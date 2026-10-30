import { describe, expect, it } from 'vitest';
import {
  channelUrlLanguageAliases,
  channelUrlLanguageSchema,
  channelUrlLanguages,
  storefrontDefaultPath,
  storefrontPagePath,
  storefrontPagePathFor,
  type ChannelUrlFacts,
} from './storefront-language-path.js';

/**
 * Feature 167 (`specs/167-storefront-locale-path/`) — the one derivation of a
 * channel's URL language prefixes (`data-model.md` §4, `contracts/url-shape.md` §2)
 * and the page path composer every emitter uses (`contracts/contracts-package.md` §1).
 */

const plEn = (prefixDefaultLanguage: boolean): ChannelUrlFacts => ({
  languages: ['pl-PL', 'en-US'],
  defaultLanguage: 'pl-PL',
  prefixDefaultLanguage,
});

describe('channelUrlLanguages — data-model.md §4 examples', () => {
  it('pl-PL, en-US, setting on: /pl and /en, both prefixed', () => {
    expect(channelUrlLanguages(plEn(true))).toEqual([
      { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
      { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
    ]);
  });

  it('pl-PL, en-US, setting off: the default is unprefixed', () => {
    expect(channelUrlLanguages(plEn(false))).toEqual([
      { languageCode: 'pl-PL', prefix: 'pl', prefixed: false, isDefault: true },
      { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
    ]);
  });

  it('pl-PL, en-US, en-GB: the split primary subtag takes the full lower-case tag', () => {
    const facts: ChannelUrlFacts = {
      languages: ['pl-PL', 'en-US', 'en-GB'],
      defaultLanguage: 'pl-PL',
      prefixDefaultLanguage: true,
    };
    expect(channelUrlLanguages(facts).map((l) => [l.languageCode, l.prefix])).toEqual([
      ['pl-PL', 'pl'],
      ['en-US', 'en-us'],
      ['en-GB', 'en-gb'],
    ]);
    expect(channelUrlLanguageAliases(facts)).toEqual([{ alias: 'en', languageCodes: ['en-US', 'en-GB'] }]);
  });

  it('de-DE only, setting off: one unprefixed language', () => {
    expect(
      channelUrlLanguages({ languages: ['de-DE'], defaultLanguage: 'de-DE', prefixDefaultLanguage: false }),
    ).toEqual([{ languageCode: 'de-DE', prefix: 'de', prefixed: false, isDefault: true }]);
  });
});

describe('channelUrlLanguages — invariants', () => {
  it('includes the default language when the list omits it (the toScopeChannel rule)', () => {
    const result = channelUrlLanguages({ languages: ['en-US'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: true });
    expect(result.map((l) => l.languageCode)).toEqual(['pl-PL', 'en-US']);
    expect(result.filter((l) => l.isDefault)).toHaveLength(1);
  });

  it('keeps channel order and yields unique prefixes matching the grammar', () => {
    const result = channelUrlLanguages({
      languages: ['en-GB', 'de-DE', 'en-US', 'de-AT', 'fr', 'pt-BR'],
      defaultLanguage: 'de-DE',
      prefixDefaultLanguage: true,
    });
    expect(result.map((l) => l.prefix)).toEqual(['en-gb', 'de-de', 'en-us', 'de-at', 'fr', 'pt']);
    expect(new Set(result.map((l) => l.prefix)).size).toBe(result.length);
    for (const entry of result) expect(channelUrlLanguageSchema.safeParse(entry).success).toBe(true);
  });

  it('throws on a case-insensitive duplicate language code', () => {
    expect(() =>
      channelUrlLanguages({ languages: ['en-US', 'en-us'], defaultLanguage: 'en-US', prefixDefaultLanguage: true }),
    ).toThrow(/duplicate/i);
  });

  it('answers no alias when no primary subtag is shared', () => {
    expect(channelUrlLanguageAliases(plEn(true))).toEqual([]);
  });
});

describe('storefrontPagePath', () => {
  it('prefixes a logical path for a prefixed language', () => {
    expect(storefrontPagePath({ path: '/c/narzedzia', languageCode: 'en-US', channel: plEn(false) })).toBe(
      '/en/c/narzedzia',
    );
    expect(storefrontPagePath({ path: '/c/narzedzia', languageCode: 'pl-PL', channel: plEn(true) })).toBe(
      '/pl/c/narzedzia',
    );
  });

  it('leaves the unprefixed default language untouched', () => {
    expect(storefrontPagePath({ path: '/c/narzedzia', languageCode: 'pl-PL', channel: plEn(false) })).toBe(
      '/c/narzedzia',
    );
  });

  it('answers /<prefix> for the home page, never a trailing slash', () => {
    expect(storefrontPagePath({ path: '/', languageCode: 'en-US', channel: plEn(true) })).toBe('/en');
    expect(storefrontPagePath({ path: '/', languageCode: 'pl-PL', channel: plEn(false) })).toBe('/');
  });

  it('preserves the query and the fragment verbatim', () => {
    expect(
      storefrontPagePath({ path: '/verify?token=a%2Fb&x=1#top', languageCode: 'en-US', channel: plEn(true) }),
    ).toBe('/en/verify?token=a%2Fb&x=1#top');
    expect(storefrontPagePath({ path: '/?q=1', languageCode: 'en-US', channel: plEn(true) })).toBe('/en?q=1');
  });

  it('matches the language case-insensitively', () => {
    expect(storefrontPagePath({ path: '/x', languageCode: 'en-us', channel: plEn(true) })).toBe('/en/x');
  });

  it('throws on a language the channel does not have', () => {
    expect(() => storefrontPagePath({ path: '/x', languageCode: 'de-DE', channel: plEn(true) })).toThrow(/de-DE/);
  });

  it('throws on a path that is not root-relative', () => {
    expect(() => storefrontPagePath({ path: 'x', languageCode: 'pl-PL', channel: plEn(true) })).toThrow();
    expect(() => storefrontPagePath({ path: '//evil.example/x', languageCode: 'pl-PL', channel: plEn(true) })).toThrow();
  });
});

describe('storefrontDefaultPath — the x-default target', () => {
  it('answers the logical path unchanged (unprefixed in both setting states)', () => {
    expect(storefrontDefaultPath('/c/narzedzia')).toBe('/c/narzedzia');
    expect(storefrontDefaultPath('/')).toBe('/');
  });
});

describe('storefrontPagePathFor — the emitters\' composer (FR-034)', () => {
  it('uses the message language when it is a channel language (exact, then primary subtag)', () => {
    expect(storefrontPagePathFor({ path: '/verify?token=t', channel: plEn(true), requestedLanguage: 'en-US' })).toBe(
      '/en/verify?token=t',
    );
    expect(storefrontPagePathFor({ path: '/verify', channel: plEn(true), requestedLanguage: 'en' })).toBe('/en/verify');
  });

  it('falls back to the channel default language', () => {
    expect(storefrontPagePathFor({ path: '/verify', channel: plEn(true), requestedLanguage: 'de-DE' })).toBe('/pl/verify');
    expect(storefrontPagePathFor({ path: '/verify', channel: plEn(false), requestedLanguage: null })).toBe('/verify');
  });

  it('answers the logical path when no channel is known', () => {
    expect(storefrontPagePathFor({ path: '/verify', channel: null, requestedLanguage: 'en-US' })).toBe('/verify');
  });
});
