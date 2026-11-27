import {
  createDegradingAdminProductVisibility,
  narrowsAdminProducts,
  visibilityPredicateClause,
  type AdminProductVisibilityPort,
  type AdminProductVisibilityScope,
  type SqlFragment,
  type VisibilityPredicate,
} from '@endora-commerce/contracts';

/**
 * Spec 193 (T052, FR-083, FR-081) — what the inventory admin lists and the set-stock assistant
 * tool ask of `product_visibility_rules`: the shared `degrades-without` shell
 * (`createDegradingAdminProductVisibility`, contracts — absent, every scope is the system's and
 * nothing is narrowed; present, a failing call is not caught, TM-3 (4)) and this module's extras.
 */
export interface InventoryProductVisibility {
  /** Per request (or per tool call) for the acting administrator. Never cached. */
  scopeFor(adminUserId: string): Promise<AdminProductVisibilityScope>;
  /** The scope's product predicate over `column` (`"alias"."column"`); `none` for a scope that narrows nothing. */
  productPredicate(scope: AdminProductVisibilityScope, column: string): VisibilityPredicate;
  /** Whether the scope does not let the product through; `false` for a scope that narrows nothing. */
  productHidden(scope: AdminProductVisibilityScope, productId: string): Promise<boolean>;
}

/** The predicate of a caller that narrows nothing (fixtures, system callers, the module off). */
export const NO_PRODUCT_PREDICATE: VisibilityPredicate = Object.freeze({ kind: 'none' }) as VisibilityPredicate;

export function createInventoryProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): InventoryProductVisibility {
  const base = createDegradingAdminProductVisibility(deps);
  return {
    scopeFor: (adminUserId) => base.scopeFor(adminUserId),
    productPredicate: (scope, column) => base.productPredicate(scope, { productId: column }),
    async productHidden(scope, productId) {
      if (!narrowsAdminProducts(scope)) return false;
      return !(await base.filterVisible(scope, { productIds: [productId] })).productIds.has(productId);
    },
  };
}

/**
 * A predicate as a clause for this module's statements: `null` adds nothing, `false` matches
 * nothing, a fragment narrows (`visibilityPredicateClause`, contracts — exhaustive, TM-3 (3)).
 */
export const productClause: (predicate: VisibilityPredicate) => SqlFragment | null | false = visibilityPredicateClause;

/** `productClause` joined to a statement with `keyword` (`where` / `and`); empty for no clause. */
export function clauseSql(predicate: VisibilityPredicate, keyword: 'where' | 'and'): SqlFragment {
  const clause = productClause(predicate);
  if (clause === null) return { sql: '', params: [] };
  if (clause === false) return { sql: ` ${keyword} false`, params: [] };
  return { sql: ` ${keyword} ${clause.sql}`, params: clause.params };
}
