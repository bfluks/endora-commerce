import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import type { GalleryLabel } from './gallery-item-label.entity.js';

/**
 * GalleryItemChannelLabel — feature 163 (`specs/163-product-data-scopes/`
 * data-model.md §7, research R14; FR-076).
 *
 * A sales channel's own holder of one gallery role. The primary key
 * `(product, channel, label)` is the per-channel role uniqueness. No row = the
 * global `gallery_item_labels` holder applies in that channel; the role resolves to
 * none in a channel where the item that would hold it is hidden. Platform-global like
 * `gallery_items` (FR-083).
 */
@GlobalEntity()
@Entity({ tableName: 'gallery_item_channel_labels' })
export class GalleryItemChannelLabel {
  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @PrimaryKey({ type: 'string', length: 16 })
  label!: GalleryLabel;

  @Property({ type: 'uuid' })
  galleryItemId!: string;
}
