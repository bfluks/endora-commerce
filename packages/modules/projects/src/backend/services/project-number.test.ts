import { describe, expect, it } from 'vitest';
import { formatProjectNumber } from './project-number.js';

describe('formatProjectNumber (research R-19)', () => {
  it('is PRJ- and the sequence value padded to six digits', () => {
    expect(formatProjectNumber(1)).toBe('PRJ-000001');
    expect(formatProjectNumber('42')).toBe('PRJ-000042');
    expect(formatProjectNumber(123456n)).toBe('PRJ-123456');
  });

  it('writes a value past six digits in full — the padding is a floor', () => {
    expect(formatProjectNumber('1234567')).toBe('PRJ-1234567');
  });

  it('refuses what is not a sequence value', () => {
    expect(() => formatProjectNumber('0')).toThrow();
    expect(() => formatProjectNumber('-3')).toThrow();
    expect(() => formatProjectNumber('abc')).toThrow();
  });
});
