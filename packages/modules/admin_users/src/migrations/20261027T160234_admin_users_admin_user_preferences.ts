import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 164 — `admin_user_preferences`, the signed-in administrator's own Admin
 * UI preferences: sidebar pins, folded groups, rail mode and list page sizes
 * (`specs/164-admin-user-preferences/data-model.md`).
 *
 * One row per (admin, preference), the value as `jsonb`. The key set is closed by
 * the contract (`ADMIN_PREFERENCE_KEYS` in `@endora-commerce/contracts`), not by a
 * `check` constraint here, so a new preference needs no migration.
 *
 * The foreign key is to this module's own `admin_users` table, so no manifest
 * dependency is involved. `on delete cascade`: soft deletion and deactivation
 * keep the rows; only a hard delete of the admin (the demo withdrawal, the test
 * harness's truncate) removes them.
 */
export class Migration20261027T160234AdminUsersAdminUserPreferences extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "admin_user_preferences" (
        "admin_user_id" uuid not null,
        "preference_key" varchar(64) not null,
        "value" jsonb not null,
        "updated_at" timestamptz not null default now(),
        constraint "admin_user_preferences_pkey" primary key ("admin_user_id", "preference_key"),
        constraint "admin_user_preferences_admin_user_fk" foreign key ("admin_user_id")
          references "admin_users" ("id") on delete cascade
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "admin_user_preferences";`);
  }
}
