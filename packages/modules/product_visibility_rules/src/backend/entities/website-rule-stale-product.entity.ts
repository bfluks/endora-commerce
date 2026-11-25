import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** A product to re-evaluate on every governed channel (data-model §3). */
@GlobalEntity()
@Entity({ tableName: 'website_rule_stale_products' })
export class WebsiteRuleStaleProduct {
  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  markedAt!: Date;
}
