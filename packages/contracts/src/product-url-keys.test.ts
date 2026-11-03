import { describe, expect, it } from 'vitest';
import {
  productKeyResolutionSchema,
  productDefaultPath,
  productPagePathsSchema,
  productPath,
  productSlugSchema,
  productUrlKeysResponseSchema,
  putProductUrlKeysRequestSchema,
  urlKeyRedirectTakeoverRequiredDetailsSchema,
  urlKeyTakenDetailsSchema,
  urlKeyWriteOutcomeSchema,
} from './product-url-keys.js';

/**
 * Feature 163 — URL-key shapes (`contracts/url-keys-and-redirects.md` §1–§5) and the
 * one seam every emitted product URL is composed by (D7, Q-B → C).
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const C = '00000000-0000-4000-8000-0000000000c1';
const R = '00000000-0000-4000-8000-0000000000f1';

const plEn = (prefixDefaultLanguage: boolean) => ({
  languages: ['pl-PL', 'en-US', 'de-DE'],
  defaultLanguage: 'pl-PL',
  prefixDefaultLanguage,
});

describe('productPath — the only product URL composer (feature 167: prefixed, never ?lang=)', () => {
  it('prefixes every language when the channel prefixes its default language', () => {
    expect(productPath({ key: 'wiertarka', languageCode: 'pl-PL', channel: plEn(true) })).toBe('/pl/p/wiertarka');
    expect(productPath({ key: 'drill', languageCode: 'en-US', channel: plEn(true) })).toBe('/en/p/drill');
  });

  it('leaves the default language unprefixed with the setting off; others are prefixed', () => {
    expect(productPath({ key: 'wiertarka', languageCode: 'pl-PL', channel: plEn(false) })).toBe('/p/wiertarka');
    expect(productPath({ key: 'bohrer', languageCode: 'de-DE', channel: plEn(false) })).toBe('/de/p/bohrer');
  });

  it('never appends ?lang=', () => {
    for (const on of [true, false]) {
      for (const languageCode of ['pl-PL', 'en-US', 'de-DE']) {
        expect(productPath({ key: 'x', languageCode, channel: plEn(on) })).not.toContain('lang=');
      }
    }
  });

  it('URL-encodes the key', () => {
    expect(productPath({ key: 'a b/c', languageCode: 'en-US', channel: plEn(true) })).toBe('/en/p/a%20b%2Fc');
  });

  it('productDefaultPath is the unprefixed x-default target', () => {
    expect(productDefaultPath('wiertarka')).toBe('/p/wiertarka');
    expect(productDefaultPath('a b')).toBe('/p/a%20b');
  });
});

describe('productSlugSchema', () => {
  it.each(['drill', 'drill-18v', 'a1-b2-c3'])('accepts %s', (key) => {
    expect(productSlugSchema.safeParse(key).success).toBe(true);
  });

  it.each(['', 'Drill', 'drill_18v', '-drill', 'drill-', 'dri--ll', 'x'.repeat(161)])('refuses %s', (key) => {
    expect(productSlugSchema.safeParse(key).success).toBe(false);
  });
});

describe('putProductUrlKeysRequestSchema', () => {
  it('accepts null as "use inherited" and a takeover confirmation', () => {
    const parsed = putProductUrlKeysRequestSchema.safeParse({
      globalKey: 'drill',
      languageKeys: [{ languageCode: 'de-DE', key: null }],
      channelKeys: [{ channelId: C, languageCode: 'de-DE', key: 'bohrer' }],
      confirmTakeover: [{ languageCode: null, key: 'drill' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a key outside the slug grammar', () => {
    expect(putProductUrlKeysRequestSchema.safeParse({ languageKeys: [{ languageCode: 'de-DE', key: 'Bohrer' }] }).success).toBe(
      false,
    );
  });

  // Phase 16 review — every list in the body is bounded, as the scopes PATCH's are.
  const many = (count: number, at: (index: number) => object): object[] => Array.from({ length: count }, (_, index) => at(index));
  it.each([
    ['languageKeys', (index: number) => ({ languageCode: 'de', key: `k-${index}` })],
    ['channelKeys', (index: number) => ({ channelId: C, languageCode: 'de', key: `k-${index}` })],
    ['confirmTakeover', (index: number) => ({ languageCode: null, key: `k-${index}` })],
  ] as const)('caps %s at 64 entries', (field, at) => {
    expect(putProductUrlKeysRequestSchema.safeParse({ [field]: many(64, at) }).success).toBe(true);
    expect(putProductUrlKeysRequestSchema.safeParse({ [field]: many(65, at) }).success).toBe(false);
  });
});

describe('productUrlKeysResponseSchema', () => {
  it('parses with and without redirects (omitted while seo is off, Q-C)', () => {
    const data = {
      globalKey: 'drill',
      languageKeys: [{ languageCode: 'de-DE', key: 'bohrer' }],
      channelKeys: [{ channelId: C, languageCode: 'de-DE', key: 'bohrer-b2b', orphaned: false }],
      effective: [{ channelId: C, languageCode: 'de-DE', key: 'bohrer-b2b', source: 'channel_language', url: '/de/p/bohrer-b2b' }],
    };
    expect(productUrlKeysResponseSchema.safeParse({ data }).success).toBe(true);
    expect(
      productUrlKeysResponseSchema.safeParse({
        data: { ...data, redirects: [{ id: R, languageCode: null, key: 'old-drill', createdAt: '2026-10-22T10:00:00.000Z' }] },
      }).success,
    ).toBe(true);
  });
});

describe('productKeyResolutionSchema', () => {
  it('discriminates product from redirect', () => {
    expect(productKeyResolutionSchema.parse({ kind: 'product', productId: P, key: 'drill' }).kind).toBe('product');
    expect(
      productKeyResolutionSchema.parse({ kind: 'redirect', key: 'old', languageCode: 'de-DE', path: '/de/p/bohrer', permanent: true })
        .kind,
    ).toBe('redirect');
    expect(productKeyResolutionSchema.safeParse({ kind: 'redirect', key: 'old' }).success).toBe(false);
  });

  it('requires `permanent` on a redirect (feature 167: former key vs another language\'s key)', () => {
    const redirect = { kind: 'redirect', key: 'wiertarka', languageCode: 'en-US', path: '/en/p/drill' };
    expect(productKeyResolutionSchema.safeParse(redirect).success).toBe(false);
    expect(productKeyResolutionSchema.safeParse({ ...redirect, permanent: false }).success).toBe(true);
  });
});

describe('productPagePathsSchema', () => {
  it('requires xDefault (feature 167)', () => {
    const paths = { canonical: '/en/p/drill', alternates: [{ languageCode: 'en-US', path: '/en/p/drill' }] };
    expect(productPagePathsSchema.safeParse(paths).success).toBe(false);
    expect(productPagePathsSchema.safeParse({ ...paths, xDefault: '/p/wiertarka' }).success).toBe(true);
  });
});

describe('error details and the import outcome', () => {
  it('URL_KEY_TAKEN names the holder', () => {
    expect(
      urlKeyTakenDetailsSchema.safeParse({
        conflicts: [{ languageCode: 'de-DE', key: 'bohrer', heldByProductId: Q, heldByProductName: 'Bohrer' }],
      }).success,
    ).toBe(true);
  });

  it('URL_KEY_REDIRECT_TAKEOVER_REQUIRED names the losing product', () => {
    expect(
      urlKeyRedirectTakeoverRequiredDetailsSchema.safeParse({
        takeovers: [{ languageCode: null, key: 'old', losingProductId: Q, losingProductName: 'Old drill' }],
      }).success,
    ).toBe(true);
  });

  it('a connector write is written or reported, never taken over (FR-093)', () => {
    expect(urlKeyWriteOutcomeSchema.safeParse({ written: true }).success).toBe(true);
    expect(
      urlKeyWriteOutcomeSchema.safeParse({
        written: false,
        issue: { languageCode: 'de-DE', channelId: null, key: 'bohrer', heldByProductId: Q, kind: 'redirect' },
      }).success,
    ).toBe(true);
  });
});
