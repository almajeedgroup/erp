import { NextResponse } from 'next/server';
import { API_BASE_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/session';

/**
 * Document download proxy.
 *
 * A browser cannot attach the bearer token itself — the token is in an
 * `httpOnly` cookie precisely so that scripts cannot read it — so the download
 * link points here, and this handler forwards the request with the token
 * attached server-side.
 *
 * It also re-asserts the response headers rather than trusting whatever came
 * back: the file is always an attachment, never sniffable, and rendered under a
 * CSP that permits nothing. That means even a file that somehow slipped past
 * the upload allow-list cannot execute in the user's browser.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { documentId } = await params;

  // The id is validated by the API, but a path segment is never interpolated
  // without encoding it first.
  const upstream = await fetch(
    `${API_BASE_URL}/api/v1/documents/${encodeURIComponent(documentId)}/download`,
    { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'Document unavailable' },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      'content-length': upstream.headers.get('content-length') ?? '',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    },
  });
}
