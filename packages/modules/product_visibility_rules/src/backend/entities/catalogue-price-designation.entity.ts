import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * The book a currency's catalogue price is read from (data-model §1, FR-001, RQ-1 A). No
 * row ⇒ the currency's base book. Book and channel ids are not foreign keys: a later
 * deletion, unbinding or status change is reported by `designationStatus` at read time.
 */
@GlobalEntity()
@Entity({ tableName: 'catalogue_price_designations' })
export class CataloguePriceDesignation {
  [OptionalProps]?: 'updatedAt';

  @PrimaryKey({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @Property({ type: 'uuid' })
  priceListId!: string;

  @Property({ type: 'uuid' })
  salesChannelId!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
