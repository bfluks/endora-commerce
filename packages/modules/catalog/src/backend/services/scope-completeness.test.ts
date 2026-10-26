import { describe, expect, it, vi } from 'vitest';
import type { ProductGlobalScopeFields, ScopeChannel, ScopeSnapshot } from '@endora-commerce/contracts';
import {
  ScopeCompletenessGate,
  checkCompleteness,
  composeCompletenessGate,
  completenessFailures,
  completenessOutcome,
  type CompletenessFacts,
} from './scope-completeness.js';

/**
 * Feature 163, Phase 11 (T077, US6, FR-060, FR-061, FR-041) — what the completeness
 * gate reports missing at a (channel, language), and which pairs a status write asks
 * it about. The database half is `backend/test/contract/catalog/scope-completeness-gate.test.ts` [PG].
 */

const B2C = '11111111-2222-4333-8444-555555555555';
const B2B = '21111111-2222-4333-8444-555555555555';
const P = '31111111-2222-4333-8444-555555555555';

function facts(over: Partial<CompletenessFacts> = {}): CompletenessFacts {
  return {
    name: { 'pl-PL': 'Wiertarka' },
    slug: 'wiertarka',
    attributeValues: {},
    requiredLanguageAttributes: [],
    attributeScopes: new Map(),
    valueOverrides: [],
    urlKeys: [],
    ...over,
  };
}

describe('checkCompleteness', () => {
  it('the name counts only in L itself — never another language (FR-060, last sentence)', () => {
    expect(checkCompleteness(facts(), B2C, 'pl-PL')).toEqual([]);
    expect(checkCompleteness(facts(), B2C, 'de-DE')).toEqual(['name']);
  });

  it('a baseline name in L counts, matched case-insensitively; an empty or blank one does not', () => {
    expect(checkCompleteness(facts({ name: { 'de-de': 'Bohrer' } }), B2C, 'de-DE')).toEqual([]);
    expect(checkCompleteness(facts({ name: { 'de-DE': '' } }), B2C, 'de-DE')).toEqual(['name']);
    expect(checkCompleteness(facts({ name: { 'de-DE': '   ' } }), B2C, 'de-DE')).toEqual(['name']);
  });

  it('a channel × language or a channel name override counts at that channel only', () => {
    const cl = facts({ valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: 'de-DE', value: { v: 'Bohrer' } }] });
    expect(checkCompleteness(cl, B2C, 'de-DE')).toEqual([]);
    expect(checkCompleteness(cl, B2B, 'de-DE')).toEqual(['name']);
    expect(checkCompleteness(cl, B2C, 'en-US')).toEqual(['name']);
    const c = facts({ valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: null, value: { v: 'Bohrer' } }] });
    expect(checkCompleteness(c, B2C, 'de-DE')).toEqual([]);
    expect(checkCompleteness(c, B2B, 'de-DE')).toEqual(['name']);
  });

  it('an empty override does not count', () => {
    const f = facts({ valueOverrides: [{ attributeKey: 'name', channelId: B2C, languageCode: 'de-DE', value: { v: '' } }] });
    expect(checkCompleteness(f, B2C, 'de-DE')).toEqual(['name']);
  });

  describe('URL key (K3)', () => {
    it('the global key satisfies it where the product has no key in L', () => {
      expect(checkCompleteness(facts({ name: { 'de-DE': 'Bohrer' } }), B2C, 'de-DE')).toEqual([]);
    });

    it('without a global key, a language key or a channel × language key satisfies it', () => {
      const none = facts({ slug: '', name: { 'de-DE': 'Bohrer' } });
      expect(checkCompleteness(none, B2C, 'de-DE')).toEqual(['urlKey']);
      expect(
        checkCompleteness({ ...none, urlKeys: [{ languageCode: 'de-DE', salesChannelId: null }] }, B2C, 'de-DE'),
      ).toEqual([]);
      const channelKey = { ...none, urlKeys: [{ languageCode: 'de-DE', salesChannelId: B2C }] };
      expect(checkCompleteness(channelKey, B2C, 'de-DE')).toEqual([]);
      expect(checkCompleteness(channelKey, B2B, 'de-DE')).toEqual(['urlKey']);
    });
  });

  describe('required language-scoped attributes', () => {
    const scopes = new Map([
      ['material', { channelScoped: true, languageScoped: true }],
      ['claim', { channelScoped: false, languageScoped: true }],
    ]);

    it('counts the value in L, at C × L or at C — never another language', () => {
      const base = facts({
        name: { 'de-DE': 'Bohrer', 'pl-PL': 'Wiertarka' },
        requiredLanguageAttributes: ['material'],
        attributeScopes: scopes,
        attributeValues: { material: { 'pl-PL': 'stal' } },
      });
      expect(checkCompleteness(base, B2C, 'pl-PL')).toEqual([]);
      expect(checkCompleteness(base, B2C, 'de-DE')).toEqual(['attribute:material']);
      const overridden = {
        ...base,
        valueOverrides: [{ attributeKey: 'material', channelId: B2C, languageCode: 'de-DE', value: { v: 'Stahl' } }],
      };
      expect(checkCompleteness(overridden, B2C, 'de-DE')).toEqual([]);
      const channelOnly = {
        ...base,
        valueOverrides: [{ attributeKey: 'material', channelId: B2C, languageCode: null, value: { v: 'Stahl' } }],
      };
      expect(checkCompleteness(channelOnly, B2C, 'de-DE')).toEqual([]);
    });

    it('ignores an override its attribute’s scope no longer allows (an orphan, FR-015)', () => {
      const f = facts({
        name: { 'de-DE': 'Bohrer' },
        requiredLanguageAttributes: ['claim'],
        attributeScopes: scopes,
        valueOverrides: [{ attributeKey: 'claim', channelId: B2C, languageCode: 'de-DE', value: { v: 'Neu' } }],
      });
      expect(checkCompleteness(f, B2C, 'de-DE')).toEqual(['attribute:claim']);
    });

    it('names every missing value, name first, then the URL key, then attributes by key', () => {
      const f = facts({
        name: {},
        slug: '',
        requiredLanguageAttributes: ['material', 'claim'],
        attributeScopes: scopes,
      });
      expect(checkCompleteness(f, B2C, 'de-DE')).toEqual(['name', 'urlKey', 'attribute:claim', 'attribute:material']);
    });
  });
});

describe('completenessFailures — the gate over pairsTurningOn (M3 → A)', () => {
  const b2c: ScopeChannel = { id: B2C, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
  const b2b: ScopeChannel = { id: B2B, languages: ['pl-PL'], defaultLanguage: 'pl-PL' };
  const global = (over: Partial<ProductGlobalScopeFields> = {}): ProductGlobalScopeFields => ({
    status: 'inactive',
    deletedAt: null,
    archivedAt: null,
    window: { from: null, until: null },
    visibility: 'public',
    allowedOrganizationIds: [],
    minOrderQuantity: null,
    returnable: true,
    ...over,
  });
  const snap = (over: Partial<ScopeSnapshot> = {}): ScopeSnapshot => ({
    global: global(),
    channelRows: [],
    languageRows: [],
    ...over,
  });
  const lacksGerman = facts();

  it('a global switch on fails only the pair lacking its name, naming it (US6 #3)', () => {
    const failures = completenessFailures(snap(), snap({ global: global({ status: 'active' }) }), [b2c, b2b], lacksGerman);
    expect(failures).toEqual([{ channelId: B2C, languageCode: 'de-DE', missing: ['name'] }]);
  });

  it('a complete product fails nothing (US6 #2)', () => {
    const complete = facts({ name: { 'pl-PL': 'Wiertarka', 'de-DE': 'Bohrer' } });
    expect(completenessFailures(snap(), snap({ global: global({ status: 'active' }) }), [b2c, b2b], complete)).toEqual([]);
  });

  it('a C × L row turning on checks that pair alone', () => {
    const after = snap({ languageRows: [{ productId: P, channelId: B2C, languageCode: 'de-DE', status: 'active' }] });
    expect(completenessFailures(snap(), after, [b2c, b2b], lacksGerman)).toEqual([
      { channelId: B2C, languageCode: 'de-DE', missing: ['name'] },
    ]);
  });

  describe('M3 → A non-triggers on a product lacking name[de]', () => {
    const on = global({ status: 'active' });

    it('a window-only change, even one opening the window now, checks nothing', () => {
      const before = snap({ global: { ...on, window: { from: new Date(Date.now() + 86_400_000), until: null } } });
      const after = snap({ global: { ...on, window: { from: null, until: null } } });
      expect(completenessFailures(before, after, [b2c], lacksGerman)).toEqual([]);
    });

    it('an audience-only change checks nothing (US6 #6)', () => {
      const before = snap({ global: { ...on, visibility: 'organization_restricted', allowedOrganizationIds: [] } });
      const after = snap({ global: on });
      expect(completenessFailures(before, after, [b2c], lacksGerman)).toEqual([]);
    });

    it('Restore — archivedAt alone moving — checks nothing (FR-019)', () => {
      const before = snap({ global: { ...on, archivedAt: new Date() } });
      expect(completenessFailures(before, snap({ global: on }), [b2c], lacksGerman)).toEqual([]);
    });
  });

  it('an archived product set active fires the gate although it stays archived (FR-060)', () => {
    const archivedAt = new Date();
    const before = snap({ global: global({ archivedAt }) });
    const after = snap({ global: global({ status: 'active', archivedAt }) });
    expect(completenessFailures(before, after, [b2c], lacksGerman)).toEqual([
      { channelId: B2C, languageCode: 'de-DE', missing: ['name'] },
    ]);
  });
});

describe('completenessOutcome — the mode decides (FR-060, N3)', () => {
  const failures = [
    { channelId: B2C, languageCode: 'de-DE', missing: ['name' as const] },
    { channelId: B2B, languageCode: 'de-DE', missing: ['name' as const, 'urlKey' as const] },
  ];

  it('warn saves and carries one completeness warning per failing pair', () => {
    expect(completenessOutcome('warn', failures)).toEqual([
      { kind: 'completeness', channelId: B2C, languageCode: 'de-DE', missing: ['name'] },
      { kind: 'completeness', channelId: B2B, languageCode: 'de-DE', missing: ['name', 'urlKey'] },
    ]);
  });

  it('refuse refuses the whole write with 422 SCOPE_INCOMPLETE naming every pair', () => {
    try {
      completenessOutcome('refuse', failures);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 422, code: 'SCOPE_INCOMPLETE', details: { pairs: failures } });
    }
  });

  it('no failure is no warning and no refusal in either mode', () => {
    expect(completenessOutcome('warn', [])).toEqual([]);
    expect(completenessOutcome('refuse', [])).toEqual([]);
  });
});

describe('composeCompletenessGate — never silently off (checkpoint C security review, I7)', () => {
  const deps = {
    membership: { listChannelsForEntity: async () => [] },
    attributeRead: { listAll: async () => [] },
    settings: { get: async () => 'warn' as never },
  };

  it('composes the gate when every collaborator is wired, and logs nothing', () => {
    const log = { warn: vi.fn() };
    expect(composeCompletenessGate(deps, log)).toBeInstanceOf(ScopeCompletenessGate);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each(['membership', 'attributeRead', 'settings'] as const)(
    'without %s it answers undefined and warns once, naming what is missing',
    (missing) => {
      const log = { warn: vi.fn() };
      expect(composeCompletenessGate({ ...deps, [missing]: undefined }, log)).toBeUndefined();
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.warn.mock.calls[0])).toContain(missing);
    },
  );
});
