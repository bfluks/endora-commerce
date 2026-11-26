import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  attachRuleBySql,
  clearWebsiteRules,
  createChannel,
  isMember,
  membershipAudit,
  membershipPort,
  recordMembershipEvents,
} from './website-rule-fixtures.js';

/**
 * Spec 193 T066 [real DB] — the website rule's membership governor, composed: `governs` reads
 * `website_rule_attachments` on the mutation's own manager, and since #1926 a writer handed a
 * manager with an open transaction **enlists** in it (audit via `recordWithin`, cache drop after
 * the scope, events buffered by the scope). A governed refusal or skip therefore has to leave
 * nothing behind in the caller's transaction: no bridge row, no audit row, no event — and an
 * ungoverned write beside it follows the transaction's own outcome.
 */
describe('website rule membership governor (spec 193, T066)', () => {
  let h: BackendServerHandle;
  let governed: string;
  let free: string;
  let rule: { ruleId: string; name: string };
  const product = SEED_PRODUCT_101_ID;

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    governed = await createChannel(h, 'gov');
    free = await createChannel(h, 'free');
    rule = await attachRuleBySql(h, [governed], 'Priced in PLN <b>');
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  /** One caller transaction inside an EventBus scope, as a Command or a worker batch runs it. */
  function inCallerTransaction<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return h.eventBus.run(() => h.orm.em.fork().transactional((em) => work(em as EntityManager)));
  }

  it('a governed refusal inside an enlisted transaction rolls the whole transaction back cleanly', async () => {
    const recorder = recordMembershipEvents(h);
    try {
      const attempt = inCallerTransaction(async (em) => {
        const first = await membershipPort(h).addToChannel(free, 'product', product, { em });
        expect(first.changed).toBe(true);
        await membershipPort(h).addToChannel(governed, 'product', product, { em, onGoverned: 'refuse' });
      });
      await expect(attempt).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED,
      });
      expect(await isMember(h, free, product)).toBe(false);
      expect(await isMember(h, governed, product)).toBe(false);
      expect(await membershipAudit(h, free, product)).toEqual([]);
      expect(await membershipAudit(h, governed, product)).toEqual([]);
      expect(recorder.events).toEqual([]);
    } finally {
      recorder.stop();
    }
  });

  it('names the rule as text in the refusal', async () => {
    const attempt = inCallerTransaction((em) => membershipPort(h).addToChannel(governed, 'product', product, { em, onGoverned: 'refuse' }));
    const error = (await attempt.catch((e: unknown) => e)) as { message: string; details?: unknown };
    expect(error.message).toContain(rule.name);
    expect(error.details).toMatchObject({ channelId: governed, rule: rule.name });
  });

  it('a refusal caught inside the transaction leaves the transaction usable and writes nothing for the governed pair', async () => {
    const recorder = recordMembershipEvents(h);
    try {
      await inCallerTransaction(async (em) => {
        await membershipPort(h)
          .addToChannel(governed, 'product', product, { em, onGoverned: 'refuse' })
          .then(
            () => expect.unreachable('a governed manual write must be refused'),
            () => undefined,
          );
        await membershipPort(h).addToChannel(free, 'product', product, { em });
      });
      expect(await isMember(h, free, product)).toBe(true);
      expect(await isMember(h, governed, product)).toBe(false);
      expect(await membershipAudit(h, free, product)).toHaveLength(1);
      expect(await membershipAudit(h, governed, product)).toEqual([]);
      expect(recorder.events).toEqual([{ channelId: free, entityId: product, op: 'add' }]);
    } finally {
      recorder.stop();
      await h.orm.em.fork().getConnection().execute(`delete from "sales_channel_products" where "sales_channel_id" = ?`, [free]);
    }
  });

  it('a skip inside the transaction writes nothing for the governed pair and lists it; the rest commits', async () => {
    const recorder = recordMembershipEvents(h);
    try {
      const results = await inCallerTransaction(async (em) => [
        await membershipPort(h).addToChannel(governed, 'product', product, { em }),
        await membershipPort(h).addToChannel(free, 'product', product, { em }),
      ]);
      expect(results[0]).toEqual({ changed: false, skippedGovernedChannelIds: [governed] });
      expect(results[1]).toEqual({ changed: true });
      expect(await isMember(h, governed, product)).toBe(false);
      expect(await membershipAudit(h, governed, product)).toEqual([]);
      expect(recorder.events).toEqual([{ channelId: free, entityId: product, op: 'add' }]);
    } finally {
      recorder.stop();
      await h.orm.em.fork().getConnection().execute(`delete from "sales_channel_products" where "sales_channel_id" = ?`, [free]);
    }
  });

  it('reads the attachment inside the caller’s transaction: an attach made in it governs the next write in it', async () => {
    const other = await createChannel(h, 'gov-tx');
    const results = await inCallerTransaction(async (em) => {
      await em
        .getConnection()
        .execute(
          `insert into "website_rule_attachments" ("sales_channel_id", "product_rule_id", "attached_at", "applied_rule_version") values (?, ?, now(), 1)`,
          [other, rule.ruleId],
          'run',
          em.getTransactionContext(),
        );
      return membershipPort(h).addToChannel(other, 'product', product, { em });
    });
    expect(results).toEqual({ changed: false, skippedGovernedChannelIds: [other] });
    expect(await isMember(h, other, product)).toBe(false);
  });

  it('governs products only: another entity type on a governed channel is written as before', async () => {
    const category = await h.orm.em
      .fork()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "categories" order by "id" limit 1`);
    if (category.length === 0) return;
    const result = await membershipPort(h).addToChannel(governed, 'category', category[0]!.id);
    expect(result.skippedGovernedChannelIds).toBeUndefined();
  });

  it('keeps the write token out of the container (TM-10)', () => {
    const names = Object.keys((h.container as unknown as { registrations: Record<string, unknown> }).registrations);
    expect(names.filter((n) => /token/i.test(n) && /governor|website|visibility/i.test(n))).toEqual([]);
    expect(names.filter((n) => /governor/i.test(n))).toEqual(['salesChannelMembershipGovernors']);
  });

  it('contributes a registration facade, not the registry: only `register` is reachable (TM-10)', () => {
    const contributed = (h.container.cradle as unknown as Record<string, object>)['salesChannelMembershipGovernors']!;
    expect(Object.keys(contributed)).toEqual(['register']);
    expect(Object.isFrozen(contributed)).toBe(true);
    for (const name of ['seal', 'tokenModule', 'governing', 'governsType']) expect(name in contributed).toBe(false);
  });
});
