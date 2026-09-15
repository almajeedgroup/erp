import {
  addProjectMemberSchema,
  createProjectSchema,
  createTimeEntrySchema,
  errorBodySchema,
  id,
  listProjectsQuerySchema,
  listTimeEntriesQuerySchema,
  okSchema,
  pageOf,
  projectMemberSchema,
  projectSchema,
  timeEntrySchema,
  updateProjectSchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  addProjectMember,
  approveTimeEntry,
  createProject,
  createTimeEntry,
  deleteProject,
  deleteTimeEntry,
  getProject,
  listProjectMembers,
  listProjects,
  listTimeEntries,
  removeProjectMember,
  updateProject,
} from './service.js';

const projectParams = z.object({ projectId: id('project') });
const projectMemberParams = z.object({ projectId: id('project'), userId: id('user') });
const timeEntryParams = z.object({ timeEntryId: id('timeEntry') });

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('project:read'),
      schema: {
        tags: ['projects'],
        summary: 'List projects',
        querystring: listProjectsQuerySchema,
        response: { 200: pageOf(projectSchema), 403: errorBodySchema },
      },
    },
    async (request) => listProjects(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('project:create'),
      schema: {
        tags: ['projects'],
        summary: 'Create a project',
        description:
          'A fixed-price project requires a budget. Project codes are unique within the ' +
          'organization.',
        body: createProjectSchema,
        response: {
          201: projectSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createProject(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:projectId',
    {
      preHandler: app.requirePermission('project:read'),
      schema: {
        tags: ['projects'],
        summary: 'Fetch one project',
        params: projectParams,
        response: { 200: projectSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getProject(request.ctx(), request.params.projectId),
  );

  app.patch(
    '/:projectId',
    {
      preHandler: app.requirePermission('project:update'),
      schema: {
        tags: ['projects'],
        summary: 'Update a project',
        description:
          'The fixed-price/budget rule is re-checked against the resulting state, so a ' +
          'project cannot be switched to fixed price without a contract value.',
        params: projectParams,
        body: updateProjectSchema,
        response: {
          200: projectSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => updateProject(request.ctx(), request.params.projectId, request.body),
  );

  app.delete(
    '/:projectId',
    {
      preHandler: app.requirePermission('project:delete'),
      schema: {
        tags: ['projects'],
        summary: 'Soft-delete a project',
        description: 'Refused with 409 once any of its time has been invoiced.',
        params: projectParams,
        response: {
          200: okSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => {
      await deleteProject(request.ctx(), request.params.projectId);
      return { ok: true as const };
    },
  );

  /* ------------------------------------------------------------- members -- */

  app.get(
    '/:projectId/members',
    {
      preHandler: app.requirePermission('project:read'),
      schema: {
        tags: ['projects'],
        summary: 'List project members',
        params: projectParams,
        response: { 200: z.array(projectMemberSchema), 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => listProjectMembers(request.ctx(), request.params.projectId),
  );

  app.post(
    '/:projectId/members',
    {
      preHandler: app.requirePermission('project:assign'),
      schema: {
        tags: ['projects'],
        summary: 'Assign someone to a project',
        params: projectParams,
        body: addProjectMemberSchema,
        response: {
          201: z.array(projectMemberSchema),
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const members = await addProjectMember(request.ctx(), request.params.projectId, request.body);
      return reply.status(201).send(members);
    },
  );

  app.delete(
    '/:projectId/members/:userId',
    {
      preHandler: app.requirePermission('project:assign'),
      schema: {
        tags: ['projects'],
        summary: 'Remove someone from a project',
        params: projectMemberParams,
        response: { 200: okSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      await removeProjectMember(request.ctx(), request.params.projectId, request.params.userId);
      return { ok: true as const };
    },
  );
};

/**
 * Time entries are mounted at the API root rather than under a project,
 * because the useful queries are cross-project: "everything Sara logged last
 * week", "all unapproved billable time".
 */
export const timeEntryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('time_entry:read'),
      schema: {
        tags: ['projects'],
        summary: 'List time entries',
        description: 'Filterable by project, employee, date range, billability and approval.',
        querystring: listTimeEntriesQuerySchema,
        response: { 200: pageOf(timeEntrySchema), 403: errorBodySchema },
      },
    },
    async (request) => listTimeEntries(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('time_entry:create'),
      schema: {
        tags: ['projects'],
        summary: 'Log time',
        description:
          'Duration is whole minutes, capped at 24 hours per entry. Refused against a ' +
          'completed or cancelled project.',
        body: createTimeEntrySchema,
        response: {
          201: timeEntrySchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createTimeEntry(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.post(
    '/:timeEntryId/approve',
    {
      preHandler: app.requirePermission('time_entry:approve'),
      schema: {
        tags: ['projects'],
        summary: 'Approve a time entry',
        description: 'Refused once the entry has been invoiced.',
        params: timeEntryParams,
        response: {
          200: timeEntrySchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => approveTimeEntry(request.ctx(), request.params.timeEntryId),
  );

  app.delete(
    '/:timeEntryId',
    {
      preHandler: app.requirePermission('time_entry:approve'),
      schema: {
        tags: ['projects'],
        summary: 'Delete a time entry',
        description:
          'Refused once the entry is on an invoice — billed time is corrected with a credit ' +
          'note, not by rewriting history.',
        params: timeEntryParams,
        response: {
          200: okSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          412: errorBodySchema,
        },
      },
    },
    async (request) => {
      await deleteTimeEntry(request.ctx(), request.params.timeEntryId);
      return { ok: true as const };
    },
  );
};
