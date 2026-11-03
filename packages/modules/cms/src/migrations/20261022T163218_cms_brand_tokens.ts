import { Migration } from '@mikro-orm/migrations';

/**
 * The brand tokens table (`specs/163-page-builder-marketing-pages/`
 * data-model §1.3, research R-1).
 *
 * One complete `BrandTokens` object per scope: the row whose
 * `sales_channel_id` is null is the global set, and a sales channel's override
 * is a row of its own. `unique nulls not distinct` makes "one row per scope"
 * the database's rule rather than the service's, the global row included
 * (PostgreSQL 15+; the platform runs on 16).
 *
 * `sales_channel_id` is deliberately not a foreign key: channels are the
 * kernel's, and a row left behind by a deleted channel is never read — the
 * storefront resolves an existing channel before it asks. Platform content,
 * not tenant-scoped (plan § Constitution Check, XI).
 *
 * Written only by the `cms.brand_tokens.update` Command, which checks
 * `version` for optimistic locking.
 */
export class Migration20261022T163218CmsBrandTokens extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "cms_brand_tokens" (
        "id" uuid not null,
        "sales_channel_id" uuid null,
        "tokens" jsonb not null,
        "version" integer not null default 1,
        "updated_at" timestamptz not null default now(),
        constraint "cms_brand_tokens_pkey" primary key ("id"),
        constraint "cms_brand_tokens_sales_channel_id_unique" unique nulls not distinct ("sales_channel_id")
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "cms_brand_tokens";');
  }
}
