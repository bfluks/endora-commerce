import type { EntityManager } from '@mikro-orm/postgresql';
import { arrangeLineGroups, flattenSections, type LineGroup } from '@endora-commerce/contracts';
import { OrderItem } from '../entities/order-item.entity.js';
import { OrderItemGroup } from '../entities/order-item-group.entity.js';

/**
 * Feature 159 (research R-6, FR-011) — the one display order of an order's
 * lines: groups by position, each group's lines by `(position, createdAt, id)`,
 * then the ungrouped lines the same way. An order placed before the feature
 * (every line at position 0) keeps its `(createdAt, id)` order.
 */
export const ORDER_LINE_STORAGE_ORDER = { position: 'asc', createdAt: 'asc', id: 'asc' } as const;

export interface ArrangedOrderLines {
  /** The order's groups, by position (an order stores no empty group). */
  readonly groups: LineGroup[];
  /** The lines in display order. */
  readonly lines: OrderItem[];
}

/** Read an order's groups and lines and answer them in the display order. */
export async function loadArrangedOrderLines(em: EntityManager, orderId: string): Promise<ArrangedOrderLines> {
  const [groups, lines] = await Promise.all([
    em.find(OrderItemGroup, { orderId }, { orderBy: { position: 'asc' } }),
    em.find(OrderItem, { orderId }, { orderBy: ORDER_LINE_STORAGE_ORDER }),
  ]);
  const lineGroups = groups.map((group) => ({ id: group.id, name: group.name, position: group.position }));
  return {
    groups: lineGroups,
    lines: flattenSections(arrangeLineGroups(lineGroups, lines, { includeEmptyGroups: true })),
  };
}
