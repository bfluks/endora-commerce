import { describe, expect, it } from 'vitest';
import {
  scopeOverviewResponseSchema,
  type ProductChannelLanguageScopeRecord,
  type ProductChannelScopeRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { buildScopeOverview, ScopeOverviewService, type ScopeOverviewInput } from './scope-overview.service.js';

/**
 * Feature 163, Phase 9 (T069) — the pure core of `GET …/products/:id/scope-overview`
 * (`contracts/admin-scopes-api.md` §3; US4, FR-015, FR-041).
 *
 * `buildScopeOverview` takes the rows the service read and answers the matrix:
 * channels × languages, each cell's effective status and its source, the fields
 * overridden at the cell, the channel row and the language column, and every orphaned
 * override with the reason it is ignored. Phase 11 (T080a, FR-041): every evaluable
 * cell carries `missing`, the completeness check the gate uses.
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';
const GONE = '00000000-0000-4000-8000-0000000000c9';
const NOW = new Date('2026-10-25T12:00:00.000Z');

function channelRow(over: Partial<ProductChannelScopeRecord> = {}): ProductChannelScopeRecord {
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

function languageRow(over: Partial<ProductChannelLanguageScopeRecord> = {}): ProductChannelLanguageScopeRecord {
  return { productId: P, channelId: B2B, languageCode: 'de-DE', status: 'inactive', ...over };
}

function input(over: Partial<ScopeOverviewInput> = {}): ScopeOverviewInput {
  return {
    product: {
      status: 'active',
      archivedAt: null,
      window: { from: null, until: null },
      name: { 'pl-PL': 'Wiertarka' },
      description: { 'pl-PL': 'Opis' },
      attributeValues: {},
      slug: 'wiertarka',
    },
    requiredLanguageAttributes: [],
    channels: [
      { id: B2B, name: { 'en-US': 'B2B' }, languages: ['pl-PL', 'de-DE'], isMember: true },
      { id: B2C, name: { 'en-US': 'B2C' }, languages: ['pl-PL', 'en-GB'], isMember: true },
    ],
    channelRows: [],
    languageRows: [],
    valueOverrides: [],
    urlKeys: [],
    attributeScopes: new Map(),
    primaryLanguage: 'pl-PL',
    platformLanguages: ['pl-PL', 'en-GB', 'de-DE', 'fr-FR'],
    now: NOW,
    ...over,
  };
}

function cell(overview: ReturnType<typeof buildScopeOverview>, channelId: string, languageCode: string) {
  const found = overview.cells.find((c) => c.channelId === channelId && c.languageCode === languageCode);
  if (!found) throw new Error(`no cell ${channelId} × ${languageCode}`);
  return found;
}

describe('buildScopeOverview (spec 163, T069)', () => {
  it('answers the §3 shape: every channel × the union of its languages, missing on evaluable cells only', () => {
    const overview = buildScopeOverview(input());
    expect(() => scopeOverviewResponseSchema.parse({ data: overview })).not.toThrow();
    expect(overview.languages).toEqual(['de-DE', 'en-GB', 'pl-PL']);
    expect(overview.channels.map((c) => c.channelId)).toEqual([B2B, B2C]);
    expect(overview.cells).toHaveLength(6);
    expect(cell(overview, B2B, 'en-GB')).not.toHaveProperty('missing');
    expect(cell(overview, B2C, 'de-DE')).not.toHaveProperty('missing');
    expect(cell(overview, B2B, 'pl-PL')).toMatchObject({
      available: true,
      effectiveStatus: 'active',
      statusSource: 'global',
      overriddenFields: [],
    });
    expect(overview.orphans).toEqual([]);
  });

  it('T080a: missing is what the gate would report, whatever the status (FR-041)', () => {
    const overview = buildScopeOverview(
      input({
        languageRows: [languageRow({ channelId: B2B, languageCode: 'de-DE', status: 'inactive' })],
        requiredLanguageAttributes: ['material'],
        attributeScopes: new Map([['material', { channelScoped: true, languageScoped: true }]]),
        product: { ...input().product, attributeValues: { material: { 'pl-PL': 'stal' } } },
      }),
    );
    // Off at (B2B, de-DE), and still evaluated: name and material are missing there.
    expect(cell(overview, B2B, 'de-DE').missing).toEqual(['name', 'attribute:material']);
    expect(cell(overview, B2B, 'pl-PL').missing).toEqual([]);
    expect(cell(overview, B2C, 'en-GB').missing).toEqual(['name', 'attribute:material']);
  });

  it('T080a: a non-member channel’s cells carry no missing', () => {
    const overview = buildScopeOverview(
      input({
        channels: [
          ...input().channels,
          { id: GONE, name: { 'en-US': 'Gone' }, languages: ['pl-PL'], isMember: false },
        ],
      }),
    );
    expect(cell(overview, GONE, 'pl-PL')).not.toHaveProperty('missing');
  });

  it('a cell whose language the channel does not offer is never available and carries no overrides', () => {
    const overview = buildScopeOverview(input());
    expect(cell(overview, B2B, 'en-GB')).toMatchObject({ available: false, overriddenFields: [] });
    expect(cell(overview, B2C, 'de-DE')).toMatchObject({ available: false, overriddenFields: [] });
  });

  it('names the status source per cell: channel × language, channel, global (US4 #1)', () => {
    const overview = buildScopeOverview(
      input({
        channelRows: [channelRow({ status: 'inactive' })],
        languageRows: [languageRow({ languageCode: 'de-DE', status: 'active' })],
      }),
    );
    expect(cell(overview, B2B, 'de-DE')).toMatchObject({
      effectiveStatus: 'active',
      statusSource: 'channel_language',
      available: true,
    });
    expect(cell(overview, B2B, 'pl-PL')).toMatchObject({
      effectiveStatus: 'inactive',
      statusSource: 'channel',
      available: false,
    });
    expect(cell(overview, B2C, 'pl-PL')).toMatchObject({ effectiveStatus: 'active', statusSource: 'global' });
    expect(cell(overview, B2B, 'de-DE').overriddenFields).toContainEqual({ field: 'status', level: 'channel_language' });
    expect(cell(overview, B2B, 'pl-PL').overriddenFields).toContainEqual({ field: 'status', level: 'channel' });
  });

  it('is unavailable outside the effective window and when archived, whatever the status', () => {
    const closed = buildScopeOverview(
      input({ channelRows: [channelRow({ window: { from: new Date('2027-01-01T00:00:00Z'), until: null } })] }),
    );
    expect(cell(closed, B2B, 'pl-PL')).toMatchObject({ effectiveStatus: 'active', available: false });
    expect(cell(closed, B2C, 'pl-PL')).toMatchObject({ available: true });

    const archived = buildScopeOverview(
      input({ product: { ...input().product, archivedAt: new Date('2026-01-01T00:00:00Z') } }),
    );
    for (const c of archived.cells) expect(c.available).toBe(false);
  });

  it('marks fields at the cell, the channel row and the language column, each once at the level that wins', () => {
    const overview = buildScopeOverview(
      input({
        product: {
          ...input().product,
          name: { 'pl-PL': 'Wiertarka', 'de-DE': 'Bohrmaschine' },
          attributeValues: { color: { 'pl-PL': 'czerwony', 'en-GB': 'red' } },
        },
        channelRows: [
          channelRow({
            window: { from: null, until: null },
            audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] },
            minOrderQuantity: 5,
            returnable: false,
          }),
        ],
        valueOverrides: [
          { attributeKey: 'name', channelId: B2B, languageCode: 'pl-PL', value: { v: 'Wiertarka B2B' } },
          { attributeKey: 'description', channelId: B2B, languageCode: null, value: { v: 'Opis B2B' } },
          { attributeKey: 'name', channelId: B2B, languageCode: null, value: { v: 'Shadowed in pl-PL' } },
          { attributeKey: 'color', channelId: B2C, languageCode: 'en-GB', value: { v: 'scarlet' } },
          { attributeKey: 'name', channelId: B2C, languageCode: 'pl-PL', value: { v: '' } },
        ],
        urlKeys: [
          { languageCode: 'de-DE', salesChannelId: null },
          { languageCode: 'pl-PL', salesChannelId: B2C },
        ],
        attributeScopes: new Map([['color', { channelScoped: true, languageScoped: true }]]),
      }),
    );

    expect(cell(overview, B2B, 'pl-PL').overriddenFields).toEqual(
      expect.arrayContaining([
        { field: 'name', level: 'channel_language' },
        { field: 'description', level: 'channel' },
        { field: 'window', level: 'channel' },
        { field: 'audience', level: 'channel' },
        { field: 'minOrderQuantity', level: 'channel' },
        { field: 'returnable', level: 'channel' },
      ]),
    );
    expect(cell(overview, B2B, 'pl-PL').overriddenFields.filter((f) => f.field === 'name')).toHaveLength(1);
    // The channel-only name wins in de-DE over the language value.
    expect(cell(overview, B2B, 'de-DE').overriddenFields).toContainEqual({ field: 'name', level: 'channel' });
    expect(cell(overview, B2B, 'de-DE').overriddenFields).toContainEqual({ field: 'urlKey', level: 'language' });
    expect(cell(overview, B2C, 'en-GB').overriddenFields).toEqual(
      expect.arrayContaining([{ field: 'attribute:color', level: 'channel_language' }]),
    );
    expect(cell(overview, B2C, 'pl-PL').overriddenFields).toEqual([{ field: 'urlKey', level: 'channel_language' }]);

    expect(overview.channelRows).toEqual([
      {
        channelId: B2B,
        overriddenFields: ['window', 'audience', 'minOrderQuantity', 'returnable', 'name', 'description'],
      },
      { channelId: B2C, overriddenFields: [] },
    ]);
    // The default language's value is the global one; every other language's is a language override.
    expect(overview.languageColumns).toEqual([
      { languageCode: 'de-DE', overriddenFields: ['name', 'urlKey'] },
      { languageCode: 'en-GB', overriddenFields: ['attribute:color'] },
      { languageCode: 'pl-PL', overriddenFields: [] },
    ]);
  });

  it('lists orphans: non-member channel, language no longer offered, attribute scope narrowed (FR-015)', () => {
    const overview = buildScopeOverview(
      input({
        channels: [
          { id: B2B, name: { 'en-US': 'B2B' }, languages: ['pl-PL', 'de-DE'], isMember: true },
          { id: GONE, name: { 'en-US': 'Gone' }, languages: ['pl-PL'], isMember: false },
        ],
        channelRows: [channelRow({ channelId: GONE, status: 'inactive', returnable: true })],
        languageRows: [
          languageRow({ channelId: B2B, languageCode: 'fr-FR' }),
          languageRow({ channelId: GONE, languageCode: 'pl-PL' }),
        ],
        valueOverrides: [
          { attributeKey: 'name', channelId: GONE, languageCode: 'pl-PL', value: { v: 'x' } },
          { attributeKey: 'name', channelId: B2B, languageCode: 'fr-FR', value: { v: 'x' } },
          { attributeKey: 'color', channelId: B2B, languageCode: null, value: { v: 'red' } },
          { attributeKey: 'size', channelId: B2B, languageCode: 'pl-PL', value: { v: 'L' } },
          { attributeKey: 'deleted_attr', channelId: B2B, languageCode: null, value: { v: 1 } },
        ],
        urlKeys: [
          { languageCode: 'fr-FR', salesChannelId: B2B },
          { languageCode: 'pl-PL', salesChannelId: GONE },
        ],
        attributeScopes: new Map([
          ['color', { channelScoped: false, languageScoped: false }],
          ['size', { channelScoped: true, languageScoped: false }],
        ]),
      }),
    );
    expect(overview.orphans).toEqual(
      expect.arrayContaining([
        { field: 'status', channelId: GONE, languageCode: null, reason: 'not_a_member' },
        { field: 'returnable', channelId: GONE, languageCode: null, reason: 'not_a_member' },
        { field: 'status', channelId: GONE, languageCode: 'pl-PL', reason: 'not_a_member' },
        { field: 'status', channelId: B2B, languageCode: 'fr-FR', reason: 'language_not_offered' },
        { field: 'name', channelId: GONE, languageCode: 'pl-PL', reason: 'not_a_member' },
        { field: 'name', channelId: B2B, languageCode: 'fr-FR', reason: 'language_not_offered' },
        { field: 'attribute:color', channelId: B2B, languageCode: null, reason: 'attribute_scope_changed' },
        { field: 'attribute:size', channelId: B2B, languageCode: 'pl-PL', reason: 'attribute_scope_changed' },
        { field: 'attribute:deleted_attr', channelId: B2B, languageCode: null, reason: 'attribute_scope_changed' },
        { field: 'urlKey', channelId: B2B, languageCode: 'fr-FR', reason: 'language_not_offered' },
        { field: 'urlKey', channelId: GONE, languageCode: 'pl-PL', reason: 'not_a_member' },
      ]),
    );
    expect(overview.orphans).toHaveLength(11);
    // Orphans never mark a cell; the non-member channel's cells are not available.
    for (const c of overview.cells) {
      expect(c.overriddenFields.map((f) => f.field)).not.toContain('attribute:color');
      expect(c.overriddenFields.map((f) => f.field)).not.toContain('attribute:size');
    }
    expect(cell(overview, GONE, 'pl-PL')).toMatchObject({
      available: false,
      effectiveStatus: 'active',
      statusSource: 'global',
      overriddenFields: [],
    });
    expect(overview.channelRows.find((r) => r.channelId === GONE)).toEqual({ channelId: GONE, overriddenFields: [] });
    // The languages axis is the member channels' union.
    expect(overview.languages).toEqual(['de-DE', 'pl-PL']);
  });

  it('a language URL key whose channel id the ORM hydrates as undefined is a language key, never an orphan', () => {
    // MikroORM answers a NULL `sales_channel_id` as `undefined` on `ProductUrlKey`
    // (163 ci-pg, 829ce2995): an orphan with no channel id broke the §3 schema.
    const overview = buildScopeOverview(
      input({ urlKeys: [{ languageCode: 'de-DE', salesChannelId: undefined as unknown as null }] }),
    );
    expect(overview.orphans).toEqual([]);
    expect(overview.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual(['urlKey']);
    expect(() => scopeOverviewResponseSchema.parse({ data: overview })).not.toThrow();
  });

  it('a product in no channel offers the global and language scopes only (US4 #4)', () => {
    const overview = buildScopeOverview(
      input({
        channels: [],
        product: { ...input().product, name: { 'pl-PL': 'Wiertarka', 'fr-FR': 'Perceuse' } },
        urlKeys: [{ languageCode: 'en-GB', salesChannelId: null }],
      }),
    );
    expect(overview.channels).toEqual([]);
    expect(overview.cells).toEqual([]);
    expect(overview.channelRows).toEqual([]);
    expect(overview.languages).toEqual(['de-DE', 'en-GB', 'fr-FR', 'pl-PL']);
    expect(overview.languageColumns).toEqual([
      { languageCode: 'de-DE', overriddenFields: [] },
      { languageCode: 'en-GB', overriddenFields: ['urlKey'] },
      { languageCode: 'fr-FR', overriddenFields: ['name'] },
      { languageCode: 'pl-PL', overriddenFields: [] },
    ]);
  });
});

describe('buildScopeOverview — media and SEO scopes (spec 163, T134b, T118c)', () => {
  it('lists gallery role / hidden overrides on the channel row and alt text on the language column (FR-041)', () => {
    const overview = buildScopeOverview(
      input({
        scopedFields: [
          { field: 'media:roles', channelId: B2B, languageCode: null },
          { field: 'media:hidden', channelId: B2B, languageCode: null },
          { field: 'media:altText', channelId: null, languageCode: 'de-de' },
        ],
      }),
    );
    expect(overview.channelRows.find((r) => r.channelId === B2B)?.overriddenFields).toEqual([
      'media:hidden',
      'media:roles',
    ]);
    expect(overview.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual([
      'media:altText',
    ]);
    expect(cell(overview, B2B, 'de-DE').overriddenFields).toEqual([
      { field: 'media:altText', level: 'language' },
      { field: 'media:hidden', level: 'channel' },
      { field: 'media:roles', level: 'channel' },
    ]);
    expect(cell(overview, B2C, 'pl-PL').overriddenFields).toEqual([]);
  });

  it('lists attachment and packaging-unit overrides at their levels, beside the media ones (T139b)', () => {
    const overview = buildScopeOverview(
      input({
        scopedFields: [
          { field: 'attachments:hidden', channelId: B2C, languageCode: null },
          { field: 'attachments:name', channelId: null, languageCode: 'pl-PL' },
          { field: 'attachments:description', channelId: null, languageCode: 'pl-PL' },
          { field: 'packagingUnits:name', channelId: null, languageCode: 'de-de' },
          { field: 'media:hidden', channelId: B2C, languageCode: null },
        ],
      }),
    );
    expect(overview.channelRows.find((r) => r.channelId === B2C)?.overriddenFields).toEqual([
      'attachments:hidden',
      'media:hidden',
    ]);
    expect(overview.languageColumns.find((c) => c.languageCode === 'pl-PL')?.overriddenFields).toEqual([
      'attachments:description',
      'attachments:name',
    ]);
    expect(overview.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual([
      'packagingUnits:name',
    ]);
    expect(cell(overview, B2C, 'pl-PL').overriddenFields).toEqual([
      { field: 'attachments:description', level: 'language' },
      { field: 'attachments:hidden', level: 'channel' },
      { field: 'attachments:name', level: 'language' },
      { field: 'media:hidden', level: 'channel' },
    ]);
  });

  it('lists an SEO override at L, C and C × L, each at its level, after every other field', () => {
    const overview = buildScopeOverview(
      input({
        scopedFields: [
          { field: 'seo:title', channelId: null, languageCode: 'pl-PL' },
          { field: 'seo:description', channelId: B2C, languageCode: null },
          { field: 'seo:title', channelId: B2C, languageCode: 'en-gb' },
          { field: 'media:roles', channelId: B2C, languageCode: null },
        ],
      }),
    );
    expect(cell(overview, B2C, 'en-GB').overriddenFields).toEqual([
      { field: 'media:roles', level: 'channel' },
      { field: 'seo:description', level: 'channel' },
      { field: 'seo:title', level: 'channel_language' },
    ]);
    expect(cell(overview, B2C, 'pl-PL').overriddenFields).toEqual([
      { field: 'media:roles', level: 'channel' },
      { field: 'seo:description', level: 'channel' },
      { field: 'seo:title', level: 'language' },
    ]);
    expect(cell(overview, B2B, 'de-DE').overriddenFields).toEqual([]);
  });

  it('lists a channel or channel × language override the resolution ignores as an orphan (FR-015)', () => {
    const overview = buildScopeOverview(
      input({
        channels: [
          { id: B2B, name: { 'en-US': 'B2B' }, languages: ['pl-PL', 'de-DE'], isMember: true },
          { id: GONE, name: { 'en-US': 'Gone' }, languages: ['pl-PL'], isMember: false },
        ],
        scopedFields: [
          { field: 'media:hidden', channelId: GONE, languageCode: null },
          { field: 'seo:title', channelId: B2B, languageCode: 'fr-FR' },
        ],
      }),
    );
    expect(overview.orphans).toEqual([
      { field: 'media:hidden', channelId: GONE, languageCode: null, reason: 'not_a_member' },
      { field: 'seo:title', channelId: B2B, languageCode: 'fr-FR', reason: 'language_not_offered' },
    ]);
    expect(overview.cells.flatMap((c) => c.overriddenFields)).toEqual([]);
  });

  it('with no scoped field (seo off, no media override) the overview is unchanged', () => {
    expect(buildScopeOverview(input({ scopedFields: [] }))).toEqual(buildScopeOverview(input()));
  });
});

describe('ScopeOverviewService.read (spec 163, T069)', () => {
  it('answers PRODUCT_NOT_FOUND for an absent or soft-deleted product', async () => {
    const em = { findOne: async () => null };
    const service = new ScopeOverviewService(
      () => em as never,
      { listChannelsForEntity: async () => [] } as never,
      { listActive: async () => [], getDefault: async () => null } as never,
      { listAll: async () => [] } as never,
    );
    await expect(service.read(P)).rejects.toBeInstanceOf(HttpError);
    await expect(service.read(P)).rejects.toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
  });
});
