import { describe, expect, it } from 'vitest';
import { availabilityCondition, audienceCaseSql } from './product-availability.sql.js';

/**
 * Feature 163 (T032) — the shape of `availabilityCondition`: a description with
 * one placeholder per bound value, in order, and no value spliced into the text.
 * Its meaning is held to the rule by `availability-parity.test.ts` [PG].
 */

const membership = {
  entityIdsInChannelSubquery: (channelId: string) => ({
    sql: 'select product_id from sales_channel_products where sales_channel_id = ?',
    params: [channelId],
  }),
};
const NOW = new Date('2031-06-15T12:00:00.000Z');
const CHANNEL = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

const placeholders = (sql: string): number => (sql.match(/\?/g) ?? []).length;

describe('availabilityCondition', () => {
  it('binds membership, channel, channel, language, now, now, then the audience — one `?` each', () => {
    const condition = availabilityCondition(
      {
        channelId: CHANNEL,
        languageCode: 'de-DE',
        channelLanguages: ['pl-PL', 'de-DE'],
        audience: { organizationId: ORG, authenticated: true },
        now: NOW,
      },
      membership,
    );
    const sql = condition.sql('p0');
    expect(condition.params).toEqual([
      CHANNEL,
      CHANNEL,
      CHANNEL,
      'de-DE',
      NOW.toISOString(),
      NOW.toISOString(),
      JSON.stringify([ORG]),
    ]);
    expect(placeholders(sql)).toBe(condition.params.length);
    expect(sql).not.toContain(CHANNEL);
    expect(sql).not.toContain(ORG);
    expect(sql).toContain('p0.deleted_at is null and p0.archived_at is null');
    expect(sql).toContain("coalesce(cl.status, c.status, ap.status) = 'active'");
  });

  it('an anonymous audience binds no organisation and never matches an allow-list', () => {
    const condition = availabilityCondition(
      {
        channelId: CHANNEL,
        languageCode: 'pl-PL',
        channelLanguages: ['pl-PL'],
        audience: { organizationId: null, authenticated: false },
        now: NOW,
      },
      membership,
    );
    expect(placeholders(condition.sql('p'))).toBe(condition.params.length);
    expect(condition.params).toHaveLength(6);
  });

  it('a language the channel does not offer matches nothing, without reading a row', () => {
    const condition = availabilityCondition(
      {
        channelId: CHANNEL,
        languageCode: 'fr-FR',
        channelLanguages: ['pl-PL', 'de-DE'],
        audience: { organizationId: null, authenticated: false },
        now: NOW,
      },
      membership,
    );
    expect(condition.sql('p')).toBe('false');
    expect(condition.params).toEqual([]);
  });
});

describe('audienceCaseSql', () => {
  it('follows isProductVisibleTo branch for branch', () => {
    const { sql, params } = audienceCaseSql('v', 'a', { organizationId: ORG, authenticated: true });
    expect(sql).toBe(
      "(case when (case when jsonb_typeof(a) = 'array' then jsonb_array_length(a) else 0 end) > 0 " +
        "then a @> ?::jsonb when v = 'organization_restricted' then false " +
        "when v = 'logged_in_only' then true else true end)",
    );
    expect(params).toEqual([JSON.stringify([ORG])]);
  });
});
