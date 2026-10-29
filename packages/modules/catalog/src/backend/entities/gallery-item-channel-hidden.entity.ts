import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * GalleryItemChannelHidden — feature 163 (`specs/163-product-data-scopes/`
 * data-model.md §7, research R14; FR-076).
 *
 * A gallery item hidden in one sales channel: it is not served there — not on the
 * product page, not as the listing card's image, not as the OG image. The image set
 * stays global (D-6). Platform-global like `gallery_items` (FR-083).
 */
@GlobalEntity()
@Entity({ tableName: 'gallery_item_channel_hidden' })
export class GalleryItemChannelHidden {
  @PrimaryKey({ type: 'uuid' })
  galleryItemId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'uuid' })
  productId!: string;
}
