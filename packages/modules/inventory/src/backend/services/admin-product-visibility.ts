import type {
  AdminProductVisibilityPort,
  AdminProductVisibilityScope,
  SqlFragment,
  VisibilityPredicate,
} from '@endora-commerce/contracts';

/**
 * Spec 193 (T052, FR-083, FR-081) — what the inventory admin lists and the set-stock assistant
 * tool ask of `product_visibility_rules`, with the owner's absence decided in front of its port
 * (`degrades-without`, D-44): absent, every scope is the system's and nothing is narrowed;
 * present, a failing call is not caught (TM-3 (4)).
 */
export interface InventoryProductVisibility {
  /** Per request (or per tool call) for the acting administrator. Never cached. */
  scopeFor(adminUserId: string): Promise<AdminProductVisibilityScope>;
  /** The scope's product predicate over `column` (`"alias"."column"`); `none` for a scope that narrows nothing. */
  productPredicate(scope: AdminProductVisibilityScope, column: string): VisibilityPredicate;
  /** Whether the scope does not let the product through; `false` for a scope that narrows nothing. */
  productHidden(scope: AdminProductVisibilityScope, productId: string): Promise<boolean>;
}

const SYSTEM: AdminProductVisibilityScope = Object.freeze({ kind: 'system' }) as AdminProductVisibilityScope;
const NONE: VisibilityPredicate = Object.freeze({ kind: 'none' }) as VisibilityPredicate;

/** The predicate of a caller that narrows nothing (fixtures, system callers, the module off). */
export const NO_PRODUCT_PREDICATE = NONE;

/** `system` and `unrestricted` narrow nothing (SC-003). */
function narrowsProducts(scope: AdminProductVisibilityScope): boolean {
  switch (scope.kind) {
    case 'system':
    case 'unrestricted':
      return false;
    case 'no_category':
    case 'restricted':
      return true;
  }
}

export function createInventoryProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): InventoryProductVisibility {
  return {
    async scopeFor(adminUserId) {
      if (!deps.isPresent()) return SYSTEM;
      return deps.port().resolveScope(adminUserId);
    },
    productPredicate(scope, column) {
      return narrowsProducts(scope) ? deps.port().productPredicate(scope, { productId: column }) : NONE;
    },
    async productHidden(scope, productId) {
      if (!narrowsProducts(scope)) return false;
      return !(await deps.port().filterVisible(scope, { productIds: [productId] })).productIds.has(productId);
    },
  };
}

/**
 * A predicate as a clause for this module's statements: `null` adds nothing (the statement is
 * the one it was before the feature), `false` matches nothing, a fragment narrows. Exhaustive on
 * purpose: a new predicate kind is a compile error here, never a silent "unrestricted" (TM-3 (3)).
 */
export function productClause(predicate: VisibilityPredicate): SqlFragment | null | false {
  switch (predicate.kind) {
    case 'none':
      return null;
    case 'deny':
      return false;
    case 'sql':
      return { sql: `(${predicate.fragment.sql})`, params: [...predicate.fragment.params] };
  }
}

/** `productClause` joined to a statement with `keyword` (`where` / `and`); empty for no clause. */
export function clauseSql(predicate: VisibilityPredicate, keyword: 'where' | 'and'): SqlFragment {
  const clause = productClause(predicate);
  if (clause === null) return { sql: '', params: [] };
  if (clause === false) return { sql: ` ${keyword} false`, params: [] };
  return { sql: ` ${keyword} ${clause.sql}`, params: clause.params };
}
