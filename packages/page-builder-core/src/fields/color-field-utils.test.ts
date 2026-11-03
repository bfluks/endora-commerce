import { describe, expect, it } from 'vitest';
import {
  BRAND_COLOR_ROLES,
  colorFieldCommitValue,
  colorFieldDisplayValue,
  colorPickerDisplayHex,
  isBrandColorToken,
  isTransparentColor,
  parseColorTextInput,
} from './color-field-utils.js';

describe('color-field-utils', () => {
  it('treats empty values as transparent for display and commit', () => {
    expect(colorFieldDisplayValue(undefined)).toBe('');
    expect(colorFieldDisplayValue('')).toBe('');
    expect(colorFieldDisplayValue('transparent')).toBe('');
    expect(colorFieldCommitValue('')).toBeUndefined();
    expect(colorFieldCommitValue('transparent')).toBeUndefined();
    expect(isTransparentColor('transparent')).toBe(true);
    expect(isTransparentColor('')).toBe(true);
  });

  it('keeps a preview hex for transparent so the native picker can open', () => {
    expect(colorPickerDisplayHex('')).toBe('#ffffff');
    expect(colorPickerDisplayHex('#ff0000')).toBe('#ff0000');
  });

  it('commits valid hex from text input immediately', () => {
    expect(parseColorTextInput('#1a2b3c')).toEqual({ display: '#1a2b3c', commit: '#1a2b3c' });
    expect(parseColorTextInput('1a2b3c')).toEqual({ display: '#1a2b3c', commit: '#1a2b3c' });
  });

  it('does not commit partial hex while typing', () => {
    expect(parseColorTextInput('#1a2')).toEqual({ display: '#1a2' });
    expect(parseColorTextInput('abc')).toEqual({ display: 'abc' });
  });

  it('commits transparent from empty text input', () => {
    expect(parseColorTextInput('')).toEqual({ display: '', commit: undefined });
    expect(parseColorTextInput('transparent')).toEqual({ display: '', commit: undefined });
  });
});

/** Feature 163, T040 (research R-6): a colour field may hold a brand-token reference. */
describe('color-field-utils — brand tokens (T040)', () => {
  it('lists the brand colour roles, primary first, each with the literal it falls back to', () => {
    expect(BRAND_COLOR_ROLES.map((entry) => entry.role)).toEqual([
      'primary',
      'primary-hover',
      'secondary',
      'secondary-hover',
      'on-primary',
      'on-secondary',
    ]);
    expect(BRAND_COLOR_ROLES[0]).toMatchObject({ role: 'primary', fallback: '#1261a6', value: 'token:primary' });
  });

  it('commits a known token where tokens are allowed, and only there', () => {
    expect(colorFieldCommitValue('token:primary', { tokens: true })).toBe('token:primary');
    expect(colorFieldCommitValue('token:nonexistent', { tokens: true })).toBeUndefined();
    // The e-mail builder renders HTML for mail clients, where a CSS variable means nothing.
    expect(colorFieldCommitValue('token:primary')).toBeUndefined();
    expect(colorFieldCommitValue('#1a2b3c', { tokens: true })).toBe('#1a2b3c');
  });

  it('shows a token as it is stored and previews its literal in the native picker', () => {
    expect(colorFieldDisplayValue('token:secondary')).toBe('token:secondary');
    expect(colorPickerDisplayHex('token:secondary')).toBe('#0f766e');
    expect(isBrandColorToken('token:secondary')).toBe(true);
    expect(isBrandColorToken('#0f766e')).toBe(false);
  });

  it('commits a typed token where tokens are allowed', () => {
    expect(parseColorTextInput('token:primary', { tokens: true })).toEqual({ display: 'token:primary', commit: 'token:primary' });
    expect(parseColorTextInput('token:prim', { tokens: true })).toEqual({ display: 'token:prim' });
    expect(parseColorTextInput('token:primary')).toEqual({ display: 'token:primary' });
  });
});
