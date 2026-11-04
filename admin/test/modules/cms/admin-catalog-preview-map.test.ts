import { describe, expect, it } from 'vitest';
import { PRODUCT_SUMMARY_MAX_LENGTH, productSummaryText } from '@endora-commerce/contracts';
import {
  mapAdminProductToCmsSummary,
  pickAdminLocalizedName,
} from '../../../../packages/modules/cms/src/admin/components/admin-catalog-preview-map';

describe('pickAdminLocalizedName', () => {
  it('returns string names as-is', () => {
    expect(pickAdminLocalizedName('Widget', 'fallback')).toBe('Widget');
  });

  it('prefers pl-PL then en-US', () => {
    expect(pickAdminLocalizedName({ 'en-US': 'En', 'pl-PL': 'Pl' }, 'x')).toBe('Pl');
    expect(pickAdminLocalizedName({ 'en-US': 'En' }, 'x')).toBe('En');
  });
});

describe('mapAdminProductToCmsSummary', () => {
  it('maps admin product fields for CMS preview cards', () => {
    const summary = mapAdminProductToCmsSummary({
      id: '1',
      slug: 'sku-1',
      name: { 'pl-PL': 'Produkt' },
      sku: 'SKU-1',
    });
    expect(summary).toEqual({
      id: '1',
      slug: 'sku-1',
      name: 'Produkt',
      sku: 'SKU-1',
      primaryAssetUrl: null,
      price: null,
      stockLevel: null,
      summary: null,
    });
  });

  // Feature 163, T196: the editor's preview cards show the summary the storefront's do —
  // the description's plain text, cut at a word boundary — in the name's language.
  it('derives the card summary from the description, as the storefront does', () => {
    const description = { 'en-US': '<p>Solid oak.</p>', 'pl-PL': '<p>Lity <strong>dąb</strong> &amp; stal.</p>' };
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: { 'pl-PL': 'P' }, sku: 'S', description }).summary).toBe(
      productSummaryText(description['pl-PL']),
    );
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: { 'pl-PL': 'P' }, sku: 'S', description }).summary).toBe('Lity dąb & stal.');
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: 'P', sku: 'S', description: 'x '.repeat(200) }).summary!.length).toBeLessThanOrEqual(
      PRODUCT_SUMMARY_MAX_LENGTH,
    );
    expect(mapAdminProductToCmsSummary({ id: '1', slug: 's', name: 'P', sku: 'S', description: null }).summary).toBeNull();
  });
});
