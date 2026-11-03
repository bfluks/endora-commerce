import { describe, expect, it } from 'vitest';
import type { AttributeScope, OverrideRow } from '@endora-commerce/contracts';

import {
  channelOverrideFor,
  effectiveAttributeValues,
  effectiveSystemText,
  overrideLanguages,
} from './storefront-value-overrides.js';

const A = 'channel-a';
const B = 'channel-b';

const rows: OverrideRow[] = [
  { attributeKey: 'name', channelId: A, languageCode: 'pl-PL', value: { v: 'Zestaw hurtowy' } },
  { attributeKey: 'name', channelId: A, languageCode: null, value: { v: 'Channel-only name' } },
  { attributeKey: 'description', channelId: A, languageCode: 'pl-PL', value: { v: '' } },
  { attributeKey: 'finish', channelId: A, languageCode: null, value: { v: 'Matte' } },
];

describe('effectiveSystemText (issue #384)', () => {
  it('takes the (channel, language) override', () => {
    expect(
      effectiveSystemText(rows, 'name', { channelId: A, languages: ['pl-PL'] }, {}, 'Baseline'),
    ).toBe('Zestaw hurtowy');
  });

  it('takes the channel-only override when no language slot matches', () => {
    expect(
      effectiveSystemText(rows, 'name', { channelId: A, languages: ['en-US'] }, {}, 'Baseline'),
    ).toBe('Channel-only name');
  });

  it('walks the request language, then the channel default, before the channel-only slot', () => {
    // Request `de-DE` on a channel whose default is `pl-PL`: the baseline pick
    // falls through to `pl-PL`, so the (channel, pl-PL) override must answer
    // ahead of the channel-only one.
    expect(
      effectiveSystemText(rows, 'name', { channelId: A, languages: ['de-DE', 'pl-PL'] }, {}, 'Baseline'),
    ).toBe('Zestaw hurtowy');
    const deRows: OverrideRow[] = [
      ...rows,
      { attributeKey: 'name', channelId: A, languageCode: 'de-DE', value: { v: 'Großhandelsset' } },
    ];
    expect(
      effectiveSystemText(deRows, 'name', { channelId: A, languages: ['de-DE', 'pl-PL'] }, {}, 'Baseline'),
    ).toBe('Großhandelsset');
    expect(
      effectiveSystemText(rows, 'name', { channelId: A, languages: ['de-DE', 'fr-FR'] }, {}, 'Baseline'),
    ).toBe('Channel-only name');
  });

  it("keeps the caller's baseline pick on another channel, with no rows, and for an empty override", () => {
    expect(
      effectiveSystemText(rows, 'name', { channelId: B, languages: ['pl-PL'] }, {}, 'Baseline'),
    ).toBe('Baseline');
    expect(
      effectiveSystemText(undefined, 'name', { channelId: A, languages: ['pl-PL'] }, {}, 'Baseline'),
    ).toBe('Baseline');
    expect(
      effectiveSystemText(rows, 'description', { channelId: A, languages: ['pl-PL'] }, {}, 'Opis'),
    ).toBe('Opis');
  });
});

describe('the language walk over baseline and overrides (issue #384)', () => {
  const blob = { 'pl-PL': 'Zestaw bazowy', 'en-US': 'Baseline kit' };
  const plOnly: OverrideRow[] = [
    { attributeKey: 'name', channelId: A, languageCode: 'pl-PL', value: { v: 'Zestaw hurtowy' } },
  ];

  it('builds the chain the baseline pick walks', () => {
    expect(overrideLanguages('en-US', 'pl-PL')).toEqual(['en-US', 'pl-PL', 'en']);
    expect(overrideLanguages(undefined, 'pl-PL')).toEqual(['pl-PL', 'en-US', 'en']);
    expect(overrideLanguages('de-DE', undefined)).toEqual(['de-DE', 'en-US', 'en']);
  });

  it('never lets a later-language override beat an earlier-language baseline value', () => {
    const ctx = { channelId: A, languages: overrideLanguages('en-US', 'pl-PL') };
    expect(effectiveSystemText(plOnly, 'name', ctx, blob, 'Baseline kit')).toBe('Baseline kit');
  });

  it('lets the override answer for the language the baseline pick lands on', () => {
    const ctx = { channelId: A, languages: overrideLanguages('de-DE', 'pl-PL') };
    expect(effectiveSystemText(plOnly, 'name', ctx, blob, 'Zestaw bazowy')).toBe('Zestaw hurtowy');
    // Same request on a tile whose own pick has no channel-default leg: the
    // walk reaches `en-US` first, so the baseline stands.
    const tile = { channelId: A, languages: overrideLanguages('de-DE', undefined) };
    expect(effectiveSystemText(plOnly, 'name', tile, blob, 'Baseline kit')).toBe('Baseline kit');
  });

  it("walks past an empty baseline value, and reaches the pick's first-key tail", () => {
    const ctx = { channelId: A, languages: overrideLanguages('en-US', 'pl-PL') };
    expect(
      effectiveSystemText(plOnly, 'name', ctx, { 'en-US': '', 'pl-PL': 'Zestaw bazowy' }, 'Zestaw bazowy'),
    ).toBe('Zestaw hurtowy');
    const frRows: OverrideRow[] = [
      { attributeKey: 'name', channelId: A, languageCode: 'fr-FR', value: { v: 'Kit de gros' } },
    ];
    expect(
      effectiveSystemText(frRows, 'name', ctx, { 'fr-FR': 'Kit de base' }, 'Kit de base'),
    ).toBe('Kit de gros');
  });

  it('keeps the channel-only slot behind the stop, as before', () => {
    const ctx = { channelId: A, languages: overrideLanguages('en-US', 'pl-PL') };
    const withChannelOnly: OverrideRow[] = [
      ...plOnly,
      { attributeKey: 'name', channelId: A, languageCode: null, value: { v: 'Channel-only name' } },
    ];
    expect(effectiveSystemText(withChannelOnly, 'name', ctx, blob, 'Baseline kit')).toBe(
      'Channel-only name',
    );
  });

  it('treats a scalar baseline as present in every language', () => {
    const scope: AttributeScope = { channelScoped: true, languageScoped: true };
    const finishRows: OverrideRow[] = [
      { attributeKey: 'finish', channelId: A, languageCode: 'pl-PL', value: { v: 'Mat' } },
    ];
    const enCtx = { channelId: A, languages: overrideLanguages('en-US', 'pl-PL') };
    expect(channelOverrideFor(finishRows, 'finish', scope, enCtx, 'Gloss')).toBe(undefined);
    expect(channelOverrideFor(finishRows, 'finish', scope, enCtx, undefined)).toBe('Mat');
    expect(
      channelOverrideFor(finishRows, 'finish', scope, enCtx, { 'pl-PL': 'Połysk', 'en-US': 'Gloss' }),
    ).toBe(undefined);
  });
});

describe('channelOverrideFor (issue #384)', () => {
  it('never answers from a baseline slot', () => {
    const scope: AttributeScope = { channelScoped: false, languageScoped: false };
    expect(channelOverrideFor(rows, 'finish', scope, { channelId: A, languages: [] }, undefined)).toBe(
      undefined,
    );
  });
});

describe('effectiveAttributeValues (issue #384)', () => {
  const scopes = new Map<string, AttributeScope>([
    ['finish', { channelScoped: true, languageScoped: false }],
  ]);

  it('replaces a channel-scoped attribute with its override', async () => {
    const out = await effectiveAttributeValues(
      { finish: 'Gloss', color: 'red' },
      rows,
      { channelId: A, languages: ['pl-PL'] },
      async () => scopes,
    );
    expect(out).toEqual({ finish: 'Matte', color: 'red' });
  });

  it('returns the input untouched, without reading scopes, when no user-attribute row exists', async () => {
    const values = { finish: 'Gloss' };
    let scopeReads = 0;
    const out = await effectiveAttributeValues(
      values,
      rows.filter((r) => r.attributeKey === 'name'),
      { channelId: A, languages: ['pl-PL'] },
      async () => {
        scopeReads += 1;
        return scopes;
      },
    );
    expect(out).toBe(values);
    expect(scopeReads).toBe(0);
  });

  it('leaves a value whose attribute is no longer channel-scoped', async () => {
    const out = await effectiveAttributeValues(
      { finish: 'Gloss' },
      rows,
      { channelId: A, languages: ['pl-PL'] },
      async () => new Map([['finish', { channelScoped: false, languageScoped: false }]]),
    );
    expect(out).toEqual({ finish: 'Gloss' });
  });
});
