import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { RfqAdminService } from './rfq-admin-service.js';

/**
 * Feature 163 (FR-018, T155 finding §1.5c) — an operator creating a quote
 * request on a customer's behalf names the channel it is raised on. That
 * channel is the one stored on the request and the one its availability
 * warnings speak about; without it the request landed on whatever the admin's
 * own request resolved (the system default), and a B2C customer's line switched
 * off in B2C was never named. An unknown channel is refused before anything is
 * numbered or written.
 *
 * Service-free: outside a request scope there is no resolved channel, so every
 * answer below comes from the body's `salesChannelId`.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2C = '00000000-0000-4000-8000-0000000000d1';
const ADMIN = { adminUserId: 'admin-1', isPlatformAdmin: true, roleLabel: 'Platform administrator' };

const record = {
  id: PRODUCT_ID,
  sku: 'SKU-1',
  slug: 'p-1',
  type: 'simple',
  status: 'active',
  name: { 'pl-PL': 'Produkt' },
  visibility: 'public',
  allowedOrganizationIds: [],
  archivedAt: null,
  deletedAt: null,
};

const body = (extra: Record<string, unknown> = {}) =>
  ({
    organizationId: ORG_ID,
    customerAccountId: CUSTOMER_ID,
    items: [{ productId: PRODUCT_ID, quantity: 1, agreedUnitPrice: 1 }],
    ...extra,
  }) as never;

function service(em: Record<string, unknown>, filterAvailable = vi.fn(async () => new Set<string>())) {
  const generateBusinessId = vi.fn(async () => null);
  const svc = new RfqAdminService({
    emFactory: () => em,
    customerAccounts: { findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID }) },
    catalogProducts: { findByIds: async () => [record] },
    catalogAvailability: { filterAvailable },
    rfqService: { generateBusinessId },
  } as never);
  return { svc, generateBusinessId, filterAvailable };
}

describe('163 — the channel an operator raises a quote request on', () => {
  it('warns about the lines unavailable at the channel the body names', async () => {
    const { svc, filterAvailable } = service({});
    const warnings = await svc.onBehalfWarnings(body({ salesChannelId: B2C }));
    expect(filterAvailable).toHaveBeenCalledWith([PRODUCT_ID], expect.objectContaining({ channelId: B2C, languageCode: null }));
    expect(warnings).toEqual([{ productId: PRODUCT_ID, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]);
  });

  it('stores the request on the channel the body names', async () => {
    const create = vi.fn((_entity: unknown, data: Record<string, unknown>) => data);
    const em = {
      findOne: vi.fn(async () => ({ id: B2C })),
      create,
      persistAndFlush: vi.fn(async () => {
        throw new Error('reached the write');
      }),
    };
    const { svc } = service(em);
    await expect(svc.createOnBehalf(ADMIN, body({ salesChannelId: B2C }))).rejects.toThrow('reached the write');
    expect(create.mock.calls[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });

  it('refuses an unknown channel with 404 before anything is numbered or created', async () => {
    const create = vi.fn();
    const { svc, generateBusinessId } = service({ findOne: vi.fn(async () => null), create });
    const caught = (await svc.createOnBehalf(ADMIN, body({ salesChannelId: B2C })).then(
      () => null,
      (error: unknown) => error,
    )) as { statusCode?: number; code?: string } | null;
    expect(caught).toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    expect(generateBusinessId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
