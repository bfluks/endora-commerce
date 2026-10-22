import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { registerOrderRoutes, type OrdersDeps } from './routes.js';

/**
 * Feature 145, FR-027 / Principle XII — the admin order preview checks each
 * line's assortment through the `salesChannelMembership` bridge accessor. The
 * dependency is optional on `OrdersDeps`, so the route must fail closed when it
 * is not wired: `500 INTERNAL`, before any line is read, priced or judged.
 * Treating "not wired" as "every product is in the assortment" would quote an
 * order the channel cannot sell.
 */

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000b1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000c9';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000101';

describe('POST /api/v1/admin/orders/preview — the membership port is required', () => {
  let app: FastifyInstance;
  const touchedAfterGuard = {
    organizationDetails: vi.fn(),
    findByIds: vi.fn(),
    resolveLinePrice: vi.fn(),
    assertMethodsAllowedForOrganization: vi.fn(),
  };

  beforeEach(async () => {
    for (const fn of Object.values(touchedAfterGuard)) fn.mockReset();

    const em = {
      findOne: async (entity: unknown, where: { id?: string }) =>
        entity === SalesChannel && where.id === CHANNEL_ID
          ? ({ id: CHANNEL_ID, code: 'b2b', status: 'active' } as unknown as SalesChannel)
          : null,
    } as unknown as EntityManager;

    const deps = {
      emFactory: () => em,
      requireCustomer: async () => {},
      requireAdmin: () => async () => {},
      resolveCustomerContext: () => ({
        customerAccountId: CUSTOMER_ID,
        organizationId: ORGANIZATION_ID,
      }),
      customerAccountRead: {
        findById: async (id: string) =>
          id === CUSTOMER_ID ? { id: CUSTOMER_ID, organizationId: ORGANIZATION_ID } : null,
      },
      organizationDetails: { findById: touchedAfterGuard.organizationDetails },
      catalogProductRead: { findByIds: touchedAfterGuard.findByIds },
      catalogProductAvailability: { filterAvailable: touchedAfterGuard.findByIds },
      pricingService: { resolveLinePrice: touchedAfterGuard.resolveLinePrice },
      orderService: {
        assertMethodsAllowedForOrganization: touchedAfterGuard.assertMethodsAllowedForOrganization,
      },
      // Deliberately absent: salesChannelMembership.
    } as unknown as OrdersDeps;

    app = Fastify();
    // The route declares Zod schemas and parses its body with Zod itself; this
    // package does not depend on the Zod type provider, so the compilers are
    // pass-throughs rather than Ajv trying to compile a Zod object.
    app.setValidatorCompiler(() => (data) => ({ value: data }));
    app.setSerializerCompiler(() => (data) => JSON.stringify(data));
    await registerOrderRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 500 INTERNAL and evaluates no line', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      payload: {
        customerAccountId: CUSTOMER_ID,
        salesChannelId: CHANNEL_ID,
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
      },
    });

    expect(res.statusCode, res.body).toBe(500);
    expect((res.json() as { code: string }).code).toBe(ERROR_CODES.INTERNAL);
    expect(res.body).not.toContain('unitPrice');
    for (const fn of Object.values(touchedAfterGuard)) expect(fn).not.toHaveBeenCalled();
  });

  it('still refuses an unknown channel with 404 before the port is consulted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      payload: {
        customerAccountId: CUSTOMER_ID,
        salesChannelId: '00000000-0000-4000-8000-0000000000c1',
        items: [{ productId: PRODUCT_ID, quantity: 1 }],
      },
    });

    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { code: string }).code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
