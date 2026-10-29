import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ProductAvailabilityScope } from '@endora-commerce/contracts';
import { CatalogOrgPriceDecorator } from './catalog-org-price-decorator.js';

/**
 * Feature 163 (owner decision W5 = A) — the external bulk-price probe gives no
 * organisation price for a product that is not available to that organisation
 * at the key's channel: switched off there, outside its publication window or
 * outside the channel's audience. Such a line answers exactly what an unknown
 * SKU answers (`sku_not_in_assortment`), and is never priced.
 */
const CHANNEL = { id: 'channel-1', defaultCurrency: 'PLN' };
/** As `productAudienceOf` answers for a key bound to `org-1`. */
const AUDIENCE = { organizationId: 'org-1', authenticated: true };
const ON = { id: 'p-on', sku: 'SKU-ON', status: 'active' };
const OFF = { id: 'p-off', sku: 'SKU-OFF', status: 'active' };

describe('CatalogOrgPriceDecorator.resolveBulkPrices — scoped availability (163, W5)', () => {
  it('prices only the products available to the organisation at the channel', async () => {
    const resolveLinePrices = vi.fn(async (input: { lines: Array<{ key: string }> }) =>
      new Map(
        input.lines.map((line) => [
          line.key,
          { amount: '10.0000', currency: 'PLN', isSale: false, bracketStartQuantity: 1, priceListId: 'pl-1' },
        ]),
      ),
    );
    const filterAvailable = vi.fn(async (ids: readonly string[], _scope: ProductAvailabilityScope) =>
      new Set(ids.filter((id) => id === ON.id)),
    );
    const decorator = new CatalogOrgPriceDecorator({
      emFactory: () => ({ find: async () => [ON, OFF] }) as unknown as EntityManager,
      pricingService: { resolveLinePrices } as never,
      organizations: { findById: async () => ({ id: 'org-1' }) } as never,
      availability: { filterAvailable },
    });

    const out = await decorator.resolveBulkPrices(
      [
        { sku: 'SKU-ON', quantity: 1 },
        { sku: 'SKU-OFF', quantity: 1 },
        { sku: 'SKU-NONE', quantity: 1 },
      ],
      { organizationId: 'org-1', salesChannel: CHANNEL, audience: AUDIENCE },
    );

    expect(out.map((line) => line.price === null ? line.reason : 'priced')).toEqual([
      'priced',
      'sku_not_in_assortment',
      'sku_not_in_assortment',
    ]);
    const pricedKeys = (resolveLinePrices.mock.calls[0]![0] as { lines: Array<{ key: string }> }).lines.map((l) => l.key);
    expect(pricedKeys).toEqual(['0']);
    expect(filterAvailable).toHaveBeenCalledWith([ON.id, OFF.id], {
      channelId: CHANNEL.id,
      languageCode: null,
      audience: AUDIENCE,
    });
  });
});
