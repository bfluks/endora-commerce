import { describe, expect, it } from 'vitest';
import {
  productKeyResolutionSchema,
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

describe('productPath — the only product URL composer', () => {
  it('answers /p/<key> in the channel default language', () => {
    expect(productPath({ key: 'drill', languageCode: 'pl-PL', channelDefaultLanguage: 'pl-PL' })).toBe('/p/drill');
  });

  it('adds ?lang=<L> in any other language, preserving the case of L', () => {
    expect(productPath({ key: 'bohrer', languageCode: 'de-DE', channelDefaultLanguage: 'pl-PL' })).toBe(
      '/p/bohrer?lang=de-DE',
    );
  });

  it('URL-encodes the key and the language', () => {
    expect(productPath({ key: 'a b/c', languageCode: 'x y', channelDefaultLanguage: 'pl-PL' })).toBe(
      '/p/a%20b%2Fc?lang=x%20y',
    );
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
      effective: [{ channelId: C, languageCode: 'de-DE', key: 'bohrer-b2b', source: 'channel_language', url: '/p/bohrer-b2b?lang=de-DE' }],
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
      productKeyResolutionSchema.parse({ kind: 'redirect', key: 'old', languageCode: 'de-DE', path: '/p/bohrer?lang=de-DE' })
        .kind,
    ).toBe('redirect');
    expect(productKeyResolutionSchema.safeParse({ kind: 'redirect', key: 'old' }).success).toBe(false);
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
