import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  authed,
  createTestContext,
  registerOrganization,
  type TestContext,
  type TestSession,
} from '../../test/harness.js';

/**
 * Build a multipart request body the way a browser would.
 *
 * `FormData`, `File` and `Response` are Node globals from undici, so the body
 * is encoded by the same code path a real browser upload goes through rather
 * than by a hand-rolled boundary string.
 */
async function multipart(
  file: { name: string; type: string; content: Buffer | string },
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const bytes = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;
  form.set('file', new File([bytes], file.name, { type: file.type }));

  const response = new Response(form);
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType: response.headers.get('content-type') ?? '' };
}

const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from('1 0 obj<</Type/Catalog>>endobj\n'),
]);
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

describe('documents', () => {
  let ctx: TestContext;
  let owner: TestSession;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.database.truncate();
    owner = await registerOrganization(ctx);
  });

  const upload = async (
    session: TestSession,
    file: Parameters<typeof multipart>[0],
    fields: Record<string, string> = {},
  ) => {
    const { body, contentType } = await multipart(file, fields);
    return ctx.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...session.headers, 'content-type': contentType },
      payload: body,
    });
  };

  describe('upload', () => {
    it('stores a PDF and records its checksum and size', async () => {
      const response = await upload(owner, {
        name: 'contract.pdf',
        type: 'application/pdf',
        content: PDF_BYTES,
      });

      expect(response.statusCode).toBe(201);
      const document = response.json();
      expect(document.contentType).toBe('application/pdf');
      expect(document.sizeBytes).toBe(PDF_BYTES.byteLength);
      expect(document.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(document.filename).toBe('contract.pdf');
    });

    it('trusts the file bytes over the declared content type', async () => {
      // An HTML payload renamed and declared as a PDF: the classic stored-XSS
      // setup. Sniffing catches it and the allow-list rejects it.
      const response = await upload(owner, {
        name: 'invoice.pdf',
        type: 'application/pdf',
        content: '<html><script>alert(document.cookie)</script></html>',
      });

      expect(response.statusCode).toBe(415);
      expect(response.json().error.code).toBe('unsupported_media_type');
    });

    it('rejects a type outside the allow-list', async () => {
      const response = await upload(owner, {
        name: 'logo.svg',
        type: 'image/svg+xml',
        content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      });
      expect(response.statusCode).toBe(415);
    });

    it('accepts a real PNG', async () => {
      const response = await upload(owner, {
        name: 'site.png',
        type: 'image/png',
        content: PNG_BYTES,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().contentType).toBe('image/png');
    });

    it('strips any path from the client filename', async () => {
      const response = await upload(owner, {
        name: '../../etc/passwd',
        type: 'text/plain',
        content: 'root:x:0:0',
      });

      // The multipart parser reduces the name to its basename before we ever
      // see it, and `safeFilenameSchema` is the second line of defence. What
      // matters is the invariant: no separators survive into the record.
      expect(response.statusCode).toBe(201);
      expect(response.json().filename).toBe('passwd');
      expect(response.json().filename).not.toContain('/');
    });

    it('rejects an empty file', async () => {
      const response = await upload(owner, {
        name: 'empty.txt',
        type: 'text/plain',
        content: '',
      });
      expect(response.statusCode).toBe(415);
    });

    it('never uses the client filename as the storage key', async () => {
      await upload(owner, { name: 'contract.pdf', type: 'application/pdf', content: PDF_BYTES });
      const keys = [...ctx.storage.contents.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toContain('contract.pdf');
      expect(keys[0]).toMatch(/^org_[0-9a-f]{32}\/\d{4}\/\d{2}\//);
    });

    it('denies upload to a viewer', async () => {
      const viewer = await addMember(ctx, owner, 'viewer');
      const response = await upload(viewer, {
        name: 'x.pdf',
        type: 'application/pdf',
        content: PDF_BYTES,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('download', () => {
    it('serves the file as an attachment that cannot execute', async () => {
      const document = (
        await upload(owner, { name: 'contract.pdf', type: 'application/pdf', content: PDF_BYTES })
      ).json();

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: `/api/v1/documents/${document.id}/download`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.rawPayload.equals(PDF_BYTES)).toBe(true);
    });

    it('encodes the filename rather than interpolating it raw', async () => {
      const document = (
        await upload(owner, {
          name: 'quarterly report "final".pdf',
          type: 'application/pdf',
          content: PDF_BYTES,
        })
      ).json();

      const response = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: `/api/v1/documents/${document.id}/download`,
      });
      const disposition = response.headers['content-disposition'] as string;
      expect(disposition).toContain("filename*=UTF-8''");
      expect(disposition).not.toContain('"final"');
    });

    it('refuses another organization’s document', async () => {
      const document = (
        await upload(owner, { name: 'contract.pdf', type: 'application/pdf', content: PDF_BYTES })
      ).json();
      const other = await registerOrganization(ctx);

      const response = await authed(
        ctx,
        other,
      )({
        method: 'GET',
        url: `/api/v1/documents/${document.id}/download`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('records each download in the audit log', async () => {
      const document = (
        await upload(owner, { name: 'contract.pdf', type: 'application/pdf', content: PDF_BYTES })
      ).json();
      await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: `/api/v1/documents/${document.id}/download`,
      });

      const audit = await authed(
        ctx,
        owner,
      )({
        method: 'GET',
        url: '/api/v1/organization/audit?action=document.downloaded',
      });
      expect(audit.json().items).toHaveLength(1);
    });
  });

  describe('AI indexing', () => {
    it('does not index by default', async () => {
      const document = (
        await upload(owner, {
          name: 'notes.txt',
          type: 'text/plain',
          content: 'The Riyadh Metro contract runs until December 2027.',
        })
      ).json();
      expect(document.indexForAi).toBe(false);

      const search = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'Riyadh Metro contract' },
      });
      expect(search.json().results).toHaveLength(0);
    });

    it('indexes when the uploader opts in', async () => {
      await upload(
        owner,
        {
          name: 'notes.txt',
          type: 'text/plain',
          content: 'The Riyadh Metro contract runs until December 2027 and is worth 4.2 million.',
        },
        { indexForAi: 'true' },
      );

      const search = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'Riyadh Metro contract', minScore: 0 },
      });
      expect(search.json().results.length).toBeGreaterThan(0);
      expect(search.json().results[0].title).toBe('notes.txt');
    });

    it('never indexes a confidential document even when asked to', async () => {
      const document = (
        await upload(
          owner,
          { name: 'salaries.txt', type: 'text/plain', content: 'Sara earns 42000 per month.' },
          { indexForAi: 'true', confidential: 'true' },
        )
      ).json();

      expect(document.indexForAi).toBe(false);

      const search = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'salary', minScore: 0 },
      });
      expect(search.json().results).toHaveLength(0);
    });

    it('purges the index when a document is later marked confidential', async () => {
      const document = (
        await upload(
          owner,
          { name: 'notes.txt', type: 'text/plain', content: 'Metro contract worth 4.2 million.' },
          { indexForAi: 'true' },
        )
      ).json();

      const before = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'metro contract', minScore: 0 },
      });
      expect(before.json().results.length).toBeGreaterThan(0);

      await authed(
        ctx,
        owner,
      )({
        method: 'PATCH',
        url: `/api/v1/documents/${document.id}`,
        payload: { confidential: true },
      });

      const after = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'metro contract', minScore: 0 },
      });
      expect(after.json().results).toHaveLength(0);
    });

    it('purges the index on delete', async () => {
      const document = (
        await upload(
          owner,
          { name: 'notes.txt', type: 'text/plain', content: 'Metro contract worth 4.2 million.' },
          { indexForAi: 'true' },
        )
      ).json();

      await authed(ctx, owner)({ method: 'DELETE', url: `/api/v1/documents/${document.id}` });

      const search = await authed(
        ctx,
        owner,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'metro contract', minScore: 0 },
      });
      expect(search.json().results).toHaveLength(0);
    });

    it('does not leak another organization’s indexed documents', async () => {
      await upload(
        owner,
        { name: 'ours.txt', type: 'text/plain', content: 'Our secret project is called Falcon.' },
        { indexForAi: 'true' },
      );

      const other = await registerOrganization(ctx);
      const search = await authed(
        ctx,
        other,
      )({
        method: 'POST',
        url: '/api/v1/ai/search',
        payload: { query: 'Falcon', minScore: 0 },
      });
      expect(search.json().results).toHaveLength(0);
    });
  });
});
