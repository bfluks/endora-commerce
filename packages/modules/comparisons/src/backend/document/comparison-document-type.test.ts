import { describe, expect, it, vi } from 'vitest';
import { documentTemplateContentSchema } from '@endora-commerce/contracts';
import { IMAGE_FALLBACK_BYTES, type AssetByteFetcher } from '../services/asset-byte-fetcher.js';
import { BUILT_IN_TEXTS } from './built-in-layout.js';
import { buildComparisonDocumentData } from './comparison-document-data.js';
import { createComparisonDocumentType } from './comparison-document-type.js';
import { sampleComparisonData } from './sample-comparison.js';

/** T035, T043 — the registration, its built-in layout in both languages, and the data builder. */
describe('the comparison document type', () => {
  const type = createComparisonDocumentType();

  it('offers its three blocks and every core block, default-only, every language', () => {
    expect(type.blocks().map((b) => b.name)).toEqual([
      'comparisons.ComparisonHeader',
      'comparisons.ComparisonTable',
      'comparisons.ComparisonShareLink',
    ]);
    expect(type.coreBlocks).toBe('all');
    expect(type.selection).toBe('default_only');
    expect(type.languages).toBeUndefined();
  });

  it('ships a valid built-in layout in English and Polish, the Polish one free of English platform text (SC-004)', () => {
    const content = documentTemplateContentSchema.parse(type.defaultContent());
    expect(Object.keys(content.languages)).toEqual(['en-US', 'pl-PL']);
    const pl = JSON.stringify(content.languages['pl-PL']);
    for (const english of Object.values(BUILT_IN_TEXTS['en-US'])) expect(pl).not.toContain(english);
    expect(type.defaultContent()).not.toBe(type.defaultContent());
  });

  it('landscape from three products', () => {
    const data = sampleComparisonData('en-US');
    expect(type.suggestOrientation?.(data)).toBe('landscape');
    expect(type.suggestOrientation?.({ ...data, view: { ...data.view, products: data.view.products.slice(0, 2) } })).toBe('portrait');
  });

  it('merge fields come from the data only', () => {
    expect(type.resolveVariables?.(sampleComparisonData('en-US'), {} as never)).toEqual({
      productCount: '3',
      channelName: 'Sample store',
      customerName: 'Anna Example',
      organizationName: 'Example Ltd.',
      shareUrl: 'https://shop.example.com/compare/share/sample0token',
    });
  });

  it('fetches product images once per render, only when the table is placed, with the fallback on failure', async () => {
    const fetch = vi.fn(async () => IMAGE_FALLBACK_BYTES);
    const withFetcher = createComparisonDocumentType({ fetcher: () => ({ fetch }) as unknown as AssetByteFetcher });
    const data = sampleComparisonData('en-US');
    const withImage = { ...data, view: { ...data.view, products: data.view.products.map((p, i) => (i === 0 ? { ...p, primaryAssetUrl: 'https://img.test/1.png' } : p)) } };
    const none = await withFetcher.prepareRender!(withImage, { placedBlocks: new Set(['comparisons.ComparisonHeader']), preview: false });
    expect(none.images.size).toBe(0);
    const some = await withFetcher.prepareRender!(withImage, { placedBlocks: new Set(['comparisons.ComparisonTable']), preview: false });
    expect([...some.images.keys()]).toEqual([withImage.view.products[0]!.id]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('buildComparisonDocumentData', () => {
  const view = sampleComparisonData('en-US').view;
  const base = { view, channelName: 'B2B', customerName: null, organizationName: null, hideEmptyRows: true, now: new Date('2026-10-17T10:00:00Z') };
  it('builds the share address from the channel storefront URL', () => {
    expect(buildComparisonDocumentData({ ...base, storefrontUrl: 'https://shop.test/' }).shareUrl).toBe(
      'https://shop.test/compare/share/sample0token',
    );
  });
  it('puts the document language prefix on the share address (feature 167, FR-034)', () => {
    expect(
      buildComparisonDocumentData({ ...base, storefrontUrl: 'https://shop.test/', pagePath: (p) => `/en${p}` }).shareUrl,
    ).toBe('https://shop.test/en/compare/share/sample0token');
  });

  it('no storefront URL, or not an http(s) one, means no share address', () => {
    expect(buildComparisonDocumentData({ ...base, storefrontUrl: '' }).shareUrl).toBeNull();
    expect(buildComparisonDocumentData({ ...base, storefrontUrl: 'javascript:alert(1)' }).shareUrl).toBeNull();
  });
  it('keeps the switch and stamps the time', () => {
    const data = buildComparisonDocumentData({ ...base, storefrontUrl: null });
    expect(data.hideEmptyRows).toBe(true);
    expect(data.generatedAt).toBe('2026-10-17T10:00:00.000Z');
  });
});
