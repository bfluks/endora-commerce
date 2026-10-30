import { describe, expect, it } from 'vitest';
import { attributeScopeChangePreviewResponseSchema } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  AttributeScopePreviewService,
  parseScopeChangeQuery,
  slotsOrphanedByScopeChange,
} from './attribute-scope-preview.js';

/**
 * Feature 163, Phase 9 (T071) — the FR-090 preview of an attribute's scope-flag change
 * (`contracts/admin-scopes-api.md` §6, research R27).
 *
 * A row becomes orphaned when the current flags let the resolver read it and the
 * requested ones do not: a channel slot needs `channelScoped`, a channel × language
 * slot needs `languageScoped` as well (`resolveAttribute`). A row the current flags
 * already skip is not counted again, so a widening always reports 0.
 */

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const both = { channelScoped: true, languageScoped: true };
const channelOnly = { channelScoped: true, languageScoped: false };
const languageOnly = { channelScoped: false, languageScoped: true };
const neither = { channelScoped: false, languageScoped: false };

describe('slotsOrphanedByScopeChange (spec 163, FR-090)', () => {
  it('channel + language → global orphans both slots', () => {
    expect(slotsOrphanedByScopeChange(both, neither)).toEqual({ channel: true, channelLanguage: true });
    expect(slotsOrphanedByScopeChange(both, languageOnly)).toEqual({ channel: true, channelLanguage: true });
  });

  it('channel + language → channel only orphans the channel × language slot', () => {
    expect(slotsOrphanedByScopeChange(both, channelOnly)).toEqual({ channel: false, channelLanguage: true });
  });

  it('channel only → not channel-scoped orphans the channel slot; its language rows were already skipped', () => {
    expect(slotsOrphanedByScopeChange(channelOnly, neither)).toEqual({ channel: true, channelLanguage: false });
    expect(slotsOrphanedByScopeChange(channelOnly, languageOnly)).toEqual({ channel: true, channelLanguage: false });
  });

  it('a widening or no change orphans nothing', () => {
    const none = { channel: false, channelLanguage: false };
    for (const [from, to] of [
      [neither, both],
      [neither, channelOnly],
      [channelOnly, both],
      [languageOnly, both],
      [languageOnly, neither],
      [neither, languageOnly],
      [both, both],
      [channelOnly, channelOnly],
    ] as const) {
      expect(slotsOrphanedByScopeChange(from, to)).toEqual(none);
    }
  });
});

describe('parseScopeChangeQuery', () => {
  it('reads "true"/"false"; an absent flag keeps the current one', () => {
    expect(parseScopeChangeQuery({ channelScoped: 'false' }, both)).toEqual(languageOnly);
    expect(parseScopeChangeQuery({}, channelOnly)).toEqual(channelOnly);
    expect(parseScopeChangeQuery({ languageScoped: 'true', channelScoped: 'true' }, neither)).toEqual(both);
  });

  it('refuses anything else with VALIDATION_FAILED', () => {
    expect(() => parseScopeChangeQuery({ channelScoped: 'yes' }, both)).toThrow(HttpError);
    expect(() => parseScopeChangeQuery({ languageScoped: '1' }, both)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'VALIDATION_FAILED' }),
    );
  });
});

describe('AttributeScopePreviewService.preview', () => {
  function service(opts: {
    attribute: { key: string; channelScoped: boolean; languageScoped: boolean } | null;
    rows?: Array<{ channel_id: string; n: string }>;
    sql?: Array<{ sql: string; params: unknown[] }>;
  }) {
    const em = {
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          opts.sql?.push({ sql, params });
          return opts.rows ?? [];
        },
      }),
    };
    return new AttributeScopePreviewService(() => em as never, {
      getByIdOrKey: async () => opts.attribute as never,
    });
  }

  it('answers 404 NOT_FOUND for an unknown attribute or a system one (not a row)', async () => {
    await expect(service({ attribute: null }).preview('name', {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('a widening answers 0 without reading the overrides', async () => {
    const sql: Array<{ sql: string; params: unknown[] }> = [];
    const out = await service({ attribute: { key: 'color', ...channelOnly }, sql }).preview('color', {
      languageScoped: 'true',
    });
    expect(out).toEqual({ orphanedOverrides: 0, byChannel: [] });
    expect(sql).toHaveLength(0);
  });

  it('a narrowing counts per channel and totals', async () => {
    const sql: Array<{ sql: string; params: unknown[] }> = [];
    const out = await service({
      attribute: { key: 'color', ...both },
      rows: [
        { channel_id: C1, n: '3' },
        { channel_id: C2, n: '1' },
      ],
      sql,
    }).preview('color', { languageScoped: 'false' });
    expect(() => attributeScopeChangePreviewResponseSchema.parse({ data: out })).not.toThrow();
    expect(out).toEqual({
      orphanedOverrides: 4,
      byChannel: [
        { channelId: C1, count: 3 },
        { channelId: C2, count: 1 },
      ],
    });
    expect(sql).toHaveLength(1);
    expect(sql[0]!.params).toContain('color');
    expect(sql[0]!.sql).toMatch(/language_code is not null/);
  });
});
