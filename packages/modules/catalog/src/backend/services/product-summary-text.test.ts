import { describe, expect, it } from 'vitest';
import { PRODUCT_SUMMARY_MAX_LENGTH, productSummaryText } from './product-summary-text.js';

/**
 * Feature 163 (T070, research R-16) — the product card's summary, derived from
 * the description: plain text, at most 160 characters, cut at a word boundary.
 */
describe('productSummaryText', () => {
  it('turns markup into plain text, with entities decoded and whitespace collapsed', () => {
    expect(productSummaryText('<p>Solid <strong>oak</strong> &amp; steel.</p>\n<p>Made&nbsp;to last.</p>')).toBe(
      'Solid oak & steel. Made to last.',
    );
  });

  it('drops scripts and styles with their content', () => {
    expect(productSummaryText('<style>p{color:red}</style><p>Visible</p><script>alert(1)</script>')).toBe('Visible');
  });

  it('keeps a short text whole', () => {
    expect(productSummaryText('A short line.')).toBe('A short line.');
  });

  it('cuts a long text at the last word boundary within 160 characters, with an ellipsis', () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
    const summary = productSummaryText(words)!;
    expect(summary.length).toBeLessThanOrEqual(PRODUCT_SUMMARY_MAX_LENGTH);
    expect(summary.endsWith('…')).toBe(true);
    expect(`${words} `).toContain(`${summary.slice(0, -1)} `);
  });

  it('does not end on a dangling comma before the ellipsis', () => {
    const text = `${'alpha beta, '.repeat(20)}end`;
    expect(productSummaryText(text)!).not.toMatch(/,…$/);
  });

  it('hard-cuts a single word longer than the limit', () => {
    const summary = productSummaryText('x'.repeat(300))!;
    expect(summary).toHaveLength(PRODUCT_SUMMARY_MAX_LENGTH);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('is null for an empty or markup-only description', () => {
    expect(productSummaryText('')).toBeNull();
    expect(productSummaryText('<p> </p>')).toBeNull();
    expect(productSummaryText(undefined)).toBeNull();
  });
});
