import { ArrayType, OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'crypto';
import type { ProductRuleDefinition } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A website-rule preview (data-model §3, FR-053): the evaluated join / leave counts of
 * attaching or changing a rule, confirmed only by its creator before it expires (TM-11).
 */
@GlobalEntity()
@Entity({ tableName: 'website_rule_previews' })
export class WebsiteRulePreview {
  [OptionalProps]?: 'id' | 'productRuleId' | 'ruleVersion' | 'status' | 'counts' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 8 })
  kind!: 'attach' | 'change';

  /** `null` for an unsaved draft of a new rule. */
  @Property({ type: 'uuid', nullable: true })
  productRuleId: string | null = null;

  @Property({ type: 'json', columnType: 'jsonb' })
  definition!: ProductRuleDefinition;

  /** Refused at confirm when the rule's version moved. */
  @Property({ type: 'integer', nullable: true })
  ruleVersion: number | null = null;

  @Property({ type: ArrayType, columnType: 'uuid[]' })
  salesChannelIds!: string[];

  @Property({ type: 'string', length: 10, default: 'pending' })
  status: 'pending' | 'ready' | 'failed' | 'applied' | 'expired' = 'pending';

  /** Per channel `{ join, leave }`. */
  @Property({ type: 'json', columnType: 'jsonb', nullable: true })
  counts: Record<string, { join: number; leave: number }> | null = null;

  @Property({ type: 'uuid' })
  createdByAdminUserId!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  expiresAt!: Date;
}
