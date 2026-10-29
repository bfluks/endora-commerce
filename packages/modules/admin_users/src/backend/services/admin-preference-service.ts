import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminListPageSize,
  AdminPreferences,
  AdminPreferencesPatch,
} from '@endora-commerce/contracts';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import {
  assemblePreferences,
  assertListPageSizesBound,
  importListPageSizes,
  mergeListPageSizes,
  readStoredListPageSizes,
  type StoredPreferenceRow,
} from './admin-preference-document.js';

type ReplacedKey = 'sidebarPins' | 'sidebarCollapsedGroups' | 'sidebarRailMode';
const REPLACED_KEYS: readonly ReplacedKey[] = [
  'sidebarPins',
  'sidebarCollapsedGroups',
  'sidebarRailMode',
];

/**
 * Feature 164 — the signed-in administrator's own Admin UI preferences
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §2.2, §3).
 *
 * One row per (admin, preference) in `admin_user_preferences`. The three sidebar
 * keys replace their whole value (last write wins); `listPageSizes` merges per
 * list under a row lock, so two devices choosing sizes on two lists do not erase
 * each other; the carry-over inserts only the lists the server does not hold.
 *
 * Every statement of one request runs in one transaction on that transaction's
 * own connection (`tx.execute`, never `getKnex()`), so a refusal — a bound
 * exceeded after the merge — writes nothing.
 *
 * Not a Command: a preference changes nothing another admin sees and no business
 * record, so it writes no audit entry (FR-020, research R-4). Not published as a
 * port: no other module asks for it.
 */
export class AdminPreferenceService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Also the logger `GET /admin/me` reports an unreadable document on. */
    readonly log: PlatformLogger,
  ) {}

  /** The admin's whole document, defaults filled. Reading never writes. */
  async read(adminUserId: string): Promise<AdminPreferences> {
    return this.readWith(this.emFactory(), adminUserId);
  }

  /** Write the keys present in `patch`, all or nothing, and answer the whole document. */
  async update(adminUserId: string, patch: AdminPreferencesPatch): Promise<AdminPreferences> {
    // command-coverage-ignore: per-admin Admin UI preference — personal UI setting, not an audited domain-state mutation
    return this.emFactory().transactional(async (tx) => {
      for (const key of REPLACED_KEYS) {
        const value = patch[key];
        if (value === undefined) continue;
        await tx.execute(
          `insert into "admin_user_preferences" ("admin_user_id", "preference_key", "value", "updated_at") ` +
            `values (?, ?, ?::jsonb, now()) ` +
            `on conflict ("admin_user_id", "preference_key") do update set ` +
            `"value" = excluded."value", "updated_at" = now()`,
          [adminUserId, key, JSON.stringify(value)],
        );
      }
      if (patch.listPageSizes !== undefined) {
        const changes = patch.listPageSizes;
        await this.writeListPageSizes(tx, adminUserId, (stored) =>
          mergeListPageSizes(stored, changes),
        );
      }
      return this.readWith(tx, adminUserId);
    });
  }

  /**
   * The one-time carry-over of the browser's page sizes (FR-022): a list the
   * server already holds keeps the server's value, so a repeat, a reload
   * mid-import or two tabs at once converge on one value per list (FR-023).
   */
  async importLegacy(
    adminUserId: string,
    body: { listPageSizes: Record<string, AdminListPageSize> },
  ): Promise<AdminPreferences> {
    // command-coverage-ignore: per-admin Admin UI preference — personal UI setting, not an audited domain-state mutation
    return this.emFactory().transactional(async (tx) => {
      await this.writeListPageSizes(tx, adminUserId, (stored) =>
        importListPageSizes(stored, body.listPageSizes),
      );
      return this.readWith(tx, adminUserId);
    });
  }

  /**
   * Lock the admin's `listPageSizes` row — creating it empty if absent, so there
   * is always a row to lock — then merge, check the bound on the result, and write.
   */
  private async writeListPageSizes(
    tx: EntityManager,
    adminUserId: string,
    merge: (stored: Record<string, number>) => Record<string, number>,
  ): Promise<void> {
    await tx.execute(
      `insert into "admin_user_preferences" ("admin_user_id", "preference_key", "value", "updated_at") ` +
        `values (?, 'listPageSizes', '{}'::jsonb, now()) ` +
        `on conflict ("admin_user_id", "preference_key") do nothing`,
      [adminUserId],
    );
    const rows = await tx.execute<Array<{ value: unknown }>>(
      `select "value" from "admin_user_preferences" ` +
        `where "admin_user_id" = ? and "preference_key" = 'listPageSizes' for update`,
      [adminUserId],
    );
    const merged = merge(readStoredListPageSizes(rows[0]?.value));
    assertListPageSizesBound(merged);
    await tx.execute(
      `update "admin_user_preferences" set "value" = ?::jsonb, "updated_at" = now() ` +
        `where "admin_user_id" = ? and "preference_key" = 'listPageSizes'`,
      [JSON.stringify(merged), adminUserId],
    );
  }

  private async readWith(em: EntityManager, adminUserId: string): Promise<AdminPreferences> {
    const rows = await em.execute<Array<{ preference_key: string; value: unknown }>>(
      `select "preference_key", "value" from "admin_user_preferences" where "admin_user_id" = ?`,
      [adminUserId],
    );
    const stored: StoredPreferenceRow[] = rows.map((row) => ({
      preferenceKey: row.preference_key,
      value: row.value,
    }));
    return assemblePreferences(stored, { log: this.log, adminUserId });
  }
}
