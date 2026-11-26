import type { AdminProductVisibilityPort, AdminProductVisibilityScope } from '@endora-commerce/contracts';

/**
 * Spec 193 (T044) — what the price book grid asks of `product_visibility_rules`, with the owner's
 * absence decided in front of its port (`degrades-without`, D-44): absent, every scope is the
 * system's and nothing is filtered; present, a failing call is not caught (TM-3 (4)).
 */
export interface PriceBookProductVisibility {
  /** Per request, for the acting administrator. Never cached. */
  scopeFor(adminUserId: string): Promise<AdminProductVisibilityScope>;
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
    async visibleVariants(scope, variantIds) {
      if (!narrowsProducts(scope) || variantIds.length === 0) return new Set(variantIds);
      return (await deps.port().filterVisible(scope, { variantIds })).variantIds;
    },
  };
}

/** The scope a caller with no visibility wiring (fixtures, system jobs) reads with. */
export const SYSTEM_PRODUCT_SCOPE = SYSTEM;
