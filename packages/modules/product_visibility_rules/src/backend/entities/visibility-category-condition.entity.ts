import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'crypto';
import type { VisibilityThreshold } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * One condition of a visibility category: priced in `currencyCode` above zero
 * (`gt_zero`) or at all (`gte_zero`) — data-model §1, FR-011, FR-012. The currency is not
 * a foreign key: a later-deactivated currency stays stored and its condition is never met.
 */
@GlobalEntity()
@Entity({ tableName: 'visibility_category_conditions' })
export class VisibilityCategoryCondition {
  [OptionalProps]?: 'id';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  visibilityCategoryId!: string;

  @Property({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @Property({ type: 'string', length: 8 })
  threshold!: VisibilityThreshold;
}
