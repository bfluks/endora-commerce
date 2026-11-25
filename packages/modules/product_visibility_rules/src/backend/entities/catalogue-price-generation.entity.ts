import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * Which generation of a currency's catalogue-price flags every read uses, and which
 * designation it was built for (data-model §2, R-5). Worker-written; not audited.
 */
@GlobalEntity()
@Entity({ tableName: 'catalogue_price_generations' })
export class CataloguePriceGeneration {
  [OptionalProps]?:
    | 'buildingGeneration'
    | 'builtForPriceListId'
    | 'builtForSalesChannelId'
    | 'wholeStale'
    | 'consumedWatermark'
    | 'builtAt';

  @PrimaryKey({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @Property({ type: 'integer' })
  servedGeneration!: number;

  @Property({ type: 'integer', nullable: true })
  buildingGeneration: number | null = null;

  /** Designation snapshot of `servedGeneration`; `null` = the base book. */
  @Property({ type: 'uuid', nullable: true })
  builtForPriceListId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  builtForSalesChannelId: string | null = null;

  @Property({ type: 'boolean', default: false })
  wholeStale: boolean = false;

  /** The `price_lists` change watermark the served generation consumed (TM-7 (5)). */
  @Property({ type: 'text', nullable: true })
  consumedWatermark: string | null = null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  builtAt: Date | null = null;
}
