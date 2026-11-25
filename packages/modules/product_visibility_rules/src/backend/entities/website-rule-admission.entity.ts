import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A product admitted to a governed channel by its rule (data-model §3, FR-093, Q1 A). The
 * first channel status write after admission sets `postAdmissionStatusSeen` and is exempt
 * from the reactivation hook.
 */
@GlobalEntity()
@Entity({ tableName: 'website_rule_admissions' })
export class WebsiteRuleAdmission {
  [OptionalProps]?: 'postAdmissionStatusSeen';

  @PrimaryKey({ type: 'uuid' })
  salesChannelId!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  admittedAt!: Date;

  @Property({ type: 'boolean', default: false })
  postAdmissionStatusSeen: boolean = false;
}
