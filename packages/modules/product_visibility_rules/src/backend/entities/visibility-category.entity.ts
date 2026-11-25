import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'crypto';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A visibility category (`specs/193-product-visibility-rules/` data-model §1, FR-010). A
 * product qualifies when any of its conditions is met (FR-011).
 *
 * Platform-global: instance configuration, not tenant data (Principle XI, FR-075).
 */
@GlobalEntity()
@Entity({ tableName: 'visibility_categories' })
export class VisibilityCategory {
  [OptionalProps]?: 'id' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Unique case-insensitively (`lower(name)` index). */
  @Property({ type: 'string', length: 120 })
  name!: string;

  /** Optimistic concurrency (`If-Match`). */
  @Property({ type: 'integer', default: 1 })
  version: number = 1;

  @Property({ type: 'datetime', columnType: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', columnType: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
