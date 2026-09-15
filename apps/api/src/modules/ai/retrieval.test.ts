import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, chunkText, cosineSimilarity } from './retrieval.js';
import { hashEmbedding } from './provider.js';

describe('chunking', () => {
  it('returns nothing for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkText('One short paragraph.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('One short paragraph.');
    expect(chunks[0]?.index).toBe(0);
  });

  it('splits a long document and indexes the pieces in order', () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i} about the Metro contract.`,
    ).join('\n\n');
    const chunks = chunkText(text, 400, 50);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    for (const chunk of chunks) expect(chunk.content.length).toBeGreaterThan(0);
  });

  it('overlaps chunks so a fact on a boundary stays retrievable', () => {
    const text = `${'a'.repeat(500)} MARKER ${'b'.repeat(500)}`;
    const chunks = chunkText(text, 520, 100);
    const combined = chunks.map((chunk) => chunk.content).join('');
    expect(combined.length).toBeGreaterThan(text.length - 100);
  });

  it('prefers paragraph boundaries when one is available late in the window', () => {
    const paragraph = 'A sentence that carries some weight in the window. '.repeat(20);
    const chunks = chunkText(`${paragraph}\n\nSecond paragraph.`, CHUNK_SIZE, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // The break lands on the blank line, so no chunk ends mid-word.
    for (const chunk of chunks) expect(chunk.content).not.toMatch(/\bsente$/);
  });

  it('clamps an overlap that would make progress degenerate', () => {
    // overlap >= size would advance the window one character at a time:
    // quadratic work and one chunk per character.
    const chunks = chunkText('x'.repeat(10_000), 100, 99);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(400);
  });

  it('handles a zero or negative overlap', () => {
    expect(chunkText('y'.repeat(1_000), 100, 0).length).toBe(10);
    expect(chunkText('y'.repeat(1_000), 100, -50).length).toBe(10);
  });
});

describe('cosine similarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 rather than throwing on a dimension mismatch', () => {
    // A corpus mid-reindex can hold vectors from two models; a ranking
    // function is the wrong place to crash over that.
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for a zero vector instead of dividing by zero', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([0, 0], [0, 0]))).toBe(false);
  });

  it('ranks related text above unrelated text', () => {
    const query = hashEmbedding('metro contract completion date', 256);
    const related = hashEmbedding('The metro contract completion date is December 2027.', 256);
    const unrelated = hashEmbedding('Office coffee machine maintenance schedule.', 256);

    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });
});

describe('the deterministic embedder', () => {
  it('produces a stable unit vector of the requested width', () => {
    const first = hashEmbedding('Riyadh Metro', 128);
    const second = hashEmbedding('Riyadh Metro', 128);

    expect(first).toHaveLength(128);
    expect(first).toEqual(second);

    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('handles text with no word characters without producing NaN', () => {
    const vector = hashEmbedding('!!! ??? ...', 64);
    expect(vector.every((value) => Number.isFinite(value))).toBe(true);
  });
});
