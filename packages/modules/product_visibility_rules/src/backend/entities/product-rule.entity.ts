import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { ProductRuleDefinition } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * A named, reusable product rule (data-model §1, FR-056). `version` moves on every
 * definition change; a website-rule preview binds to it.
 */
@GlobalEntity()
@Entity({ tableName: 'product_rules' })
export class ProductRule {
  [OptionalProps]?: 'id' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 120, unique: 'product_rules_name_unique' })
  name!: string;

  @Property({ type: 'json', columnType: 'jsonb' })
  definition!: ProductRuleDefinition;

  @Property({ type: 'integer', default: 1 })
  version: number = 1;

  @Property({ type: 'datetime', columnType: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', columnType: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
