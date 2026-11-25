import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** {@link ProductCataloguePrice} per variant (data-model §2): a row ⇔ the variant is priced. */
@GlobalEntity()
@Entity({ tableName: 'variant_catalogue_prices' })
export class VariantCataloguePrice {
  @PrimaryKey({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @PrimaryKey({ type: 'integer' })
  generation!: number;

  @PrimaryKey({ type: 'uuid' })
  variantId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'boolean' })
  hasPositive!: boolean;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  refreshedAt!: Date;
}
