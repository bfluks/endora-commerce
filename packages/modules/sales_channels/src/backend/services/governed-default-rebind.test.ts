import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type DictionaryValidator, type SalesChannelAttributionRegistryPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannelsService } from './sales-channels.service.js';

/**
 * A channel delete that would rebind product orphans onto the system default asks the kernel's
 * membership port whether that default is governed first (FR-059, R-10). The guard fails closed:
 * a composition without the port refuses rather than rebinding past a rule it cannot see, and
 * the refusal names the rule but never counts the orphans, which may include products the
 * caller cannot see (FR-082).
 */

const DEFAULT_ID = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

function serviceWith(membership?: Pick<SalesChannelMembershipPort, 'isGoverned'>): SalesChannelsService {
  return new SalesChannelsService(
    () => ({}) as EntityManager,
    { emit: () => undefined } as unknown as EventBus,
    {} as DictionaryValidator,
    {} as SalesChannelAttributionRegistryPort,
    { tableFor: () => undefined } as never,
    {} as CommandBus,
    undefined,
    undefined,
    undefined,
    undefined,
    membership,
  );
}

const refuse = (service: SalesChannelsService, orphans: Array<{ entityType: string }>): Promise<void> =>
  service['refuseRebindOntoGovernedDefault']({} as EntityManager, DEFAULT_ID, orphans);

describe('the rebind of product orphans onto a governed default', () => {
  it('fails closed when the membership port is not composed and products would be rebound', async () => {
    await expect(refuse(serviceWith(), [{ entityType: 'product' }])).rejects.toThrow(/membership port/);
  });

  it('asks nothing when no product would be rebound', async () => {
    await expect(refuse(serviceWith(), [{ entityType: 'category' }])).resolves.toBeUndefined();
  });

  it('refuses a governed default naming the rule, with no count in the details or the sentence', async () => {
    const membership = { isGoverned: async () => ({ ruleLabel: 'Priced' }) };
    const error = (await refuse(serviceWith(membership), [{ entityType: 'product' }, { entityType: 'product' }]).catch((e: unknown) => e)) as {
      statusCode: number;
      code: string;
      message: string;
      details: unknown;
    };
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
    expect(error.details).toEqual({ code: 'default_channel_governed', entityType: 'product', rule: 'Priced' });
    expect(error.message).not.toMatch(/\b2\b/);
  });

  it('lets the rebind through when the default is not governed', async () => {
    const membership = { isGoverned: async () => null };
    await expect(refuse(serviceWith(membership), [{ entityType: 'product' }])).resolves.toBeUndefined();
  });
});
