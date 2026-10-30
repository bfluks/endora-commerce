import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminMeResponseSchema, adminPreferencesResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';

/**
 * Feature 164 — the admin's preferences on a real database
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §2.1,
 * §2.2; data-model *Lifecycle*).
 *
 * Last write wins per key; page sizes merge per list under a row lock so two
 * devices choosing sizes on two lists do not erase each other; the carry-over is
 * idempotent and never overwrites (FR-023, SC-008); the rows follow the admin row
 * (kept by soft delete and deactivation, cascaded by a hard delete); and a
 * failed read never fails the sign-in probe (FR-018).
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000164b1';
const URL = '/api/v1/admin/me/preferences';
const IMPORT_URL = '/api/v1/admin/me/preferences/legacy-import';
const who = { cookies: { b2b_session: 'stub-admin-preferences-persistence-session' } };

interface PreferenceServiceLike {
  read(adminUserId: string): Promise<unknown>;
  log: { warn: (...args: unknown[]) => void };
}

describe('Admin UI preferences on a real database (spec 164)', () => {
  let h: BackendServerHandle;

  async function ensureAdmin(): Promise<void> {
    const em = h.em();
    const existing = await em.findOne(AdminUser, { id: ADMIN_ID });
    if (existing) {
      existing.status = 'active';
      existing.deletedAt = null;
    } else {
      em.create(AdminUser, {
        id: ADMIN_ID,
        email: 'admin-preferences-persistence@example.com',
        passwordHash: 'x'.repeat(60),
        firstName: 'Persistence',
        lastName: 'Admin',
        adminRoleId: null,
        status: 'active',
      });
    }
    await em.flush();
  }

  async function resetRows(): Promise<void> {
    await h.em().execute(`delete from "admin_user_preferences" where "admin_user_id" = ?`, [
      ADMIN_ID,
    ]);
  }

  async function rowCount(): Promise<number> {
    const rows = await h
      .em()
      .execute<Array<{ n: string }>>(
        `select count(*)::text as n from "admin_user_preferences" where "admin_user_id" = ?`,
        [ADMIN_ID],
      );
    return Number(rows[0]!.n);
  }

  async function patch(payload: object) {
    return h.app.inject({ method: 'PATCH', url: URL, ...who, payload });
  }

  async function importSizes(listPageSizes: Record<string, number>) {
    return h.app.inject({ method: 'POST', url: IMPORT_URL, ...who, payload: { listPageSizes } });
  }

  async function document() {
    const res = await h.app.inject({ method: 'GET', url: URL, ...who });
    expect(res.statusCode).toBe(200);
    return adminPreferencesResponseSchema.parse(res.json()).data;
  }

  function preferenceService(): PreferenceServiceLike {
    const cradle = h.container.cradle as unknown as {
      admin: { handle: { adminPreferenceService: PreferenceServiceLike } };
    };
    return cradle.admin.handle.adminPreferenceService;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await ensureAdmin();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('last write wins per key', async () => {
    await resetRows();
    expect((await patch({ sidebarPins: ['/orders'] })).statusCode).toBe(200);
    expect((await patch({ sidebarPins: ['/customers', '/orders'] })).statusCode).toBe(200);
    expect((await patch({ sidebarRailMode: true })).statusCode).toBe(200);
    const data = await document();
    expect(data.sidebarPins).toEqual(['/customers', '/orders']);
    expect(data.sidebarRailMode).toBe(true);
  });

  it('two concurrent PATCHes of two different lists both survive', async () => {
    await resetRows();
    const results = await Promise.all([
      patch({ listPageSizes: { orders: 50 } }),
      patch({ listPageSizes: { returns: 100 } }),
      patch({ listPageSizes: { invoices: 10 } }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await document()).listPageSizes).toEqual({ orders: 50, returns: 100, invoices: 10 });
  });

  it('concurrent and repeated imports converge, and never overwrite a stored list (FR-023, SC-008)', async () => {
    await resetRows();
    expect((await patch({ listPageSizes: { orders: 100 } })).statusCode).toBe(200);
    const results = await Promise.all([
      importSizes({ orders: 10, returns: 50 }),
      importSizes({ orders: 10, returns: 50 }),
      importSizes({ returns: 50, invoices: 20 }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await importSizes({ orders: 10, returns: 50 })).statusCode).toBe(200);
    expect((await document()).listPageSizes).toEqual({ orders: 100, returns: 50, invoices: 20 });
    // One row per (admin, key), however many writers there were.
    const rows = await h
      .em()
      .execute<Array<{ preference_key: string }>>(
        `select "preference_key" from "admin_user_preferences" where "admin_user_id" = ?`,
        [ADMIN_ID],
      );
    expect(rows.map((r) => r.preference_key)).toEqual(['listPageSizes']);
  });

  it('soft deletion and deactivation keep the rows; restoring serves them again', async () => {
    await resetRows();
    expect((await patch({ sidebarPins: ['/orders'] })).statusCode).toBe(200);
    const em = h.em();

    const user = await em.findOneOrFail(AdminUser, { id: ADMIN_ID });
    user.deletedAt = new Date();
    await em.flush();
    expect(await rowCount()).toBe(1);
    user.deletedAt = null;
    await em.flush();
    expect((await document()).sidebarPins).toEqual(['/orders']);

    user.status = 'inactive';
    await em.flush();
    expect(await rowCount()).toBe(1);
    user.status = 'active';
    await em.flush();
    expect((await document()).sidebarPins).toEqual(['/orders']);
  });

  it('a failed read leaves /admin/me answering 200 with `preferences: null`, and logs it (FR-018)', async () => {
    const service = preferenceService();
    const read = vi
      .spyOn(Object.getPrototypeOf(service) as PreferenceServiceLike, 'read')
      .mockRejectedValueOnce(new Error('relation "admin_user_preferences" does not exist'));
    const warn = vi.spyOn(service.log, 'warn');
    try {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/me', ...who });
      expect(res.statusCode).toBe(200);
      const me = adminMeResponseSchema.parse((res.json() as { data: unknown }).data);
      expect(me.preferences).toBeNull();
      expect(me.adminUser.id).toBe(ADMIN_ID);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ adminUserId: ADMIN_ID }),
        expect.stringContaining('preferences'),
      );
    } finally {
      read.mockRestore();
      warn.mockRestore();
    }
  });

  it('a hard delete of the admin removes the rows (cascade)', async () => {
    await resetRows();
    expect((await patch({ sidebarPins: ['/orders'], sidebarRailMode: true })).statusCode).toBe(200);
    expect(await rowCount()).toBe(2);
    await h.em().execute(`delete from "admin_users" where "id" = ?`, [ADMIN_ID]);
    expect(await rowCount()).toBe(0);
    await ensureAdmin();
  });
});
