import { Migration } from '@mikro-orm/migrations';

/**
 * Owner ruling of 2026-10-25 — a unit price is carried at four decimal places,
 * unrounded, from the price book to the invoice line, and only the line value
 * (`unit × quantity`) is rounded to two (`specs/pricing/worked-examples.md`
 * §10.18). `quote_request_items.desired_unit_price`, `agreed_unit_price` and `reference_unit_price` widen from
 * `numeric(12,2)` to `numeric(14,4)`, the price book's own type.
 *
 * Widening is lossless: every stored value keeps its digits (`12.34` reads
 * `12.3400`), and nothing is backfilled — a line priced before the change was
 * priced at two places and keeps that price.
 *
 * `down` narrows back and **rounds** any sub-cent unit price stored since, half
 * away from zero, which is Postgres' cast; it exists for a development rollback,
 * not for a production one.
 */
export class Migration20261025T031736QuoteRequestsUnitPriceFourPlaces extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "quote_request_items" alter column "desired_unit_price" type numeric(14,4), alter column "agreed_unit_price" type numeric(14,4), alter column "reference_unit_price" type numeric(14,4);');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "quote_request_items" alter column "desired_unit_price" type numeric(12,2), alter column "agreed_unit_price" type numeric(12,2), alter column "reference_unit_price" type numeric(12,2);');
  }
}
