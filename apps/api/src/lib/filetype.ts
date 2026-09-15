/**
 * Content-type detection from magic bytes.
 *
 * The `Content-Type` a browser sends is a claim by the uploader, and uploaders
 * include attackers. Renaming `shell.html` to `invoice.pdf` and declaring
 * `application/pdf` must not get a file stored and later served as HTML — that
 * is stored XSS with extra steps.
 *
 * So the server sniffs the leading bytes, and the *sniffed* type is what gets
 * stored, checked against the allow-list and echoed back on download. The
 * declared type is used only to break ties for formats that genuinely have no
 * signature (plain text, CSV, Markdown). See docs/08-modules/documents.md.
 */

export interface DetectedType {
  contentType: string;
  /** `true` when the bytes themselves identified the format. */
  fromSignature: boolean;
}

interface Signature {
  contentType: string;
  offset: number;
  bytes: number[];
}

const SIGNATURES: Signature[] = [
  { contentType: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { contentType: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  // RIFF....WEBP — the second marker is checked separately below.
  { contentType: 'image/webp', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  // Legacy OLE compound file: .doc, .xls, .ppt
  {
    contentType: 'application/x-ole-storage',
    offset: 0,
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  // ZIP local file header — also every OOXML document, resolved below.
  { contentType: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/** Types that carry no signature and are therefore trusted from the declaration. */
const SIGNATURELESS = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);

/** OOXML container types, distinguished by a marker inside the zip payload. */
const OOXML_MARKERS: { marker: string; contentType: string }[] = [
  {
    marker: 'word/',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    marker: 'xl/',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    marker: 'ppt/',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
];

/** Legacy OLE types cannot be told apart cheaply; the declaration disambiguates. */
const OLE_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

export function detectContentType(buffer: Buffer, declared: string | undefined): DetectedType {
  const claimed = (declared ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

  for (const signature of SIGNATURES) {
    if (!matches(buffer, signature)) continue;

    if (signature.contentType === 'image/webp') {
      // RIFF is a container; only the WEBP form is accepted.
      if (buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return { contentType: 'image/webp', fromSignature: true };
      }
      continue;
    }

    if (signature.contentType === 'application/zip') {
      const head = buffer.subarray(0, 4_096).toString('latin1');
      for (const { marker, contentType } of OOXML_MARKERS) {
        if (head.includes(marker)) return { contentType, fromSignature: true };
      }
      return { contentType: 'application/zip', fromSignature: true };
    }

    if (signature.contentType === 'application/x-ole-storage') {
      // The container is confirmed; which Office format it holds is not, so
      // accept the declaration only if it names one of the legacy types.
      return OLE_TYPES.has(claimed)
        ? { contentType: claimed, fromSignature: true }
        : { contentType: 'application/msword', fromSignature: true };
    }

    return { contentType: signature.contentType, fromSignature: true };
  }

  if (SIGNATURELESS.has(claimed) && isProbablyText(buffer)) {
    return { contentType: claimed, fromSignature: false };
  }

  if (isProbablyText(buffer)) {
    return { contentType: 'text/plain', fromSignature: false };
  }

  return { contentType: 'application/octet-stream', fromSignature: false };
}

function matches(buffer: Buffer, signature: Signature): boolean {
  if (buffer.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => buffer[signature.offset + index] === byte);
}

/**
 * Heuristic: a NUL byte or a high proportion of control characters in the
 * first kilobyte means this is not text.
 */
function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 1_024);
  if (sample.length === 0) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (byte < 0x20 && !isWhitespace) control += 1;
  }
  return control / sample.length < 0.05;
}
