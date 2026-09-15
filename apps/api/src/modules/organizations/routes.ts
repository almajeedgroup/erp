import {
  currencySchema,
  errorBodySchema,
  id,
  inviteMemberSchema,
  okSchema,
  pageOf,
  paginationQuerySchema,
  roleSchema,
  shortText,
  updateMemberRoleSchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getOrganization,
  inviteMember,
  listAuditLog,
  listMembers,
  removeMember,
  updateMemberRole,
  updateOrganization,
} from './service.js';

const organizationSchema = z.object({
  id: id('organization'),
  name: z.string(),
  slug: z.string(),
  baseCurrency: z.string(),
  country: z.string().nullable(),
  timezone: z.string(),
  vatNumber: z.string().nullable(),
  defaultTaxRate: z.number().int(),
  createdAt: z.string(),
});

const updateOrganizationSchema = z.strictObject({
  name: shortText.optional(),
  baseCurrency: currencySchema.optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  timezone: z.string().trim().max(64).optional(),
  vatNumber: z.string().trim().max(50).optional(),
  defaultTaxRate: z.number().int().min(0).max(100).optional(),
});

const memberSchema = z.object({
  userId: id('user'),
  membershipId: id('membership'),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  status: z.string(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

const auditSchema = z.object({
  id: id('auditLog'),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  succeeded: z.boolean(),
  requestId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  createdAt: z.string(),
});

const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(60).optional(),
});

const memberParams = z.object({ userId: id('user') });

export const organizationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('organization:read'),
      schema: {
        tags: ['organization'],
        summary: 'Fetch the current organization',
        response: { 200: organizationSchema, 403: errorBodySchema },
      },
    },
    async (request) => getOrganization(request.ctx()),
  );

  app.patch(
    '/',
    {
      preHandler: app.requirePermission('organization:update'),
      schema: {
        tags: ['organization'],
        summary: 'Update organization settings',
        body: updateOrganizationSchema,
        response: { 200: organizationSchema, 403: errorBodySchema, 422: errorBodySchema },
      },
    },
    async (request) => updateOrganization(request.ctx(), request.body),
  );

  app.get(
    '/members',
    {
      preHandler: app.requirePermission('member:read'),
      schema: {
        tags: ['organization'],
        summary: 'List members and their roles',
        response: { 200: z.array(memberSchema), 403: errorBodySchema },
      },
    },
    async (request) => listMembers(request.ctx()),
  );

  app.post(
    '/members',
    {
      preHandler: app.requirePermission('member:invite'),
      schema: {
        tags: ['organization'],
        summary: 'Add a member',
        description:
          'The caller may only grant a role strictly below their own, and only an owner ' +
          'can create another owner. Requires `member:invite`.',
        body: inviteMemberSchema,
        response: {
          201: memberSchema,
          403: errorBodySchema,
          409: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const member = await inviteMember(request.ctx(), request.body);
      return reply.status(201).send(member);
    },
  );

  app.patch(
    '/members/:userId/role',
    {
      preHandler: app.requirePermission('member:update_role'),
      schema: {
        tags: ['organization'],
        summary: 'Change a member’s role',
        description:
          'Subject to the same escalation rules as adding a member, and refuses to demote ' +
          'the last remaining owner.',
        params: memberParams,
        body: updateMemberRoleSchema,
        response: {
          200: memberSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => updateMemberRole(request.ctx(), request.params.userId, request.body.role),
  );

  app.delete(
    '/members/:userId',
    {
      preHandler: app.requirePermission('member:remove'),
      schema: {
        tags: ['organization'],
        summary: 'Revoke a membership',
        description: 'Also revokes that member’s live sessions in the same transaction.',
        params: memberParams,
        response: {
          200: okSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => {
      await removeMember(request.ctx(), request.params.userId);
      return { ok: true as const };
    },
  );

  app.get(
    '/audit',
    {
      preHandler: app.requirePermission('audit:read'),
      schema: {
        tags: ['organization'],
        summary: 'Read the audit log',
        description:
          'Append-only record of every state change, including denied attempts. Requires ' +
          '`audit:read`, which only owners and admins hold.',
        querystring: auditQuerySchema,
        response: { 200: pageOf(auditSchema), 403: errorBodySchema },
      },
    },
    async (request) => listAuditLog(request.ctx(), request.query),
  );
};
