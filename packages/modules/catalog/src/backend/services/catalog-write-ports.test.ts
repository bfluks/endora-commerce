import { describe, expect, it } from 'vitest';
import { createCatalogProductScopeWritePort, toScopesPatch } from './catalog-write-ports.js';
import type { ProductScopesService } from './product-scopes.service.js';
import type { UrlKeyService } from './url-key.service.js';

/**
 * Feature 163 (T122, FR-091) — a connector's scoped write becomes the scopes PATCH
 * body with only the scopes it names: one entry per channel, an absent key left
 * absent (untouched), `null` kept (use inherited).
 */
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';

describe('toScopesPatch', () => {
  it('groups by channel and names only what the input names', () => {
    expect(
      toScopesPatch({
        status: [
          { channelId: B2B, languageCode: null, value: 'inactive' },
          { channelId: B2B, languageCode: 'pl-PL', value: null },
        ],
        orderRules: [{ channelId: B2C, returnable: false }],
      }),
    ).toEqual({
      channels: [
        { channelId: B2B, status: 'inactive', languageStatuses: [{ languageCode: 'pl-PL', status: null }] },
        { channelId: B2C, returnable: false },
      ],
    });
  });

  it('maps windows to ISO bounds, the global one to `global`', () => {
    const from = new Date('2026-11-01T00:00:00.000Z');
    expect(
      toScopesPatch({
        window: [
          { channelId: null, value: { from, until: null } },
          { channelId: B2B, value: null },
        ],
        audience: [{ channelId: B2C, value: { visibility: 'public', allowedOrganizationIds: [] } }],
      }),
    ).toEqual({
      channels: [
        { channelId: B2B, window: null },
        { channelId: B2C, audience: { visibility: 'public', allowedOrganizationIds: [] } },
      ],
      global: { publishFrom: '2026-11-01T00:00:00.000Z', publishUntil: null },
    });
  });

  it('is an empty write for an empty input', () => {
    expect(toScopesPatch({})).toEqual({ channels: [] });
  });
});

describe('createCatalogProductScopeWritePort (checkpoint C code review, N2; A-6)', () => {
  it('runs the write alone, with no completeness mode, and reads nothing back', async () => {
    const calls: unknown[][] = [];
    const scopes = {
      writeStatus: async (...args: unknown[]) => {
        calls.push(args);
        return { changedFields: ['scopedStatus'], warnings: [] };
      },
      apply: async () => {
        throw new Error('the port must not read the scopes back');
      },
    } as unknown as ProductScopesService;
    const port = createCatalogProductScopeWritePort(() => scopes, () => ({}) as UrlKeyService);
    await port.applyScopes('p-1', { status: [{ channelId: B2B, languageCode: null, value: 'active' }] }, { source: 'pim' });
    expect(calls).toEqual([['p-1', { channels: [{ channelId: B2B, status: 'active' }] }]]);
  });
});
