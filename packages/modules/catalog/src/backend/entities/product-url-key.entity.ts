import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * ProductUrlKey — feature 163 (`specs/163-product-data-scopes/` data-model.md §5,
 * research R11).
 *
 * A product's URL key in one language (`salesChannelId` null — the language key,
 * for every channel) or at one sales channel × language (the override). The global
 * key stays `products.slug`. A key is unique per language across every channel,
 * counting the global key wherever the product has no language key — a rule no
 * index can express, so `UrlKeyService` enforces it under a per-key advisory lock;
 * the partial uniques here only stop a product holding two keys at one scope.
 *
 * An override whose channel the product left, or whose language the channel
 * dropped, stays and keeps reserving its key (FR-015, FR-070). Platform-global like
 * `products` (FR-083).
 *
 * A soft-deleted product's rows stop reserving their keys (another product may take
 * them), while its `products.slug` stays taken; a future un-delete must therefore
 * re-check every key it would bring back.
 */
@GlobalEntity()
@Entity({ tableName: 'product_url_keys' })
export class ProductUrlKey {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'salesChannelId';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'string', length: 16 })
  languageCode!: string;

  /** `null` = the language key; else the channel × language override. */
  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 160 })
  key!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
