import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * ProductAttachmentChannelHidden — feature 163 (`specs/163-product-data-scopes/`
 * data-model.md §8, research R16; FR-078).
 *
 * A product attachment hidden in one sales channel: that channel's product page neither
 * lists it nor names its file. Platform-global like `product_attachments` (FR-083).
 */
@GlobalEntity()
@Entity({ tableName: 'product_attachment_channel_hidden' })
export class ProductAttachmentChannelHidden {
  @PrimaryKey({ type: 'uuid' })
  attachmentId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'uuid' })
  productId!: string;
}
