import { describe, expect, it } from 'vitest';
import { ID_CHUNK, inIdChunks, uuidArrayLiteral } from './sql-id-arrays.js';

describe('uuidArrayLiteral', () => {
  it('quotes every element and escapes quotes and backslashes', () => {
    expect(uuidArrayLiteral(['a', 'b"c', 'd\\e'])).toBe('{"a","b\\"c","d\\\\e"}');
  });
});

describe('inIdChunks (code review W2)', () => {
  it('never hands a read more than ID_CHUNK ids, and keeps the order', async () => {
    const ids = Array.from({ length: ID_CHUNK * 2 + 3 }, (_, i) => `id-${i}`);
    const sizes: number[] = [];
    const out = await inIdChunks(ids, async (chunk) => {
      sizes.push(chunk.length);
      return chunk;
    });
    expect(sizes).toEqual([ID_CHUNK, ID_CHUNK, 3]);
    expect(out).toEqual(ids);
  });

  it('reads nothing for no ids', async () => {
    let calls = 0;
    expect(await inIdChunks([], async () => (calls++, []))).toEqual([]);
    expect(calls).toBe(0);
  });
});
