import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authRoutes } from './modules/auth/routes.js';
import { clientRoutes } from './modules/clients/routes.js';
import { organizationRoutes } from './modules/organizations/routes.js';
import { employeeRoutes } from './modules/employees/routes.js';
import { expenseRoutes, invoiceRoutes } from './modules/finance/routes.js';
import { projectRoutes, timeEntryRoutes } from './modules/projects/routes.js';

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
  await app.register(projectRoutes, { prefix: '/projects' });
  await app.register(timeEntryRoutes, { prefix: '/time-entries' });
  await app.register(employeeRoutes, { prefix: '/employees' });
  await app.register(invoiceRoutes, { prefix: '/invoices' });
  await app.register(expenseRoutes, { prefix: '/expenses' });
};
