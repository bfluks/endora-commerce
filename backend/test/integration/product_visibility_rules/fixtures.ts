import { randomUUID } from 'node:crypto';
import type {
  AdminProductVisibilityPort,
  AdminProductVisibilityScope,
  CatalogueReferencePricePort,
  ProductVisibilityOverviewResponse,
  VisibilityPredicate,
} from '@endora-commerce/contracts';
import type { CataloguePriceFlags } from '../../../../packages/modules/product_visibility_rules/src/backend/services/catalogue-price-flags.js';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { ensureAdminWithRole } from '../../helpers/admin-search-fixtures.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Spec 193 — shared helpers of the `product_visibility_rules` integration tests: the
 * platform administrator's stub session, roles with chosen permissions (and an admin
 * holding each), and the configuration API.
 */

export const ADMIN = { b2b_session: 'stub-admin-session' } as const;
export const BASE = '/api/v1/admin/product-visibility';

export interface TestRole {
  roleId: string;
  roleCode: string;
  adminUserId: string;
  cookies: Record<string, string>;
}

const cookiesAdded: string[] = [];

/** A role holding `permissions`, and an administrator acting under it with a stub session. */
export async function roleWith(h: BackendServerHandle, permissions: readonly string[], label = 'pvr'): Promise<TestRole> {
  const adminUserId = randomUUID();
  const roleCode = `${label}_${randomUUID().slice(0, 8)}`;
  await ensureAdminWithRole(h, adminUserId, roleCode, permissions);
  const [row] = await h
    .em()
    .getConnection()
    .execute<Array<{ id: string }>>(`select "id" from "admin_roles" where "code" = ?`, [roleCode]);
  const cookie = `stub-pvr-${adminUserId}`;
  ADMIN_COOKIES[cookie] = { adminUserId };
  cookiesAdded.push(cookie);
  return { roleId: row!.id, roleCode, adminUserId, cookies: { b2b_session: cookie } };
}

/** Replace a role's permissions, as `admin_roles` would — this module is not told. */
export async function setRolePermissions(h: BackendServerHandle, roleId: string, permissions: readonly string[]): Promise<void> {
  await h
    .em()
    .getConnection()
    .execute(`update "admin_roles" set "permissions" = ?::jsonb where "id" = ?`, [JSON.stringify(permissions), roleId]);
}

export function forgetTestRoles(): void {
  for (const cookie of cookiesAdded.splice(0)) delete ADMIN_COOKIES[cookie];
}

export interface Call {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a test reads whatever envelope the route answers
  headers: Record<string, unknown>;
}

export async function call(
  h: BackendServerHandle,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { payload?: unknown; cookies?: Record<string, string>; ifMatch?: string } = {},
): Promise<Call> {
  const res = await h.app.inject({
    method,
    url: `${BASE}${path}`,
    cookies: options.cookies ?? ADMIN,
    ...(options.payload !== undefined ? { payload: options.payload as never } : {}),
    ...(options.ifMatch ? { headers: { 'if-match': options.ifMatch } } : {}),
  });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}

export async function overview(h: BackendServerHandle, cookies: Record<string, string> = ADMIN): Promise<ProductVisibilityOverviewResponse> {
  const res = await call(h, 'GET', '/overview', { cookies });
  if (res.status !== 200) throw new Error(`overview answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data as ProductVisibilityOverviewResponse;
}

/** Delete every configuration row this module holds — between test files sharing a database. */
export async function clearConfiguration(h: BackendServerHandle): Promise<void> {
  const sql = (s: string) => h.em().getConnection().execute(s);
  await sql(`delete from "visibility_role_mappings"`);
  await sql(`delete from "visibility_categories"`);
  await sql(`delete from "catalogue_price_designations"`);
}

// ── Phase 4: the catalogue-price flags and the admin scope ─────────────────────────────────

/** The module's flags service and admin scope port, as composed. */
export function flagsOf(h: BackendServerHandle): CataloguePriceFlags {
  return (h.container as unknown as { resolve<T>(n: string): T }).resolve<CataloguePriceFlags>('productVisibilityFlags');
}

export function scopePort(h: BackendServerHandle): AdminProductVisibilityPort {
  return (h.container as unknown as { resolve<T>(n: string): T }).resolve<AdminProductVisibilityPort>('adminProductVisibilityPort');
}

export function pricePort(h: BackendServerHandle): CatalogueReferencePricePort {
  return (h.container as unknown as { resolve<T>(n: string): T }).resolve<CatalogueReferencePricePort>('catalogueReferencePricePort');
}

/** Run the flags work to rest, as the worker would — the shared test server runs no worker. */
export async function settleFlags(h: BackendServerHandle): Promise<void> {
  for (let i = 0; i < 5 && (await flagsOf(h).hasPendingWork()); i += 1) await flagsOf(h).runPass();
}

/** Delete every flag row, generation and mark — between test files sharing a database. */
export async function clearFlags(h: BackendServerHandle): Promise<void> {
  const sql = (s: string) => h.em().getConnection().execute(s);
  for (const table of ['catalogue_price_stale_products', 'variant_catalogue_prices', 'product_catalogue_prices', 'catalogue_price_generations']) {
    await sql(`delete from "${table}"`);
  }
}

/**
 * What a scope lets through, read four ways that must agree: `filterVisible`, the product
 * predicate embedded in a statement over `products`, the variant predicate over
 * `product_variants`, and the live line check.
 */
export async function visibleTo(
  h: BackendServerHandle,
  scope: AdminProductVisibilityScope,
  productIds: readonly string[],
  variantIds: readonly string[],
): Promise<{ products: string[]; variants: string[]; viaPredicate: string[]; variantsViaPredicate: string[]; lines: string[] }> {
  const port = scopePort(h);
  const filtered = await port.filterVisible(scope, { productIds, variantIds });
  const run = async (table: string, predicate: VisibilityPredicate, ids: readonly string[]): Promise<string[]> => {
    if (predicate.kind === 'deny') return [];
    const clause = predicate.kind === 'sql' ? ` and (${predicate.fragment.sql})` : '';
    const params = predicate.kind === 'sql' ? predicate.fragment.params : [];
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select t."id" from "${table}" t where t."id" = any(?::uuid[])${clause}`, [`{${ids.join(',')}}`, ...params]);
    return rows.map((r) => r.id).sort();
  };
  const lines = await port.checkLines(scope, productIds.map((productId) => ({ productId })));
  return {
    products: [...filtered.productIds].sort(),
    variants: [...filtered.variantIds].sort(),
    viaPredicate: await run('products', port.productPredicate(scope, { productId: '"t"."id"' }), productIds),
    variantsViaPredicate: await run('product_variants', port.variantPredicate(scope, { variantId: '"t"."id"' }), variantIds),
    lines: productIds.filter((_, i) => lines[i]!.visible).sort(),
  };
}

/** The change feed's subscriber runs after the write returns; wait for its mark (≤ 5 s). */
export async function waitForMark(h: BackendServerHandle, productId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ n: number }>>(`select count(*)::int as n from "catalogue_price_stale_products" where "product_id" = ?`, [productId]);
    if (row!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no catalogue-price mark for ${productId} within 5 s`);
}
