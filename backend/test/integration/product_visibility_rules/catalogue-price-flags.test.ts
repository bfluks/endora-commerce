import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogueReferencePricePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { Product } from '../../helpers/package-entities.js';
import { CataloguePriceFlags } from '../../../../packages/modules/product_visibility_rules/src/backend/services/catalogue-price-flags.js';
import {
  call,
  clearConfiguration,
  clearFlags,
  flagsOf,
  forgetTestRoles,
  pricePort,
  roleWith,
  scopePort,
  settleFlags,
  visibleTo,
  waitForMark,
  type TestRole,
} from './fixtures.js';

/**
 * Spec 193 Phase 4 (T026) — the catalogue-price flags behind the admin scope, from real price books
 * (FR-002 – FR-007, SC-001 at the port; research R-5; threat model TM-7; owner answer Q2 A).
 *
 * A = PLN, B = EUR. Five simple products in five price states, and a configurable product with
 * one qualifying and one non-qualifying variant, under four categories. Every read the port
 * offers — `filterVisible`, the product and variant predicates embedded in a statement, and the
 * live line check — answers exactly the expected set.
 */
describe('catalogue-price flags and the admin scope (spec 193, T026)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let P6: { id: string; attributeValues: Record<string, unknown> };
  const roles: Record<'aPos' | 'bPos' | 'aAny' | 'aOrB', TestRole> = {} as never;
  const ids = () => [f.products.P1.id, f.products.P2.id, f.products.P3.id, f.products.P4.id, P6.id, f.products.P5.id];
  const variants = () => [f.variants.P5r, f.variants.P5b];

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await clearConfiguration(h);
    await clearFlags(h);
    const em = h.em();
    const stamp = randomUUID().slice(0, 8);
    const p6 = em.create(Product, {
      sku: `P6-${stamp}`,
      slug: `p6-${stamp}`,
      type: 'simple',
      status: 'active',
      name: 'Unpriced',
      description: 'Unpriced',
      visibility: 'public',
      attributeValues: {},
    });
    await em.persist(p6).flush();
    P6 = { id: p6.id, attributeValues: {} };

    const tier = (amount: string) => [{ minQuantity: 1, maxQuantity: null, amount }];
    // P1: A > 0 only. P2: B > 0 only. P3: both. P4: A = 0 only. P6: no price.
    await f.setBase(f.products.P1, { product: tier('100'), variants: {} });
    await f.setBase(f.products.P2, { product: [], variants: {} });
    await f.setBase(f.products.P2, { product: tier('20'), variants: {} }, 'EUR');
    await f.setBase(f.products.P3, { product: tier('30'), variants: {} });
    await f.setBase(f.products.P3, { product: tier('7'), variants: {} }, 'EUR');
    await f.setBase(f.products.P4, { product: tier('0'), variants: {} });
    // P5: only its red variant is priced.
    await f.setBase(f.products.P5, {
      product: [],
      variants: { [f.variants.P5r]: { type: 'fixed', tiers: tier('50') }, [f.variants.P5b]: null },
    });

    const category = async (name: string, conditions: unknown) =>
      (await call(h, 'POST', '/categories', { payload: { name, conditions } })).body.data.id as string;
    const mapped = async (categoryId: string) => {
      const role = await roleWith(h, ['rfqs:handle', 'catalog:read']);
      await call(h, 'PUT', `/role-mappings/${role.roleId}`, { payload: { target: { kind: 'category', categoryId } } });
      return role;
    };
    roles.aPos = await mapped(await category('A>0', [{ currencyCode: 'PLN', threshold: 'gt_zero' }]));
    roles.bPos = await mapped(await category('B>0', [{ currencyCode: 'EUR', threshold: 'gt_zero' }]));
    roles.aAny = await mapped(await category('A>=0', [{ currencyCode: 'PLN', threshold: 'gte_zero' }]));
    roles.aOrB = await mapped(
      await category('A>0 or B>0', [
        { currencyCode: 'PLN', threshold: 'gt_zero' },
        { currencyCode: 'EUR', threshold: 'gt_zero' },
      ]),
    );
    await flagsOf(h).requestRebuild(['PLN', 'EUR']);
    await settleFlags(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearConfiguration(h);
    await clearFlags(h);
    await f.clearBooks();
    await f.resetBase();
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  const expectVisible = async (role: TestRole, products: string[], variantIds: string[]) => {
    const scope = await scopePort(h).resolveScope(role.adminUserId);
    const seen = await visibleTo(h, scope, ids(), variants());
    const sorted = [...products].sort();
    expect(seen.products, 'filterVisible').toEqual(sorted);
    expect(seen.viaPredicate, 'productPredicate').toEqual(sorted);
    expect(seen.lines, 'checkLines').toEqual(sorted);
    expect(seen.variants, 'filterVisible variants').toEqual([...variantIds].sort());
    expect(seen.variantsViaPredicate, 'variantPredicate').toEqual([...variantIds].sort());
  };

  it('SC-001 — the 4 × 5 matrix and the configurable product: zero leaked, zero missing', async () => {
    const { P1, P2, P3, P4, P5 } = f.products;
    await expectVisible(roles.aPos, [P1.id, P3.id, P5.id], [f.variants.P5r]);
    await expectVisible(roles.bPos, [P2.id, P3.id], []);
    await expectVisible(roles.aAny, [P1.id, P3.id, P4.id, P5.id], [f.variants.P5r]);
    await expectVisible(roles.aOrB, [P1.id, P2.id, P3.id, P5.id], [f.variants.P5r]);
  });

  it('zero vs none: a zero price meets "≥ 0" and is marked "no fixed price"; no price meets nothing (FR-003, FR-043)', async () => {
    const scope = await scopePort(h).resolveScope(roles.aAny.adminUserId);
    const lines = await scopePort(h).checkLines(scope, [{ productId: f.products.P4.id }, { productId: P6.id }, { productId: f.products.P1.id }]);
    expect(lines).toEqual([
      { visible: true, noFixedPrice: true },
      { visible: false, noFixedPrice: false },
      { visible: true, noFixedPrice: false },
    ]);
  });

  it('a row write is refreshed by a targeted mark, through the change feed', async () => {
    await f.setBase({ id: P6.id }, { product: [{ minQuantity: 1, maxQuantity: null, amount: '5' }], variants: {} });
    // The bus delivers after the write returns: the subscriber's mark lands a moment later.
    await waitForMark(h, P6.id);
    await settleFlags(h);
    const scope = await scopePort(h).resolveScope(roles.aPos.adminUserId);
    expect((await scopePort(h).filterVisible(scope, { productIds: [P6.id] })).productIds.has(P6.id)).toBe(true);
    await f.setBase({ id: P6.id }, { product: [], variants: {} });
    await waitForMark(h, P6.id);
    await settleFlags(h);
  });

  it('a designation change swaps generations; meanwhile the currency drops for admins and the served flags stay readable (TM-7 (4), Q2 A)', async () => {
    const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '0' }] });
    const servedBefore = await servedOf('PLN');
    const rowsBefore = await flagRowCount('PLN', servedBefore);
    const set = await call(h, 'PUT', '/designations/PLN', { payload: { priceListId: book.id, salesChannelId: f.channels.CH1.id } });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    // Before the rebuild: admin scopes drop PLN; the served generation is untouched for the rule.
    const during = await scopePort(h).resolveScope(roles.aPos.adminUserId);
    expect(during.kind === 'restricted' && during.conditions).toEqual([]);
    expect(await servedOf('PLN')).toBe(servedBefore);
    expect(await flagRowCount('PLN', servedBefore)).toBe(rowsBefore);

    await settleFlags(h);
    expect(await servedOf('PLN')).toBe(servedBefore + 1);
    expect(await flagRowCount('PLN', servedBefore)).toBe(0);
    // P1 now costs 0 at the designated book: gone for "> 0", kept for "≥ 0".
    await expectVisible(roles.aPos, [f.products.P3.id, f.products.P5.id], [f.variants.P5r]);
    await expectVisible(roles.aAny, [f.products.P1.id, f.products.P3.id, f.products.P4.id, f.products.P5.id], [f.variants.P5r]);

    await call(h, 'DELETE', '/designations/PLN');
    await settleFlags(h);
    await expectVisible(roles.aPos, [f.products.P1.id, f.products.P3.id, f.products.P5.id], [f.variants.P5r]);
  });

  describe('races (TM-7)', () => {
    /** A flags instance over the same database, whose engine read can run something in the middle. */
    function racing(during: () => Promise<void>, failing = false) {
      const real = pricePort(h);
      let fired = false;
      const prices: Pick<CatalogueReferencePricePort, 'resolve' | 'changeWatermark'> = {
        resolve: async (input) => {
          const answer = await real.resolve(input);
          if (!fired) {
            fired = true;
            await during();
            if (failing) throw new Error('build crashed');
          }
          return answer;
        },
        changeWatermark: () => real.changeWatermark(),
      };
      return new CataloguePriceFlags({
        emFactory: () => h.em().fork(),
        prices: () => prices,
        listProductIds: async () => ids(),
        activeCurrencies: async () => ['PLN', 'EUR'],
      });
    }
    const markOf = async (productId: string) =>
      (
        await h
          .em()
          .getConnection()
          .execute<Array<{ n: number }>>(
            `select count(*)::int as n from "catalogue_price_stale_products" where "currency_code" = 'PLN' and "product_id" = ?`,
            [productId],
          )
      )[0]!.n;

    it('(1) a change landing between the refresh’s engine read and its write keeps its mark', async () => {
      await flagsOf(h).markProducts(['PLN'], [f.products.P3.id]);
      const refreshed = await racing(() => flagsOf(h).markProducts(['PLN'], [f.products.P3.id])).refreshMarked();
      expect(refreshed).toBe(1);
      expect(await markOf(f.products.P3.id)).toBe(1);
      await settleFlags(h);
      expect(await markOf(f.products.P3.id)).toBe(0);
    });

    it('(2) a refresh racing a swap writes nothing into the swapped-away generation and keeps its marks', async () => {
      await flagsOf(h).markProducts(['PLN'], [f.products.P3.id]);
      const served = await servedOf('PLN');
      const refreshed = await racing(async () => {
        await flagsOf(h).requestRebuild(['PLN']);
        await flagsOf(h).rebuildCurrency('PLN');
      }).refreshMarked();
      expect(refreshed).toBe(0);
      expect(await servedOf('PLN')).toBe(served + 1);
      expect(await flagRowCount('PLN', served)).toBe(0);
      expect(await markOf(f.products.P3.id)).toBe(1);
      await settleFlags(h);
      expect(await markOf(f.products.P3.id)).toBe(0);
    });

    it('(3) marks taken while n + 1 builds are applied to n + 1 after the swap', async () => {
      await flagsOf(h).requestRebuild(['PLN']);
      const served = await servedOf('PLN');
      const swapped = await racing(async () => {
        await f.setBase(f.products.P4, { product: [{ minQuantity: 1, maxQuantity: null, amount: '3' }], variants: {} });
      }).rebuildCurrency('PLN');
      expect(swapped).toBe(true);
      expect(await servedOf('PLN')).toBe(served + 1);
      await waitForMark(h, f.products.P4.id);
      expect(await markOf(f.products.P4.id)).toBe(1);
      await settleFlags(h);
      await expectVisible(roles.aPos, [f.products.P1.id, f.products.P3.id, f.products.P4.id, f.products.P5.id], [f.variants.P5r]);
      await f.setBase(f.products.P4, { product: [{ minQuantity: 1, maxQuantity: null, amount: '0' }], variants: {} });
      await waitForMark(h, f.products.P4.id);
      await settleFlags(h);
    });

    it('(6) a crashed build is never swapped, and the next one starts again', async () => {
      await flagsOf(h).requestRebuild(['PLN']);
      const served = await servedOf('PLN');
      await expect(racing(async () => undefined, true).rebuildCurrency('PLN')).rejects.toThrow('build crashed');
      expect(await servedOf('PLN')).toBe(served);
      await expectVisible(roles.aPos, [f.products.P1.id, f.products.P3.id, f.products.P5.id], [f.variants.P5r]);
      await flagsOf(h).requestRebuild(['PLN']);
      await settleFlags(h);
      expect(await servedOf('PLN')).toBeGreaterThan(served);
      const [leftover] = await h
        .em()
        .getConnection()
        .execute<Array<{ n: number }>>(
          `select count(*)::int as n from "product_catalogue_prices" where "currency_code" = 'PLN' and "generation" <> ?`,
          [await servedOf('PLN')],
        );
      expect(leftover!.n).toBe(0);
    });
  });

  async function servedOf(code: string): Promise<number> {
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ served_generation: number }>>(`select "served_generation" from "catalogue_price_generations" where "currency_code" = ?`, [code]);
    return Number(row?.served_generation ?? 0);
  }

  async function flagRowCount(code: string, generation: number): Promise<number> {
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ n: number }>>(`select count(*)::int as n from "product_catalogue_prices" where "currency_code" = ? and "generation" = ?`, [
        code,
        generation,
      ]);
    return row!.n;
  }
});
