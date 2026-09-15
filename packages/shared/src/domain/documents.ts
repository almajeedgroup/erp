import { z } from 'zod';
import {
  id,
  longText,
  metadataSchema,
  paginationQuerySchema,
  shortText,
  tagsSchema,
} from './common.js';

/**
 * Upload safety.
 *
 * The allow-list below is the *only* thing that decides whether a file is
 * stored. Content type is re-derived from the magic bytes on the server; the
 * browser-supplied `Content-Type` is treated as a hint and nothing more.
 * Files are stored under a generated key, never the client's filename, and are
 * always served with `Content-Disposition: attachment` from a path that cannot
 * execute. See docs/08-modules/documents.md.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export const DOCUMENT_CATEGORIES = [
  'contract',
  'proposal',
  'invoice',
  'receipt',
  'report',
  'policy',
  'identification',
  'deliverable',
  'other',
] as const;
export const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);

/** What the document hangs off. Enforced as a real FK per type. */
export const DOCUMENT_OWNER_TYPES = [
  'organization',
  'client',
  'project',
  'employee',
  'invoice',
  'expense',
  'task',
] as const;
export const documentOwnerTypeSchema = z.enum(DOCUMENT_OWNER_TYPES);

/**
 * Filenames are sanitised, not trusted: no path separators, no traversal, no
 * NUL, no leading dot. This is belt-and-braces — the stored key is generated
 * server-side regardless — but it keeps the display name harmless too.
 */
export const safeFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\'), 'must not contain path separators')
  .refine((v) => !v.includes('\0'), 'must not contain null bytes')
  .refine(
    (v) => v !== '.' && v !== '..' && !v.startsWith('.'),
    'must not be a dotfile or traversal',
  );

export const createDocumentMetadataSchema = z.strictObject({
  title: shortText.optional(),
  category: documentCategorySchema.default('other'),
  ownerType: documentOwnerTypeSchema.default('organization'),
  ownerId: z.string().max(64).optional(),
  description: longText.optional(),
  /** Opt this document into AI retrieval. Off by default — retrieval is consent-based. */
  indexForAi: z.boolean().default(false),
  confidential: z.boolean().default(false),
  tags: tagsSchema,
  metadata: metadataSchema,
});

export const updateDocumentSchema = z.strictObject({
  title: shortText.optional(),
  category: documentCategorySchema.optional(),
  description: longText.optional(),
  indexForAi: z.boolean().optional(),
  confidential: z.boolean().optional(),
  tags: tagsSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  category: documentCategorySchema.optional(),
  ownerType: documentOwnerTypeSchema.optional(),
  ownerId: z.string().max(64).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const documentSchema = z.object({
  id: id('document'),
  title: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** SHA-256 of the stored bytes; doubles as a duplicate-upload check. */
  checksum: z.string(),
  category: documentCategorySchema,
  ownerType: documentOwnerTypeSchema,
  ownerId: z.string().nullable(),
  confidential: z.boolean(),
  indexForAi: z.boolean(),
  tags: z.array(z.string()),
  createdAt: z.string(),
});

export type CreateDocumentMetadata = z.infer<typeof createDocumentMetadataSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
