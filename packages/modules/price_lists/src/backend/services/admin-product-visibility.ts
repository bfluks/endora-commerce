import {
  createDegradingAdminProductVisibility,
  narrowsAdminProducts,
  SYSTEM_ADMIN_PRODUCT_SCOPE,
  type AdminProductVisibilityPort,
  type AdminProductVisibilityScope,
  type VisibilityPredicate,
} from '@endora-commerce/contracts';

/**
 * Spec 193 (T044) — what the price book grid asks of `product_visibility_rules`: the shared
 * `degrades-without` shell (`createDegradingAdminProductVisibility`, contracts — absent, every scope
 * is the system's and nothing is filtered; present, a failing call is not caught, TM-3 (4)) and
 * this module's row and variant questions over it.
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

const SYSTEM: AdminProductVisibilityScope = SYSTEM_ADMIN_PRODUCT_SCOPE;

/** `system` and `unrestricted` narrow nothing (SC-003). */
export const narrowsProducts = narrowsAdminProducts;

export function createPriceBookProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): PriceBookProductVisibility {
  const base = createDegradingAdminProductVisibility(deps);
  return {
    scopeFor: (adminUserId) => base.scopeFor(adminUserId),
    productPredicate: (scope, column) => base.productPredicate(scope, { productId: column }),
    variantPredicate: (scope, column) => base.variantPredicate(scope, { variantId: column }),
    async productHidden(scope, productId) {
      if (!narrowsProducts(scope)) return false;
      return !(await base.filterVisible(scope, { productIds: [productId] })).productIds.has(productId);
    },
    async visibleVariants(scope, variantIds) {
      if (!narrowsProducts(scope) || variantIds.length === 0) return new Set(variantIds);
      return (await base.filterVisible(scope, { variantIds })).variantIds;
    },
    async hiddenRowIds(scope, rows) {
      if (!narrowsProducts(scope)) return new Set();
      const productIds = [...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : [])))];
      const variantIds = [...new Set(rows.flatMap((r) => (r.variantId ? [r.variantId] : [])))];
      if (productIds.length === 0 && variantIds.length === 0) return new Set();
      const visible = await base.filterVisible(scope, { productIds, variantIds });
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
