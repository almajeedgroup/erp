import {
  createEmployeeSchema,
  employeeSchema,
  errorBodySchema,
  id,
  listEmployeesQuerySchema,
  okSchema,
  pageOf,
  updateEmployeeSchema,
} from '@almajeed/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from './service.js';

const employeeParams = z.object({ employeeId: id('employee') });

const SENSITIVE_NOTE =
  'Compensation, pay period, cost rate, national id and bank account are returned as null ' +
  'unless the caller holds `employee:read_sensitive`, and writing any of them requires the ' +
  'same permission.';

export const employeeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: app.requirePermission('employee:read'),
      schema: {
        tags: ['employees'],
        summary: 'List employees',
        description: SENSITIVE_NOTE,
        querystring: listEmployeesQuerySchema,
        response: { 200: pageOf(employeeSchema), 403: errorBodySchema },
      },
    },
    async (request) => listEmployees(request.ctx(), request.query),
  );

  app.post(
    '/',
    {
      preHandler: app.requirePermission('employee:create'),
      schema: {
        tags: ['employees'],
        summary: 'Create an employee record',
        description: SENSITIVE_NOTE,
        body: createEmployeeSchema,
        response: {
          201: employeeSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const created = await createEmployee(request.ctx(), request.body);
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:employeeId',
    {
      preHandler: app.requirePermission('employee:read'),
      schema: {
        tags: ['employees'],
        summary: 'Fetch one employee',
        description: SENSITIVE_NOTE,
        params: employeeParams,
        response: { 200: employeeSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getEmployee(request.ctx(), request.params.employeeId),
  );

  app.patch(
    '/:employeeId',
    {
      preHandler: app.requirePermission('employee:update'),
      schema: {
        tags: ['employees'],
        summary: 'Update an employee',
        description: SENSITIVE_NOTE,
        params: employeeParams,
        body: updateEmployeeSchema,
        response: {
          200: employeeSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => updateEmployee(request.ctx(), request.params.employeeId, request.body),
  );

  app.delete(
    '/:employeeId',
    {
      preHandler: app.requirePermission('employee:delete'),
      schema: {
        tags: ['employees'],
        summary: 'Soft-delete an employee',
        description: 'Refused with 409 while they still have direct reports.',
        params: employeeParams,
        response: {
          200: okSchema,
          403: errorBodySchema,
          404: errorBodySchema,
          409: errorBodySchema,
        },
      },
    },
    async (request) => {
      await deleteEmployee(request.ctx(), request.params.employeeId);
      return { ok: true as const };
    },
  );
};
