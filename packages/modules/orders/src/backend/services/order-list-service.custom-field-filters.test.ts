import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { isCustomFieldFilterUnavailableFailure } from '@endora-commerce/contracts';
import { OrderListService } from './order-list-service.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';

/**
 * `specs/157-custom-fields-list-filters/` — a list built without the
 * list-filter port (the prompt tools' list) refuses custom-field filters
 * rather than answering unfiltered (FR-011), and reads nothing.
 */
describe('OrderListService without the custom-field list-filter port', () => {
  it('refuses a request that filters on custom fields, naming the keys, before any read', async () => {
    const find = vi.fn();
    const em = { find, findAndCount: find } as unknown as EntityManager;
    const service = new OrderListService(
      () => em,
      {} as OrderStatusGraphService,
      {} as never,
      {} as never,
    );
    const error = await service
      .list({ page: 1, pageSize: 10, customFieldFilters: { source: { in: ['web'] }, vip: { is: true } } })
      .catch((caught: unknown) => caught);
    expect(isCustomFieldFilterUnavailableFailure(error)).toBe(true);
    expect((error as { keys: string[] }).keys).toEqual(['source', 'vip']);
    expect(find).not.toHaveBeenCalled();
  });
});
