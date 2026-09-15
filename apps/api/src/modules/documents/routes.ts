import {
  ALLOWED_MIME_TYPES,
  createDocumentMetadataSchema,
  documentSchema,
  errorBodySchema,
  id,
  listDocumentsQuerySchema,
  okSchema,
  pageOf,
  safeFilenameSchema,
  unsupportedMediaType,
  updateDocumentSchema,
} from '@almajeed/shared';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  deleteDocument,
  downloadDocument,
  getDocument,
  listDocuments,
  updateDocument,
  uploadDocument,
} from './service.js';

const documentParams = z.object({ documentId: id('document') });

export const documentRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(multipart, {
    limits: {
      fileSize: app.services.config.storage.maxUploadBytes,
      files: 1,
      // Bound the metadata fields too: an unbounded field count is a cheap
      // memory-exhaustion vector on an endpoint that has to buffer.
      fields: 20,
      fieldSize: 8_192,
    },
  });

  app.get(
    '/',
    {
      preHandler: app.requirePermission('document:read'),
      schema: {
        tags: ['documents'],
        summary: 'List documents',
        querystring: listDocumentsQuerySchema,
        response: { 200: pageOf(documentSchema), 403: errorBodySchema },
      },
    },
    async (request) => listDocuments(request.ctx(), request.query),
  );

  /**
   * Upload.
   *
   * `multipart/form-data`, one file plus optional metadata fields. The
   * declared content type is treated as a hint; the stored type comes from the
   * file's leading bytes.
   */
  app.post(
    '/',
    {
      preHandler: app.requirePermission('document:upload'),
      schema: {
        tags: ['documents'],
        summary: 'Upload a document',
        description:
          'multipart/form-data with a `file` part and optional metadata fields (title, ' +
          'category, ownerType, ownerId, description, indexForAi, confidential, tags). ' +
          'The content type is detected from the file bytes, not taken from the request, ' +
          `and must be one of: ${ALLOWED_MIME_TYPES.join(', ')}.`,
        consumes: ['multipart/form-data'],
        response: {
          201: documentSchema,
          403: errorBodySchema,
          413: errorBodySchema,
          415: errorBodySchema,
          422: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) throw unsupportedMediaType('Expected a multipart upload with a `file` part');

      const body = await file.toBuffer();

      // Metadata arrives as string form fields; parse them through the same
      // schema a JSON body would use so defaults and bounds still apply.
      const fields = file.fields as Record<string, { value?: unknown } | undefined>;
      const field = (name: string): string | undefined => {
        const value = fields[name]?.value;
        return typeof value === 'string' ? value : undefined;
      };
      const boolField = (name: string): boolean | undefined => {
        const value = field(name);
        return value === undefined ? undefined : value === 'true' || value === '1';
      };

      const metadata = createDocumentMetadataSchema.parse({
        title: field('title'),
        category: field('category'),
        ownerType: field('ownerType'),
        ownerId: field('ownerId'),
        description: field('description'),
        indexForAi: boolField('indexForAi'),
        confidential: boolField('confidential'),
        tags: field('tags')
          ?.split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });

      const created = await uploadDocument(request.ctx(), {
        ...metadata,
        filename: safeFilenameSchema.parse(file.filename),
        declaredContentType: file.mimetype,
        body,
      });

      return reply.status(201).send(created);
    },
  );

  app.get(
    '/:documentId',
    {
      preHandler: app.requirePermission('document:read'),
      schema: {
        tags: ['documents'],
        summary: 'Fetch document metadata',
        params: documentParams,
        response: { 200: documentSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => getDocument(request.ctx(), request.params.documentId),
  );

  app.get(
    '/:documentId/download',
    {
      preHandler: app.requirePermission('document:read'),
      schema: {
        tags: ['documents'],
        summary: 'Download the file',
        description:
          'Always served as an attachment, with the detected content type and a strict ' +
          'CSP, so nothing stored here can execute in a browser. Each download is audited.',
        params: documentParams,
        // No response schema: the body is the file's bytes, not JSON. Declaring
        // only the error shapes would make the type provider narrow `send` to
        // an error body and reject the Buffer.
        produces: ['application/octet-stream'],
      },
    },
    async (request, reply) => {
      const file = await downloadDocument(request.ctx(), request.params.documentId);
      return (
        reply
          .header('content-type', file.contentType)
          // The filename is quoted and RFC 5987-encoded; never interpolated raw.
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          )
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .send(file.body)
      );
    },
  );

  app.patch(
    '/:documentId',
    {
      preHandler: app.requirePermission('document:upload'),
      schema: {
        tags: ['documents'],
        summary: 'Update document metadata',
        description:
          'Marking a document confidential, or turning off `indexForAi`, purges its chunks ' +
          'from the retrieval index immediately — the flag is not decorative.',
        params: documentParams,
        body: updateDocumentSchema,
        response: { 200: documentSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => updateDocument(request.ctx(), request.params.documentId, request.body),
  );

  app.delete(
    '/:documentId',
    {
      preHandler: app.requirePermission('document:delete'),
      schema: {
        tags: ['documents'],
        summary: 'Soft-delete a document',
        description:
          'The row is retained and the retrieval index purged; the stored object is removed ' +
          'later by the retention job, so an accidental delete is recoverable.',
        params: documentParams,
        response: { 200: okSchema, 403: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      await deleteDocument(request.ctx(), request.params.documentId);
      return { ok: true as const };
    },
  );
};
