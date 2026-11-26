import { describe, expect, it } from 'vitest';
import { roleEffect, roleScopeKind, isRoleMappable } from './role-visibility.js';

/**
 * Research R-13 (FR-020 – FR-026, OQ-G 1, I-2) — what the module does to one role,
 * decided in one order: platform administrator, self-lifting permission, mapped unrestricted,
 * mapped to a category, unmapped with `rfqs:handle` (fail-closed), otherwise unrestricted.
 */
const role = (code: string, permissions: string[]) => ({ id: 'r', code, permissions });
const CATEGORY = { kind: 'category' as const, categoryId: 'c' };
const UNRESTRICTED = { kind: 'unrestricted' as const };

describe('roleScopeKind', () => {
  it('platform_admin is unrestricted whatever is stored (FR-022)', () => {
    expect(roleScopeKind(role('platform_admin', []), CATEGORY)).toEqual({ kind: 'unrestricted', reason: 'platform_admin' });
  });

  it.each(['*', 'product_visibility:manage', 'platform.modules.activate', 'admin_users:manage'])(
    'a role holding %s is unrestricted, and a stored mapping has no effect (FR-026)',
    (permission) => {
      expect(roleScopeKind(role('sales', ['rfqs:handle', permission]), CATEGORY)).toEqual({
        kind: 'unrestricted',
        reason: 'self_lifting',
      });
    },
  );

  it('mapped to unrestricted ⇒ unrestricted, even holding rfqs:handle (FR-025)', () => {
    expect(roleScopeKind(role('sales', ['rfqs:handle']), UNRESTRICTED)).toEqual({ kind: 'unrestricted', reason: 'mapped_unrestricted' });
  });

  it('mapped to a category ⇒ restricted to it', () => {
    expect(roleScopeKind(role('sales', ['catalog:read']), CATEGORY)).toEqual({ kind: 'restricted', categoryId: 'c' });
  });

  it('unmapped with rfqs:handle ⇒ fail-closed (FR-023)', () => {
    expect(roleScopeKind(role('sales', ['rfqs:handle', 'catalog:read']), null)).toEqual({ kind: 'no_category' });
  });

  it('unmapped otherwise ⇒ unrestricted', () => {
    expect(roleScopeKind(role('viewer', ['catalog:read']), null)).toEqual({ kind: 'unrestricted', reason: 'unmapped' });
  });
});

describe('roleEffect — what the overview shows (FR-024, FR-026)', () => {
  it('names every effect', () => {
    expect(roleEffect(role('platform_admin', ['*']), null)).toBe('unmappable_unrestricted');
    expect(roleEffect(role('ops', ['admin_users:manage']), null)).toBe('unmappable_unrestricted');
    expect(roleEffect(role('ops', ['admin_users:manage']), CATEGORY)).toBe('mapping_without_effect');
    expect(roleEffect(role('ops', ['admin_users:manage']), UNRESTRICTED)).toBe('mapping_without_effect');
    expect(roleEffect(role('sales', ['rfqs:handle']), UNRESTRICTED)).toBe('mapped_unrestricted');
    expect(roleEffect(role('sales', ['rfqs:handle']), CATEGORY)).toBe('mapped');
    expect(roleEffect(role('sales', ['rfqs:handle']), null)).toBe('sees_no_products');
    expect(roleEffect(role('viewer', []), null)).toBe('unrestricted');
  });
});

describe('isRoleMappable (FR-022, FR-026)', () => {
  it('refuses platform_admin and every self-lifting role', () => {
    expect(isRoleMappable(role('platform_admin', []))).toBe(false);
    expect(isRoleMappable(role('x', ['*']))).toBe(false);
    expect(isRoleMappable(role('x', ['product_visibility:manage']))).toBe(false);
    expect(isRoleMappable(role('x', ['rfqs:handle', 'catalog:read']))).toBe(true);
  });
});
