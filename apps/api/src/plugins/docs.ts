import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { AppConfig } from '../config/env.js';

/**
 * OpenAPI.
 *
 * The specification is generated from the Zod schemas the routes already
 * validate against, so it cannot drift from the implementation — a documented
 * field that no longer exists is not expressible. `/docs` serves the browsable
 * UI and `/docs/json` the raw document for client generation.
 *
 * In production the UI is off: an interactive console against a system holding
 * payroll is not something to leave on by accident. The raw document is still
 * served, at `/openapi.json`, so client generation keeps working.
 */
export const docsPlugin = fp(
  async (app: FastifyInstance, options: { config: AppConfig }) => {
    const { config } = options;

    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Al-Majeed ERP API',
          description:
            'Clients, projects, employees, finance, documents, tasks, analytics and an AI ' +
            'agent. Every endpoint is scoped to the organization in the caller’s access ' +
            'token and gated by the permission listed in its description.',
          version: '0.1.0',
          license: { name: 'MIT' },
        },
        servers: [{ url: '/api/v1', description: 'Versioned API root' }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Short-lived access token from POST /auth/login or POST /auth/refresh.',
            },
          },
        },
        security: [{ bearerAuth: [] }],
        tags: [
          { name: 'auth', description: 'Registration, login, token rotation, password change' },
          { name: 'organization', description: 'Organization profile, members, audit log' },
          { name: 'clients', description: 'Client accounts and their contacts' },
          { name: 'projects', description: 'Projects, members and time entries' },
          { name: 'employees', description: 'People, employment and compensation' },
          { name: 'finance', description: 'Invoices, payments and expenses' },
          { name: 'documents', description: 'File upload, download and metadata' },
          { name: 'tasks', description: 'Work items and comments' },
          { name: 'analytics', description: 'Derived metrics and reports' },
          { name: 'ai', description: 'Retrieval and the agent' },
        ],
      },
      transform: jsonSchemaTransform,
    });

    if (config.isProduction) {
      // No interactive console against a system holding payroll. The raw
      // document stays available so clients can still be generated from it.
      app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
      return;
    }

    // The UI plugin serves the document at `${routePrefix}/json` itself.
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: true },
      staticCSP: true,
    });
  },
  { name: 'docs' },
);
