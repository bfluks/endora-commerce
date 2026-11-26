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
  /**
   * Owner ruling 2026-11-26 (FR-094) — the scope's variant predicate over `column`; `none` for a
   * scope that narrows nothing, without asking the port.
   */
  variantPredicate(scope: AdminProductVisibilityScope, column: string): VisibilityPredicate;
  /** Whether the scope does not let the product through; `false` for a scope that narrows nothing. */
  productHidden(scope: AdminProductVisibilityScope, productId: string): Promise<boolean>;
  /** Which of `variantIds` the scope lets through (all of them for a scope that narrows nothing). */
  visibleVariants(scope: AdminProductVisibilityScope, variantIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Spec 193 (T102, FR-094) — the ids of the stored rows the scope does not let through: a row
   * naming a hidden product, or a variant that does not qualify. A row naming no product is
   * visible. One port call for the whole set, none for a scope that narrows nothing.
   */
  hiddenRowIds(
    scope: AdminProductVisibilityScope,
    rows: ReadonlyArray<{ id: string; productId: string | null; variantId: string | null }>,
  ): Promise<ReadonlySet<string>>;
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
    variantPredicate(scope, column) {
      return narrowsProducts(scope) ? deps.port().variantPredicate(scope, { variantId: column }) : NONE;
    },
    async productHidden(scope, productId) {
      if (!narrowsProducts(scope)) return false;
      return !(await deps.port().filterVisible(scope, { productIds: [productId] })).productIds.has(productId);
    },
    async visibleVariants(scope, variantIds) {
      if (!narrowsProducts(scope) || variantIds.length === 0) return new Set(variantIds);
      return (await deps.port().filterVisible(scope, { variantIds })).variantIds;
    },
    async hiddenRowIds(scope, rows) {
      if (!narrowsProducts(scope)) return new Set();
      const productIds = [...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : [])))];
      const variantIds = [...new Set(rows.flatMap((r) => (r.variantId ? [r.variantId] : [])))];
      if (productIds.length === 0 && variantIds.length === 0) return new Set();
      const visible = await deps.port().filterVisible(scope, { productIds, variantIds });
      return new Set(
        rows
          .filter(
            (r) =>
              (r.productId !== null && !visible.productIds.has(r.productId)) ||
              (r.variantId !== null && !visible.variantIds.has(r.variantId)),
          )
          .map((r) => r.id),
      );
    },
  };
}

/** The scope a caller with no visibility wiring (fixtures, system jobs) reads with. */
export const SYSTEM_PRODUCT_SCOPE = SYSTEM;
