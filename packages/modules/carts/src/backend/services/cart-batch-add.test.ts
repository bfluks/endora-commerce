import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  type CatalogPackagingUnitRecord,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type LinePricePort,
  type OrganizationDetailsPort,
  type ProductDisplayModePort,
} from '@endora-commerce/contracts';
import {
  ModuleDisabledError,
  SalesChannel,
  type SalesChannelMembershipPort,
} from '@endora-commerce/platform/kernel';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { CART_MAX_LINES, CartService, type CustomerContext } from './cart-service.js';

/**
 * Feature 154, Phase 7 (T048) — `CartService.addItems`, the one batch every batch
 * path into a cart goes through (`specs/154-catalog-order-constraints/research.md`
 * R8, `contracts/cart-and-checkout-api.md` §4).
 *
 * 1. **Resolution first** (threat F1): every line meets exactly `addItem`'s
 *    preconditions; a line that fails gets the unknown-id answer, never a name or
 *    a minimum, and counts toward no total.
 * 2. **Two passes** with the cart (D1): unit minimums, then pieces minimums over
 *    the survivors. Existing cart lines are never rejected.
 * 3. The accepted lines are added through `addItem`'s own write.
 *
 * The `EntityManager` is an in-memory double holding this module's two tables and
 * answering the system-default channel; `catalog`, `price_lists` and the channel
 * bridge are port doubles.
 */

const CUSTOMER: CustomerContext = { customerAccountId: 'cust-1', organizationId: 'org-1' };
const ACTOR = { customer: CUSTOMER };
const DEFAULT_CHANNEL = { id: 'ch-default', systemDefault: true };

// ── products ────────────────────────────────────────────────────────────────

const A = 'prod-a'; // pieces minimum 10, two variants
const B = 'prod-b'; // no minimum
const C = 'prod-c'; // pieces minimum 10, Pallet of 64 with a minimum of 2 units
const H = 'prod-h'; // minimum 10, restricted to another organisation — hidden
const Q = 'prod-q'; // quote-only
const UNKNOWN = 'prod-unknown';
const PALLET = 'unit-pallet';
const RED = 'var-red';
const BLUE = 'var-blue';

function product(
  id: string,
  overrides: Partial<CatalogProductRecord> = {},
): CatalogProductRecord {
  return {
    id,
    type: 'simple',
    status: 'active',
    name: { en: `Name of ${id}`, pl: `Nazwa ${id}` },
    visibility: 'public',
    allowedOrganizationIds: [],
    attributeValues: { defaultPrice: 10 },
    minOrderQuantity: null,
    ...overrides,
  } as unknown as CatalogProductRecord;
}

const PRODUCTS = new Map<string, CatalogProductRecord>([
  [A, product(A, { type: 'configurable', minOrderQuantity: 10, name: { en: 'Anchor', pl: 'Kotwa' } })],
  [B, product(B)],
  [C, product(C, { minOrderQuantity: 10, name: { en: 'Cement', pl: 'Cement PL' } })],
  [H, product(H, { minOrderQuantity: 10, allowedOrganizationIds: ['org-other'] })],
  [Q, product(Q)],
]);

const UNITS: CatalogPackagingUnitRecord[] = [
  { id: PALLET, productId: C, name: 'Pallet', baseQuantity: 64, minOrderUnits: 2 } as CatalogPackagingUnitRecord,
];

// ── the rig ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string };

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === (value ?? null));
}

interface Rig {
  service: CartService;
  carts: Row[];
  items: Row[];
  writes: { flushes: number; created: number };
  catalog: {
    findById: ReturnType<typeof vi.fn>;
    listPackagingUnitsByProductIds: ReturnType<typeof vi.fn>;
  };
  audits: unknown[];
}

function rig(
  options: {
    carts?: Row[];
    items?: Row[];
    products?: Map<string, CatalogProductRecord>;
    findById?: (id: string) => Promise<CatalogProductRecord | null>;
    resolveLinePrice?: LinePricePort['resolveLinePrice'];
    /** Products each named channel publishes. */
    channels?: Record<string, string[]>;
  } = {},
): Rig {
  const carts: Row[] = options.carts ?? [];
  const items: Row[] = options.items ?? [];
  const writes = { flushes: 0, created: 0 };
  const products = options.products ?? PRODUCTS;
  const tableOf = (entity: unknown): Row[] => {
    if (entity === Cart) return carts;
    if (entity === CartItem) return items;
    throw new Error(`carts queried an entity it does not own: ${String(entity)}`);
  };
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === SalesChannel) return DEFAULT_CHANNEL;
      return tableOf(entity).find((row) => matches(row, where)) ?? null;
    },
    find: async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(entity).filter((row) => matches(row, where)),
    count: async (entity: unknown, where: Record<string, unknown>) =>
      tableOf(entity).filter((row) => matches(row, where)).length,
    create: (entity: unknown, data: Record<string, unknown>) => {
      writes.created += 1;
      const row: Row = { id: randomUUID(), ...data };
      if (entity === Cart) row['sourceQuoteRequestId'] ??= null;
      return row;
    },
    persist: (row: Row) => {
      const table = 'cartId' in row ? items : carts;
      if (!table.includes(row)) table.push(row);
    },
    persistAndFlush: async (row: Row) => {
      writes.flushes += 1;
      const table = 'cartId' in row ? items : carts;
      if (!table.includes(row)) table.push(row);
    },
    flush: async () => {
      writes.flushes += 1;
    },
  } as unknown as EntityManager;

  const catalog = {
    findById: vi.fn(options.findById ?? (async (id: string) => products.get(id) ?? null)),
    findPackagingUnitInProduct: async (productId: string, unitId: string) =>
      UNITS.find((u) => u.id === unitId && u.productId === productId) ?? null,
    listPackagingUnitsByProductIds: vi.fn(async (ids: readonly string[]) =>
      UNITS.filter((u) => ids.includes(u.productId)),
    ),
  };
  const pricing: LinePricePort = {
    resolveLinePrice:
      options.resolveLinePrice ??
      (async ({ product: p }) => ({
        amount: '10.00',
        currency: 'PLN',
        priceListId: 'pl-1',
        isSale: false,
        bracketStartQuantity: 1,
        displayMode: p.id === Q ? 'none' : 'gross_only',
      })),
  };
  const organizations = { findById: async () => null } as unknown as OrganizationDetailsPort;
  const membership = {
    filterEntityIdsInChannel: async (channelId: string, _kind: string, ids: string[]) =>
      ids.filter((id) => (options.channels?.[channelId] ?? []).includes(id)),
  } as unknown as SalesChannelMembershipPort;
  // Asked only when no price list holds the product (issue #236).
  const displayModes: ProductDisplayModePort = { resolveDisplayMode: async () => 'gross_only' };
  const audits: unknown[] = [];
  const auditService = { record: async (entry: unknown) => void audits.push(entry) };

  const service = new CartService(
    () => em,
    pricing,
    catalog as unknown as CatalogProductReadPort,
    organizations,
    membership,
    displayModes,
    undefined,
    auditService as never,
  );
  return { service, carts, items, writes, catalog, audits };
}

function existingCart(overrides: Partial<Row> = {}): Row {
  return {
    id: 'cart-1',
    customerAccountId: CUSTOMER.customerAccountId,
    organizationId: CUSTOMER.organizationId,
    status: 'active',
    sourceQuoteRequestId: null,
    ...overrides,
  };
}

function cartLine(overrides: Partial<Row> & { productId: string; quantity: number }): Row {
  return {
    id: randomUUID(),
    cartId: 'cart-1',
    variantId: null,
    packagingUnitId: null,
    packagingUnitBaseQuantity: null,
    quoteSeededQuantity: null,
    unitPrice: '10.00',
    currency: 'PLN',
    ...overrides,
  };
}

const NOT_FOUND = { status: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND, message: 'Product not found.' };

// ── 1. resolution first ─────────────────────────────────────────────────────

describe('addItems — resolution first (F1, FR-035)', () => {
  it('a hidden, an out-of-channel and an unknown product each get the unknown-id 404, with no name or minimum', async () => {
    const r = rig({ carts: [existingCart()], channels: { 'ch-x': [B] } });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: H, quantity: 5 },
        { productId: UNKNOWN, quantity: 5 },
        { productId: A, quantity: 5, salesChannelId: 'ch-x' },
        { productId: B, quantity: 1 },
      ],
      { onLineError: 'report' },
    );

    expect(result.outcomes).toEqual([
      { index: 0, status: 'failed', error: NOT_FOUND },
      { index: 1, status: 'failed', error: NOT_FOUND },
      { index: 2, status: 'failed', error: NOT_FOUND },
      { index: 3, status: 'added' },
    ]);
    // A hidden product's outcome is the unknown id's, byte for byte, but for its index.
    const { index: _h, ...hidden } = result.outcomes[0]!;
    const { index: _u, ...unknown } = result.outcomes[1]!;
    expect(JSON.stringify(hidden)).toBe(JSON.stringify(unknown));
    // F12 — the unit read only ever sees vetted ids.
    for (const [ids] of r.catalog.listPackagingUnitsByProductIds.mock.calls as [string[]][]) {
      expect(ids).not.toContain(H);
      expect(ids).not.toContain(UNKNOWN);
      expect(ids).not.toContain(A);
    }
    expect(r.items.map((i) => i.productId)).toEqual([B]);
  });

  it('an unknown packaging unit is the unit 404 and its line counts toward no total', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5, packagingUnitId: 'unit-gone' },
        { productId: A, variantId: BLUE, quantity: 5 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes[0]).toEqual({
      index: 0,
      status: 'failed',
      error: {
        status: 404,
        code: ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
        message: 'Packaging unit not found for this product.',
      },
    });
    // Had the unresolved line counted, A's total would be 10 and the line admitted.
    expect(result.outcomes[1]).toMatchObject({ index: 1, status: 'below_minimum', minimum: 10 });
    expect(r.items).toHaveLength(0);
  });

  it("'throw' throws the first resolution failure before anything is written", async () => {
    const r = rig();
    await expect(
      r.service.addItems(
        ACTOR,
        [
          { productId: B, quantity: 1 },
          { productId: H, quantity: 5 },
          { productId: UNKNOWN, quantity: 1 },
        ],
        { onLineError: 'throw' },
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND });
    expect(r.carts).toHaveLength(0);
    expect(r.items).toHaveLength(0);
    expect(r.writes).toEqual({ flushes: 0, created: 0 });
  });

  it('a quantity below one is a resolution failure like addItem\'s', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(ACTOR, [{ productId: B, quantity: 0 }], { onLineError: 'report' });
    expect(result.outcomes).toEqual([
      {
        index: 0,
        status: 'failed',
        error: { status: 422, code: ERROR_CODES.CART_QUANTITY_INVALID, message: 'Quantity must be at least 1.' },
      },
    ]);
  });
});

// ── 2. two passes with the cart ─────────────────────────────────────────────

describe('addItems — two passes with the cart (D1, FR-006a)', () => {
  it('split variants A-red 5 + A-blue 5 against a minimum of 10 are both added', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5 },
        { productId: A, variantId: BLUE, quantity: 5 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'added' },
      { index: 1, status: 'added' },
    ]);
    expect(r.items.map((i) => [i.variantId, i.quantity])).toEqual([
      [RED, 5],
      [BLUE, 5],
    ]);
    expect(result.items).toHaveLength(2);
  });

  it('A-red 5 + A-blue 3 are both below the minimum, named in the request language, and nothing is added', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: A, variantId: RED, quantity: 5 },
        { productId: A, variantId: BLUE, quantity: 3 },
      ],
      { onLineError: 'report', language: 'pl' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'below_minimum', productId: A, productName: 'Kotwa', kind: 'pieces', minimum: 10 },
      { index: 1, status: 'below_minimum', productId: A, productName: 'Kotwa', kind: 'pieces', minimum: 10 },
    ]);
    expect(r.items).toHaveLength(0);
  });

  it('a rejected pallet line lowers the pieces total, and pass 2 rejects the piece line too', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: C, quantity: 1, packagingUnitId: PALLET },
        { productId: C, quantity: 3 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      {
        index: 0,
        status: 'below_minimum',
        productId: C,
        productName: 'Cement',
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: 'Pallet',
      },
      { index: 1, status: 'below_minimum', productId: C, productName: 'Cement', kind: 'pieces', minimum: 10 },
    ]);
    expect(r.items).toHaveLength(0);
  });

  it('two pallets and three pieces of the same product are both added', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: C, quantity: 2, packagingUnitId: PALLET },
        { productId: C, quantity: 3 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes.map((o) => o.status)).toEqual(['added', 'added']);
    expect(r.items.map((i) => i.quantity)).toEqual([128, 3]);
  });

  it('a line already in the cart below its minimum is never rejected; the batch is judged with it', async () => {
    const existingA = cartLine({ productId: A, quantity: 3 });
    const r = rig({ carts: [existingCart()], items: [existingA] });

    const unrelated = await r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError: 'report' });
    expect(unrelated.outcomes).toEqual([{ index: 0, status: 'added' }]);

    const short = await r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 4 }], {
      onLineError: 'report',
    });
    expect(short.outcomes[0]).toMatchObject({ status: 'below_minimum', kind: 'pieces', minimum: 10 });

    const enough = await r.service.addItems(ACTOR, [{ productId: A, variantId: RED, quantity: 7 }], {
      onLineError: 'report',
    });
    expect(enough.outcomes).toEqual([{ index: 0, status: 'added' }]);
    expect(existingA.quantity).toBe(3);
  });

  it('an exempt quote-seeded line counts toward its product total', async () => {
    const seeded = cartLine({ productId: A, quantity: 5, quoteSeededQuantity: 5 });
    const r = rig({ carts: [existingCart({ sourceQuoteRequestId: 'qr-1' })], items: [seeded] });

    const short = await r.service.addItems(ACTOR, [{ productId: A, variantId: BLUE, quantity: 3 }], {
      onLineError: 'report',
    });
    expect(short.outcomes[0]).toMatchObject({ status: 'below_minimum', minimum: 10 });

    const enough = await r.service.addItems(ACTOR, [{ productId: A, variantId: BLUE, quantity: 5 }], {
      onLineError: 'report',
    });
    expect(enough.outcomes).toEqual([{ index: 0, status: 'added' }]);
  });

  it('outcomes are in input order across every status', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 1 },
        { productId: A, quantity: 2 },
        { productId: UNKNOWN, quantity: 1 },
        { productId: B, quantity: 2 },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes.map((o) => [o.index, o.status])).toEqual([
      [0, 'added'],
      [1, 'below_minimum'],
      [2, 'failed'],
      [3, 'added'],
    ]);
    // The two B lines share (product, variant, unit) and so one cart line, as addItem bumps.
    expect(r.items.map((i) => [i.productId, i.quantity])).toEqual([[B, 3]]);
    expect(r.audits).toHaveLength(2);
  });
});

// ── 3. adding, and the error modes ──────────────────────────────────────────

describe('addItems — the add step and the error modes', () => {
  it("'throw' rethrows a step-3 refusal with the earlier lines added", async () => {
    const r = rig({ carts: [existingCart()] });
    await expect(
      r.service.addItems(
        ACTOR,
        [
          { productId: B, quantity: 1 },
          { productId: Q, quantity: 1 },
          { productId: B, quantity: 1, variantId: RED },
        ],
        { onLineError: 'throw' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.CART_PRODUCT_QUOTE_ONLY });
    expect(r.items.map((i) => i.productId)).toEqual([B]);
  });

  it("'report' returns a step-3 refusal as failed and goes on", async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(
      ACTOR,
      [
        { productId: B, quantity: 1 },
        { productId: Q, quantity: 1 },
        { productId: B, quantity: 1, variantId: RED },
      ],
      { onLineError: 'report' },
    );
    expect(result.outcomes).toEqual([
      { index: 0, status: 'added' },
      {
        index: 1,
        status: 'failed',
        error: {
          status: 400,
          code: ERROR_CODES.CART_PRODUCT_QUOTE_ONLY,
          message: 'This product is sold on request only and cannot be added to the cart.',
        },
      },
      { index: 2, status: 'added' },
    ]);
  });

  it('a switched-off catalogue is rethrown in either mode, never reported as a line', async () => {
    for (const onLineError of ['report', 'throw'] as const) {
      const r = rig({
        carts: [existingCart()],
        findById: async () => {
          throw new ModuleDisabledError('catalog');
        },
      });
      await expect(
        r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError }),
      ).rejects.toMatchObject({ statusCode: 503, code: ERROR_CODES.MODULE_DISABLED });
    }
  });

  it('a switched-off pricing engine in the add step is rethrown in report mode', async () => {
    const r = rig({
      carts: [existingCart()],
      resolveLinePrice: async () => {
        throw new ModuleDisabledError('price_lists');
      },
    });
    await expect(
      r.service.addItems(ACTOR, [{ productId: B, quantity: 1 }], { onLineError: 'report' }),
    ).rejects.toMatchObject({ statusCode: 503, code: ERROR_CODES.MODULE_DISABLED });
  });

  it(`refuses more than CART_MAX_LINES lines before resolving any`, async () => {
    const r = rig({ carts: [existingCart()] });
    const lines = Array.from({ length: CART_MAX_LINES + 1 }, () => ({ productId: B, quantity: 1 }));
    await expect(r.service.addItems(ACTOR, lines, { onLineError: 'report' })).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.CART_LINE_CAP_EXCEEDED,
    });
    expect(r.catalog.findById).not.toHaveBeenCalled();
  });

  it('an empty batch answers the cart with no outcomes', async () => {
    const r = rig({ carts: [existingCart()] });
    const result = await r.service.addItems(ACTOR, [], { onLineError: 'throw' });
    expect(result.outcomes).toEqual([]);
    expect(result.cart.id).toBe('cart-1');
  });

  it('refuses a batch with neither a customer nor an anonymous token', async () => {
    const r = rig();
    await expect(
      r.service.addItems({}, [{ productId: B, quantity: 1 }], { onLineError: 'report' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(r.catalog.findById).not.toHaveBeenCalled();
  });
});

// ── performance (F4) ────────────────────────────────────────────────────────

describe('addItems — bounded work (F4, R20)', () => {
  it('200 batch lines against a 200-line cart finish well within a generous bound', async () => {
    const ids = Array.from({ length: CART_MAX_LINES }, (_, i) => `perf-${i}`);
    const products = new Map(ids.map((id) => [id, product(id, { minOrderQuantity: 10 })]));
    const r = rig({
      carts: [existingCart()],
      items: ids.map((id) => cartLine({ productId: id, quantity: 10 })),
      products,
    });
    const started = performance.now();
    const result = await r.service.addItems(
      ACTOR,
      ids.map((id) => ({ productId: id, quantity: 1 })),
      { onLineError: 'report' },
    );
    const elapsed = performance.now() - started;
    expect(result.outcomes.every((o) => o.status === 'added')).toBe(true);
    // One unit read for the whole batch, not one per line.
    expect(r.catalog.listPackagingUnitsByProductIds).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(2_000);
  });
});
