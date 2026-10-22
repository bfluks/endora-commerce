import { describe, expect, it, vi } from 'vitest';
import { isCustomFieldFilterUnavailableFailure } from '@endora-commerce/contracts';
import { RfqAdminService } from './rfq-admin-service.js';

/**
 * `specs/157-custom-fields-list-filters/` — the admin list built without the
 * list-filter port refuses custom-field filters rather than answering
 * unfiltered (FR-011), and reads nothing.
 */
describe('RfqAdminService.listAll without the custom-field list-filter port', () => {
  it('refuses a request that filters on custom fields, naming the keys, before any read', async () => {
    const find = vi.fn();
    const service = new RfqAdminService({ emFactory: () => ({ find }) } as never);
    const error = await service
      .listAll(
        { adminUserId: 'a', isPlatformAdmin: true, roleLabel: 'Platform administrator' },
        { customFieldFilters: { source: { in: ['web'] } } },
      )
      .catch((caught: unknown) => caught);
    expect(isCustomFieldFilterUnavailableFailure(error)).toBe(true);
    expect((error as { keys: string[] }).keys).toEqual(['source']);
    expect(find).not.toHaveBeenCalled();
  });
});
