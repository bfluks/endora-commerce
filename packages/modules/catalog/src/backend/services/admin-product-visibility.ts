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
