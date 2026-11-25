import { describe, expect, it } from 'vitest';
import type { DesignationStatus } from '@endora-commerce/contracts';
import { VisibilityConfigService } from './visibility-config.service.js';

/**
 * Spec 193 T023 — a designation set or cleared asks for a whole rebuild of its currency's
 * catalogue-price flags; a refused designation, or a write that changes nothing, asks for
 * nothing.
 */
describe('designation writes schedule a flag rebuild (T023)', () => {
  function service(status: DesignationStatus, changed: boolean) {
    const requested: string[] = [];
    const svc = new VisibilityConfigService({
      emFactory: () => ({}) as never,
      commandBus: { run: async () => ({ changed }) as never },
      currencies: () => ({ listActive: async () => [{ code: 'PLN' }] }) as never,
      roles: () => ({}) as never,
      permissions: () => ({}) as never,
      prices: () => ({ designationStatus: async () => status }) as never,
      flagsScheduler: {
        requestCurrencyRebuild: async (code) => {
          requested.push(code);
        },
      },
    });
    return { svc, requested };
  }
  const BODY = { priceListId: '11111111-1111-4111-8111-111111111111', salesChannelId: '22222222-2222-4222-8222-222222222222' };
  const IN_FORCE: DesignationStatus = { inForce: true, window: { startsAt: null, endsAt: null } };

  it('set and clear each request the currency', async () => {
    const { svc, requested } = service(IN_FORCE, true);
    await svc.setDesignation('PLN', BODY);
    await svc.clearDesignation('PLN');
    expect(requested).toEqual(['PLN', 'PLN']);
  });

  it('a draft book is accepted and still rebuilds', async () => {
    const { svc, requested } = service({ inForce: false, reason: 'not_active', window: null }, true);
    await svc.setDesignation('PLN', BODY);
    expect(requested).toEqual(['PLN']);
  });

  it('a refused book and an unchanged designation request nothing', async () => {
    const refused = service({ inForce: false, reason: 'not_on_channel', window: null }, true);
    await expect(refused.svc.setDesignation('PLN', BODY)).rejects.toMatchObject({ statusCode: 422, code: 'DESIGNATION_INVALID' });
    expect(refused.requested).toEqual([]);
    const unchanged = service(IN_FORCE, false);
    await unchanged.svc.setDesignation('PLN', BODY);
    await unchanged.svc.clearDesignation('PLN');
    expect(unchanged.requested).toEqual([]);
  });
});
