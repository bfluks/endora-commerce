import type { EntityManager } from '@mikro-orm/postgresql';
import { uuidArrayLiteral } from './sql-id-arrays.js';
import type {
  AdminProductVisibilityPort,
  AdminProductVisibilityScope,
  SqlFragment,
  VisibilityPredicate,
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
export const SYSTEM_PRODUCT_SCOPE: AdminProductReadScope = Object.freeze({ kind: 'system' }) as AdminProductReadScope;

/**
 * What this module asks of `product_visibility_rules`, with the owner's absence decided in front
 * of the port (`degrades-without`, D-44): absent ⇒ every scope is {@link SYSTEM_PRODUCT_SCOPE}
 * and no predicate is ever asked for. Present ⇒ the port answers, and a failure is **not**
 * caught (TM-3 (4)) — a request whose scope cannot be read answers 5xx, never unfiltered.
 */
export interface CatalogAdminProductVisibility {
  /** Per request (or at execution, for the requesting administrator). Never cached. */
  scopeFor(adminUserId: string): Promise<AdminProductReadScope>;
  productPredicate(scope: AdminProductReadScope, columns: { productId: string }): VisibilityPredicate;
  variantPredicate(scope: AdminProductReadScope, columns: { variantId: string }): VisibilityPredicate;
  filterVisible(
    scope: AdminProductReadScope,
    ids: { productIds?: readonly string[]; variantIds?: readonly string[] },
  ): Promise<{ productIds: ReadonlySet<string>; variantIds: ReadonlySet<string> }>;
}

const NO_CLAUSE: VisibilityPredicate = Object.freeze({ kind: 'none' }) as VisibilityPredicate;

/** `system` and `unrestricted` add no clause at all (SC-003: byte-identical answers). */
export function isNarrowed(scope: AdminProductReadScope): boolean {
  switch (scope.kind) {
    case 'system':
    case 'unrestricted':
      return false;
    case 'no_category':
    case 'restricted':
      return true;
  }
}

/** The wiring `index.ts` composes: the presence probe in front of the gated port. */
export function createCatalogAdminProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): CatalogAdminProductVisibility {
  return {
    async scopeFor(adminUserId) {
      if (!deps.isPresent()) return SYSTEM_PRODUCT_SCOPE;
      return deps.port().resolveScope(adminUserId);
    },
    productPredicate(scope, columns) {
      return isNarrowed(scope) ? deps.port().productPredicate(scope, columns) : NO_CLAUSE;
    },
    variantPredicate(scope, columns) {
      return isNarrowed(scope) ? deps.port().variantPredicate(scope, columns) : NO_CLAUSE;
    },
    async filterVisible(scope, ids) {
      if (!isNarrowed(scope)) {
        return { productIds: new Set(ids.productIds ?? []), variantIds: new Set(ids.variantIds ?? []) };
      }
      return deps.port().filterVisible(scope, ids);
    },
  };
}

/**
 * A predicate as a clause for this module's statements. `null` = no clause; `false` = matches
 * nothing (the caller answers empty without asking the database). Exhaustive on purpose: a new
 * predicate kind is a compile error here, never a silent "unrestricted" (TM-3 (3)).
 */
export function predicateClause(predicate: VisibilityPredicate): SqlFragment | null | false {
  switch (predicate.kind) {
    case 'none':
      return null;
    case 'deny':
      return false;
    case 'sql':
      return { sql: `(${predicate.fragment.sql})`, params: [...predicate.fragment.params] };
  }
}

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
