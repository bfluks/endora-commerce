import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartDroppedLinesBanner } from '../../components/CartDroppedLinesBanner';
import {
  REPORT_CAP,
  REPORT_ENCODED_MAX,
  REPORT_MORE_MAX,
  REPORT_NAME_MAX,
  decodeBuildRejections,
  decodeConversionSkips,
  droppedBelowMinimumReason,
  encodeBuildRejections,
  encodeConversionSkips,
  reportMoreText,
  quickOrderBuildOutcome,
  quickOrderBuildRejectionText,
  quickOrderRejectionLabel,
  shoppingListSkipLabel,
} from '../../lib/batchReport';

/**
 * Feature 155, T121 — the batch paths' reports name the minimum (FR-011, US4): the buyer's
 * quick-order preview, the quick-order build's `rejected[]`, the shopping list's `skipped[]`
 * and the quote → cart dropped lines. PL and EN.
 */

describe('quick-order preview row (FR-011 (a))', () => {
  const row = { line: 2, raw: 'A,4', reason: 'below_minimum' as const, minimum: 10, productTotal: 7 };

  it("states the product's total in the file and the minimum", () => {
    expect(quickOrderRejectionLabel(row, 'en-US')).toBe("The product's total in this file is 7, minimum 10 pcs");
    expect(quickOrderRejectionLabel(row, 'pl-PL')).toBe('Łączna ilość produktu w tym pliku to 7, minimum 10 szt.');
  });

  it('labels the existing reasons instead of printing their codes', () => {
    const label = quickOrderRejectionLabel({ line: 3, raw: 'X,1', reason: 'product_not_found' }, 'en-US');
    expect(label).toBe('Product not found');
    expect(quickOrderRejectionLabel({ line: 3, raw: 'X,1', reason: 'product_not_found' }, 'pl-PL')).toBe(
      'Nie znaleziono produktu',
    );
  });
});

describe('quick-order build rejected[] (FR-011 (b))', () => {
  const pieces = {
    productId: 'p1',
    variantId: null,
    quantity: 5,
    productName: 'Anchor bolt',
    reason: 'below_minimum' as const,
    kind: 'pieces' as const,
    minimum: 10,
  };

  it('names the product, the quantity and the minimum', () => {
    expect(quickOrderBuildRejectionText(pieces, 'en-US')).toBe('Anchor bolt × 5 — Below the minimum (10 pcs)');
    expect(quickOrderBuildRejectionText(pieces, 'pl-PL')).toBe('Anchor bolt × 5 — Poniżej minimum (10 szt.)');
  });

  it('names the packaging unit of a unit refusal', () => {
    const unit = { ...pieces, quantity: 64, kind: 'packaging_unit' as const, minimum: 2, packagingUnitName: 'Pallet' };
    expect(quickOrderBuildRejectionText(unit, 'en-US')).toBe('Anchor bolt × 64 — Below the minimum (2 × Pallet)');
  });

  it('summarises a partial build and a build that added nothing', () => {
    expect(quickOrderBuildOutcome(3, 1, 'en-US')).toBe('Cart built from your import: 2 of 3 lines added.');
    expect(quickOrderBuildOutcome(3, 1, 'pl-PL')).toBe('Koszyk utworzony z importu: dodano 2 z 3 pozycji.');
    expect(quickOrderBuildOutcome(1, 1, 'en-US')).toBe('No lines were added to your cart.');
    expect(quickOrderBuildOutcome(2, 0, 'en-US')).toBe('Cart built from your import: 2 of 2 lines added.');
  });

  it('round-trips through the redirect URL, carrying only the five fields the page words', () => {
    const encoded = encodeBuildRejections([pieces]);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBuildRejections(encoded)).toEqual({
      lines: [{ productName: 'Anchor bolt', quantity: 5, kind: 'pieces', minimum: 10 }],
      more: 0,
    });
  });

  it(`caps the carried list at the first ${REPORT_CAP} lines and counts the rest`, () => {
    const many = Array.from({ length: REPORT_CAP + 5 }, (_, i) => ({ ...pieces, productName: `Bolt ${i}` }));
    const decoded = decodeBuildRejections(encodeBuildRejections(many));
    expect(decoded.lines).toHaveLength(REPORT_CAP);
    expect(decoded.lines[0]!.productName).toBe('Bolt 0');
    expect(decoded.more).toBe(5);
    expect(reportMoreText(5, 'en-US')).toBe('+5 more');
    expect(reportMoreText(5, 'pl-PL')).toBe('+5 więcej');
  });

  it('keeps the URL bounded: a very long product name is cut', () => {
    const long = { ...pieces, productName: 'x'.repeat(5000) };
    const encoded = encodeBuildRejections(Array.from({ length: REPORT_CAP }, () => long));
    expect(encoded.length).toBeLessThanOrEqual(REPORT_ENCODED_MAX);
    expect(decodeBuildRejections(encoded).lines[0]!.productName).toHaveLength(REPORT_NAME_MAX);
  });

  /**
   * Round C (item 4) — the report rides a redirect URL, so its size is a budget (~6 KB), not a
   * cap that merely exists: the worst a build can send — every line a unit refusal with two
   * maximum-length names in multi-byte letters, some needing JSON escapes — still fits, by
   * carrying fewer lines and counting the rest.
   */
  it(`stays within the ${REPORT_ENCODED_MAX}-character URL budget, shrinking the list into \`more\``, () => {
    expect(REPORT_ENCODED_MAX).toBeLessThanOrEqual(6_144);
    const worst = {
      productName: 'Ł"'.repeat(5000),
      quantity: 999_999,
      kind: 'packaging_unit',
      minimum: 999_999,
      packagingUnitName: 'Ż\\'.repeat(5000),
    };
    const encoded = encodeBuildRejections(Array.from({ length: REPORT_CAP + 3 }, () => worst));
    expect(encoded.length).toBeLessThanOrEqual(REPORT_ENCODED_MAX);
    const decoded = decodeBuildRejections(encoded);
    expect(decoded.lines.length).toBeGreaterThan(0);
    expect(decoded.lines.length).toBeLessThan(REPORT_CAP);
    // Every line sent is either carried or counted.
    expect(decoded.lines.length + decoded.more).toBe(REPORT_CAP + 3);
  });

  it('a short report is not shrunk: the budget only ever drops what does not fit', () => {
    const decoded = decodeBuildRejections(encodeBuildRejections(Array.from({ length: REPORT_CAP }, () => pieces)));
    expect(decoded.lines).toHaveLength(REPORT_CAP);
    expect(decoded.more).toBe(0);
  });

  it('decodes a hand-made report within the bounds the encoder writes: names cut, `more` clamped', () => {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const decoded = decodeBuildRejections(
      encode({
        lines: [{ ...pieces, productName: 'y'.repeat(1000), kind: 'packaging_unit', packagingUnitName: 'z'.repeat(1000) }],
        more: 1e12,
      }),
    );
    expect(decoded.lines[0]!.productName).toHaveLength(REPORT_NAME_MAX);
    expect(decoded.lines[0]!.productName.endsWith('…')).toBe(true);
    expect(decoded.lines[0]!.packagingUnitName).toHaveLength(REPORT_NAME_MAX);
    expect(decoded.more).toBe(REPORT_MORE_MAX);
    // Only the fields the page words are read back; anything else written by hand is dropped.
    expect(decodeBuildRejections(encode({ lines: [{ ...pieces, extra: 'x'.repeat(10) }], more: 0 })).lines[0]).toEqual({
      productName: 'Anchor bolt',
      quantity: 5,
      kind: 'pieces',
      minimum: 10,
    });
    expect(decodeConversionSkips(encode({ lines: [], more: Number.MAX_SAFE_INTEGER })).more).toBe(REPORT_MORE_MAX);
  });

  it('every empty answer is a fresh report, never one shared array', () => {
    const first = decodeBuildRejections(undefined);
    first.lines.push({ productName: 'x', quantity: 1, kind: 'pieces', minimum: 2 });
    expect(decodeBuildRejections(undefined)).toEqual({ lines: [], more: 0 });
  });

  it('reads a hand-edited query defensively: nothing, never an error', () => {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    expect(decodeBuildRejections('%%%')).toEqual({ lines: [], more: 0 });
    expect(decodeBuildRejections(undefined)).toEqual({ lines: [], more: 0 });
    expect(decodeBuildRejections(encode([pieces]))).toEqual({ lines: [], more: 0 });
    expect(decodeBuildRejections(encode({ lines: 'no', more: 3 }))).toEqual({ lines: [], more: 0 });
    expect(decodeBuildRejections(encode({ lines: [{ productName: 1 }], more: -2 }))).toEqual({ lines: [], more: 0 });
    expect(decodeBuildRejections('A'.repeat(50_000))).toEqual({ lines: [], more: 0 });
    // More lines than the cap, written by hand (inside the URL budget), are cut to the cap.
    const small = { productName: 'B', quantity: 5, kind: 'pieces', minimum: 10 };
    const forged = encode({ lines: Array.from({ length: 40 }, () => small), more: 1.5 });
    const decoded = decodeBuildRejections(forged);
    expect(decoded.lines).toHaveLength(REPORT_CAP);
    expect(decoded.more).toBe(0);
  });
});

describe('shopping list skipped[] (FR-011)', () => {
  it('carries a capped, projected skip list across the redirect', () => {
    const skip = { itemId: 'i1', productId: 'p1', reason: 'below_minimum', minimum: 10, extra: 'dropped' };
    const many = Array.from({ length: REPORT_CAP + 2 }, (_, i) => ({ ...skip, itemId: `i${i}` }));
    const decoded = decodeConversionSkips(encodeConversionSkips(many));
    expect(decoded.lines).toHaveLength(REPORT_CAP);
    expect(decoded.lines[0]).toEqual({ itemId: 'i0', productId: 'p1', reason: 'below_minimum', minimum: 10 });
    expect(decoded.more).toBe(2);
    expect(decodeConversionSkips('%%%')).toEqual({ lines: [], more: 0 });
  });

  it('states the minimum of a below_minimum skip', () => {
    expect(shoppingListSkipLabel({ reason: 'below_minimum', minimum: 10 }, 'en-US')).toBe('Below the minimum (10 pcs)');
    expect(shoppingListSkipLabel({ reason: 'below_minimum', minimum: 10 }, 'pl-PL')).toBe('Poniżej minimum (10 szt.)');
  });

  it('labels the existing skip reasons', () => {
    expect(shoppingListSkipLabel({ reason: 'product_archived' }, 'en-US')).toBe('Product archived');
    expect(shoppingListSkipLabel({ reason: 'product_not_found' }, 'pl-PL')).toBe('Produkt nie jest już dostępny');
  });
});

describe('CartDroppedLinesBanner — quote → cart (FR-011)', () => {
  const strings = (locale: string) => ({
    heading: 'Some lines were skipped',
    intro: 'These products were not added because:',
    reasonNotPurchasable: 'no longer available',
    reasonOutOfStock: 'out of stock',
    reasonNoPriceInCustomerList: 'no price available',
    reasonRemovedByConversion: 'skipped during conversion',
    reasonBelowMinimum: (minimum: number | undefined) => droppedBelowMinimumReason(minimum, locale),
  });

  it('states the minimum of a below_minimum line, distinct from no price (EN)', () => {
    const html = renderToString(
      <CartDroppedLinesBanner
        droppedLines={[
          { productId: 'p1', productName: 'Anchor bolt', reason: 'below_minimum', minimum: 10 },
          { productId: 'p2', productName: 'Dowel', reason: 'no_price_in_customer_list' },
        ]}
        strings={strings('en-US')}
      />,
    );
    expect(html).toContain('Anchor bolt');
    expect(html).toContain('below the minimum order quantity (minimum 10)');
    expect(html).toContain('no price available');
  });

  it('renders in Polish', () => {
    const html = renderToString(
      <CartDroppedLinesBanner
        droppedLines={[{ productId: 'p1', productName: 'Kotwa', reason: 'below_minimum', minimum: 10 }]}
        strings={strings('pl-PL')}
      />,
    );
    expect(html).toContain('poniżej minimalnej ilości zamówienia (minimum 10)');
  });
});
