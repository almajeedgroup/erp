import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authRoutes } from './modules/auth/routes.js';
import { clientRoutes } from './modules/clients/routes.js';
import { organizationRoutes } from './modules/organizations/routes.js';

/**
 * The route table.
 *
 * Mounted under `/api/v1`. Versioning in the path rather than a header keeps
 * the contract obvious in a log line, a browser address bar and a curl command,
 * and makes running v1 and v2 side by side during a migration trivial.
 */
export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(organizationRoutes, { prefix: '/organization' });
  await app.register(clientRoutes, { prefix: '/clients' });
};
