import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A product priced in a currency at its catalogue price (data-model §2, R-5). A row
 * exists only when some line of the product is priced (0 included); `hasPositive` when
 * some line is above zero. Derived from `catalogueReferencePricePort`; never written by hand.
 */
@GlobalEntity()
@Entity({ tableName: 'product_catalogue_prices' })
export class ProductCataloguePrice {
  @PrimaryKey({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @PrimaryKey({ type: 'integer' })
  generation!: number;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'boolean' })
  hasPositive!: boolean;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  refreshedAt!: Date;
}
