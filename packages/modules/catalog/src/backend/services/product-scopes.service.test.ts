import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ProductChannelScopeRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  nonMemberOrganizationIds,
  planProductScopeWrite,
  type ProductScopeWriteState,
} from './product-scopes.service.js';

/**
 * Feature 162, Phase 4 (T021) — the decision core of `ProductScopesService.apply`:
 * what a `PATCH /admin/catalog/products/:id/scopes` writes, what it refuses, and the
 * audit projection it records (`contracts/admin-scopes-api.md` §2; FR-012–FR-015,
 * FR-030, FR-080, C4).
 *
 * `planProductScopeWrite` is pure: it takes the product's current scope rows and its
 * member channels, and answers the rows to upsert or delete. The service runs it
 * inside the Command's transaction, so a refusal here is a refusal of the whole
 * request with nothing written.
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';
const GONE = '00000000-0000-4000-8000-0000000000c9';
const ORG_A = '00000000-0000-4000-8000-0000000000e1';
const ORG_B = '00000000-0000-4000-8000-0000000000e2';

function state(over: Partial<ProductScopeWriteState> = {}): ProductScopeWriteState {
  return {
    productId: P,
    productType: 'simple',
    globalWindow: { from: null, until: null },
    channelRows: [],
    languageRows: [],
    memberChannels: new Map([
      [B2B, ['pl-PL', 'de-DE']],
      [B2C, ['pl-PL', 'en-GB']],
    ]),
    ...over,
  };
}

function row(over: Partial<ProductChannelScopeRecord> = {}): ProductChannelScopeRecord {
  return {
    productId: P,
    channelId: B2B,
    status: null,
    window: null,
    audience: null,
    minOrderQuantity: null,
    returnable: null,
    ...over,
  };
}

function refusal(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
  throw new Error('expected a refusal');
}

describe('planProductScopeWrite — upsert and inherit (FR-012)', () => {
  it('a channel status creates the channel row', () => {
    const plan = planProductScopeWrite(state(), { channels: [{ channelId: B2B, status: 'draft' }] });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: row({ status: 'draft' }) }]);
    expect(plan.changedFields).toEqual(['scopedStatus']);
  });

  it('an absent key leaves the stored value untouched', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'draft', returnable: false })] }), {
      channels: [{ channelId: B2B, minOrderQuantity: 5 }],
    });
    expect(plan.channelRows).toEqual([
      { channelId: B2B, next: row({ status: 'draft', returnable: false, minOrderQuantity: 5 }) },
    ]);
    expect(plan.changedFields).toEqual(['orderRules']);
  });

  it('null removes one override and keeps the others', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'draft', returnable: false })] }), {
      channels: [{ channelId: B2B, status: null }],
    });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: row({ returnable: false }) }]);
  });

  it('a row whose every field inherits is deleted, never stored empty', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'draft' })] }), {
      channels: [{ channelId: B2B, status: null }],
    });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: null }]);
  });

  it('a language status upserts and null deletes the C×L row', () => {
    const plan = planProductScopeWrite(
      state({ languageRows: [{ productId: P, channelId: B2B, languageCode: 'pl-PL', status: 'draft' }] }),
      {
        channels: [
          {
            channelId: B2B,
            languageStatuses: [
              { languageCode: 'de-DE', status: 'active' },
              { languageCode: 'pl-PL', status: null },
            ],
          },
        ],
      },
    );
    expect(plan.languageRows).toEqual([
      { channelId: B2B, languageCode: 'de-DE', next: 'active' },
      { channelId: B2B, languageCode: 'pl-PL', next: null },
    ]);
    expect(plan.channelRows).toEqual([]);
    expect(plan.changedFields).toEqual(['scopedStatus']);
  });

  it('a language is matched case-insensitively and stored in the channel spelling', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de-de', status: 'active' }] }],
    });
    expect(plan.languageRows).toEqual([{ channelId: B2B, languageCode: 'de-DE', next: 'active' }]);
  });

  it('writing the value already stored changes nothing', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ status: 'draft' })] }), {
      channels: [{ channelId: B2B, status: 'draft' }],
    });
    expect(plan.changedFields).toEqual([]);
  });

  it('a window, an audience and order rules each name their own changed field', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [
        {
          channelId: B2B,
          window: { from: '2026-12-01T00:00:00.000Z', until: null },
          audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] },
          returnable: true,
        },
      ],
    });
    expect([...plan.changedFields].sort()).toEqual(['audience', 'orderRules', 'publicationWindow']);
    expect(plan.channelRows[0]?.next).toEqual(
      row({
        window: { from: new Date('2026-12-01T00:00:00.000Z'), until: null },
        audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] },
        returnable: true,
      }),
    );
  });

  it('an overridden fully-open window is stored as an override, not as inherit', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [{ channelId: B2B, window: { from: null, until: null } }],
    });
    expect(plan.channelRows).toEqual([{ channelId: B2B, next: row({ window: { from: null, until: null } }) }]);
  });
});

describe('planProductScopeWrite — the global window, and FR-013', () => {
  it('a global window change never touches an override', () => {
    const current = state({ channelRows: [row({ status: 'draft' })] });
    const plan = planProductScopeWrite(current, {
      channels: [],
      global: { publishFrom: '2026-12-01T00:00:00.000Z' },
    });
    expect(plan.channelRows).toEqual([]);
    expect(plan.languageRows).toEqual([]);
    expect(plan.globalWindow).toEqual({ from: new Date('2026-12-01T00:00:00.000Z'), until: null });
    expect(plan.changedFields).toEqual(['publicationWindow']);
  });

  it('a partial global window keeps the other bound', () => {
    const plan = planProductScopeWrite(
      state({ globalWindow: { from: new Date('2026-12-01T00:00:00.000Z'), until: null } }),
      { channels: [], global: { publishUntil: '2026-12-31T00:00:00.000Z' } },
    );
    expect(plan.globalWindow).toEqual({
      from: new Date('2026-12-01T00:00:00.000Z'),
      until: new Date('2026-12-31T00:00:00.000Z'),
    });
  });
});

describe('planProductScopeWrite — refusals (FR-014) and their one exception (FR-015)', () => {
  it('a value for a channel the product is not a member of is SCOPE_INVALID not_a_member', () => {
    const err = refusal(() => planProductScopeWrite(state(), { channels: [{ channelId: GONE, status: 'active' }] }));
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.SCOPE_INVALID);
    expect(err.details).toEqual({ channelId: GONE, reason: 'not_a_member' });
  });

  it('a language status in a non-member channel is not_a_member too', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [{ channelId: GONE, languageStatuses: [{ languageCode: 'pl-PL', status: 'active' }] }],
      }),
    );
    expect(err.details).toEqual({ channelId: GONE, reason: 'not_a_member' });
  });

  it('a language the channel does not offer is SCOPE_INVALID language_not_offered, naming it', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'fr-FR', status: 'active' }] }],
      }),
    );
    expect(err.code).toBe(ERROR_CODES.SCOPE_INVALID);
    expect(err.details).toEqual({ channelId: B2B, languageCode: 'fr-FR', reason: 'language_not_offered' });
  });

  it('removing an orphaned channel row is always allowed', () => {
    const plan = planProductScopeWrite(state({ channelRows: [row({ channelId: GONE, status: 'draft' })] }), {
      channels: [{ channelId: GONE, status: null }],
    });
    expect(plan.channelRows).toEqual([{ channelId: GONE, next: null }]);
  });

  it('removing an orphaned language row is always allowed', () => {
    const current = state({
      languageRows: [{ productId: P, channelId: B2B, languageCode: 'fr-FR', status: 'active' }],
    });
    const plan = planProductScopeWrite(current, {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'fr-FR', status: null }] }],
    });
    expect(plan.languageRows).toEqual([{ channelId: B2B, languageCode: 'fr-FR', next: null }]);
  });

  it('a channel window whose start is not before its end is VALIDATION_FAILED, field window', () => {
    for (const until of ['2026-12-01T00:00:00.000Z', '2026-11-30T00:00:00.000Z']) {
      const err = refusal(() =>
        planProductScopeWrite(state(), {
          channels: [{ channelId: B2B, window: { from: '2026-12-01T00:00:00.000Z', until } }],
        }),
      );
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(err.details).toMatchObject({ field: 'window', channelId: B2B });
    }
  });

  it('a global window whose start is not before its end is VALIDATION_FAILED, field window', () => {
    const err = refusal(() =>
      planProductScopeWrite(state({ globalWindow: { from: null, until: new Date('2026-12-01T00:00:00.000Z') } }), {
        channels: [],
        global: { publishFrom: '2026-12-02T00:00:00.000Z' },
      }),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toEqual({ field: 'window' });
  });

  it('a minimum on a product type that takes none is VALIDATION_FAILED, field minOrderQuantity', () => {
    const err = refusal(() =>
      planProductScopeWrite(state({ productType: 'bundle' }), { channels: [{ channelId: B2B, minOrderQuantity: 5 }] }),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toMatchObject({ field: 'minOrderQuantity' });
  });

  it('the same channel named twice is VALIDATION_FAILED, field channels', () => {
    const err = refusal(() =>
      planProductScopeWrite(state(), {
        channels: [
          { channelId: B2B, status: 'draft' },
          { channelId: B2B, status: 'active' },
        ],
      }),
    );
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(err.details).toMatchObject({ field: 'channels' });
  });
});

describe('planProductScopeWrite — audience (C4)', () => {
  it('the override replaces the whole rule; null inherits the whole rule', () => {
    const current = state({
      channelRows: [row({ audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_A] } })],
    });
    const replaced = planProductScopeWrite(current, {
      channels: [
        { channelId: B2B, audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_B] } },
      ],
    });
    expect(replaced.channelRows[0]?.next?.audience).toEqual({
      visibility: 'organization_restricted',
      allowedOrganizationIds: [ORG_B],
    });
    const inherited = planProductScopeWrite(current, { channels: [{ channelId: B2B, audience: null }] });
    expect(inherited.channelRows).toEqual([{ channelId: B2B, next: null }]);
  });

  it('nonMemberOrganizationIds names the organizations the channel does not offer', async () => {
    const membership = {
      filterEntityIdsAvailableInChannel: async (channelId: string, entityType: string, ids: readonly string[]) => {
        expect(channelId).toBe(B2B);
        expect(entityType).toBe('organization');
        return ids.filter((id) => id === ORG_A);
      },
    };
    expect(await nonMemberOrganizationIds(membership, B2B, [ORG_A, ORG_B])).toEqual([ORG_B]);
    expect(await nonMemberOrganizationIds(membership, B2B, [])).toEqual([]);
  });
});

describe('planProductScopeWrite — the audit projection (FR-080, Q-D → A)', () => {
  it('before and after hold every touched row completely, in the request shape', () => {
    const current = state({
      channelRows: [row({ status: 'draft', returnable: false })],
      languageRows: [{ productId: P, channelId: B2B, languageCode: 'de-DE', status: 'inactive' }],
      globalWindow: { from: null, until: new Date('2027-01-01T00:00:00.000Z') },
    });
    const plan = planProductScopeWrite(current, {
      channels: [
        { channelId: B2B, status: 'active', languageStatuses: [{ languageCode: 'de-DE', status: null }] },
        { channelId: B2C, minOrderQuantity: 3 },
      ],
      global: { publishFrom: '2026-12-01T00:00:00.000Z' },
    });
    expect(plan.before).toEqual({
      channels: [
        {
          channelId: B2B,
          status: 'draft',
          window: null,
          audience: null,
          minOrderQuantity: null,
          returnable: false,
          languageStatuses: [{ languageCode: 'de-DE', status: 'inactive' }],
        },
        {
          channelId: B2C,
          status: null,
          window: null,
          audience: null,
          minOrderQuantity: null,
          returnable: null,
          languageStatuses: [],
        },
      ],
      global: { publishFrom: null, publishUntil: '2027-01-01T00:00:00.000Z' },
    });
    expect(plan.after).toEqual({
      channels: [
        {
          channelId: B2B,
          status: 'active',
          window: null,
          audience: null,
          minOrderQuantity: null,
          returnable: false,
          languageStatuses: [{ languageCode: 'de-DE', status: null }],
        },
        {
          channelId: B2C,
          status: null,
          window: null,
          audience: null,
          minOrderQuantity: 3,
          returnable: null,
          languageStatuses: [],
        },
      ],
      global: { publishFrom: '2026-12-01T00:00:00.000Z', publishUntil: '2027-01-01T00:00:00.000Z' },
    });
  });

  it('re-applying before restores the rows the write replaced', () => {
    const current = state({ channelRows: [row({ status: 'draft', returnable: false })] });
    const forward = planProductScopeWrite(current, { channels: [{ channelId: B2B, status: 'active', returnable: null }] });
    const afterState = state({
      channelRows: forward.channelRows.flatMap((r) => (r.next ? [r.next] : [])),
    });
    const back = planProductScopeWrite(afterState, forward.before as never);
    expect(back.channelRows).toEqual([{ channelId: B2B, next: row({ status: 'draft', returnable: false }) }]);
  });

  it('a channel touched only through its languages records only the language rows', () => {
    const plan = planProductScopeWrite(state(), {
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] }],
    });
    expect(plan.before).toEqual({
      channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de-DE', status: null }] }],
    });
  });
});
