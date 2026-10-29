import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord, OrderMinimumRules } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  NEW_CART_LINE_KEY,
  assertCartMeetsMinimums,
  buildProspectiveCartLines,
  judgeTouchedCartLine,
  type CartMinimumItem,
} from './cart-minimums.js';

/**
 * Feature 155, Phase 6 (T038) — the cart's prospective-lines builder
 * (`specs/155-catalog-order-constraints/research.md` R11, `data-model.md` §2).
 *
 * A single add or edit is judged on the basket as it *would be*: the cart's lines
 * with the change applied — a bump of the matching `(product, variant, unit)`
 * line or a new line, or one line's new quantity. Exemption is the FR-028
 * predicate applied to the prospective quantity (owner ruling P2), and only the
 * touched line is judged.
 */

const A = 'product-a';
const B = 'product-b';
const PALLET = 'unit-pallet';

function item(overrides: Partial<CartMinimumItem> & Pick<CartMinimumItem, 'id' | 'productId'>): CartMinimumItem {
  return {
    variantId: null,
    quantity: 1,
    packagingUnitId: null,
    packagingUnitBaseQuantity: null,
    quoteSeededQuantity: null,
    ...overrides,
  };
}

const NO_SOURCE = { sourceQuoteRequestId: null };
const QUOTE_SOURCE = { sourceQuoteRequestId: 'qr-1' };

const RULES: OrderMinimumRules = {
  products: [
    { id: A, type: 'simple', minOrderQuantity: 10 },
    { id: B, type: 'configurable', minOrderQuantity: null },
  ],
  packagingUnits: [{ id: PALLET, productId: B, name: 'Pallet', baseQuantity: 64, minOrderUnits: 2 }],
};

describe('buildProspectiveCartLines — add', () => {
  it('bumps the line matching (product, variant, unit) and judges that line', () => {
    const items = [
      item({ id: 'i1', productId: A, quantity: 3 }),
      item({ id: 'i2', productId: A, variantId: 'v2', quantity: 4 }),
    ];
    const { lines, touchedKey } = buildProspectiveCartLines(NO_SOURCE, items, {
      kind: 'add',
      productId: A,
      variantId: null,
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 2,
    });
    expect(touchedKey).toBe('i1');
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.key === 'i1')?.quantity).toBe(5);
    expect(lines.find((l) => l.key === 'i2')?.quantity).toBe(4);
  });

  it('a different unit of the same product is a new line, not a bump', () => {
    const items = [item({ id: 'i1', productId: B, quantity: 5 })];
    const { lines, touchedKey } = buildProspectiveCartLines(NO_SOURCE, items, {
      kind: 'add',
      productId: B,
      variantId: null,
      packagingUnitId: PALLET,
      packagingUnitBaseQuantity: 64,
      quantity: 64,
    });
    expect(touchedKey).toBe(NEW_CART_LINE_KEY);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      key: NEW_CART_LINE_KEY,
      productId: B,
      quantity: 64,
      packagingUnitId: PALLET,
      packagingUnitBaseQuantity: 64,
      exempt: false,
    });
  });

  it('appends a new key when nothing matches', () => {
    const { lines, touchedKey } = buildProspectiveCartLines(NO_SOURCE, [], {
      kind: 'add',
      productId: A,
      variantId: null,
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 5,
    });
    expect(touchedKey).toBe(NEW_CART_LINE_KEY);
    expect(lines).toEqual([
      {
        key: NEW_CART_LINE_KEY,
        productId: A,
        quantity: 5,
        packagingUnitId: null,
        packagingUnitBaseQuantity: null,
        exempt: false,
      },
    ]);
  });

  it('bumping a quote-seeded line ends its exemption while the quantity differs', () => {
    const items = [item({ id: 'i1', productId: A, quantity: 5, quoteSeededQuantity: 5 })];
    const { lines } = buildProspectiveCartLines(QUOTE_SOURCE, items, {
      kind: 'add',
      productId: A,
      variantId: null,
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 1,
    });
    expect(lines[0]).toMatchObject({ key: 'i1', quantity: 6, exempt: false });
  });

  it('a new line is never exempt; untouched seeded lines keep their exemption', () => {
    const items = [item({ id: 'i1', productId: A, quantity: 5, quoteSeededQuantity: 5 })];
    const { lines } = buildProspectiveCartLines(QUOTE_SOURCE, items, {
      kind: 'add',
      productId: A,
      variantId: 'v2',
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 3,
    });
    expect(lines.map((l) => [l.key, l.exempt])).toEqual([
      ['i1', true],
      [NEW_CART_LINE_KEY, false],
    ]);
  });
});

describe('buildProspectiveCartLines — edit', () => {
  it('replaces one quantity and leaves the others', () => {
    const items = [
      item({ id: 'i1', productId: A, quantity: 10 }),
      item({ id: 'i2', productId: B, quantity: 7 }),
    ];
    const { lines, touchedKey } = buildProspectiveCartLines(NO_SOURCE, items, {
      kind: 'edit',
      itemId: 'i1',
      quantity: 4,
    });
    expect(touchedKey).toBe('i1');
    expect(lines.map((l) => [l.key, l.quantity])).toEqual([
      ['i1', 4],
      ['i2', 7],
    ]);
  });

  it('exemption follows the prospective quantity: 5 → 12 not exempt, back to 5 exempt (P2)', () => {
    const seeded = item({ id: 'i1', productId: A, quantity: 12, quoteSeededQuantity: 5 });
    expect(
      buildProspectiveCartLines(QUOTE_SOURCE, [{ ...seeded, quantity: 5 }], {
        kind: 'edit',
        itemId: 'i1',
        quantity: 12,
      }).lines[0]?.exempt,
    ).toBe(false);
    expect(
      buildProspectiveCartLines(QUOTE_SOURCE, [seeded], { kind: 'edit', itemId: 'i1', quantity: 5 }).lines[0]
        ?.exempt,
    ).toBe(true);
  });

  it('no exemption without the basket quote source', () => {
    const items = [item({ id: 'i1', productId: A, quantity: 5, quoteSeededQuantity: 5 })];
    expect(
      buildProspectiveCartLines(NO_SOURCE, items, { kind: 'edit', itemId: 'i1', quantity: 5 }).lines[0]?.exempt,
    ).toBe(false);
  });
});

describe('judgeTouchedCartLine', () => {
  it('answers the touched line’s pieces violation (US1 #3)', () => {
    const prospective = buildProspectiveCartLines(NO_SOURCE, [], {
      kind: 'add',
      productId: A,
      variantId: null,
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 5,
    });
    expect(judgeTouchedCartLine(prospective, RULES)).toEqual({
      key: NEW_CART_LINE_KEY,
      productId: A,
      kind: 'pieces',
      minimum: 10,
      total: 5,
    });
  });

  it('judges only the touched key — another line below its minimum does not refuse the change', () => {
    const items = [
      item({ id: 'i1', productId: B, quantity: 64, packagingUnitId: PALLET, packagingUnitBaseQuantity: 64 }),
    ];
    const prospective = buildProspectiveCartLines(NO_SOURCE, items, {
      kind: 'add',
      productId: B,
      variantId: null,
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 5,
    });
    // The pallet line is below its unit minimum; the touched piece line is not judged by it.
    expect(judgeTouchedCartLine(prospective, RULES)).toBeNull();
  });

  it('the touched line’s packaging-unit violation when the pieces rule passes', () => {
    const prospective = buildProspectiveCartLines(NO_SOURCE, [], {
      kind: 'add',
      productId: B,
      variantId: null,
      packagingUnitId: PALLET,
      packagingUnitBaseQuantity: 64,
      quantity: 64,
    });
    expect(judgeTouchedCartLine(prospective, RULES)).toMatchObject({
      key: NEW_CART_LINE_KEY,
      kind: 'packaging_unit',
      packagingUnitName: 'Pallet',
      minimum: 2,
      units: 1,
    });
  });

  it('an exempt touched line is never refused, and its pieces still count (US4 #7c)', () => {
    const items = [item({ id: 'i1', productId: A, quantity: 5, quoteSeededQuantity: 5 })];
    expect(
      judgeTouchedCartLine(
        buildProspectiveCartLines(QUOTE_SOURCE, items, { kind: 'edit', itemId: 'i1', quantity: 5 }),
        RULES,
      ),
    ).toBeNull();
    const addThree = buildProspectiveCartLines(QUOTE_SOURCE, items, {
      kind: 'add',
      productId: A,
      variantId: 'v2',
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 3,
    });
    expect(judgeTouchedCartLine(addThree, RULES)).toMatchObject({ kind: 'pieces', total: 8 });
    const addFive = buildProspectiveCartLines(QUOTE_SOURCE, items, {
      kind: 'add',
      productId: A,
      variantId: 'v2',
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
      quantity: 5,
    });
    expect(judgeTouchedCartLine(addFive, RULES)).toBeNull();
  });

  it('a missing product record yields product_unavailable for the touched line (FR-037)', () => {
    const items = [item({ id: 'i1', productId: 'gone', quantity: 3 })];
    const prospective = buildProspectiveCartLines(NO_SOURCE, items, {
      kind: 'edit',
      itemId: 'i1',
      quantity: 4,
    });
    expect(judgeTouchedCartLine(prospective, RULES)).toEqual({
      key: 'i1',
      productId: 'gone',
      kind: 'product_unavailable',
    });
  });
});

/**
 * FR-039 (`contracts/cart-and-checkout-api.md` §12) — submit for approval judges
 * the basket as placement does: the quote-line exemption holds only once the
 * quote source is confirmed, and the confirmation is asked only for a basket that
 * carries a mark, after the catalogue read.
 */
describe('assertCartMeetsMinimums — the quote source is confirmed, not trusted', () => {
  const productA = { id: A, type: 'simple', minOrderQuantity: 10, name: { en: 'Anchor' } } as unknown as CatalogProductRecord;
  const catalogue = (calls: string[]) => ({
    findByIds: async () => {
      calls.push('findByIds');
      return [productA];
    },
    listPackagingUnitsByProductIds: async () => [],
  });
  const seeded = [item({ id: 'i1', productId: A, quantity: 5, quoteSeededQuantity: 5 })];

  it('a confirmed source keeps the seeded line exempt', async () => {
    const calls: string[] = [];
    await expect(
      assertCartMeetsMinimums(catalogue(calls), {
        cart: QUOTE_SOURCE,
        items: seeded,
        availableOnly: async (products) => products,
        confirmQuoteSource: async (quoteRequestId: string) => {
          calls.push(`confirm:${quoteRequestId}`);
          return true;
        },
      }),
    ).resolves.toBeUndefined();
    // Round C (item 6) — the closure is handed the mark's quote id, so a caller
    // never re-reads it (or asserts it non-null) on its own.
    expect(calls).toEqual(['findByIds', `confirm:${QUOTE_SOURCE.sourceQuoteRequestId}`]);
  });

  it('an unconfirmed source judges the seeded line like any line', async () => {
    const refusal = await assertCartMeetsMinimums(catalogue([]), {
      cart: QUOTE_SOURCE,
      items: seeded,
      availableOnly: async (products) => products,
      confirmQuoteSource: async () => false,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal).toMatchObject({ statusCode: 422, code: 'PRODUCT_BELOW_MINIMUM_QUANTITY' });
  });

  it('feature 163 (FR-006) — a line whose product is no longer available refuses with the unknown-id 404', async () => {
    const refusal = await assertCartMeetsMinimums(catalogue([]), {
      cart: { sourceQuoteRequestId: null },
      items: seeded,
      availableOnly: async () => [],
      confirmQuoteSource: async () => true,
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal).toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
  });

  it('a basket without a mark never asks for a confirmation', async () => {
    const calls: string[] = [];
    await assertCartMeetsMinimums(catalogue(calls), {
      cart: NO_SOURCE,
      items: [item({ id: 'i1', productId: A, quantity: 12 })],
      availableOnly: async (products) => products,
      confirmQuoteSource: async () => {
        calls.push('confirm');
        return true;
      },
    });
    expect(calls).toEqual(['findByIds']);
  });
});
