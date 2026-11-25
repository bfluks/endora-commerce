import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * The rule governing one sales channel (data-model §1, FR-051) — at most one per channel.
 * Read by the kernel membership governor inside the membership mutation's transaction (R-10).
 */
@GlobalEntity()
@Entity({ tableName: 'website_rule_attachments' })
export class WebsiteRuleAttachment {
  [OptionalProps]?: 'attachedAt';

  @PrimaryKey({ type: 'uuid' })
  salesChannelId!: string;

  @Property({ type: 'uuid' })
  productRuleId!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz', onCreate: () => new Date() })
  attachedAt: Date = new Date();

  /** The rule version whose preview was applied. */
  @Property({ type: 'integer' })
  appliedRuleVersion!: number;
}
