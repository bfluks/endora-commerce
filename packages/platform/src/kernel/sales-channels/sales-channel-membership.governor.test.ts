import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { EventBus } from '../../events/bus.js';
import type { AuditPort } from '../ports/audit.js';
import { ChannelBridgeRegistry } from './channel-bridge-registry.js';
import {
  ChannelMembershipGovernorRegistry,
  type ChannelMembershipGovernor,
  type GovernorWriteToken,
} from './membership-governors.js';
import { SalesChannelMembershipService } from './sales-channel-membership.service.js';

/**
 * The membership
 * governor inside the kernel's single membership mutator.
 *
 * A module contributes a governor for a channel; the service **skips** a governed (channel,
 * product) pair by default, **refuses** it when the caller says the write is manual
 * (`onGoverned: 'refuse'`), and applies it only with the governing module's own write token.
 * The at-least-one-channel floor is waived for a token write and for a request that named a
 * governed channel which was skipped; every other last-channel removal is still refused.
 */

const DEFAULT = 'ch-default';
const A = 'ch-a';
const G = 'ch-governed';
const P = 'p1';
const RULE = 'Flagged and priced';

function fakeEm(rows: Map<string, Set<string>>): EntityManager {
  const setOf = (entityId: string): Set<string> => {
    let set = rows.get(entityId);
    if (!set) {
      set = new Set();
      rows.set(entityId, set);
    }
    return set;
  };
  const connection = {
    async execute(sql: string, params: string[]): Promise<unknown> {
      if (sql.startsWith('select "id" from "sales_channels"')) return [{ id: DEFAULT }];
      if (sql.startsWith('select count(*)')) return [{ count: String(setOf(params[0]!).size) }];
      if (sql.startsWith('select 1 as present')) return setOf(params[1]!).has(params[0]!) ? [{ present: 1 }] : [];
      if (sql.startsWith('select "sales_channel_id"')) {
        return [...setOf(params[0]!)].sort().map((id) => ({ sales_channel_id: id }));
      }
      if (sql.startsWith('insert into')) {
        const [channelId, entityId] = params as [string, string];
        const set = setOf(entityId);
        const isNew = !set.has(channelId);
        set.add(channelId);
        return isNew ? [{ entity_id: entityId }] : [];
      }
      if (sql.startsWith('delete from') && sql.includes('"sales_channel_id" = ?')) {
        setOf(params[1]!).delete(params[0]!);
        return [];
      }
      if (sql.startsWith('delete from')) {
        const removed = [...setOf(params[0]!)];
        rows.set(params[0]!, new Set());
        return removed.map((id) => ({ sales_channel_id: id }));
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  const em = {
    getConnection: () => connection,
    getTransactionContext: () => undefined,
    transactional: async <T>(work: (tx: EntityManager) => Promise<T>): Promise<T> => work(em),
    find: async () => [],
  } as unknown as EntityManager;
  return em;
}

interface Harness {
  service: SalesChannelMembershipService;
  registry: ChannelMembershipGovernorRegistry;
  rows: Map<string, Set<string>>;
  audits: Array<Record<string, unknown>>;
  events: string[];
  token: GovernorWriteToken;
  present: Set<string>;
  governedIds: Set<string>;
}

function harness(
  initial: Record<string, string[]> = {},
  governor: Partial<ChannelMembershipGovernor> = {},
  governed: readonly string[] = [G],
): Harness {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, new Set(v)]));
  const audits: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const present = new Set(['product_visibility_rules']);
  const governedIds = new Set(governed);
  const bridges = new ChannelBridgeRegistry();
  bridges.register({ entityType: 'product', table: 'sales_channel_products', entityIdColumn: 'product_id' });
  bridges.register({ entityType: 'organization', table: 'sales_channel_organizations', entityIdColumn: 'organization_id' });
  const registry = new ChannelMembershipGovernorRegistry({ isPresent: (id) => present.has(id) });
  const token = registry.register({
    moduleId: 'product_visibility_rules',
    entityTypes: ['product'],
    governs: async (_em, channelId) => (governedIds.has(channelId) ? { ruleLabel: RULE } : null),
    ...governor,
  });
  registry.seal();
  const audit = { record: async (entry: { stateAfter: Record<string, unknown> }) => void audits.push(entry.stateAfter) } as unknown as AuditPort;
  const eventBus = {
    emit: (_name: string, payload: { channelId: string; entityId: string; op: string }) =>
      void events.push(`${payload.op}:${payload.channelId}:${payload.entityId}`),
  } as unknown as EventBus;
  const service = new SalesChannelMembershipService(() => fakeEm(rows), eventBus, audit, bridges, undefined, registry);
  return { service, registry, rows, audits, events, token, present, governedIds };
}

const channelsOf = (h: Harness, id = P): string[] => [...(h.rows.get(id) ?? [])].sort();

async function refusal(work: Promise<unknown>): Promise<{ statusCode: number; code: string; message: string; details: unknown }> {
  try {
    await work;
  } catch (error) {
    return error as never;
  }
  throw new Error('expected the write to be refused');
}

describe('membership governor — addToChannel', () => {
  it('ungoverned: applied as today', async () => {
    const h = harness({ [P]: [DEFAULT] });
    expect(await h.service.addToChannel(A, 'product', P)).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([A, DEFAULT]);
  });

  it('governed, default: skipped, the result names the channel, nothing written', async () => {
    const h = harness({ [P]: [DEFAULT] });
    expect(await h.service.addToChannel(G, 'product', P)).toEqual({ changed: false, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([DEFAULT]);
    expect(h.audits).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('governed, refuse: 409 CHANNEL_MEMBERSHIP_GOVERNED naming the rule, nothing written', async () => {
    const h = harness({ [P]: [DEFAULT] });
    const error = await refusal(h.service.addToChannel(G, 'product', P, { onGoverned: 'refuse' }));
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(error.message).toContain(RULE);
    expect(error.details).toEqual({ channelId: G, rule: RULE });
    expect(channelsOf(h)).toEqual([DEFAULT]);
  });

  it('governed, with the governor token: applied, audited with the source', async () => {
    const h = harness({ [P]: [DEFAULT] });
    const result = await h.service.addToChannel(G, 'product', P, { governorToken: h.token, source: 'website_rule:r1' });
    expect(result).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([DEFAULT, G]);
    expect(h.audits).toEqual([{ channelId: G, entityType: 'product', entityId: P, op: 'add', source: 'website_rule:r1' }]);
  });

  it('TM-10: a structurally identical token not issued by the registry is rejected', async () => {
    const h = harness({ [P]: [DEFAULT] });
    const forged = { ...(h.token as object) } as GovernorWriteToken;
    expect(await h.service.addToChannel(G, 'product', P, { governorToken: forged })).toEqual({
      changed: false,
      skippedGovernedChannelIds: [G],
    });
    const error = await refusal(h.service.addToChannel(G, 'product', P, { governorToken: forged, onGoverned: 'refuse' }));
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(channelsOf(h)).toEqual([DEFAULT]);
  });

  it('TM-10: a caller-supplied source without the token is ignored in the audit row', async () => {
    const h = harness({ [P]: [DEFAULT] });
    await h.service.addToChannel(A, 'product', P, { source: 'website_rule:forged' });
    expect(h.audits).toEqual([{ channelId: A, entityType: 'product', entityId: P, op: 'add' }]);
  });

  it('a token write on an ungoverned channel is applied as an ordinary write, without the source', async () => {
    const h = harness({ [P]: [DEFAULT] });
    await h.service.addToChannel(A, 'product', P, { governorToken: h.token, source: 'website_rule:r1' });
    expect(h.audits).toEqual([{ channelId: A, entityType: 'product', entityId: P, op: 'add' }]);
  });

  it('TM-10: governs() throwing refuses the write, never "not governed"', async () => {
    const h = harness({ [P]: [DEFAULT] }, {
      governs: async () => {
        throw new Error('attachments unreadable');
      },
    });
    await expect(h.service.addToChannel(A, 'product', P)).rejects.toThrow('attachments unreadable');
    expect(channelsOf(h)).toEqual([DEFAULT]);
  });

  it('the governor of an absent module is ignored', async () => {
    const h = harness({ [P]: [DEFAULT] });
    h.present.clear();
    expect(await h.service.addToChannel(G, 'product', P, { onGoverned: 'refuse' })).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([DEFAULT, G]);
  });

  it('entity types the governor does not declare are untouched', async () => {
    const h = harness({ org: [DEFAULT] });
    expect(await h.service.addToChannel(G, 'organization', 'org', { onGoverned: 'refuse' })).toEqual({ changed: true });
    expect(channelsOf(h, 'org')).toEqual([DEFAULT, G]);
  });
});

describe('membership governor — removeFromChannel', () => {
  it('ungoverned: applied; the last channel is still refused (floor kept)', async () => {
    const h = harness({ [P]: [A, DEFAULT] });
    expect(await h.service.removeFromChannel(A, 'product', P)).toEqual({ changed: true });
    const error = await refusal(h.service.removeFromChannel(DEFAULT, 'product', P));
    expect(error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
  });

  it('governed, default: skipped', async () => {
    const h = harness({ [P]: [A, G] });
    expect(await h.service.removeFromChannel(G, 'product', P)).toEqual({ changed: false, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([A, G]);
  });

  it('governed, refuse: 409', async () => {
    const h = harness({ [P]: [A, G] });
    const error = await refusal(h.service.removeFromChannel(G, 'product', P, { onGoverned: 'refuse' }));
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(channelsOf(h)).toEqual([A, G]);
  });

  it('governed, token: removed — even the last channel, with no fallback (floor waived)', async () => {
    const h = harness({ [P]: [G] });
    const result = await h.service.removeFromChannel(G, 'product', P, { governorToken: h.token, fallbackToDefault: true, source: 'website_rule:r1' });
    expect(result).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([]);
    expect(h.audits).toEqual([{ channelId: G, entityType: 'product', entityId: P, op: 'remove', source: 'website_rule:r1' }]);
  });

  it('the fallback onto a governed default counts as no fallback: the last channel is refused', async () => {
    const h = harness({ [P]: [A] }, {}, [DEFAULT]);
    const error = await refusal(h.service.removeFromChannel(A, 'product', P, { fallbackToDefault: true }));
    expect(error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
    expect(channelsOf(h)).toEqual([A]);
  });
});

describe('membership governor — bindToDefaultIfEmpty', () => {
  it('ungoverned default: bound', async () => {
    const h = harness();
    expect(await h.service.bindToDefaultIfEmpty('product', P)).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([DEFAULT]);
  });

  it('governed default: binds nothing — the product stays on no channel until admitted', async () => {
    const h = harness({}, {}, [DEFAULT]);
    expect(await h.service.bindToDefaultIfEmpty('product', P)).toEqual({ changed: false, skippedGovernedChannelIds: [DEFAULT] });
    expect(channelsOf(h)).toEqual([]);
  });

  it('governed default, refuse: 409', async () => {
    const h = harness({}, {}, [DEFAULT]);
    const error = await refusal(h.service.bindToDefaultIfEmpty('product', P, { onGoverned: 'refuse' }));
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
  });

  it('governed default, token: bound', async () => {
    const h = harness({}, {}, [DEFAULT]);
    expect(await h.service.bindToDefaultIfEmpty('product', P, { governorToken: h.token })).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([DEFAULT]);
  });
});

describe('membership governor — copyMemberships', () => {
  it('copies the ungoverned channels and skips the governed one', async () => {
    const h = harness({ src: [A, G], [P]: [] });
    expect(await h.service.copyMemberships('product', 'src', P)).toEqual({ copied: 1, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([A]);
  });

  it('refuse: 409 before anything is copied', async () => {
    const h = harness({ src: [A, G], [P]: [] });
    const error = await refusal(h.service.copyMemberships('product', 'src', P, { onGoverned: 'refuse' }));
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(channelsOf(h)).toEqual([]);
  });

  it('token: copies the governed one too', async () => {
    const h = harness({ src: [A, G], [P]: [] });
    expect(await h.service.copyMemberships('product', 'src', P, { governorToken: h.token })).toEqual({ copied: 2 });
    expect(channelsOf(h)).toEqual([A, G]);
  });

  it('ungoverned: as today', async () => {
    const h = harness({ src: [A, DEFAULT], [P]: [] });
    expect(await h.service.copyMemberships('product', 'src', P)).toEqual({ copied: 2 });
  });
});

describe('membership governor — replaceChannelsForEntity', () => {
  it('ungoverned: replaced as today', async () => {
    const h = harness({ [P]: [DEFAULT] });
    expect(await h.service.replaceChannelsForEntity('product', P, [A])).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([A]);
  });

  it('keeps governed rows as they are and replaces the rest', async () => {
    const h = harness({ [P]: [DEFAULT, G] });
    expect(await h.service.replaceChannelsForEntity('product', P, [A])).toEqual({ changed: true, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([A, G]);
    expect(h.events.sort()).toEqual([`add:${A}:${P}`, `remove:${DEFAULT}:${P}`]);
  });

  it('a desired governed channel is not added', async () => {
    const h = harness({ [P]: [DEFAULT] });
    expect(await h.service.replaceChannelsForEntity('product', P, [A, G])).toEqual({ changed: true, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([A]);
  });

  it('a connector create naming only its governed channel ends on no channel (floor waived)', async () => {
    const h = harness({ [P]: [DEFAULT] });
    expect(await h.service.replaceChannelsForEntity('product', P, [G])).toEqual({ changed: true, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([]);
  });

  it('nothing to change except governed pairs: unchanged, the skip reported', async () => {
    const h = harness({ [P]: [A] });
    expect(await h.service.replaceChannelsForEntity('product', P, [A, G])).toEqual({ changed: false, skippedGovernedChannelIds: [G] });
    expect(channelsOf(h)).toEqual([A]);
  });

  it('refuse: 409 when a governed pair would change, nothing written', async () => {
    const h = harness({ [P]: [DEFAULT, G] });
    const error = await refusal(h.service.replaceChannelsForEntity('product', P, [A], { onGoverned: 'refuse' }));
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(channelsOf(h)).toEqual([DEFAULT, G]);
  });

  it('refuse: a governed pair kept as it is is no refusal', async () => {
    const h = harness({ [P]: [DEFAULT, G] });
    expect(await h.service.replaceChannelsForEntity('product', P, [A, G], { onGoverned: 'refuse' })).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([A, G]);
  });

  it('token: governed pairs follow the desired set', async () => {
    const h = harness({ [P]: [DEFAULT, G] });
    expect(await h.service.replaceChannelsForEntity('product', P, [A], { governorToken: h.token })).toEqual({ changed: true });
    expect(channelsOf(h)).toEqual([A]);
  });
});

describe('membership governor — clearChannelsForEntity', () => {
  it('a product still cannot be cleared, governed or not', async () => {
    const h = harness({ [P]: [G] });
    const error = await refusal(h.service.clearChannelsForEntity('product', P));
    expect(error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
  });
});

describe('governor registry (TM-10)', () => {
  const governor = (moduleId = 'm1'): ChannelMembershipGovernor => ({ moduleId, entityTypes: ['product'], governs: async () => null });

  it('a second governor for one module id throws', () => {
    const registry = new ChannelMembershipGovernorRegistry();
    registry.register(governor());
    expect(() => registry.register(governor())).toThrow(/already/);
  });

  it('registration after boot (sealed) throws', () => {
    const registry = new ChannelMembershipGovernorRegistry();
    registry.seal();
    expect(() => registry.register(governor())).toThrow(/sealed/);
  });

  it('issues a distinct, frozen token per governor', () => {
    const registry = new ChannelMembershipGovernorRegistry();
    const t1 = registry.register(governor('m1'));
    const t2 = registry.register(governor('m2'));
    expect(t1).not.toBe(t2);
    expect(Object.isFrozen(t1)).toBe(true);
  });

  it("one module's token does not write a channel another module governs", async () => {
    const rows = new Map([[P, new Set([DEFAULT])]]);
    const bridges = new ChannelBridgeRegistry();
    bridges.register({ entityType: 'product', table: 'sales_channel_products', entityIdColumn: 'product_id' });
    const registry = new ChannelMembershipGovernorRegistry();
    const other = registry.register(governor('other'));
    registry.register({ moduleId: 'owner', entityTypes: ['product'], governs: async (_em, id) => (id === G ? { ruleLabel: RULE } : null) });
    registry.seal();
    const service = new SalesChannelMembershipService(() => fakeEm(rows), { emit: () => undefined } as unknown as EventBus, undefined, bridges, undefined, registry);
    expect(await service.addToChannel(G, 'product', P, { governorToken: other })).toEqual({ changed: false, skippedGovernedChannelIds: [G] });
  });
});

describe('isGoverned — the read a caller asks before a write it does not route through the mutator', () => {
  it('names the rule of a governed channel and answers null for an ungoverned one', async () => {
    const h = harness();
    await expect(h.service.isGoverned('product', G)).resolves.toEqual({ ruleLabel: RULE });
    await expect(h.service.isGoverned('product', A)).resolves.toBeNull();
  });

  it('answers null for an entity type no governor declares', async () => {
    const h = harness();
    await expect(h.service.isGoverned('organization', G)).resolves.toBeNull();
  });

  it('answers null while the governing module is absent (FR-073)', async () => {
    const h = harness();
    h.present.clear();
    await expect(h.service.isGoverned('product', G)).resolves.toBeNull();
  });

  it('propagates a governor that throws — never "not governed" (TM-10)', async () => {
    const h = harness({}, { governs: async () => Promise.reject(new Error('attachments unreadable')) });
    await expect(h.service.isGoverned('product', G)).rejects.toThrow('attachments unreadable');
  });

  it('asks on the caller’s manager when one is given', async () => {
    const seen: EntityManager[] = [];
    const h = harness({}, { governs: async (em) => (seen.push(em), null) });
    const em = fakeEm(new Map());
    await h.service.isGoverned('product', G, { em });
    expect(seen).toEqual([em]);
  });

  it('answers null on a composition with no governors at all', async () => {
    const bridges = new ChannelBridgeRegistry();
    const service = new SalesChannelMembershipService(() => fakeEm(new Map()), {} as EventBus, undefined, bridges);
    await expect(service.isGoverned('product', G)).resolves.toBeNull();
  });
});

/**
 * A governed write that enlists in the caller's open transaction (issue #1926): the token write
 * records its audit on the caller's manager and defers the access-cache drop to the enclosing
 * scope; a refused or skipped pair leaves nothing behind. Organization pairs, because the access
 * cache is only ever dropped for an Organization.
 */
describe('membership governor — enlisted in the caller’s transaction', () => {
  const ORG = 'org-1';

  function enlisted(initial: Record<string, string[]> = {}) {
    const rows = new Map(Object.entries(initial).map(([k, v]) => [k, new Set(v)]));
    const log: string[] = [];
    const deferred: Array<() => Promise<void>> = [];
    const bridges = new ChannelBridgeRegistry();
    bridges.register({ entityType: 'organization', table: 'sales_channel_organizations', entityIdColumn: 'organization_id' });
    const registry = new ChannelMembershipGovernorRegistry();
    const token = registry.register({
      moduleId: 'governing_module',
      entityTypes: ['organization'],
      governs: async (_em, channelId) => (channelId === G ? { ruleLabel: RULE } : null),
    });
    registry.seal();
    const callerEm = { ...fakeEm(rows), isInTransaction: () => true } as unknown as EntityManager;
    const audit = {
      record: async () => void log.push('audit:own'),
      recordWithin: (em: EntityManager, entry: { stateAfter: { source?: string } }) =>
        void log.push(`audit:within:${em === callerEm ? 'caller' : 'other'}:${entry.stateAfter.source ?? '-'}`),
    } as unknown as AuditPort;
    const eventBus = {
      emit: (name: string) => void log.push(`emit:${name}`),
      afterScope: async (work: () => Promise<void>) => {
        log.push('afterScope');
        deferred.push(work);
      },
    } as unknown as EventBus;
    const cache = {
      invalidateAfterWrite: async (id: string) => (log.push(`drop:${id}`), 1),
      invalidateAllAfterWrite: async () => 1,
    };
    const service = new SalesChannelMembershipService(() => fakeEm(rows), eventBus, audit, bridges, cache, registry);
    return { service, rows, log, deferred, token, callerEm };
  }

  it('a token write records audit through recordWithin and defers the cache drop through afterScope', async () => {
    const h = enlisted({ [ORG]: [DEFAULT] });
    const result = await h.service.addToChannel(G, 'organization', ORG, { em: h.callerEm, governorToken: h.token, source: 'rule:1' });
    expect(result).toEqual({ changed: true });
    expect(h.log).toEqual(['audit:within:caller:rule:1', 'afterScope', 'emit:sales_channels.membership_changed']);
    expect(h.deferred).toHaveLength(1);
    await h.deferred[0]!();
    expect(h.log.at(-1)).toBe(`drop:${ORG}`);
  });

  it('a token removal records audit through recordWithin and defers the cache drop through afterScope', async () => {
    const h = enlisted({ [ORG]: [DEFAULT, G] });
    expect(await h.service.removeFromChannel(G, 'organization', ORG, { em: h.callerEm, governorToken: h.token })).toEqual({ changed: true });
    expect(h.log).toEqual(['audit:within:caller:-', 'afterScope', 'emit:sales_channels.membership_changed']);
    await h.deferred[0]!();
    expect(h.log.at(-1)).toBe(`drop:${ORG}`);
  });

  it('a refusal leaves no audit, no cache drop and no event', async () => {
    const h = enlisted({ [ORG]: [DEFAULT] });
    const error = await refusal(h.service.addToChannel(G, 'organization', ORG, { em: h.callerEm, onGoverned: 'refuse' }));
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(h.log).toEqual([]);
    expect(h.deferred).toEqual([]);
    expect([...h.rows.get(ORG)!]).toEqual([DEFAULT]);
  });

  it('a skip-only call reports changed: false, with no audit and no drop', async () => {
    const h = enlisted({ [ORG]: [DEFAULT, G] });
    expect(await h.service.addToChannel(G, 'organization', 'org-2', { em: h.callerEm })).toEqual({ changed: false, skippedGovernedChannelIds: [G] });
    expect(await h.service.removeFromChannel(G, 'organization', ORG, { em: h.callerEm })).toEqual({ changed: false, skippedGovernedChannelIds: [G] });
    expect(h.log).toEqual([]);
    expect(h.deferred).toEqual([]);
  });
});

/**
 * The container holds a facade, never the registry (TM-10): every module can resolve the cradle,
 * so `seal`, `tokenModule` and `governing` must not be reachable from it.
 */
describe('the registration facade a composition contributes', () => {
  it('exposes only `register`, frozen, and registers into the registry', async () => {
    const registry = new ChannelMembershipGovernorRegistry();
    const port = registry.registrationPort();
    expect(Object.keys(port)).toEqual(['register']);
    expect(Object.isFrozen(port)).toBe(true);
    for (const name of ['seal', 'tokenModule', 'governing', 'governsType', 'isSealed']) expect(name in port).toBe(false);
    const token = port.register({ moduleId: 'm', entityTypes: ['product'], governs: async () => ({ ruleLabel: RULE }) });
    expect(registry.tokenModule(token)).toBe('m');
    expect(registry.registrationPort()).toBe(port);
    registry.seal();
    expect(() => port.register({ moduleId: 'late', entityTypes: ['product'], governs: async () => null })).toThrow(/sealed/);
  });
});
