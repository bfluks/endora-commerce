import { describe, expect, it } from 'vitest';
import { effectiveAttributeSql, effectiveTextSql } from './effective-value.sql.js';

/**
 * Feature 163 (T060) — the shape of the effective-value expressions: one
 * placeholder per bound value, the values in placeholder order, and nothing
 * spliced into the text. Their meaning is held to #384's walk by
 * `effective-text-parity.test.ts` [PG].
 */

const CHANNEL = '11111111-1111-4111-8111-111111111111';
const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

describe('effectiveTextSql', () => {
  it.each([[['pl-PL']], [['pl-PL', 'en-US', 'en']], [['de-DE', 'pl-PL', 'en-US', 'en']]])(
    'binds exactly its placeholders for the chain %j',
    (languages) => {
      const e = effectiveTextSql('name', { channelId: CHANNEL, languages });
      const sql = e.sql('p0');
      expect(placeholders(sql)).toBe(e.params.length);
      expect(sql).not.toContain(CHANNEL);
      expect(sql).toContain('p0.name');
      expect(sql).toContain('product_value_overrides');
      // The overrides sub-select binds last: the attribute, then the channel.
      expect(e.params.slice(-2)).toEqual(['name', CHANNEL]);
    },
  );

  it('renders the same params whatever the alias', () => {
    const e = effectiveTextSql('description', { channelId: CHANNEL, languages: ['pl-PL', 'en'] });
    expect(placeholders(e.sql('x'))).toBe(placeholders(e.sql('p0')));
  });
});

describe('effectiveAttributeSql', () => {
  it.each([
    [{ channelScoped: true, languageScoped: true }],
    [{ channelScoped: true, languageScoped: false }],
    [{ channelScoped: false, languageScoped: false }],
  ])('binds exactly its placeholders for scope %j', (scope) => {
    const e = effectiveAttributeSql('color', scope, { channelId: CHANNEL, languages: ['pl-PL', 'en-US'] });
    const sql = e.sql('p0');
    expect(placeholders(sql)).toBe(e.params.length);
    expect(sql).not.toContain("'color'");
  });

  it('is the baseline alone for an attribute that is not channel-scoped', () => {
    const e = effectiveAttributeSql('color', { channelScoped: false, languageScoped: true }, { channelId: CHANNEL, languages: ['pl-PL'] });
    expect(e.sql('p0')).toBe('(p0.attribute_values -> ?::text)');
    expect(e.params).toEqual(['color']);
  });
});

describe('the emptiness test of a jsonb value', () => {
  it('never reads a missing key (SQL NULL) as non-empty', () => {
    // A simple `case jsonb_typeof(x)` over a NULL `x` matches no `when`; an
    // `else true` there made every absent override slot answer the walk.
    const sql = effectiveTextSql('name', { channelId: CHANNEL, languages: ['pl-PL', 'en-US'] }).sql('p0');
    expect(sql).not.toMatch(/else true end, false\)/);
    expect(sql).toContain("when 'number' then true when 'boolean' then true else false end, false)");
  });
});
