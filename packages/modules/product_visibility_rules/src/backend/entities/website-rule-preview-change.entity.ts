import { Entity, PrimaryKey } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** One product joining or leaving one channel in a preview (data-model §3); deleted with it. */
@GlobalEntity()
@Entity({ tableName: 'website_rule_preview_changes' })
export class WebsiteRulePreviewChange {
  @PrimaryKey({ type: 'uuid' })
  previewId!: string;

  @PrimaryKey({ type: 'uuid' })
  salesChannelId!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @PrimaryKey({ type: 'string', length: 5 })
  op!: 'join' | 'leave';
}
