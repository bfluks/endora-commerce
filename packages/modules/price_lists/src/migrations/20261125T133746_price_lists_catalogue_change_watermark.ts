import { Migration } from '@mikro-orm/migrations';

/**
 * Spec 193 (`specs/193-product-visibility-rules/` T012, threat model TM-7 (5)) — the
 * catalogue change watermark: a sequence the writer moves once per pricing-generation bump,
 * after commit, beside the `price_lists.catalogue_prices_changed` announcement.
 * `catalogueReferencePricePort.changeWatermark()` reads it, so a consumer that missed an
 * announcement (the in-process bus is best effort) sees that a price may have moved.
 * A sequence rather than a row: moving it takes no lock and no transaction.
 */
export class Migration20261125T133746PriceListsCatalogueChangeWatermark extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create sequence if not exists "price_lists_catalogue_change_seq" as bigint;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop sequence if exists "price_lists_catalogue_change_seq";`);
  }
}
