import { describe, expect, it } from 'vitest';
import {
  applyTranslationPatch,
  effectivePackagingUnitName,
  translationAt,
  translationMapPatchSchema,
} from './product-scopes.js';

/**
 * Feature 163 (FR-077–FR-079, R15, R16) — the one rule for a per-language text of a
 * gallery image, an attachment and a packaging unit: the value at the scope language
 * when it is non-empty, else the global one.
 */
describe('translationAt', () => {
  it('answers the value at the language, matched as the channel spells it', () => {
    expect(translationAt({ 'pl-PL': 'Karton' }, 'pl-PL')).toBe('Karton');
    expect(translationAt({ 'pl-pl': 'Karton' }, 'pl-PL')).toBe('Karton');
  });

  it('answers null for an absent, empty or blank value, and for no language', () => {
    expect(translationAt({ 'pl-PL': 'Karton' }, 'en-US')).toBeNull();
    expect(translationAt({ 'en-US': '' }, 'en-US')).toBeNull();
    expect(translationAt({ 'en-US': '   ' }, 'en-US')).toBeNull();
    expect(translationAt({ 'en-US': 'Box' }, null)).toBeNull();
    expect(translationAt(null, 'en-US')).toBeNull();
    expect(translationAt(undefined, 'en-US')).toBeNull();
  });
});

describe('effectivePackagingUnitName', () => {
  const unit = { name: 'carton', nameTranslations: { 'pl-PL': 'karton' } };

  it('takes the translation at the language, else the global name (US9 #5)', () => {
    expect(effectivePackagingUnitName(unit, 'pl-PL')).toBe('karton');
    expect(effectivePackagingUnitName(unit, 'de-DE')).toBe('carton');
    expect(effectivePackagingUnitName(unit, null)).toBe('carton');
  });

  it('reads a record that carries no translations as the global name', () => {
    expect(effectivePackagingUnitName({ name: 'carton' }, 'pl-PL')).toBe('carton');
  });
});

describe('translationMapPatchSchema', () => {
  it('accepts language → text, the empty string meaning "remove"', () => {
    expect(translationMapPatchSchema(160).safeParse({ 'pl-PL': 'karton', 'en-US': '' }).success).toBe(true);
  });

  it('refuses a text over the limit, a non-string and a malformed language tag', () => {
    expect(translationMapPatchSchema(5).safeParse({ 'pl-PL': 'too long' }).success).toBe(false);
    expect(translationMapPatchSchema(160).safeParse({ 'pl-PL': 3 }).success).toBe(false);
    expect(translationMapPatchSchema(160).safeParse({ 'pl PL': 'x' }).success).toBe(false);
    expect(translationMapPatchSchema(160).safeParse({ '': 'x' }).success).toBe(false);
  });
});

describe('applyTranslationPatch', () => {
  it('sets the named languages, removes on an empty text and leaves the rest', () => {
    expect(applyTranslationPatch({ 'pl-PL': 'a', 'de-DE': 'b' }, { 'pl-PL': 'c', 'de-DE': '', 'en-US': 'd' })).toEqual({
      'pl-PL': 'c',
      'en-US': 'd',
    });
  });

  it('keeps the stored spelling of a language named in another case', () => {
    expect(applyTranslationPatch({ 'de-DE': 'a' }, { 'de-de': 'b' })).toEqual({ 'de-DE': 'b' });
  });

  it('starts from nothing when nothing is stored', () => {
    expect(applyTranslationPatch(null, { 'pl-PL': ' ' })).toEqual({});
  });
});
