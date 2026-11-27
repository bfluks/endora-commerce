import {
  PRODUCT_VISIBILITY_FAIL_CLOSED_PERMISSION,
  PRODUCT_VISIBILITY_PLATFORM_ADMIN_ROLE_CODE,
  PRODUCT_VISIBILITY_SELF_LIFTING_PERMISSIONS,
  type ProductVisibilityMappingTarget,
  type ProductVisibilityRoleEffect,
} from '@endora-commerce/contracts';

/** What a role is, for this decision: its code and its permission codes. */
export interface RoleFacts {
  readonly code: string;
  readonly permissions: readonly string[];
}

/** What the module does to one role's admin product reads — before any condition is read. */
export type RoleScopeKind =
  | { kind: 'unrestricted'; reason: 'platform_admin' | 'self_lifting' | 'mapped_unrestricted' | 'unmapped' }
  | { kind: 'no_category' }
  | { kind: 'restricted'; categoryId: string };

const SELF_LIFTING: ReadonlySet<string> = new Set(PRODUCT_VISIBILITY_SELF_LIFTING_PERMISSIONS);

/** FR-026 — the role can lift its own restriction. */
export function holdsSelfLiftingPermission(role: RoleFacts): boolean {
  return role.permissions.some((p) => SELF_LIFTING.has(p));
}

/** FR-022, FR-026 — `platform_admin` and every self-lifting role are never mapped. */
export function isRoleMappable(role: RoleFacts): boolean {
  return role.code !== PRODUCT_VISIBILITY_PLATFORM_ADMIN_ROLE_CODE && !holdsSelfLiftingPermission(role);
}

/**
 * Research R-13 — one order, and nothing else decides: platform administrator; a
 * self-lifting permission (whatever is stored, FR-026); mapped to unrestricted (FR-025);
 * mapped to a category; unmapped and holding `rfqs:handle` (fail-closed, FR-023); otherwise
 * unrestricted. `mapping` is the stored target, `null` when the role has none.
 */
export function roleScopeKind(role: RoleFacts, mapping: ProductVisibilityMappingTarget | null): RoleScopeKind {
  if (role.code === PRODUCT_VISIBILITY_PLATFORM_ADMIN_ROLE_CODE) return { kind: 'unrestricted', reason: 'platform_admin' };
  if (holdsSelfLiftingPermission(role)) return { kind: 'unrestricted', reason: 'self_lifting' };
  if (mapping?.kind === 'unrestricted') return { kind: 'unrestricted', reason: 'mapped_unrestricted' };
  if (mapping?.kind === 'category') return { kind: 'restricted', categoryId: mapping.categoryId };
  if (role.permissions.includes(PRODUCT_VISIBILITY_FAIL_CLOSED_PERMISSION)) return { kind: 'no_category' };
  return { kind: 'unrestricted', reason: 'unmapped' };
}

/** FR-024, FR-026 — the effect the configuration screen shows for a role. */
export function roleEffect(role: RoleFacts, mapping: ProductVisibilityMappingTarget | null): ProductVisibilityRoleEffect {
  if (!isRoleMappable(role)) return mapping ? 'mapping_without_effect' : 'unmappable_unrestricted';
  const scope = roleScopeKind(role, mapping);
  switch (scope.kind) {
    case 'restricted':
      return 'mapped';
    case 'no_category':
      return 'sees_no_products';
    case 'unrestricted':
      return scope.reason === 'mapped_unrestricted' ? 'mapped_unrestricted' : 'unrestricted';
  }
}
