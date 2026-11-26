import { randomUUID } from 'node:crypto';
import type { BackendServerHandle } from './test-server.js';
import { setupPricingFixture, type PricingFixture } from './pricing-fixture.js';
import { Product, ProductVariant } from './package-entities.js';
import {
  call,
  clearConfiguration,
  clearFlags,
  flagsOf,
  forgetTestRoles,
  roleWith,
  settleFlags,
  type TestRole,
} from '../integration/product_visibility_rules/fixtures.js';

/**
 * Spec 193 Phase 5 — one catalogue and three callers, shared by the catalog visibility tests
 * (`test/contract/catalog/visibility-*`, `test/integration/catalog/visibility-*`).
 *
 * Products (all active, from the feature-160 pricing fixture plus one of its own):
 *
 *  - `visible` — P1, PLN base price 100: meets "PLN > 0".
 *  - `configurable` — P5, priced only through its red variant (`visibleVariant`); its blue
 *    variant (`hiddenVariant`) has no price, so the parent is visible and that variant is not.
 *  - `hidden` — a configurable product with one variant and no price anywhere.
 *
 * Callers:
 *
 *  - `restricted` — a role mapped to a category "PLN > 0" (a `sql` predicate);
 *  - `noCategory` — unmapped and holding `rfqs:handle` (FR-023: a `deny` predicate);
 *  - the platform administrator's stub session, `ADMIN` (unrestricted).
 */
export interface CatalogVisibilityFixture {
  readonly f: PricingFixture;
  readonly visible: { readonly id: string };
  readonly configurable: { readonly id: string; readonly visibleVariant: string; readonly hiddenVariant: string };
  readonly hidden: { readonly id: string; readonly variantId: string; readonly sku: string };
  readonly categoryId: string;
  readonly restricted: TestRole;
  readonly noCategory: TestRole;
  /** Clear the module's configuration, flags and the roles' stub sessions. */
  teardown(): Promise<void>;
}

/** The permissions every restricted caller here holds: catalogue read and write, and the fail-closed code. */
export const CATALOG_CALLER_PERMISSIONS = ['rfqs:handle', 'catalog:read', 'catalog:write'] as const;

export async function setupCatalogVisibilityFixture(h: BackendServerHandle): Promise<CatalogVisibilityFixture> {
  const f = await setupPricingFixture(h);
  await clearConfiguration(h);
  await clearFlags(h);
  const em = h.em();
  const stamp = randomUUID().slice(0, 8);
  const hidden = em.create(Product, {
    sku: `HID-${stamp}`,
    slug: `hid-${stamp}`,
    type: 'configurable',
    status: 'active',
    name: `Hidden ${stamp}`,
    description: 'Hidden',
    visibility: 'public',
    attributeValues: {},
  });
  await em.persist(hidden).flush();
  const hiddenVariant = em.create(ProductVariant, {
    parentProductId: hidden.id,
    sku: `HIDV-${stamp}`,
    variantAttributeValues: { color: 'red' },
  });
  await em.persist(hiddenVariant).flush();

  // P5: only its red variant is priced; the parent row carries no price of its own.
  await f.setBase(f.products.P5, {
    product: [],
    variants: { [f.variants.P5r]: { type: 'fixed', tiers: [{ minQuantity: 1, maxQuantity: null, amount: '50' }] }, [f.variants.P5b]: null },
  });

  const created = await call(h, 'POST', '/categories', {
    payload: { name: `PLN>0 ${stamp}`, conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }] },
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`catalog visibility fixture: category answered ${created.status}: ${JSON.stringify(created.body)}`);
  }
  const categoryId = created.body.data.id as string;
  const restricted = await roleWith(h, CATALOG_CALLER_PERMISSIONS, 'cvr');
  const mapped = await call(h, 'PUT', `/role-mappings/${restricted.roleId}`, { payload: { target: { kind: 'category', categoryId } } });
  if (mapped.status !== 200) {
    throw new Error(`catalog visibility fixture: mapping answered ${mapped.status}: ${JSON.stringify(mapped.body)}`);
  }
  const noCategory = await roleWith(h, CATALOG_CALLER_PERMISSIONS, 'cvn');

  await flagsOf(h).requestRebuild(['PLN', 'EUR']);
  await settleFlags(h);

  return {
    f,
    visible: { id: f.products.P1.id },
    configurable: { id: f.products.P5.id, visibleVariant: f.variants.P5r, hiddenVariant: f.variants.P5b },
    hidden: { id: hidden.id, variantId: hiddenVariant.id, sku: hidden.sku },
    categoryId,
    restricted,
    noCategory,
    async teardown() {
      await clearConfiguration(h);
      await clearFlags(h);
      await f.clearBooks();
      await f.resetBase();
      forgetTestRoles();
    },
  };
}

/**
 * What a hidden product's rows look like, for "writes nothing": the product row itself and the
 * number of rows naming it in every table with a `product_id` or `parent_product_id` column.
 */
export async function productFingerprint(h: BackendServerHandle, productId: string): Promise<Record<string, unknown>> {
  const conn = h.em().getConnection();
  const columns = await conn.execute<Array<{ tableName: string; columnName: string }>>(
    `select "table_name" as "tableName", "column_name" as "columnName" from information_schema.columns
      where "table_schema" = current_schema() and "column_name" in ('product_id', 'parent_product_id')
        and "table_name" not in ('catalogue_price_stale_products', 'product_catalogue_prices', 'variant_catalogue_prices')
      order by 1, 2`,
  );
  const out: Record<string, unknown> = {};
  const [row] = await conn.execute<Array<{ row: unknown }>>(`select row_to_json(p) as "row" from "products" p where p."id" = ?`, [productId]);
  out['products'] = row?.row;
  // A copy or a new variant is a write too, whatever it names.
  for (const table of ['products', 'product_variants', 'catalog_bulk_operations']) {
    const [counted] = await conn.execute<Array<{ n: number }>>(`select count(*)::int as n from "${table}"`);
    out[`count(${table})`] = counted!.n;
  }
  for (const { tableName, columnName } of columns) {
    const [counted] = await conn.execute<Array<{ n: number }>>(
      `select count(*)::int as n from "${tableName}" where "${columnName}" = ?`,
      [productId],
    );
    out[`${tableName}.${columnName}`] = counted!.n;
  }
  return out;
}
