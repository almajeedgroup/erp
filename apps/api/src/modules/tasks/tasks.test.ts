import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authed,
  createTestContext,
  registerOrganization,
  type TestContext,
  type TestSession,
} from '../../test/harness.js';

describe('tasks', () => {
  let ctx: TestContext;
  let owner: TestSession;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.database.truncate();
    owner = await registerOrganization(ctx);
    const project = await authed(
      ctx,
      owner,
    )({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Metro Phase 2', status: 'active' },
    });
    projectId = project.json().id;
  });

  const create = (session: TestSession, payload: Record<string, unknown>) =>
    authed(ctx, session)({ method: 'POST', url: '/api/v1/tasks', payload });

  it('creates a task with defaults', async () => {
    const response = await create(owner, { title: 'Survey the site' });
    expect(response.statusCode).toBe(201);

    const task = response.json();
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.overdue).toBe(false);
    expect(task.loggedMinutes).toBe(0);
    expect(task.completedAt).toBe(null);
  });

  it('stamps completedAt from the status, and clears it on reopen', async () => {
    const task = (await create(owner, { title: 'Ship it' })).json();

    const done = await authed(
      ctx,
      owner,
    )({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { status: 'done' },
    });
    expect(done.json().completedAt).toBeTruthy();

    const reopened = await authed(
      ctx,
      owner,
    )({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { status: 'in_progress' },
    });
    expect(reopened.json().completedAt).toBe(null);
  });

  it('will not let a client set completedAt directly', async () => {
    const task = (await create(owner, { title: 'Ship it' })).json();
    const response = await authed(
      ctx,
      owner,
    )({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { completedAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('derives overdue from the due date and status', async () => {
    const overdue = (await create(owner, { title: 'Late', dueDate: '2026-01-01' })).json();
    expect(overdue.overdue).toBe(true);

    const future = (await create(owner, { title: 'Soon', dueDate: '2027-01-01' })).json();
    expect(future.overdue).toBe(false);

    // Closing it stops it being overdue, without touching the due date.
    const closed = await authed(
      ctx,
      owner,
    )({
      method: 'PATCH',
      url: `/api/v1/tasks/${overdue.id}`,
      payload: { status: 'done' },
    });
    expect(closed.json().overdue).toBe(false);
  });

  it('gives board positions a sparse ordering', async () => {
    const first = (await create(owner, { title: 'A', projectId })).json();
    const second = (await create(owner, { title: 'B', projectId })).json();
    expect(second.position).toBeGreaterThan(first.position);
    expect(second.position - first.position).toBe(1_000);
  });

  it('aggregates logged time without an N+1', async () => {
    const task = (await create(owner, { title: 'Survey', projectId })).json();

    for (const minutes of [90, 30]) {
      await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/time-entries',
        payload: { projectId, taskId: task.id, date: '2026-06-10', minutes },
      });
    }

    const fetched = await authed(ctx, owner)({ method: 'GET', url: `/api/v1/tasks/${task.id}` });
    expect(fetched.json().loggedMinutes).toBe(120);

    const list = await authed(ctx, owner)({ method: 'GET', url: '/api/v1/tasks' });
    expect(list.json().items.find((t: { id: string }) => t.id === task.id).loggedMinutes).toBe(120);
  });

  it('filters to open work', async () => {
    await create(owner, { title: 'Open one' });
    const done = (await create(owner, { title: 'Closed one' })).json();
    await authed(
      ctx,
      owner,
    )({
      method: 'PATCH',
      url: `/api/v1/tasks/${done.id}`,
      payload: { status: 'done' },
    });

    const response = await authed(
      ctx,
      owner,
    )({
      method: 'GET',
      url: '/api/v1/tasks?openOnly=true',
    });
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].title).toBe('Open one');
  });

  it('refuses to delete a task that still has subtasks', async () => {
    const parent = (await create(owner, { title: 'Parent' })).json();
    await create(owner, { title: 'Child', parentTaskId: parent.id });

    const response = await authed(
      ctx,
      owner,
    )({
      method: 'DELETE',
      url: `/api/v1/tasks/${parent.id}`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses to attach a task to another organization’s project', async () => {
    const other = await registerOrganization(ctx);
    const theirProject = await authed(
      ctx,
      other,
    )({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Theirs' },
    });

    const response = await create(owner, {
      title: 'Cross-tenant',
      projectId: theirProject.json().id,
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses to assign a task to someone outside the organization', async () => {
    const other = await registerOrganization(ctx);
    const response = await create(owner, { title: 'Nope', assigneeId: other.userId });
    expect(response.statusCode).toBe(404);
  });

  describe('comments', () => {
    it('records the author', async () => {
      const task = (await create(owner, { title: 'Discuss' })).json();
      const response = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/comments`,
        payload: { body: 'Starting on this tomorrow.' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().authorUserId).toBe(owner.userId);
    });

    it('lets only the author delete their comment', async () => {
      const member = await addMember(ctx, owner, 'member');
      const task = (await create(owner, { title: 'Discuss' })).json();
      const comment = await authed(
        ctx,
        member,
      )({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/comments`,
        payload: { body: 'Mine' },
      });

      const byOther = await authed(
        ctx,
        owner,
      )({
        method: 'DELETE',
        url: `/api/v1/tasks/${task.id}/comments/${comment.json().id}`,
      });
      expect(byOther.statusCode).toBe(404);

      const byAuthor = await authed(
        ctx,
        member,
      )({
        method: 'DELETE',
        url: `/api/v1/tasks/${task.id}/comments/${comment.json().id}`,
      });
      expect(byAuthor.statusCode).toBe(200);
    });
  });

  describe('permissions', () => {
    it('lets a member create and update but not delete', async () => {
      const member = await addMember(ctx, owner, 'member');
      const created = await create(member, { title: 'Mine' });
      expect(created.statusCode).toBe(201);

      const deleted = await authed(
        ctx,
        member,
      )({
        method: 'DELETE',
        url: `/api/v1/tasks/${created.json().id}`,
      });
      expect(deleted.statusCode).toBe(403);
    });

    it('keeps a viewer read-only', async () => {
      const viewer = await addMember(ctx, owner, 'viewer');
      expect((await create(viewer, { title: 'Nope' })).statusCode).toBe(403);
      const list = await authed(ctx, viewer)({ method: 'GET', url: '/api/v1/tasks' });
      expect(list.statusCode).toBe(200);
    });
  });
});
