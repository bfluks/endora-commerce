import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A role's visibility target — a category or `unrestricted` (data-model §1, FR-020,
 * FR-025, I-2). At most one per role; setting no target deletes the row. `adminRoleId` is
 * not a foreign key (R-13): a deleted role leaves a row that matches nothing.
 */
@GlobalEntity()
@Entity({ tableName: 'visibility_role_mappings' })
export class VisibilityRoleMapping {
  [OptionalProps]?: 'visibilityCategoryId' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  adminRoleId!: string;

  @Property({ type: 'string', length: 12 })
  target!: 'category' | 'unrestricted';

  /** Set exactly when `target` is `category` (check constraint). */
  @Property({ type: 'uuid', nullable: true })
  visibilityCategoryId: string | null = null;

  @Property({ type: 'datetime', columnType: 'timestamptz', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
