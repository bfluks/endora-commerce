import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who `ProjectAccess` and the owner-read checks treat as the system
 * (`specs/163-projects-and-tasks/` T144 F6): only an actor of kind `system` —
 * a worker, a subscriber — is unrestricted. Any other actor with no
 * administrator behind it (a customer, an api key) sees no Project and may read
 * no other module's record, the shape `tasks`' `isSystemActor` already has.
 */

const scope = vi.hoisted(() => ({ actor: { kind: 'system' } as { kind: string; id?: string } }));

vi.mock('@endora-commerce/platform/tenancy', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/platform/tenancy')>(
    '@endora-commerce/platform/tenancy',
  );
  return {
    ...actual,
    getTenantContext: () => ({ mode: 'all', actor: scope.actor }),
    orgConstraintFor: () => ({ kind: 'all' }),
  };
});

const { ProjectAccess } = await import('./project-access.js');
const { createOwnerReadCheck } = await import('./owner-read-permissions.js');

const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const PROJECT = '00000000-0000-4000-8000-0000000000b1';

function access(held: string[] = []) {
  const execute = vi.fn(async () => [{ id: PROJECT }]);
  const permissions = {
    listPermissions: vi.fn(async () => held),
    hasPermission: vi.fn(async (_adminUserId: string, code: string) => held.includes('*') || held.includes(code)),
    resolveRole: vi.fn(),
  };
  const service = new ProjectAccess({
    emFactory: () => ({ execute }) as never,
    permissions: permissions as never,
    tenantScopes: {} as never,
    adminUsers: {} as never,
    settings: { get: vi.fn(async () => 'members') } as never,
  });
  return { service, execute, permissions };
}

describe('ProjectAccess — who is the system (T144 F6)', () => {
  beforeEach(() => {
    scope.actor = { kind: 'system' };
  });

  it('the system actor is unrestricted', async () => {
    const { service } = access();
    expect(await service.currentViewer()).toMatchObject({ adminUserId: null, canRead: true, seeAll: true });
    expect([...(await service.visibleIds([PROJECT]))]).toEqual([PROJECT]);
  });

  it.each([
    ['a customer', { kind: 'customer', id: 'customer-1' }],
    ['an api key', { kind: 'api_key', id: 'key-1' }],
    ['an administrator actor with no id', { kind: 'admin' }],
  ])('%s is not the system and sees no Project', async (_label, actor) => {
    scope.actor = actor;
    const { service, execute } = access();
    expect(await service.currentViewer()).toMatchObject({ adminUserId: null, canRead: false, seeAll: false });
    expect(await service.visibleIds([PROJECT])).toEqual(new Set());
    expect(await service.allVisibleIds()).toEqual([]);
    expect(await service.findVisible(PROJECT)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('an administrator is asked for their permissions', async () => {
    scope.actor = { kind: 'admin', id: ADMIN };
    expect(await access(['projects:read']).service.currentViewer()).toMatchObject({
      adminUserId: ADMIN,
      canRead: true,
      seeAll: false,
    });
    expect(await access(['*']).service.currentViewer()).toMatchObject({ canRead: true, seeAll: true });
  });
});

describe('createOwnerReadCheck — who is the system (T144 F6)', () => {
  const permissions = { listPermissions: vi.fn(async () => ['orders:read']), resolveRole: vi.fn() };
  const check = createOwnerReadCheck(permissions as never, 'orders:read');

  it('answers yes to the system actor', async () => {
    scope.actor = { kind: 'system' };
    expect(await check()).toBe(true);
  });

  it.each([
    ['a customer', { kind: 'customer', id: 'customer-1' }],
    ['an api key', { kind: 'api_key', id: 'key-1' }],
  ])('answers no to %s', async (_label, actor) => {
    scope.actor = actor;
    expect(await check()).toBe(false);
  });

  it('asks an administrator’s permissions', async () => {
    scope.actor = { kind: 'admin', id: ADMIN };
    expect(await check()).toBe(true);
    expect(await createOwnerReadCheck(permissions as never, 'crm:read')()).toBe(false);
  });
});
