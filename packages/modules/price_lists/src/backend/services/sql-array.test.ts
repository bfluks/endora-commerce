import { describe, expect, it } from 'vitest';
import { pgArray } from './sql-array.js';

/** Review finding 10 (release 0.108.0) — the one array-literal builder; its Postgres round trip is `price-surface-array-params.test.ts`. */
describe('pgArray', () => {
  it('quotes every element and escapes the backslash and the double quote', () => {
    expect(pgArray(['a', 'b\\c', 'd"e', ''])).toBe('{"a","b\\\\c","d\\"e",""}');
  });

  it('writes null as an unquoted NULL and numbers as their text', () => {
    expect(pgArray(['1.5000', null, 2])).toBe('{"1.5000",NULL,"2"}');
  });

  it('writes an empty array as {}', () => {
    expect(pgArray([])).toBe('{}');
  });
});
