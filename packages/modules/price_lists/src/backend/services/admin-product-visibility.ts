import type { AdminProductVisibilityPort, AdminProductVisibilityScope, VisibilityPredicate } from '@endora-commerce/contracts';

const NONE: VisibilityPredicate = Object.freeze({ kind: 'none' }) as VisibilityPredicate;

/**
 * Spec 193 (T044) — what the price book grid asks of `product_visibility_rules`, with the owner's
 * absence decided in front of its port (`degrades-without`, D-44): absent, every scope is the
 * system's and nothing is filtered; present, a failing call is not caught (TM-3 (4)).
 */
export interface PriceBookProductVisibility {
  /** Per request, for the acting administrator. Never cached. */
  scopeFor(adminUserId: string): Promise<AdminProductVisibilityScope>;
  /**
   * Spec 193 (T053) — the scope's product predicate over `column` (`"alias"."column"`); `none` for a
   * scope that narrows nothing, without asking the port.
   */
  productPredicate(scope: AdminProductVisibilityScope, column: string): VisibilityPredicate;
  /** Whether the scope does not let the product through; `false` for a scope that narrows nothing. */
  productHidden(scope: AdminProductVisibilityScope, productId: string): Promise<boolean>;
  /** Which of `variantIds` the scope lets through (all of them for a scope that narrows nothing). */
  visibleVariants(scope: AdminProductVisibilityScope, variantIds: readonly string[]): Promise<ReadonlySet<string>>;
}

const SYSTEM: AdminProductVisibilityScope = Object.freeze({ kind: 'system' }) as AdminProductVisibilityScope;

/** `system` and `unrestricted` narrow nothing (SC-003). */
export function narrowsProducts(scope: AdminProductVisibilityScope): boolean {
  switch (scope.kind) {
    case 'system':
    case 'unrestricted':
      return false;
    case 'no_category':
    case 'restricted':
      return true;
  }
}

export function createPriceBookProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): PriceBookProductVisibility {
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
    async visibleVariants(scope, variantIds) {
      if (!narrowsProducts(scope) || variantIds.length === 0) return new Set(variantIds);
      return (await deps.port().filterVisible(scope, { variantIds })).variantIds;
    },
  };
}

/** The scope a caller with no visibility wiring (fixtures, system jobs) reads with. */
export const SYSTEM_PRODUCT_SCOPE = SYSTEM;
