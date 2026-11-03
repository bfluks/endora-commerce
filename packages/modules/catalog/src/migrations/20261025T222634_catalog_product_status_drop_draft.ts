import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 163, spec Session 2026-10-25 — the product status loses `draft`
 * (`specs/163-product-data-scopes/data-model.md` §13, research R30.1–R30.2;
 * FR-010, FR-110, FR-112, SC-009).
 *
 * In this order, so no converted row is archived and no row violates the new
 * constraints:
 *
 * 1. every `inactive` product without `archived_at` is archived at its
 *    `updated_at` (O-4): until now `inactive` *was* the archived state, so those
 *    products stay archived and need an explicit Restore;
 * 2. `draft` becomes `inactive` in `products` and in both scope tables, without
 *    writing `archived_at` (Q1-b) — no draft product becomes archived;
 * 3. the scope `CHECK`s are replaced by two-value ones — `drop constraint if
 *    exists`, so the same body is correct on a database that ran the three-value
 *    `20261022T035133` body and on a fresh one — and `products_status_check` is
 *    added (R30.2), so a process still writing `draft` during a rolling deploy is
 *    refused rather than stored;
 * 4. the column default becomes `inactive` (Q1-d).
 *
 * `20261022T035133_catalog_product_scopes.ts` is deliberately not amended: a
 * database that already ran it would never re-run an edited body (R30.1).
 *
 * `down()` restores the three-value scope `CHECK`s, drops `products_status_check`
 * and sets the default back to `draft`. It cannot tell a converted `draft` from an
 * original `inactive`, nor a backfilled `archived_at` from an original one, so it
 * leaves the data as it is.
 */
export class Migration20261025T222634CatalogProductStatusDropDraft extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "products" set "archived_at" = "updated_at" where "status" = 'inactive' and "archived_at" is null;`,
    );
    this.addSql(`update "products" set "status" = 'inactive' where "status" = 'draft';`);
    this.addSql(`update "product_channel_scopes" set "status" = 'inactive' where "status" = 'draft';`);
    this.addSql(`update "product_channel_language_scopes" set "status" = 'inactive' where "status" = 'draft';`);
    this.addSql(
      `alter table "product_channel_scopes" drop constraint if exists "product_channel_scopes_status_check";`,
    );
    this.addSql(
      `alter table "product_channel_scopes" add constraint "product_channel_scopes_status_check"
         check ("status" is null or "status" in ('active', 'inactive'));`,
    );
    this.addSql(
      `alter table "product_channel_language_scopes" drop constraint if exists "product_channel_language_scopes_status_check";`,
    );
    this.addSql(
      `alter table "product_channel_language_scopes" add constraint "product_channel_language_scopes_status_check"
         check ("status" in ('active', 'inactive'));`,
    );
    this.addSql(`alter table "products" drop constraint if exists "products_status_check";`);
    this.addSql(
      `alter table "products" add constraint "products_status_check" check ("status" in ('active', 'inactive'));`,
    );
    this.addSql(`alter table "products" alter column "status" set default 'inactive';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "products" alter column "status" set default 'draft';`);
    this.addSql(`alter table "products" drop constraint if exists "products_status_check";`);
    this.addSql(
      `alter table "product_channel_language_scopes" drop constraint if exists "product_channel_language_scopes_status_check";`,
    );
    this.addSql(
      `alter table "product_channel_language_scopes" add constraint "product_channel_language_scopes_status_check"
         check ("status" in ('draft', 'active', 'inactive'));`,
    );
    this.addSql(
      `alter table "product_channel_scopes" drop constraint if exists "product_channel_scopes_status_check";`,
    );
    this.addSql(
      `alter table "product_channel_scopes" add constraint "product_channel_scopes_status_check"
         check ("status" is null or "status" in ('draft', 'active', 'inactive'));`,
    );
  }
}
