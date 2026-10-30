import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  customFieldDisplayName,
  customFieldFilterChips,
  customFieldFilterRefusal,
  emptyCustomFieldFilters,
  resolveCustomFieldLabel,
  withCustomFieldFilter,
  withoutCustomFieldFilter,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  sanitizeCustomFieldFilters,
  toCustomFieldFiltersParam,
  writeCustomFieldFilterParams,
} from '@endora-commerce/admin-kit/components';
import type { CustomFieldFilters, CustomFieldListFilterField } from '@endora-commerce/contracts';
import en from '../../../packages/modules/_i18n/i18n/en.json';
import pl from '../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Feature 157 (T038) — the kit's pure custom-field filter helpers
 * (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §1.3).
 * The chip copy is read from the real `core` bundles, so the wording a user
 * reads and the pairing of both languages are proved by the same assertion.
 */

const FIELDS: CustomFieldListFilterField[] = [
  {
    key: 'region',
    valueType: 'select',
    label: { en: 'Region', pl: 'Region PL' },
    labelDefault: 'Region default',
    options: [
      { value: 'north', label: { en: 'North', pl: 'Północ' }, labelDefault: 'North default' },
      { value: 'south', label: { en: 'South' }, labelDefault: 'South default' },
    ],
  },
  {
    key: 'tags',
    valueType: 'multiselect',
    label: { en: 'Tags' },
    labelDefault: 'Tags default',
    options: [
      { value: 'a', label: { en: 'Alpha' }, labelDefault: 'Alpha' },
      { value: 'b', label: { en: 'Beta' }, labelDefault: 'Beta' },
    ],
  },
  { key: 'weight', valueType: 'number', label: { en: 'Weight' }, labelDefault: 'Weight', options: [] },
  { key: 'due', valueType: 'date', label: { en: 'Due' }, labelDefault: 'Due', options: [] },
  { key: 'vip', valueType: 'boolean', label: { en: 'VIP' }, labelDefault: 'VIP', options: [] },
  { key: 'note', valueType: 'text', label: {}, labelDefault: 'Note', options: [] },
];

function translator(bundle: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>): string => {
    const template = bundle[key];
    if (template === undefined) throw new Error(`missing core key ${key}`);
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? `{${name}}`));
  };
}
const tEn = translator(en as Record<string, string>);
const tPl = translator(pl as Record<string, string>);

function filters(entries: Record<string, unknown>): CustomFieldFilters {
  return Object.assign(Object.create(null) as CustomFieldFilters, entries);
}

function plain(value: CustomFieldFilters): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function refusal(code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(400, { error: { code: code as never, message: 'refused', ...(details ? { details } : {}) } });
}

afterEach(() => {
  // A helper that wrote into a plain object's prototype would leave it here.
  expect(Object.prototype).not.toHaveProperty('in');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

describe('readCustomFieldFilterParams / writeCustomFieldFilterParams', () => {
  it('round-trips every operator, `in` repeated', () => {
    const value = filters({
      region: { in: ['north', 'south'] },
      note: { contains: 'acme' },
      vip: { is: false },
      weight: { min: '1.5', max: '9' },
      due: { from: '2026-01-01', to: '2026-02-28' },
    });
    const written = writeCustomFieldFilterParams(new URLSearchParams(), value);
    expect(written.getAll('cf.region.in')).toEqual(['north', 'south']);
    expect(written.get('cf.vip.is')).toBe('false');
    expect(plain(readCustomFieldFilterParams(written))).toEqual(plain(value));
  });

  it('drops a malformed operator value and keeps the well-formed ones beside it', () => {
    const read = readCustomFieldFilterParams(
      new URLSearchParams('cf.k.min=ten&cf.k.max=9&cf.d.from=2026-02-30&cf.d.to=2026-03-01&cf.b.is=maybe&cf.k.like=x'),
    );
    expect(plain(read)).toEqual({ k: { max: '9' }, d: { to: '2026-03-01' } });
  });

  it('keeps an unknown key with a well-formed operator (US1-9)', () => {
    expect(plain(readCustomFieldFilterParams(new URLSearchParams('cf.gone.in=x')))).toEqual({ gone: { in: ['x'] } });
  });

  it('drops a parameter whose key fails the key grammar (threat model F-4)', () => {
    const long = `a${'b'.repeat(64)}`;
    const read = readCustomFieldFilterParams(
      new URLSearchParams(`cf.Bad-Key.in=x&cf.__proto__.in=x&cf.${long}.in=x&cf.ok.in=y`),
    );
    expect(Object.keys(read)).toEqual(['ok']);
    expect(Object.prototype).not.toHaveProperty('in');
  });

  it('reads `constructor` as an ordinary unknown key, an own property of a null-prototype record', () => {
    // `toString` is not one: its capital fails the key grammar, so it is dropped like `Bad-Key`.
    const read = readCustomFieldFilterParams(new URLSearchParams('cf.constructor.in=x&cf.toString.in=y'));
    expect(Object.getPrototypeOf(read)).toBeNull();
    expect(Object.keys(read)).toEqual(['constructor']);
    expect(read.constructor).toEqual({ in: ['x'] });
    expect(typeof Object.prototype.toString).toBe('function');
    expect(({}).constructor).toBe(Object);
    const written = writeCustomFieldFilterParams(new URLSearchParams(), read);
    expect(written.getAll('cf.constructor.in')).toEqual(['x']);
  });

  it('leaves other parameters alone and replaces every earlier `cf.*`', () => {
    const before = new URLSearchParams('status=new&cf.old.in=x&page=3&cf.region.in=south');
    const written = writeCustomFieldFilterParams(before, filters({ region: { in: ['north'] } }));
    expect(written.get('status')).toBe('new');
    expect(written.get('page')).toBe('3');
    expect(written.has('cf.old.in')).toBe(false);
    expect(written.getAll('cf.region.in')).toEqual(['north']);
    // The input is not mutated.
    expect(before.has('cf.old.in')).toBe(true);
  });

  it('reads at most 10 keys, in address order', () => {
    const query = Array.from({ length: 12 }, (_, i) => `cf.k${i}.in=v`).join('&');
    expect(Object.keys(readCustomFieldFilterParams(new URLSearchParams(query)))).toEqual(
      Array.from({ length: 10 }, (_, i) => `k${i}`),
    );
  });

  it('reads at most 100 `in` values in total (and the schema\'s 50 per key), the rest dropped in address order', () => {
    const query = ['a', 'b', 'c']
      .flatMap((key) => Array.from({ length: 45 }, (_, i) => `cf.${key}.in=v${i}`))
      .join('&');
    const read = readCustomFieldFilterParams(new URLSearchParams(query));
    expect(read.a?.in).toHaveLength(45);
    expect(read.b?.in).toHaveLength(45);
    expect(read.c?.in).toHaveLength(10);
    const perKey = Array.from({ length: 60 }, (_, i) => `cf.a.in=v${i}`).join('&');
    expect(readCustomFieldFilterParams(new URLSearchParams(perKey)).a?.in).toHaveLength(50);
  });
});

describe('sanitizeCustomFieldFilters (FR-014)', () => {
  it('keeps offered keys with a parsable filter and reports the rest in input order', () => {
    const result = sanitizeCustomFieldFilters(
      { gone: { in: ['x'] }, region: { in: ['north'] }, weight: { min: 'ten' }, constructor: { in: ['x'] }, vip: { is: true } },
      FIELDS,
    );
    expect(plain(result.kept)).toEqual({ region: { in: ['north'] }, vip: { is: true } });
    expect(Object.getPrototypeOf(result.kept)).toBeNull();
    expect(result.dropped).toEqual(['gone', 'weight', 'constructor']);
  });

  it('prunes `in` values no longer among the options, dropping the key when none is left', () => {
    const result = sanitizeCustomFieldFilters(
      { region: { in: ['north', 'east'] }, tags: { in: ['removed'] } },
      FIELDS,
    );
    expect(plain(result.kept)).toEqual({ region: { in: ['north'] } });
    expect(result.dropped).toEqual(['tags']);
  });

  it('drops everything for a non-object input', () => {
    for (const saved of [null, undefined, 'x', 3, ['region']]) {
      const result = sanitizeCustomFieldFilters(saved, FIELDS);
      expect(plain(result.kept)).toEqual({});
      expect(result.dropped).toEqual([]);
    }
  });
});

describe('pruneRemovedOptions (US1-9)', () => {
  it('removes `in` values a known field no longer offers and never removes an unknown key', () => {
    const pruned = pruneRemovedOptions(
      filters({ region: { in: ['east'] }, tags: { in: ['a', 'zzz'] }, gone: { in: ['x'] }, constructor: { in: ['x'] } }),
      FIELDS,
    );
    expect(plain(pruned)).toEqual({ tags: { in: ['a'] }, gone: { in: ['x'] }, constructor: { in: ['x'] } });
    expect(Object.getPrototypeOf(pruned)).toBeNull();
  });
});

describe('customFieldFilterChips', () => {
  const value = filters({
    region: { in: ['north', 'south'] },
    weight: { min: '1' },
    note: { contains: 'x' },
  });

  it('builds "<label>: <summary>" per type, in English', () => {
    const chips = customFieldFilterChips(FIELDS, value, 'en', tEn);
    expect(chips.map((chip) => chip.label)).toEqual(['Region: North, South', 'Weight: ≥ 1', 'Note: contains “x”']);
    const more = customFieldFilterChips(
      FIELDS,
      filters({ weight: { max: '9' }, due: { from: '2026-01-01', to: '2026-01-31' }, vip: { is: true } }),
      'en',
      tEn,
    ).map((chip) => chip.label);
    expect(more[0]).toBe('Weight: ≤ 9');
    expect(more[1]).toBe('Due: 2026-01-01 – 2026-01-31');
    expect(more[2]).toBe('VIP: Yes');
    expect(customFieldFilterChips(FIELDS, filters({ weight: { min: '1', max: '9' }, vip: { is: false } }), 'en', tEn).map((c) => c.label)).toEqual([
      'Weight: 1 – 9',
      'VIP: No',
    ]);
  });

  it('uses the given language, falls back to the base language, then to labelDefault', () => {
    const chips = customFieldFilterChips(FIELDS, value, 'pl', tPl).map((chip) => chip.label);
    expect(chips[0]).toBe('Region PL: Północ, South default');
    expect(chips[2]).toMatch(/^Note: /);
    expect(chips[2]).not.toBe('Note: contains “x”');
    expect(customFieldFilterChips(FIELDS, value, 'pl-PL', tPl)[0]?.label).toBe('Region PL: Północ, South default');
  });

  it('names an unknown key by the key itself', () => {
    expect(customFieldFilterChips(FIELDS, filters({ gone: { in: ['x'] } }), 'en', tEn)[0]?.label).toBe('gone: x');
  });

  it("each chip's remove returns the filters without that key", () => {
    const chips = customFieldFilterChips(FIELDS, value, 'en', tEn);
    const next = chips[1]!.remove();
    expect(plain(next)).toEqual({ region: { in: ['north', 'south'] }, note: { contains: 'x' } });
    expect(Object.getPrototypeOf(next)).toBeNull();
    expect(plain(value)).toHaveProperty('weight');
    expect(new Set(chips.map((chip) => chip.id)).size).toBe(3);
  });
});

describe('customFieldFilterRefusal', () => {
  it('returns details.key for CUSTOM_FIELD_FILTER_UNAVAILABLE and null otherwise', () => {
    expect(customFieldFilterRefusal(refusal('CUSTOM_FIELD_FILTER_UNAVAILABLE', { key: 'gone', keys: ['gone'] }))).toBe('gone');
    expect(customFieldFilterRefusal(refusal('VALIDATION_FAILED', { key: 'gone' }))).toBeNull();
    expect(customFieldFilterRefusal(refusal('CUSTOM_FIELD_FILTER_UNAVAILABLE'))).toBeNull();
    expect(customFieldFilterRefusal(new Error('CUSTOM_FIELD_FILTER_UNAVAILABLE'))).toBeNull();
    expect(customFieldFilterRefusal(null)).toBeNull();
  });
});

describe('toCustomFieldFiltersParam', () => {
  it('sorts keys and answers null for {}', () => {
    expect(toCustomFieldFiltersParam(filters({}))).toBeNull();
    expect(toCustomFieldFiltersParam(filters({ vip: { is: true }, region: { in: ['north'] } }))).toBe(
      '{"region":{"in":["north"]},"vip":{"is":true}}',
    );
  });
});

describe('the record and label helpers the list pages share', () => {
  it('resolves a label in the language, then its base language, then labelDefault, skipping empty labels', () => {
    expect(resolveCustomFieldLabel({ pl: 'Region PL' }, 'Default', 'pl-PL')).toBe('Region PL');
    expect(resolveCustomFieldLabel({ pl: '' }, 'Default', 'pl')).toBe('Default');
  });

  it('names a field by its label, and a key the list does not offer by the key, cut to 64 characters', () => {
    expect(customFieldDisplayName(FIELDS, 'region', 'pl')).toBe('Region PL');
    expect(customFieldDisplayName(FIELDS, 'gone_field', 'en')).toBe('gone_field');
    const long = `<img src=x>${'a'.repeat(80)}`;
    expect(customFieldDisplayName(FIELDS, long, 'en')).toBe(`${long.slice(0, 64)}…`);
  });

  it('sets and removes one key, always into a new prototype-free record', () => {
    const start = emptyCustomFieldFilters();
    expect(Object.getPrototypeOf(start)).toBeNull();
    const set = withCustomFieldFilter(start, 'region', { in: ['north'] });
    expect(Object.getPrototypeOf(set)).toBeNull();
    expect(set).not.toBe(start);
    expect({ ...set }).toEqual({ region: { in: ['north'] } });
    const constructorKey = withCustomFieldFilter(set, 'constructor', { is: true });
    expect(Object.keys(constructorKey)).toEqual(['region', 'constructor']);
    expect({ ...withCustomFieldFilter(constructorKey, 'region', null) }).toEqual({ constructor: { is: true } });
    expect({ ...withoutCustomFieldFilter(constructorKey, 'constructor') }).toEqual({ region: { in: ['north'] } });
  });

  it('gives each chip an accessible name for its remove action', () => {
    const [chip] = customFieldFilterChips(FIELDS, filters({ region: { in: ['north'] } }), 'en', tEn);
    expect(chip?.removeLabel).toBe('Remove filter Region: North');
    const [plChip] = customFieldFilterChips(FIELDS, filters({ region: { in: ['north'] } }), 'pl', tPl);
    expect(plChip?.removeLabel).toBe('Usuń filtr Region PL: Północ');
  });
});
