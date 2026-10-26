import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * GalleryItem — Asset reference attached to a Product (feature 002 US3,
 * data-model.md §2.3). Labels (Base / Small / Thumbnail) live in the
 * sibling `GalleryItemLabel` bridge so the per-product UNIQUE constraint
 * can be enforced at the DB level (research.md R-2).
 */
@GlobalEntity()
@Entity({ tableName: 'gallery_items' })
export class GalleryItem {
  [OptionalProps]?: 'id' | 'position' | 'altText' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'integer' })
  position: number = 0;

  /**
   * Feature 163 (FR-077, R15) — the product's own alt text of this image per
   * language, `{ "<lang>": "<text>" }`. A language absent here falls back to the
   * asset's alt text. Product-specific, so it never changes another product using
   * the same asset.
   */
  @Property({ type: 'json' })
  altText: Record<string, string> = {};

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
