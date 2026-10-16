import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

@GlobalEntity()
@Entity({ tableName: 'order_items' })
export class OrderItem {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'variantId'
    | 'variantSnapshot'
    | 'packagingUnitSnapshot'
    | 'returnableAtPurchase';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'json' })
  productSnapshot!: {
    sku: string;
    name: string;
    primaryAssetUrl: string | null;
  };

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'json', nullable: true })
  variantSnapshot?: { sku: string; label: string } | null;

  /**
   * Feature 043 — set when the line was ordered as a packaging unit. The unit
   * name is also appended to `productSnapshot.name`, so all order-derived
   * documents (detail, invoice, CSV, email) show the suffix automatically.
   */
  @Property({ type: 'json', nullable: true })
  packagingUnitSnapshot?: { name: string; baseQuantity: number } | null;

  /**
   * Feature 148 (FR-016a) — whether the product was returnable when the line
   * was placed, written once at placement and never updated. `null` only on
   * lines placed before the column existed, which `returns` treats as
   * returnable (FR-017).
   */
  @Property({ type: 'boolean', nullable: true })
  returnableAtPurchase?: boolean | null;

  @Property({ type: 'integer' })
  quantity!: number;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: string;

  @Property({ type: 'decimal', precision: 5, scale: 4 })
  taxRate!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  lineTotal!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
