import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 155 — `quote_request_items.packaging_unit_id`
 * (`specs/155-catalog-order-constraints/data-model.md` §4).
 *
 * The catalogue packaging unit a line resolved to (FR-026), beside the
 * existing `packaging_unit_name` / `packaging_unit_base_quantity` snapshot.
 * **No foreign key**: packaging units are hard-deleted and the line's
 * snapshot outlives them.
 */
export class Migration20261018T122118QuoteRequestsItemPackagingUnitId extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "quote_request_items" add column "packaging_unit_id" uuid null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "quote_request_items" drop column if exists "packaging_unit_id";`);
  }
}
