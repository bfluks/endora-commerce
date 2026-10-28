import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';

const channelState: { current: { id: string; languages: string[]; defaultLanguage: string } | null } = {
  current: null,
};
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => channelState.current,
}));

const { RfqService } = await import('./rfq-service.js');

/**
 * Feature 163 (FR-018, T155 finding §1.5b) — the scope language L a buyer's
 * quote line is asked about is the request's language tag resolved against the
 * channel, exactly as the basket's (`basketScopeLanguage`): never the language
 * the response's messages are written in. Those two differ whenever the buyer
 * asks in a language the message bundles do not carry — `de-DE` against the
 * `en`/`pl` bundles answers its messages in Polish, and the line used to be
 * judged at `pl-PL` with them, so a product switched off in German was quoted
 * to a German buyer the basket refused.
 */

const B2C = '00000000-0000-4000-8000-0000000000d1';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a2';
const ORG_ID = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

const ctx = { customerAccountId: CUSTOMER_ID, organizationId: ORG_ID, isOrgAdmin: false };

function serviceAskingAt(): { service: InstanceType<typeof RfqService>; filterAvailable: ReturnType<typeof vi.fn> } {
  // Nothing is available, so the write stops at the product 404 before any
  // collaborator past the availability question is reached.
  const filterAvailable = vi.fn(async () => new Set<string>());
  const service = new RfqService({
    emFactory: () => ({}),
    negotiationPolicy: { assertProposalsAllowed: async () => undefined },
    catalogProducts: {
      findByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({
          id,
          sku: 'SKU',
          slug: 'p',
          type: 'simple',
          status: 'active',
          name: { 'pl-PL': 'Produkt' },
          visibility: 'public',
          allowedOrganizationIds: [],
          archivedAt: null,
          deletedAt: null,
        })),
    },
    catalogAvailability: { filterAvailable },
  } as never);
  return { service, filterAvailable };
}

async function refusalOf(promise: Promise<unknown>): Promise<string | undefined> {
  const caught = (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as { code?: string } | null;
  return caught?.code;
}

beforeEach(() => {
  channelState.current = { id: B2C, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
});

describe('163 — a buyer’s quote line is asked about at the request’s scope language', () => {
  it('asks at the request tag resolved against the channel, not at the message language', async () => {
    const { service, filterAvailable } = serviceAskingAt();
    const code = await refusalOf(
      service.createForCustomer(ctx, { items: [{ productId: PRODUCT_ID, quantity: 1 }] } as never, {
        language: 'pl',
        languageTag: 'de-DE',
        salesChannelId: B2C,
      }),
    );
    expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    expect(filterAvailable).toHaveBeenCalledWith([PRODUCT_ID], expect.objectContaining({ channelId: B2C, languageCode: 'de-DE' }));
  });

  it('with no request tag asks at the channel’s default language, whatever the message language', async () => {
    channelState.current = { id: B2C, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'de-DE' };
    const { service, filterAvailable } = serviceAskingAt();
    await refusalOf(
      service.createForCustomer(ctx, { items: [{ productId: PRODUCT_ID, quantity: 1 }] } as never, {
        language: 'pl',
        salesChannelId: B2C,
      }),
    );
    expect(filterAvailable).toHaveBeenCalledWith([PRODUCT_ID], expect.objectContaining({ languageCode: 'de-DE' }));
  });
});
