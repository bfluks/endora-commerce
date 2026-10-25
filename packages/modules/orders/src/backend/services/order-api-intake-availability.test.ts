import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type CartWritePort, type ProductAvailabilityScope } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { OrderApiIntakeService } from './order-api-intake-service.js';
import type { OrderService } from './order-service.js';

/**
 * Feature 163 (owner decision W5 = A) — the external order intake asks
 * `catalogProductAvailabilityPort` at the key's channel for the bound
 * Organization: a product that is switched off there, outside its window or
 * outside the channel's audience is refused per line with the answer an
 * unknown SKU gets (`SKU_NOT_IN_ASSORTMENT` at `lines.<i>.sku`), inside the
 * intake's whole-order 422, and nothing is placed.
 */
const ORG_ID = '00000000-0000-4000-8000-000000000010';
const CHANNEL_ID = '00000000-0000-4000-8000-000000000012';
const ON = { id: '00000000-0000-4000-8000-000000000030', sku: 'SKU-ON', attributeValues: {} };
const OFF = { id: '00000000-0000-4000-8000-000000000031', sku: 'SKU-OFF', attributeValues: {} };

function rig() {
  const placeOrder = vi.fn(async () => ({ id: 'order-1' }));
  const filterAvailable = vi.fn(async (ids: readonly string[], _scope: ProductAvailabilityScope) =>
    new Set(ids.filter((id) => id === ON.id)),
  );
  const em = {
    findOne: async (entity: unknown) =>
      (entity as { name?: string }).name === 'SalesChannel'
        ? { id: CHANNEL_ID, defaultCurrency: 'PLN', defaultLanguage: 'pl-PL', languages: ['pl-PL', 'en-US'] }
        : null,
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'intent-1', ...data }),
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
    nativeUpdate: async () => 1,
  } as unknown as EntityManager;
  const service = new OrderApiIntakeService({
    emFactory: () => em,
    cartService: { clearForCustomer: async () => undefined } as unknown as CartWritePort,
    orderService: {
      placeOrder,
      assertMethodsAllowedForOrganization: async () => undefined,
      assertMethodsOfferedInChannel: async () => undefined,
    } as unknown as OrderService,
    addressService: {} as never,
    catalogProductRead: { findBySkus: async () => [ON, OFF] } as never,
    organizationDetails: { findById: async () => null } as never,
    catalogAvailability: { filterAvailable },
    pricingService: {
      resolveLinePrices: async (input: { lines: Array<{ key: string }> }) =>
        new Map(input.lines.map((line) => [line.key, { amount: '10.0000', currency: 'PLN' }])),
    } as never,
  });
  return { service, placeOrder, filterAvailable };
}

const binding = {
  apiKeyId: '00000000-0000-4000-8000-000000000050',
  organizationId: ORG_ID,
  salesChannelId: CHANNEL_ID,
  customerAccountId: '00000000-0000-4000-8000-000000000011',
};

const bodyOf = (skus: string[]) =>
  ({
    lines: skus.map((sku) => ({ sku, quantity: 1 })),
    deliveryMethodId: '00000000-0000-4000-8000-000000000021',
    paymentMethodId: '00000000-0000-4000-8000-000000000022',
    deliveryAddressId: '00000000-0000-4000-8000-000000000023',
    billingAddressId: '00000000-0000-4000-8000-000000000023',
  }) as never;

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('OrderApiIntakeService — scoped availability (163, W5)', () => {
  it('refuses an unavailable product per line exactly as an unknown SKU, and places nothing', async () => {
    const { service, placeOrder, filterAvailable } = rig();
    const error = await refusal(service.place(binding, 'idem-1', bodyOf(['SKU-ON', 'SKU-OFF', 'SKU-NONE'])));
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(error.details).toEqual([
      { path: 'lines.1.sku', issue: ERROR_CODES.SKU_NOT_IN_ASSORTMENT, sku: 'SKU-OFF' },
      { path: 'lines.2.sku', issue: ERROR_CODES.SKU_NOT_IN_ASSORTMENT, sku: 'SKU-NONE' },
    ]);
    expect(placeOrder).not.toHaveBeenCalled();
    // Asked at the key's channel, in its default language, for the bound Organization.
    expect(filterAvailable).toHaveBeenCalledWith([ON.id, OFF.id], {
      channelId: CHANNEL_ID,
      languageCode: null,
      audience: { organizationId: ORG_ID, authenticated: true },
    });
  });
});
