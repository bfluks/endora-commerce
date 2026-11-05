import { describe, expect, it } from 'vitest';
import { PRODUCT_SUMMARY_MAX_LENGTH, productSummaryText } from './index.js';

/**
 * Feature 163, T196 — the product card's summary is one rule for the
 * storefront's listing (`catalog`) and the page editor's preview (`cms`'
 * admin). Its full behaviour is held where the catalogue uses it
 * (`packages/modules/catalog/src/backend/services/product-summary-text.test.ts`);
 * this pins the shared export.
 */
describe('productSummaryText (shared)', () => {
  it('is exported with its limit and turns a description into one plain line', () => {
    expect(PRODUCT_SUMMARY_MAX_LENGTH).toBe(160);
    expect(productSummaryText('<p>Solid <strong>oak</strong> &amp; steel.</p>')).toBe('Solid oak & steel.');
    expect(productSummaryText(null)).toBeNull();
  });
});
