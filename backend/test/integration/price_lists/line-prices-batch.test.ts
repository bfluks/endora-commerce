import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CustomerAccount,
  CustomerGroup,
  Organization,
  Product,
  type ProductRow,
} from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';

/**
 * D-287 P0 — the batched, quantity-aware line resolution, and the one
 * customer-group rule.
 *
 * `resolveLinePrices` replaces the per-line loops of the cart read, the
 * placement drift check, a quote's reference prices and the external catalogue
 * API (`specs/pricing/read-paths-and-performance.md` §2.3, §5). Batching changes
 * how rows are loaded and must change nothing else, so the reference here is the
 * per-line path it replaces — `resolveLinePrice`, untouched — key by key, over a
 * fixture with quantity tiers, a bracket gap that falls through, a category
 * rule, a sale list on a customer group, the same product on several lines at
 * different quantities, a product priced only by its own attribute and one
 * priced by nothing.
 *
 * The customer-group half: the sale list targets a group that is the
 * **customer's own**, not the organisation's. Before P0 only quotes and the
 * admin order preview resolved it; listings, the product page and the cart
 * passed the organisation alone. Every entry point must honour it once the
 * caller names the customer account.
 */

async function countQueries<T>(
  h: BackendServerHandle,
  work: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
  const conn = h.em().getConnection() as unknown as {
    execute: (...args: unknown[]) => Promise<unknown>;
  };
  const original = conn.execute.bind(conn);
  let queries = 0;
  conn.execute = (...args: unknown[]) => {
    queries += 1;
    return original(...args);
  };
  try {
    return { result: await work(), queries };
  } finally {
    conn.execute = original;
  }
}

describe('price_lists — batched line prices and the customer-group rule', () => {
  let h: BackendServerHandle;
  let salesChannel: SalesChannel;
  let organization: Organization;
  let customerAccountId: string;
  let otherOrgAccountId: string;
  let products: ProductRow[];
  let pricing: PricingService;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    salesChannel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

    const orgGroup = em.create(CustomerGroup, { code: `cg-org-${stamp}`, name: 'Org group' });
    const vipGroup = em.create(CustomerGroup, { code: `cg-vip-${stamp}`, name: 'VIP' });
    await em.persistAndFlush([orgGroup, vipGroup]);

    const makeOrg = (name: string) =>
      em.create(Organization, {
        name,
        taxId: `LPB-${stamp}-${name.length}`,
        vatStatus: 'vat_payer',
        status: 'active',
        customerGroupId: orgGroup.id,
        registeredAddress: { street: 'Test 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
      });
    organization = makeOrg('Line batch org');
    const otherOrganization = makeOrg('Line batch other org');
    await em.persistAndFlush([organization, otherOrganization]);

    // The customer's own group overrides the organisation's (feature 040 R6).
    const account = em.create(CustomerAccount, {
      organizationId: organization.id,
      email: `line-batch-${stamp}@x.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Line',
      lastName: 'Batch',
      customerGroupId: vipGroup.id,
    });
    // Same group, another organisation: must not lend its group to `organization`.
    const otherAccount = em.create(CustomerAccount, {
      organizationId: otherOrganization.id,
      email: `line-batch-other-${stamp}@x.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Other',
      lastName: 'Org',
      customerGroupId: vipGroup.id,
    });
    await em.persistAndFlush([account, otherAccount]);
    customerAccountId = account.id;
    otherOrgAccountId = otherAccount.id;

    const p101 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    const p102 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_102_ID });
    const p103 = await em.findOneOrFail(Product, { id: SEED_PRODUCT_103_ID });
    const ownPriceOnly = em.create(Product, {
      sku: `LPB-OWN-${stamp}`,
      slug: `lpb-own-${stamp}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Own price only' },
      description: { 'en-US': 'x' },
      visibility: 'public',
      attributeValues: { defaultPrice: 55.5 },
    });
    const unpriced = em.create(Product, {
      sku: `LPB-NONE-${stamp}`,
      slug: `lpb-none-${stamp}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Unpriced' },
      description: { 'en-US': 'x' },
      visibility: 'public',
      attributeValues: {},
    });
    await em.persistAndFlush([ownPriceOnly, unpriced]);
    products = [p101, p102, p103, ownPriceOnly, unpriced];

    const categoryRows = await em
      .getConnection()
      .execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ?`,
        [SEED_PRODUCT_101_ID],
      );
    const categoryId = categoryRows[0]!.category_id;

    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));

    // Default, with a quantity tier on p101.
    for (const [product, brackets] of [
      [p101, [{ minQuantity: 1, maxQuantity: 9, amount: '100' }, { minQuantity: 10, maxQuantity: null, amount: '90' }]],
      [p102, [{ minQuantity: 1, maxQuantity: null, amount: '110' }]],
      [p103, [{ minQuantity: 1, maxQuantity: null, amount: '120' }]],
    ] as const) {
      await lists.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
      await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, { PLN: [...brackets] });
    }

    // The organisation's list starts at 5 pieces: quantity 1 falls through.
    const orgList = await lists.create({
      name: 'LPB org list',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'organization', values: [organization.id] },
    });
    await lists.addProduct(orgList.id, p101.id);
    await lists.replaceBrackets(orgList.id, p101.id, {
      PLN: [{ minQuantity: 5, maxQuantity: null, amount: '70' }],
    });
    await lists.activate(orgList.id);

    const catList = await lists.create({
      name: 'LPB category list',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'category', values: [categoryId] },
    });
    for (const [product, amount] of [
      [p101, '85'],
      [p102, '88'],
    ] as const) {
      await lists.addProduct(catList.id, product.id);
      await lists.replaceBrackets(catList.id, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
      });
    }
    await lists.activate(catList.id);

    // A sale on the customer's OWN group, with a tier.
    const vipSale = await lists.create({
      name: 'LPB VIP sale',
      type: 'sale',
      applicationRule: { kind: 'criterion', type: 'customerGroup', values: [vipGroup.id] },
    });
    await lists.addProduct(vipSale.id, p103.id);
    await lists.replaceBrackets(vipSale.id, p103.id, {
      PLN: [
        { minQuantity: 1, maxQuantity: 19, amount: '60' },
        { minQuantity: 20, maxQuantity: null, amount: '50' },
      ],
    });
    await lists.activate(vipSale.id);

    pricing = new PricingService(
      h.em,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
      customerAccountPortsFor(h.em).read,
    );
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const lines = () => {
    const [p101, p102, p103, own, none] = products as [ProductRow, ProductRow, ProductRow, ProductRow, ProductRow];
    return [
      { key: 'p101x1', product: p101, quantity: 1 },
      { key: 'p101x5', product: p101, quantity: 5 },
      { key: 'p101x12', product: p101, quantity: 12 },
      { key: 'p101x5-again', product: p101, quantity: 5 },
      { key: 'p102x1', product: p102, quantity: 1 },
      { key: 'p103x1', product: p103, quantity: 1 },
      { key: 'p103x25', product: p103, quantity: 25 },
      { key: 'own', product: own, quantity: 1 },
      { key: 'none', product: none, quantity: 3 },
    ];
  };

  const viewers = [
    { label: 'anonymous visitor', org: false, account: false },
    { label: 'signed-in organisation', org: true, account: false },
    { label: 'signed-in customer with their own group', org: true, account: true },
  ];

  for (const viewer of viewers) {
    it(`answers, key by key, what one resolveLinePrice per line answers — ${viewer.label}`, async () => {
      const context = {
        organization: viewer.org ? organization : null,
        ...(viewer.account ? { customerAccountId } : {}),
        salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
      };
      const batched = await pricing.resolveLinePrices({ lines: lines(), context });
      expect(batched.size).toBe(lines().length);
      for (const line of lines()) {
        const single = await pricing.resolveLinePrice({
          product: line.product,
          variantId: null,
          context: { ...context, quantity: line.quantity },
        });
        expect(batched.get(line.key), line.key).toEqual(single);
      }
    });
  }

  it('prices each line at its own quantity', async () => {
    const out = await pricing.resolveLinePrices({
      lines: lines(),
      context: {
        organization,
        salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
      },
    });
    expect(out.get('p101x1')).toMatchObject({ amount: '85.0000', isSale: false });
    expect(out.get('p101x5')).toMatchObject({ amount: '70.0000', bracketStartQuantity: 5 });
    expect(out.get('p101x12')).toMatchObject({ amount: '70.0000' });
    expect(out.get('p101x5-again')).toEqual(out.get('p101x5'));
    expect(out.get('own')).toBeNull();
    expect(out.get('none')).toBeNull();
  });

  it("honours the customer's own group on every entry point once the account is named", async () => {
    const channel = { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency };
    const [, , p103] = products as [ProductRow, ProductRow, ProductRow];

    // The organisation alone: its group has no list, so Default prices p103.
    const orgOnly = await pricing.resolveEngine({
      product: p103,
      context: { quantity: 1, organization, salesChannel: channel },
    });
    expect(orgOnly.sale).toBeNull();
    expect(orgOnly.base.bracket?.amount).toBe('120.0000');

    // The customer: their VIP sale wins, on every entry point.
    const engine = await pricing.resolveEngine({
      product: p103,
      context: { quantity: 1, organization, customerAccountId, salesChannel: channel },
    });
    expect(engine.sale?.bracket.amount).toBe('60.0000');

    const line = await pricing.resolveLinePrice({
      product: p103,
      context: { quantity: 25, organization, customerAccountId, salesChannel: channel },
    });
    expect(line).toMatchObject({ amount: '50.0000', isSale: true });

    const listing = await pricing.resolveListingPrices({
      products: [p103],
      context: { organization, customerAccountId, salesChannel: channel },
    });
    expect(listing.get(p103.id)).toMatchObject({ source: 'price_list', amount: '60.0000', isSale: true });

    const details = await pricing.resolveListingPriceDetails({
      products: [p103],
      context: { organization, customerAccountId, salesChannel: channel },
    });
    expect(details.get(p103.id)).toMatchObject({
      basePrice: { amount: '120.0000', currency: 'PLN' },
      salePrice: { amount: '60.0000', currency: 'PLN' },
    });

    const batch = await pricing.resolveLinePrices({
      lines: [{ key: 'k', product: p103, quantity: 1 }],
      context: { organization, customerAccountId, salesChannel: channel },
    });
    expect(batch.get('k')).toMatchObject({ amount: '60.0000', isSale: true });
  });

  it("orders by price on the customer's own group too, so the sort matches the card", async () => {
    // The price sort is resolved for the same viewer the card is; a sort that
    // read the organisation's group alone would place p103 at 120 while the
    // card beside it shows the customer's 60.
    const channel = { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency };
    const [, , p103] = products as [ProductRow, ProductRow, ProductRow];
    const context = { organization, customerAccountId, salesChannel: channel };
    const chunk = await pricing.orderByUnitPrice({
      context,
      direction: 'asc',
      after: null,
      limit: 50,
      restrictToProductIds: [p103.id],
    });
    expect(chunk.rows).toHaveLength(1);
    expect(chunk.rows[0]).toMatchObject({ productId: p103.id, amount: '60.0000', isSale: true });
    const card = await pricing.resolveListingPrices({ products: [p103], context });
    expect(card.get(p103.id)).toMatchObject({ amount: chunk.rows[0]!.amount });
  });

  it("ignores the group of an account that belongs to another organisation", async () => {
    const [, , p103] = products as [ProductRow, ProductRow, ProductRow];
    const out = await pricing.resolveLinePrice({
      product: p103,
      context: {
        quantity: 1,
        organization,
        customerAccountId: otherOrgAccountId,
        salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
      },
    });
    expect(out).toMatchObject({ amount: '120.0000', isSale: false });
  });

  it('resolveListingPriceDetails is resolveListingPrices plus resolveEngine, from one resolution', async () => {
    const channel = { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency };
    const context = { organization, customerAccountId, salesChannel: channel };
    const details = await pricing.resolveListingPriceDetails({ products, context });
    const prices = await pricing.resolveListingPrices({ products, context });
    expect(details.size).toBe(products.length);
    for (const product of products) {
      const detail = details.get(product.id)!;
      expect(detail.price, product.sku).toEqual(prices.get(product.id));
      const engine = await pricing.resolveEngine({ product, context: { ...context, quantity: 1 } });
      expect(detail.displayMode).toBe(engine.displayMode);
      expect(detail.salePrice).toEqual(
        engine.sale ? { amount: engine.sale.bracket.amount, currency: engine.currencyCode } : null,
      );
      const expectedBase = engine.base.bracket
        ? { amount: engine.base.bracket.amount, currency: engine.currencyCode }
        : detail.price.source === 'product'
          ? { amount: detail.price.amount, currency: detail.price.currency }
          : null;
      expect(detail.basePrice).toEqual(expectedBase);
    }
  });

  it('pays a statement count that does not grow with the lines', async () => {
    const context = {
      organization,
      customerAccountId,
      salesChannel: { id: salesChannel.id, defaultCurrency: salesChannel.defaultCurrency },
    };
    const few = lines();
    const many = Array.from({ length: 5 }, (_, i) => few.map((l) => ({ ...l, key: `${l.key}#${i}` }))).flat();

    const small = await countQueries(h, () => pricing.resolveLinePrices({ lines: few, context }));
    const large = await countQueries(h, () => pricing.resolveLinePrices({ lines: many, context }));
    let looped = 0;
    for (const line of few) {
      looped += (
        await countQueries(h, () =>
          pricing.resolveLinePrice({ product: line.product, context: { ...context, quantity: line.quantity } }),
        )
      ).queries;
    }

    expect(large.result.size).toBe(many.length);
    expect(large.queries).toBe(small.queries);
    // The loop paid ~7+ statements per line; the batch is a small constant.
    expect(small.queries).toBeLessThanOrEqual(16);
    expect(small.queries).toBeLessThan(looped);
    // eslint-disable-next-line no-console
    console.info(
      `[line-prices-batch] ${few.length} lines: batch=${small.queries} statements, ` +
        `${many.length} lines: batch=${large.queries}, per-line loop=${looped}`,
    );
  });
});
