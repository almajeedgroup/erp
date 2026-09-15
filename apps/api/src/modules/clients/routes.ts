import {
  clientSchema,
  contactSchema,
  createClientSchema,
  createContactSchema,
  errorBodySchema,
  id,
  listClientsQuerySchema,
  okSchema,
  pageOf,
  updateClientSchema,
} from '@almajeed/shared';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createClient,
  createContact,
  deleteClient,
  deleteContact,
  getClient,
  listClients,
  listContacts,
  updateClient,
} from './service.js';

const clientParams = z.object({ clientId: id('client') });
const contactParams = z.object({ clientId: id('client'), contactId: id('contact') });

/**
 * Client routes.
 *
 * Every handler takes its organization from `request.ctx()`, which reads the
 * verified token — the `clientId` in the path is only ever used together with
 * that scope, so a valid id belonging to another tenant returns 404.
 */
export const clientRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('client:read'),
      schema: {
        tags: ['clients'],
        summary: 'List clients',
        description:
          'Keyset-paginated, newest first. Requires `client:read`. Filterable by status, ' +
          'tag and a free-text query over name, legal name and email.',
        querystring: listClientsQuerySchema,
        response: { 200: pageOf(clientSchema), 403: errorBodySchema },
      },
    },
    async (request) => listClients(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('client:create'),
      schema: {
        tags: ['clients'],
        summary: 'Create a client',
        description: 'Requires `client:create`.',
        body: createClientSchema,
        response: { 201: clientSchema, 403: errorBodySchema, 422: errorBodySchema },
      },
    },
    async (request, reply) => {
      const created = await createClient(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:clientId',
    {
      preHandler: app.requirePermission('client:read'),
      schema: {
        tags: ['clients'],
        summary: 'Fetch one client',
        params: clientParams,
        response: { 200: clientSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getClient(request.ctx(), request.params.clientId),
  );

  app.patch(
    '/:clientId',
    {
      preHandler: app.requirePermission('client:update'),
      schema: {
        tags: ['clients'],
        summary: 'Update a client',
        description: 'Partial update. Requires `client:update`.',
        params: clientParams,
        body: updateClientSchema,
        response: {
          200: clientSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request) => updateClient(request.ctx(), request.params.clientId, request.body),
  );

  app.delete(
    '/:clientId',
    {
      preHandler: app.requirePermission('client:delete'),
      schema: {
        tags: ['clients'],
        summary: 'Soft-delete a client',
        description:
          'Refused with 409 while the client still has active projects or unpaid invoices. ' +
          'The row is retained so financial history stays intact.',
        params: clientParams,
        response: {
          200: okSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => {
      await deleteClient(request.ctx(), request.params.clientId);
      return { ok: true as const };
    },
  );

  /* ------------------------------------------------------------ contacts -- */

  app.get(
    '/:clientId/contacts',
    {
      preHandler: app.requirePermission('client:read'),
      schema: {
        tags: ['clients'],
        summary: 'List a client’s contacts',
        params: clientParams,
        response: { 200: z.array(contactSchema), 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => listContacts(request.ctx(), request.params.clientId),
  );

  app.post(
    '/:clientId/contacts',
    {
      preHandler: app.requirePermission('client:update'),
      schema: {
        tags: ['clients'],
        summary: 'Add a contact',
        description:
          'Marking a contact primary demotes the previous one in the same transaction; a ' +
          'partial unique index guarantees at most one live primary per client.',
        params: clientParams,
        body: createContactSchema,
        response: {
          201: contactSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createContact(request.ctx(), request.params.clientId, request.body);
      return reply.status(201).send(created);
    },
  );

  app.delete(
    '/:clientId/contacts/:contactId',
    {
      preHandler: app.requirePermission('client:update'),
      schema: {
        tags: ['clients'],
        summary: 'Remove a contact',
        params: contactParams,
        response: { 200: okSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      await deleteContact(request.ctx(), request.params.clientId, request.params.contactId);
      return { ok: true as const };
    },
  );
};
