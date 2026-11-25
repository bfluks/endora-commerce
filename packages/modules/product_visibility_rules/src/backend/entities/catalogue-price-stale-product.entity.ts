import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A targeted refresh mark (data-model §2): this product's flags in this currency are to
 * be re-resolved. A refresh clears only marks older than its read start (TM-7 (1)).
 */
@GlobalEntity()
@Entity({ tableName: 'catalogue_price_stale_products' })
export class CataloguePriceStaleProduct {
  @PrimaryKey({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  markedAt!: Date;
}
