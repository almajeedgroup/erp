import {
  type CreateDocumentMetadata,
  type DocumentRecord,
  type Page,
  isAllowedMimeType,
  newId,
  payloadTooLarge,
  unsupportedMediaType,
} from '@almajeed/shared';
import { documents, scope, scopeById } from '@almajeed/db';
import { type SQL, eq, ilike, or } from 'drizzle-orm';
import type { RequestContext } from '../../context.js';
import { writeAudit } from '../../lib/audit.js';
import { detectContentType } from '../../lib/filetype.js';
import { likePattern, mapPage } from '../../lib/query.js';
import { findByIdOrThrow, paginate } from '../../lib/repository.js';
import { iso } from '../../lib/serialize.js';
import { buildStorageKey } from '../../lib/storage.js';
import {
  INDEXABLE_CONTENT_TYPES,
  indexDocument,
  removeDocumentFromIndex,
} from '../ai/retrieval.js';

/**
 * Documents.
 *
 * The upload pipeline, in order, and every step is load-bearing:
 *
 *  1. Enforce the size limit while reading, not after — a limit checked after
 *     buffering is not a limit.
 *  2. Sniff the content type from the leading bytes. The browser's
 *     `Content-Type` is a claim by the uploader, and uploaders include
 *     attackers; `invoice.pdf` that is really HTML must not be stored as HTML.
 *  3. Check the *sniffed* type against the allow-list.
 *  4. Store under a generated key. The client's filename never touches the
 *     path; it is kept as a display name only.
 *  5. Record the SHA-256 of the stored bytes, which doubles as a duplicate check.
 *  6. Index for retrieval only if the uploader opted in and the document is
 *     not confidential.
 *
 * Downloads are always served as an attachment with the sniffed type, so
 * nothing stored here can be coaxed into executing in a browser.
 */

interface DocumentRow {
  id: string;
  title: string;
  filename: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  category: string;
  ownerType: string;
  ownerId: string | null;
  description: string | null;
  indexForAi: boolean;
  confidential: boolean;
  uploadedByUserId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const selection = {
  id: documents.id,
  title: documents.title,
  filename: documents.filename,
  storageKey: documents.storageKey,
  contentType: documents.contentType,
  sizeBytes: documents.sizeBytes,
  checksum: documents.checksum,
  category: documents.category,
  ownerType: documents.ownerType,
  ownerId: documents.ownerId,
  description: documents.description,
  indexForAi: documents.indexForAi,
  confidential: documents.confidential,
  uploadedByUserId: documents.uploadedByUserId,
  tags: documents.tags,
  metadata: documents.metadata,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    category: row.category as DocumentRecord['category'],
    ownerType: row.ownerType as DocumentRecord['ownerType'],
    ownerId: row.ownerId,
    confidential: row.confidential,
    indexForAi: row.indexForAi,
    tags: row.tags,
    createdAt: iso(row.createdAt),
  };
}

export async function listDocuments(
  ctx: RequestContext,
  query: {
    limit: number;
    cursor?: string;
    category?: string;
    ownerType?: string;
    ownerId?: string;
    q?: string;
  },
): Promise<Page<DocumentRecord>> {
  const filters: (SQL | undefined)[] = [];
  if (query.category) filters.push(eq(documents.category, query.category as never));
  if (query.ownerType) filters.push(eq(documents.ownerType, query.ownerType as never));
  if (query.ownerId) filters.push(eq(documents.ownerId, query.ownerId));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(or(ilike(documents.title, pattern), ilike(documents.filename, pattern)));
  }

  const page = await paginate<DocumentRow>(
    ctx.db.select(selection).from(documents).$dynamic(),
    documents,
    ctx,
    { limit: query.limit, cursor: query.cursor, filters },
  );
  return mapPage(page, toDocument);
}

async function getDocumentRow(ctx: RequestContext, id: string): Promise<DocumentRow> {
  return findByIdOrThrow<DocumentRow>(
    ctx.db.select(selection).from(documents).$dynamic(),
    documents,
    ctx,
    id,
    'Document',
  );
}

export async function getDocument(ctx: RequestContext, id: string): Promise<DocumentRecord> {
  return toDocument(await getDocumentRow(ctx, id));
}

export interface UploadInput extends CreateDocumentMetadata {
  filename: string;
  declaredContentType: string | undefined;
  body: Buffer;
}

export async function uploadDocument(
  ctx: RequestContext,
  input: UploadInput,
): Promise<DocumentRecord> {
  if (input.body.byteLength === 0) {
    throw unsupportedMediaType('The uploaded file is empty');
  }
  if (input.body.byteLength > ctx.services.config.storage.maxUploadBytes) {
    throw payloadTooLarge(
      `Files are limited to ${ctx.services.config.storage.maxUploadBytes} bytes`,
    );
  }

  // The sniffed type wins over the declared one, and it is what gets stored.
  const detected = detectContentType(input.body, input.declaredContentType);
  if (!isAllowedMimeType(detected.contentType)) {
    throw unsupportedMediaType(
      `Files of type "${detected.contentType}" are not accepted. See the allow-list in the API docs.`,
    );
  }

  const id = newId('document');
  const storageKey = buildStorageKey(ctx.auth.organizationId, ctx.now);
  const stored = await ctx.services.storage.put(storageKey, input.body, detected.contentType);

  const shouldIndex = input.indexForAi && !input.confidential;

  try {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id,
        organizationId: ctx.auth.organizationId,
        title: input.title ?? input.filename,
        filename: input.filename,
        storageKey: stored.key,
        contentType: detected.contentType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        category: input.category,
        ownerType: input.ownerType,
        ownerId: input.ownerId ?? null,
        description: input.description ?? null,
        indexForAi: shouldIndex,
        confidential: input.confidential,
        uploadedByUserId: ctx.auth.userId,
        tags: input.tags,
        metadata: input.metadata,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });

      await writeAudit(tx, {
        organizationId: ctx.auth.organizationId,
        actorUserId: ctx.auth.userId,
        action: 'document.uploaded',
        resourceType: 'document',
        resourceId: id,
        after: {
          filename: input.filename,
          contentType: detected.contentType,
          sizeBytes: stored.sizeBytes,
          declaredContentType: input.declaredContentType ?? null,
        },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    });
  } catch (error) {
    // The bytes are already in storage; if the row could not be written, that
    // object is unreferenced and has to go, or storage grows forever.
    await ctx.services.storage.delete(stored.key).catch(() => undefined);
    throw error;
  }

  if (shouldIndex && INDEXABLE_CONTENT_TYPES.has(detected.contentType)) {
    await indexDocument(ctx, id, input.body.toString('utf8'));
  }

  return getDocument(ctx, id);
}

export interface DownloadResult {
  filename: string;
  contentType: string;
  body: Buffer;
}

export async function downloadDocument(ctx: RequestContext, id: string): Promise<DownloadResult> {
  const row = await getDocumentRow(ctx, id);
  const body = await ctx.services.storage.get(row.storageKey);

  await writeAudit(ctx.db, {
    organizationId: ctx.auth.organizationId,
    actorUserId: ctx.auth.userId,
    action: 'document.downloaded',
    resourceType: 'document',
    resourceId: id,
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { filename: row.filename, contentType: row.contentType, body };
}

export async function updateDocument(
  ctx: RequestContext,
  id: string,
  input: {
    title?: string;
    category?: string;
    description?: string;
    indexForAi?: boolean;
    confidential?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<DocumentRecord> {
  const before = await getDocumentRow(ctx, id);

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  for (const key of [
    'title',
    'category',
    'description',
    'indexForAi',
    'confidential',
    'tags',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  const nextIndexed = (patch.indexForAi as boolean | undefined) ?? before.indexForAi;
  const nextConfidential = (patch.confidential as boolean | undefined) ?? before.confidential;
  const shouldIndex = nextIndexed && !nextConfidential;
  patch.indexForAi = shouldIndex;

  await ctx.db
    .update(documents)
    .set(patch)
    .where(scopeById(documents, ctx.auth.organizationId, id));

  // Marking a document confidential, or opting it out of AI, must actually
  // remove it from the index — leaving stale chunks would make the flag
  // decorative.
  if (!shouldIndex) {
    await removeDocumentFromIndex(ctx, id);
  } else if (!before.indexForAi && INDEXABLE_CONTENT_TYPES.has(before.contentType)) {
    const body = await ctx.services.storage.get(before.storageKey);
    await indexDocument(ctx, id, body.toString('utf8'));
  }

  await writeAudit(ctx.db, {
    organizationId: ctx.auth.organizationId,
    actorUserId: ctx.auth.userId,
    action: 'document.updated',
    resourceType: 'document',
    resourceId: id,
    before: { indexForAi: before.indexForAi, confidential: before.confidential },
    after: { indexForAi: shouldIndex, confidential: nextConfidential },
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return getDocument(ctx, id);
}

/**
 * Delete a document.
 *
 * The row is soft-deleted and the retrieval index is purged immediately, but
 * the stored object is left for the retention job. Deleting bytes synchronously
 * makes an accidental delete unrecoverable, and "undo" is a feature people
 * expect from a document store.
 */
export async function deleteDocument(ctx: RequestContext, id: string): Promise<void> {
  const row = await getDocumentRow(ctx, id);

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ deletedAt: ctx.now, indexForAi: false, updatedAt: ctx.now })
      .where(scopeById(documents, ctx.auth.organizationId, id));
    await writeAudit(tx, {
      organizationId: ctx.auth.organizationId,
      actorUserId: ctx.auth.userId,
      action: 'document.deleted',
      resourceType: 'document',
      resourceId: id,
      before: { filename: row.filename, storageKey: row.storageKey },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  });

  await removeDocumentFromIndex(ctx, id);
}

/** Count of this organization's documents currently available to retrieval. */
export async function indexedDocumentCount(ctx: RequestContext): Promise<number> {
  const rows = await ctx.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      scope(
        documents,
        ctx.auth.organizationId,
        eq(documents.indexForAi, true),
        eq(documents.confidential, false),
      ),
    );
  return rows.length;
}
