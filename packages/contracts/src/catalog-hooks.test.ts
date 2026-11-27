import { describe, expect, it } from 'vitest';
import { toHookableActionDeclaration } from './command-hooks.js';
import { CATALOG_HOOKABLE_ACTIONS, productStatusChanges, type ProductStatusFacts } from './catalog-hooks.js';

/** Spec 193 T049 — the catalog writes that can move a product's status, declared hookable. */
describe('CATALOG_HOOKABLE_ACTIONS (spec 193, T049)', () => {
  it('declares the six status writers for beforeCommit', () => {
    expect(Object.values(CATALOG_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'product.update', objectType: 'product', phases: ['beforeCommit'] },
      { action: 'product.restore', objectType: 'product', phases: ['beforeCommit'] },
      { action: 'product.bulk_update.undo', objectType: 'bulk_operation', phases: ['beforeCommit'] },
      { action: 'product.scopes.update', objectType: 'product', phases: ['beforeCommit'] },
      { action: 'product.scoped_values.save', objectType: 'product', phases: ['beforeCommit'] },
      { action: 'product.scoped_values.import', objectType: 'product', phases: ['beforeCommit'] },
    ]);
  });
});

describe('productStatusChanges', () => {
  const P = '00000000-0000-4000-8000-000000000001';
  const CH = '00000000-0000-4000-8000-0000000000c1';
  const facts = (over: Partial<ProductStatusFacts> = {}): ProductStatusFacts => ({
    productId: P,
    status: 'inactive',
    archived: false,
    deleted: false,
    channelStatuses: [],
    ...over,
  });

  it('carries the global before and after, and only the channel cells that moved', () => {
    const before = [facts({ channelStatuses: [{ salesChannelId: CH, languageCode: null, status: 'inactive' }] })];
    const after = [
      facts({
        status: 'active',
        channelStatuses: [
          { salesChannelId: CH, languageCode: null, status: null },
          { salesChannelId: CH, languageCode: 'pl', status: 'active' },
        ],
      }),
    ];
    expect(productStatusChanges(before, after)).toEqual({
      products: [
        {
          productId: P,
          before: { status: 'inactive', archived: false, deleted: false },
          after: { status: 'active', archived: false, deleted: false },
          channelStatuses: [
            { salesChannelId: CH, languageCode: null, before: 'inactive', after: null },
            { salesChannelId: CH, languageCode: 'pl', before: null, after: 'active' },
          ],
        },
      ],
    });
  });

  it('a product that moved nothing is still reported with its state, and an unknown one is null', () => {
    const same = [facts({ status: 'active' })];
    expect(productStatusChanges(same, same).products[0]).toMatchObject({ before: { status: 'active' }, channelStatuses: [] });
    expect(productStatusChanges([], same).products[0]!.before).toBeNull();
  });
});
