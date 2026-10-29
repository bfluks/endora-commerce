import { describe, expect, it } from 'vitest';
import { formatTaskNumber } from './task-number.js';

describe('formatTaskNumber', () => {
  it('prefixes and zero-pads the sequence value to six digits', () => {
    expect(formatTaskNumber(1)).toBe('TSK-000001');
    expect(formatTaskNumber(123)).toBe('TSK-000123');
  });

  it('accepts the sequence value as the string the driver returns', () => {
    expect(formatTaskNumber('42')).toBe('TSK-000042');
  });

  it('does not truncate a value longer than the padding', () => {
    expect(formatTaskNumber(1234567)).toBe('TSK-1234567');
  });

  it('refuses a value that is not a positive integer', () => {
    expect(() => formatTaskNumber(0)).toThrow();
    expect(() => formatTaskNumber('abc')).toThrow();
  });
});
