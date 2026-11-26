import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord, ProductRuleDefinition } from '@endora-commerce/contracts';
import { ProductRuleGovernance, type ProductRuleGovernanceDeps } from './product-rule-governance.js';

/**
 * (FR-055; contracts/ports.md §2) — `productRuleGovernancePort`, the read a
 * connector asks to avoid writing against a website rule. The owner-off answer (503
 * `MODULE_DISABLED`) is the `providePort` gate's, asserted against the composed module in
 * `off-state.website-rule.test.ts`.
 */
const G = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const DEF: ProductRuleDefinition = { match: 'all', conditions: [{ kind: 'attribute_boolean', attributeKey: 'featured', value: true }] };

function product(id: string, overrides: Partial<CatalogProductRecord> = {}): CatalogProductRecord {
  return { id, status: 'active', archivedAt: null, deletedAt: null, attributeValues: {}, ...overrides } as CatalogProductRecord;
}

function deps(overrides: Partial<ProductRuleGovernanceDeps> = {}): ProductRuleGovernanceDeps {
  return {
    rules: {
      governedChannels: async () => [{ salesChannelId: G, productRuleId: 'r1', productRuleName: 'Featured', definition: DEF }],
      governingFor: async (channelId) => (channelId === G ? { salesChannelId: G, productRuleId: 'r1', productRuleName: 'Featured', definition: DEF } : null),
      meetsRule: async (channelId, ids) => (channelId === G ? new Map(ids.map((id) => [id, id === P1])) : null),
    },
    membership: () => ({ filterEntityIdsInChannel: async (_c, _t, ids) => ids.filter((id) => id === P1) }),
    products: () => ({
      findByIds: async (ids) => ids.map((id) => (id === P3 ? product(id, { status: 'inactive' }) : product(id))),
    }),
    ...overrides,
  };
}

describe('ProductRuleGovernance (FR-055)', () => {
  it('governedChannels names each governed channel and its rule', async () => {
    const port = new ProductRuleGovernance(deps());
    expect(await port.governedChannels()).toEqual([{ salesChannelId: G, productRuleId: 'r1', productRuleName: 'Featured' }]);
  });

  it('meetsRule answers per product, and null for a channel no rule governs', async () => {
    const port = new ProductRuleGovernance(deps());
    expect(await port.meetsRule(G, [P1, P2])).toEqual(new Map([[P1, true], [P2, false]]));
    expect(await port.meetsRule(U, [P1])).toBeNull();
  });

  describe('excludedOnlyByRule (FR-090, FR-091; R-18)', () => {
    it('is all false on a channel no rule governs', async () => {
      const port = new ProductRuleGovernance(deps({ channelStatuses: async () => new Map() }));
      expect(await port.excludedOnlyByRule(U, [{ productId: P2 }])).toEqual([false]);
    });

    it('is true only for a live non-member whose stored channel status is not inactive', async () => {
      const port = new ProductRuleGovernance(
        deps({ channelStatuses: async (_c, ids) => new Map(ids.map((id) => [id, id === P2 ? null : 'inactive'] as const)) }),
      );
      // P1 is a member; P2 a live non-member with no stored status; P3 inactive.
      expect(await port.excludedOnlyByRule(G, [{ productId: P1 }, { productId: P2 }, { productId: P3 }])).toEqual([false, true, false]);
    });

    it('a stored channel status of inactive keeps it false', async () => {
      const port = new ProductRuleGovernance(deps({ channelStatuses: async (_c, ids) => new Map(ids.map((id) => [id, 'inactive'] as const)) }));
      expect(await port.excludedOnlyByRule(G, [{ productId: P2 }])).toEqual([false]);
    });

    it('fails closed (all false) while no reader of the stored channel status is composed', async () => {
      const port = new ProductRuleGovernance(deps());
      expect(await port.excludedOnlyByRule(G, [{ productId: P2 }])).toEqual([false]);
    });
  });
});
