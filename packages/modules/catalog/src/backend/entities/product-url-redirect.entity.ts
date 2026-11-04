import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * ProductUrlRedirect — feature 163 (`specs/163-product-data-scopes/` data-model.md
 * §5, research R11, R12).
 *
 * A former URL key that answers a permanent redirect to the product's current URL
 * at (channel, language). It stores the **product**, never a target key or URL, so
 * redirects never chain (FR-072). `languageCode` null is a former global key that
 * was free in every language when it was released; it redirects in every language
 * of every channel (H1). Removed when the operator deletes it, when another product
 * takes it over on confirmation, and when the product is deleted (FR-072).
 * Serving it is `seo`'s decision (FR-111); keeping it is catalog's invariant.
 */
@GlobalEntity()
@Entity({ tableName: 'product_url_redirects' })
export class ProductUrlRedirect {
  [OptionalProps]?: 'createdAt' | 'languageCode';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  /** `null` = a former global key, redirecting in every language. */
  @Property({ type: 'string', length: 16, nullable: true })
  languageCode: string | null = null;

  @Property({ type: 'string', length: 160 })
  key!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
