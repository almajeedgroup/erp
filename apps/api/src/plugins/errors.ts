import { AppError, type FieldIssue, internalError, notFound, rateLimited } from '@almajeed/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

/**
 * The single error boundary.
 *
 * Handled failures (`AppError`) are reported with their code, their message and
 * — for validation — the specific fields at fault. Everything else is a bug:
 * it is logged in full, with the stack and the cause chain, and the client gets
 * a bare 500 carrying only the request id. That asymmetry is deliberate.
 * Stack traces, SQL fragments and driver messages in an HTTP response are a
 * reconnaissance gift, and "Security Misconfiguration" in the OWASP Top 10 is
 * mostly this mistake.
 *
 * The request id is echoed in the body and in the `x-request-id` header, so a
 * user can quote it and an operator can find the exact log line.
 */

const SERIALIZATION_FAILURE_MESSAGE =
  'The response did not match its declared schema. This is a server bug.';

export const errorsPlugin = fp(
  async (app: FastifyInstance) => {
    app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
      const error = notFound('Route');
      await reply.status(error.status).send(error.toBody(request.id));
    });

    app.setErrorHandler(async (error: FastifyError, request, reply) => {
      const requestId = request.id;

      // 1. Schema validation, translated into the shared field-issue shape.
      if (hasZodFastifySchemaValidationErrors(error)) {
        const issues: FieldIssue[] = error.validation.map((item) => ({
          path: formatInstancePath(item.instancePath),
          message: item.message ?? 'Invalid value',
        }));
        const appError = new AppError('validation_failed', 'Request validation failed', { issues });
        request.log.info({ requestId, issues }, 'request rejected by validation');
        return reply.status(appError.status).send(appError.toBody(requestId));
      }

      // 2. A response that does not match its own schema is our bug, and it is
      //    worth shouting about: it means a handler returned the wrong shape.
      if (isResponseSerializationError(error)) {
        request.log.error(
          { requestId, err: error, route: `${request.method} ${request.url}` },
          'response serialization failed',
        );
        return reply.status(500).send({
          error: { code: 'internal_error', message: SERIALIZATION_FAILURE_MESSAGE, requestId },
        });
      }

      // 3. Deliberate, well-typed failures.
      if (AppError.is(error)) {
        const log = error.expected ? request.log.info : request.log.error;
        log.call(
          request.log,
          {
            requestId,
            code: error.code,
            details: error.details,
            ...(error.expected ? {} : { err: error }),
          },
          `request failed: ${error.code}`,
        );
        return reply.status(error.status).send(error.toBody(requestId));
      }

      // 4. Fastify's own transport-level errors, which carry usable statuses.
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;

      if (statusCode === 429) {
        return reply.status(429).send(rateLimited().toBody(requestId));
      }

      if (statusCode === 413) {
        return reply.status(413).send({
          error: {
            code: 'payload_too_large',
            message: 'Payload exceeds the permitted size',
            requestId,
          },
        });
      }

      if (statusCode >= 400 && statusCode < 500) {
        return reply.status(statusCode).send({
          error: {
            code: statusCode === 401 ? 'unauthenticated' : 'validation_failed',
            message: error.message || 'Request could not be processed',
            requestId,
          },
        });
      }

      // 5. Anything left is unhandled. Log everything, disclose nothing.
      request.log.error(
        { requestId, err: error, route: `${request.method} ${request.url}` },
        'unhandled error',
      );
      return reply.status(500).send(internalError(error).toBody(requestId));
    });
  },
  { name: 'errors' },
);

/** `/lines/0/unitPrice` -> `lines[0].unitPrice`. */
function formatInstancePath(instancePath: string): string {
  if (!instancePath || instancePath === '/') return '(root)';
  return instancePath
    .replace(/^\//, '')
    .split('/')
    .reduce((acc, segment) => {
      if (acc === '') return segment;
      return /^\d+$/.test(segment) ? `${acc}[${segment}]` : `${acc}.${segment}`;
    }, '');
}
