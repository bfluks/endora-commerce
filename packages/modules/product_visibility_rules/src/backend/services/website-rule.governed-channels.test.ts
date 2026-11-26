import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ProductRuleDefinition } from '@endora-commerce/contracts';
import { WebsiteRuleService, type WebsiteRuleServiceDeps } from './website-rule.service.js';

/**
 * Which channels a website rule governs is read once per call: the attachments in one statement,
 * the channels they name resolved in one batch (`listAll`), not one `getById` per attachment. A
 * question about one channel reads that channel's attachment and resolves that channel only.
 * An attachment whose channel no longer resolves governs nothing.
 */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const DEF: ProductRuleDefinition = { match: 'all', conditions: [{ kind: 'attribute_boolean', attributeKey: 'featured', value: true }] };

function harness() {
  const attachments = [A, B, GONE].map((id, i) => ({ sales_channel_id: id, product_rule_id: `r${i}`, name: `Rule ${i}`, definition: DEF }));
  const calls: string[] = [];
  const em = {
    fork: () => em,
    getConnection: () => ({
      execute: async (_sql: string, params: unknown[] = []) => {
        calls.push('sql');
        return params.length > 0 ? attachments.filter((a) => a.sales_channel_id === params[0]) : attachments;
      },
    }),
  } as unknown as EntityManager;
  const live = new Set([A, B]);
  const channels = {
    getById: async (id: string) => (calls.push(`getById:${id}`), live.has(id) ? ({ id } as never) : null),
    listAll: async () => (calls.push('listAll'), [...live].map((id) => ({ id }) as never)),
  };
  const service = new WebsiteRuleService({ emFactory: () => em, channels: () => channels } as unknown as WebsiteRuleServiceDeps);
  return { service, calls };
}

describe('WebsiteRuleService — governed channels resolved in one batch', () => {
  it('governedChannels: one statement and one listAll, whatever the number of attachments', async () => {
    const h = harness();
    const governed = await h.service.governedChannels();
    expect(governed.map((g) => g.salesChannelId)).toEqual([A, B]);
    expect(governed[0]).toEqual({ salesChannelId: A, productRuleId: 'r0', productRuleName: 'Rule 0', definition: DEF });
    expect(h.calls).toEqual(['sql', 'listAll']);
  });

  it('governingFor: the one channel asked about, resolved alone', async () => {
    const h = harness();
    expect(await h.service.governingFor(B)).toEqual({ salesChannelId: B, productRuleId: 'r1', productRuleName: 'Rule 1', definition: DEF });
    expect(h.calls).toEqual(['sql', `getById:${B}`]);
  });

  it('governingFor: null for a deleted channel, an ungoverned one, and a non-uuid id', async () => {
    const h = harness();
    expect(await h.service.governingFor(GONE)).toBeNull();
    expect(await h.service.governingFor('44444444-4444-4444-8444-444444444444')).toBeNull();
    expect(await h.service.governingFor('not-a-uuid')).toBeNull();
  });
});
