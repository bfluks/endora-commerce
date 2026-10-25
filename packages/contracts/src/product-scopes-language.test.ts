import { describe, expect, it } from 'vitest';
import { firstLanguageTag, scopeLanguageOf, toScopeChannel } from './product-scopes.js';

/**
 * Feature 163 (code review N1/N2) — the one home of the channel-language
 * normalisation and of the `Accept-Language` pick every buyer seam reads.
 */
describe('toScopeChannel', () => {
  it('always offers the channel default, first when the list omits it', () => {
    expect(toScopeChannel({ id: 'c', languages: ['en-US'], defaultLanguage: 'pl-PL' })).toEqual({
      id: 'c',
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
    });
    expect(toScopeChannel({ id: 'c', defaultLanguage: 'pl-PL' }).languages).toEqual(['pl-PL']);
  });
});

describe('scopeLanguageOf', () => {
  const channel = { id: 'c', languages: ['de-DE'], defaultLanguage: 'pl-PL' };
  it('resolves a tag against the channel languages, the default included', () => {
    expect(scopeLanguageOf(channel, 'de')).toBe('de-DE');
    expect(scopeLanguageOf(channel, 'pl')).toBe('pl-PL');
    expect(scopeLanguageOf(channel, 'fr-FR')).toBe('pl-PL');
    expect(scopeLanguageOf(channel, undefined)).toBe('pl-PL');
  });
});

describe('firstLanguageTag', () => {
  it.each([
    ['de-DE,en;q=0.8', 'de-DE'],
    ['de;q=0.9, en', 'de'],
    ['  pl-PL  ', 'pl-PL'],
    ['', undefined],
    [undefined, undefined],
    [['en-US', 'pl'], 'en-US'],
  ] as const)('%j -> %j', (header, expected) => {
    expect(firstLanguageTag(header)).toBe(expected);
  });
});
