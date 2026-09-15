import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn, metadataColumn, softDelete, tagsColumn, timestamps } from './columns.js';
import { documentCategoryEnum, documentOwnerTypeEnum } from './enums.js';
import { organizations, users } from './tenancy.js';

/**
 * Documents.
 *
 * The row is metadata; the bytes live in object storage under `storage_key`,
 * a server-generated path that never contains user input. `checksum` is the
 * SHA-256 of the stored bytes and doubles as a cheap duplicate check.
 *
 * `content_type` is the type the server *detected*, not the one the browser
 * claimed. See docs/08-modules/documents.md for the upload pipeline.
 */
export const documents = pgTable(
  'documents',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    /** The client's original filename, sanitised. Display only. */
    filename: varchar('filename', { length: 255 }).notNull(),
    /** Opaque storage path, generated server-side. Never derived from input. */
    storageKey: varchar('storage_key', { length: 512 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: char('checksum', { length: 64 }).notNull(),
    category: documentCategoryEnum('category').notNull().default('other'),
    ownerType: documentOwnerTypeEnum('owner_type').notNull().default('organization'),
    ownerId: varchar('owner_id', { length: 64 }),
    description: text('description'),
    /** Opt-in to AI retrieval. Nothing is indexed without this being true. */
    indexForAi: boolean('index_for_ai').notNull().default(false),
    /** Excluded from retrieval and from exports regardless of `indexForAi`. */
    confidential: boolean('confidential').notNull().default(false),
    uploadedByUserId: idColumn('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    tags: tagsColumn(),
    metadata: metadataColumn(),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('documents_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('documents_owner_idx').on(table.organizationId, table.ownerType, table.ownerId),
    index('documents_org_category_idx').on(table.organizationId, table.category),
    index('documents_checksum_idx').on(table.organizationId, table.checksum),
  ],
);

/**
 * Retrieval chunks.
 *
 * Embeddings are stored as a JSONB array of floats rather than a `vector`
 * column. ADR-0005 records why: it keeps the test suite hermetic (no pgvector
 * extension, no container) and in-process cosine over a tenant's chunks is
 * comfortably fast at the corpus sizes this product sees. The migration path
 * to pgvector — and the threshold that should trigger it — is written down in
 * the same ADR.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: idColumn().primaryKey(),
    organizationId: idColumn('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: idColumn('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    embedding: jsonb('embedding').$type<number[]>(),
    /** Name of the model that produced `embedding`; a change forces a reindex. */
    embeddingModel: varchar('embedding_model', { length: 80 }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('document_chunks_document_idx').on(table.documentId, table.chunkIndex),
    index('document_chunks_org_idx').on(table.organizationId),
  ],
);

export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id],
  }),
  uploadedBy: one(users, { fields: [documents.uploadedByUserId], references: [users.id] }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, { fields: [documentChunks.documentId], references: [documents.id] }),
}));
