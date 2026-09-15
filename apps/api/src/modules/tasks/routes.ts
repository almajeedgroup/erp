import {
  createCommentSchema,
  createTaskSchema,
  errorBodySchema,
  id,
  listTasksQuerySchema,
  okSchema,
  pageOf,
  taskCommentSchema,
  taskSchema,
  updateTaskSchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  addComment,
  createTask,
  deleteComment,
  deleteTask,
  getTask,
  listComments,
  listTasks,
  updateTask,
} from './service.js';

const taskParams = z.object({ taskId: id('task') });
const commentParams = z.object({ taskId: id('task'), commentId: id('comment') });

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('task:read'),
      schema: {
        tags: ['tasks'],
        summary: 'List tasks',
        description:
          '`overdue` is derived from the due date and status at read time. `loggedMinutes` ' +
          'is aggregated for the whole page in one query rather than per row.',
        querystring: listTasksQuerySchema,
        response: { 200: pageOf(taskSchema), 403: errorBodySchema },
      },
    },
    async (request) => listTasks(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('task:create'),
      schema: {
        tags: ['tasks'],
        summary: 'Create a task',
        body: createTaskSchema,
        response: {
          201: taskSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createTask(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:taskId',
    {
      preHandler: app.requirePermission('task:read'),
      schema: {
        tags: ['tasks'],
        summary: 'Fetch one task',
        params: taskParams,
        response: { 200: taskSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getTask(request.ctx(), request.params.taskId),
  );

  app.patch(
    '/:taskId',
    {
      preHandler: app.requirePermission('task:update'),
      schema: {
        tags: ['tasks'],
        summary: 'Update a task',
        description:
          '`completedAt` is a consequence of the status and cannot be set directly — a ' +
          'client-supplied completion time is how a burn-down chart starts lying.',
        params: taskParams,
        body: updateTaskSchema,
        response: { 200: taskSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => updateTask(request.ctx(), request.params.taskId, request.body),
  );

  app.delete(
    '/:taskId',
    {
      preHandler: app.requirePermission('task:delete'),
      schema: {
        tags: ['tasks'],
        summary: 'Soft-delete a task',
        description: 'Refused with 409 while it still has subtasks.',
        params: taskParams,
        response: {
          200: okSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => {
      await deleteTask(request.ctx(), request.params.taskId);
      return { ok: true as const };
    },
  );

  app.get(
    '/:taskId/comments',
    {
      preHandler: app.requirePermission('task:read'),
      schema: {
        tags: ['tasks'],
        summary: 'List comments on a task',
        params: taskParams,
        response: {
          200: z.array(taskCommentSchema),
          403: errorBodySchema,
          404: errorBodySchema,
        },
      },
    },
    async (request) => listComments(request.ctx(), request.params.taskId),
  );

  app.post(
    '/:taskId/comments',
    {
      preHandler: app.requirePermission('task:update'),
      schema: {
        tags: ['tasks'],
        summary: 'Comment on a task',
        params: taskParams,
        body: createCommentSchema,
        response: {
          201: taskCommentSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await addComment(request.ctx(), request.params.taskId, request.body.body);
      return reply.status(201).send(created);
    },
  );

  app.delete(
    '/:taskId/comments/:commentId',
    {
      preHandler: app.requirePermission('task:update'),
      schema: {
        tags: ['tasks'],
        summary: 'Delete your own comment',
        description:
          'Only the author may remove a comment. Moderating someone else’s would need its ' +
          'own permission rather than riding on `task:update`.',
        params: commentParams,
        response: { 200: okSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      await deleteComment(request.ctx(), request.params.taskId, request.params.commentId);
      return { ok: true as const };
    },
  );
};
