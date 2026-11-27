import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  ChannelMembershipGovernor,
  ChannelMembershipGovernorRegistryPort,
  GovernorWriteToken,
} from '@endora-commerce/platform/kernel';
import { WebsiteRuleGovernorHandle, websiteRuleMembershipGovernor } from './membership-governor.js';

/**
 * The website rule's channel-membership governor and the holder of
 * its write token.
 */
const CHANNEL = '0b7d4a52-2f0e-4c47-9a0e-7a2b3c4d5e6f';
const TX = { tx: 'caller-transaction' };

function emReturning(rows: unknown[] | Error): { em: EntityManager; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const em = {
    getConnection: () => ({ execute }),
    getTransactionContext: () => TX,
    findOne: vi.fn(),
    find: vi.fn(),
  } as unknown as EntityManager;
  return { em, execute };
}

describe('websiteRuleMembershipGovernor', () => {
  const governor = websiteRuleMembershipGovernor();

  it('governs products only, as product_visibility_rules', () => {
    expect(governor.moduleId).toBe('product_visibility_rules');
    expect(governor.entityTypes).toEqual(['product']);
  });

  it('names the attached rule of a governed channel', async () => {
    const { em, execute } = emReturning([{ name: 'Priced in PLN' }]);
    await expect(governor.governs(em, CHANNEL)).resolves.toEqual({ ruleLabel: 'Priced in PLN' });
    const [sql, params] = execute.mock.calls[0]!;
    expect(sql).toMatch(/website_rule_attachments/);
    expect(sql).toMatch(/product_rules/);
    expect(params).toEqual([CHANNEL]);
  });

  it('answers null for a channel with no attachment', async () => {
    const { em } = emReturning([]);
    await expect(governor.governs(em, CHANNEL)).resolves.toBeNull();
  });

  it('reads on the mutation’s own manager and inside its transaction, never through the unit of work', async () => {
    const { em, execute } = emReturning([]);
    await governor.governs(em, CHANNEL);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![2]).toBe('all');
    expect(execute.mock.calls[0]![3]).toBe(TX);
    expect((em as unknown as { findOne: ReturnType<typeof vi.fn> }).findOne).not.toHaveBeenCalled();
    expect((em as unknown as { find: ReturnType<typeof vi.fn> }).find).not.toHaveBeenCalled();
  });

  it('is asked every time — no cache, so an attach is effective on the next write (R-10 d)', async () => {
    const { em, execute } = emReturning([]);
    await governor.governs(em, CHANNEL);
    await governor.governs(em, CHANNEL);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('propagates a failed read: the kernel refuses the write, never reads it as "not governed" (TM-10)', async () => {
    const { em } = emReturning(new Error('connection lost'));
    await expect(governor.governs(em, CHANNEL)).rejects.toThrow('connection lost');
  });

  it('answers null for an id no channel can carry, without a statement that would abort the caller’s transaction', async () => {
    const { em, execute } = emReturning([{ name: 'never' }]);
    await expect(governor.governs(em, 'not-a-uuid')).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('WebsiteRuleGovernorHandle (TM-10)', () => {
  function registry(): { port: ChannelMembershipGovernorRegistryPort; issued: GovernorWriteToken; registered: ChannelMembershipGovernor[] } {
    const issued = Object.freeze(Object.create(null) as object) as GovernorWriteToken;
    const registered: ChannelMembershipGovernor[] = [];
    return {
      issued,
      registered,
      port: {
        register(governor) {
          registered.push(governor);
          return issued;
        },
      },
    };
  }

  it('registers the governor once and keeps exactly the token the registry issued', () => {
    const handle = new WebsiteRuleGovernorHandle();
    const r = registry();
    handle.register(r.port);
    expect(r.registered).toHaveLength(1);
    expect(r.registered[0]!.moduleId).toBe('product_visibility_rules');
    expect(handle.token()).toBe(r.issued);
  });

  it('refuses a second registration', () => {
    const handle = new WebsiteRuleGovernorHandle();
    handle.register(registry().port);
    expect(() => handle.register(registry().port)).toThrow(/already/);
  });

  it('has no token before boot registered it — a write cannot go out unsigned by accident', () => {
    expect(() => new WebsiteRuleGovernorHandle().token()).toThrow(/not registered/);
  });

  it('exposes the token through no enumerable property', () => {
    const handle = new WebsiteRuleGovernorHandle();
    const r = registry();
    handle.register(r.port);
    expect(Object.values(handle)).not.toContain(r.issued);
    expect(JSON.stringify(handle)).toBe('{}');
  });
});
