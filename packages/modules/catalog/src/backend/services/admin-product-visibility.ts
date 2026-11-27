import type { EntityManager } from '@mikro-orm/postgresql';
import { uuidArrayLiteral } from './sql-id-arrays.js';
import {
  createDegradingAdminProductVisibility,
  narrowsAdminProducts,
  SYSTEM_ADMIN_PRODUCT_SCOPE,
  visibilityPredicateClause,
  type AdminProductVisibilityPort,
  type AdminProductVisibilityScope,
  type DegradingAdminProductVisibility,
  type SqlFragment,
  type VisibilityPredicate,
} from '@endora-commerce/contracts';

/**
 * Spec 193 (R-7, TM-3) — whose products an admin read or write of this module may touch.
 *
 * **A required parameter** of every read and write the catalog admin routes use: never optional,
 * never defaulted. Storefront, connector and system callers pass {@link SYSTEM_PRODUCT_SCOPE}
 * explicitly; an admin request passes the scope resolved for its administrator. The
 * architecture test `admin-scope-required.test.ts` holds the signatures.
 */
export type AdminProductReadScope = AdminProductVisibilityScope;

/** Not narrowed, and says why: the caller is not an administrator acting under a role. */
export const SYSTEM_PRODUCT_SCOPE: AdminProductReadScope = SYSTEM_ADMIN_PRODUCT_SCOPE;

/**
 * What this module asks of `product_visibility_rules`: the shared `degrades-without` shell
 * (`createDegradingAdminProductVisibility`, contracts). Absent ⇒ every scope is
 * {@link SYSTEM_PRODUCT_SCOPE} and no predicate is ever asked for. Present ⇒ the port answers, and
 * a failure is **not** caught (TM-3 (4)) — a request whose scope cannot be read answers 5xx, never
 * unfiltered.
 */
export type CatalogAdminProductVisibility = DegradingAdminProductVisibility;

/** `system` and `unrestricted` add no clause at all (SC-003: byte-identical answers). */
export const isNarrowed: (scope: AdminProductReadScope) => boolean = narrowsAdminProducts;

/** The wiring `index.ts` composes: the presence probe in front of the gated port. */
export function createCatalogAdminProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): CatalogAdminProductVisibility {
  return createDegradingAdminProductVisibility(deps);
}

/**
 * A predicate as a clause for this module's statements. `null` = no clause; `false` = matches
 * nothing (the caller answers empty without asking the database). Exhaustive on purpose: a new
 * predicate kind is a compile error here, never a silent "unrestricted" (TM-3 (3)).
 */
export const predicateClause: (predicate: VisibilityPredicate) => SqlFragment | null | false = visibilityPredicateClause;

/**
 * A scope's predicate as a clause over one product id column, for a statement that counts products:
 * `null` adds nothing, `false` counts none, a fragment narrows (FR-031).
 */
export type ProductVisibilityClause = SqlFragment | null | false;

/** A narrowed scope with no visibility wiring is a composition fault — refuse, never widen. */
export function requireVisibility(
  visibility: CatalogAdminProductVisibility | undefined,
  scope: AdminProductReadScope,
): CatalogAdminProductVisibility | null {
  if (!isNarrowed(scope)) return null;
  if (!visibility) {
    throw new Error('catalog: a narrowed admin product scope reached a service composed without product visibility.');
  }
  return visibility;
}

/**
 * Spec 193 (FR-080) — which of the named products are hidden from the caller, for a service that
 * answers about other products (a link's target, a grouped child, a bundle option). Bound to the
 * caller's scope by the route; {@link NO_PRODUCT_HIDDEN} for a caller that narrows nothing.
 */
export type HiddenProducts = (productIds: readonly string[]) => Promise<ReadonlySet<string>>;

export const NO_PRODUCT_HIDDEN: HiddenProducts = async () => new Set();

/**
 * The product exists (not deleted) and `scope` does not let it through — "hidden", as opposed to
 * "missing". `false` for a scope that narrows nothing.
 */
export async function isProductHidden(
  em: EntityManager,
  visibility: CatalogAdminProductVisibility | undefined,
  scope: AdminProductReadScope,
  productId: string,
): Promise<boolean> {
  return (await hiddenProductIds(em, visibility, scope, [productId])).size > 0;
}

/** Which of `productIds` exist (not deleted) and are hidden from `scope`; empty for a scope that narrows nothing. */
export async function hiddenProductIds(
  em: EntityManager,
  visibility: CatalogAdminProductVisibility | undefined,
  scope: AdminProductReadScope,
  productIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const narrowing = requireVisibility(visibility, scope);
  if (!narrowing || productIds.length === 0) return new Set();
  const clause = predicateClause(narrowing.productPredicate(scope, { productId: '"products"."id"' }));
  if (clause === null) return new Set();
  const rows = await em.execute<Array<{ id: string }>>(
    `select "id" from "products"
      where "id" = any(?::uuid[]) and "deleted_at" is null${clause === false ? '' : ` and not ${clause.sql}`}`,
    [uuidArrayLiteral(productIds.filter(isUuid)), ...(clause === false ? [] : clause.params)],
  );
  return new Set(rows.map((r) => r.id));
}

/** The variant exists under its parent (not deleted) and `scope` does not let it through. */
export async function isVariantHidden(
  em: EntityManager,
  visibility: CatalogAdminProductVisibility | undefined,
  scope: AdminProductReadScope,
  productId: string,
  variantId: string,
): Promise<boolean> {
  const narrowing = requireVisibility(visibility, scope);
  if (!narrowing) return false;
  const clause = predicateClause(narrowing.variantPredicate(scope, { variantId: '"product_variants"."id"' }));
  if (clause === null) return false;
  const rows = await em.execute<Array<{ id: string }>>(
    `select "id" from "product_variants"
      where "id" = ? and "parent_product_id" = ? and "deleted_at" is null${clause === false ? '' : ` and not ${clause.sql}`}`,
    [variantId, productId, ...(clause === false ? [] : clause.params)],
  );
  return rows.length > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID.test(value);
}
