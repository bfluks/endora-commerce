import { describe, expect, it } from 'vitest';

import { effectiveSystemText, overrideLanguages, type OverrideRow } from '../src/index.js';

// Issue #384 — the walk the storefront's catalog and search reads share.
describe('effectiveSystemText language walk', () => {
  const channelId = 'channel-a';
  const blob = { 'pl-PL': 'Zestaw bazowy', 'en-US': 'Baseline kit' };
  const rows: OverrideRow[] = [
    { attributeKey: 'name', channelId, languageCode: 'pl-PL', value: { v: 'Zestaw hurtowy' } },
  ];
  const name = (preferred: string | undefined, baselineText: string): string =>
    effectiveSystemText(
      rows,
      'name',
      { channelId, languages: overrideLanguages(preferred, 'pl-PL') },
      blob,
      baselineText,
    );

  it('shows the en-US baseline to an en-US request despite a (channel, pl-PL) override', () => {
    expect(name('en-US', 'Baseline kit')).toBe('Baseline kit');
  });

  it('shows the (channel, pl-PL) override where the pick lands on pl-PL', () => {
    expect(name('pl-PL', 'Zestaw bazowy')).toBe('Zestaw hurtowy');
    expect(name('de-DE', 'Zestaw bazowy')).toBe('Zestaw hurtowy');
    expect(name(undefined, 'Zestaw bazowy')).toBe('Zestaw hurtowy');
  });

  it('leaves a product without overrides on its baseline pick', () => {
    expect(
      effectiveSystemText(
        [],
        'name',
        { channelId, languages: overrideLanguages('pl-PL', 'pl-PL') },
        blob,
        'Zestaw bazowy',
      ),
    ).toBe('Zestaw bazowy');
  });
});
