import { describe, expect, it } from 'vitest';
import {
  isCustomFieldFilterUnavailableFailure,
  type CustomFieldFilters,
  type CustomFieldValueType,
  type SupportedEntityType,
} from '@endora-commerce/contracts';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import { CustomFieldListFilterService } from './custom-field-list-filter.service.js';
import { hostStorageBinding } from './host-storage-binding.js';

/**
 * The list-filter port (`specs/157-custom-fields-list-filters/contracts/list-filter-api.md`
 * §1.4): what a list offers, and a request's filters as one bound condition.
 * No database — the definition source and the presence check are stubbed and
 * the emitted SQL is read as text. A cap breach is the `ZodError` the contract's
 * own `parse` throws (this package names no `zod` of its own), so it is matched
 * by name.
 */

interface StubDefinition {
  key: string;
  valueType: CustomFieldValueType;
  entityType?: SupportedEntityType;
  listFilter?: boolean;
  sortOrder?: number;
  audience?: 'customer' | 'internal';
  options?: Array<{ value: string; sortOrder: number }>;
}

function cached(def: StubDefinition, entityType: SupportedEntityType): CachedDefinition {
  return {
    definition: {
      id: `def-${def.key}`,
      entityType: def.entityType ?? entityType,
      key: def.key,
      label: { en: `EN ${def.key}`, pl: `PL ${def.key}` },
      labelDefault: def.key,
      valueType: def.valueType,
      required: true,
      audience: def.audience ?? 'internal',
      sortOrder: def.sortOrder ?? 0,
      config: { secret: true },
      listFilter: def.listFilter ?? true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    options: (def.options ?? []).map((option) => ({
      id: `opt-${def.key}-${option.value}`,
      definitionId: `def-${def.key}`,
      value: option.value,
      label: { en: option.value.toUpperCase() },
      labelDefault: option.value,
      isDefault: false,
      sortOrder: option.sortOrder,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  } as unknown as CachedDefinition;
}

function service(
  definitions: StubDefinition[],
  options: { served?: boolean } = {},
): { port: CustomFieldListFilterService; reads: SupportedEntityType[] } {
  const reads: SupportedEntityType[] = [];
  const port = new CustomFieldListFilterService(
    {
      listForEntity: async (entityType) => {
        reads.push(entityType);
        return definitions.map((def) => cached(def, entityType));
      },
    },
    () => options.served ?? true,
  );
  return { port, reads };
}

const EVERY_TYPE: StubDefinition[] = [
  { key: 'note', valueType: 'text' },
  { key: 'amount', valueType: 'number' },
  { key: 'flag', valueType: 'boolean' },
  { key: 'due', valueType: 'date' },
  { key: 'source', valueType: 'select', options: [{ value: 'web', sortOrder: 0 }] },
  { key: 'tags', valueType: 'multiselect', options: [{ value: 'a', sortOrder: 0 }] },
  { key: 'seats', valueType: 'number' },
  { key: 'opened', valueType: 'date' },
  { key: 'memo', valueType: 'text' },
  { key: 'region', valueType: 'select', options: [{ value: 'eu', sortOrder: 0 }] },
];

const TEN_KEYS: CustomFieldFilters = {
  note: { contains: 'abc' },
  amount: { min: '1', max: '9.5' },
  flag: { is: true },
  due: { from: '2026-01-01', to: '2026-12-31' },
  source: { in: ['web', 'shop'] },
  tags: { in: ['a', 'b'] },
  seats: { min: '-3' },
  opened: { to: '2026-06-30' },
  memo: { contains: 'x' },
  region: { in: ['eu'] },
};

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** The SQL with every number-guarded `case … end` removed: what is left must cast nothing to numeric. */
const outsideNumberGuards = (sql: string): string =>
  sql.replace(/case when jsonb_typeof\([^)]*\) = 'number' then .*? end/g, '');

describe('CustomFieldListFilterService.condition — shape', () => {
  it('answers null for no filters', async () => {
    const { port } = service(EVERY_TYPE);
    expect(await port.condition('order', undefined)).toBeNull();
    expect(await port.condition('order', {})).toBeNull();
  });

  it('builds one condition over one scan of the bound table for ten keys of every type', async () => {
    const { port } = service(EVERY_TYPE);
    const condition = await port.condition('order', TEN_KEYS);
    expect(condition).not.toBeNull();
    const { table } = hostStorageBinding('order');
    expect(count(condition!.sql, `from "${table}"`)).toBe(1);
    expect(condition!.sql.startsWith(`select t."id" from "${table}" t where `)).toBe(true);
    expect(count(condition!.sql.toLowerCase(), ' where ')).toBeGreaterThanOrEqual(1);
    // Twelve predicates: ten keys, two of them with both bounds.
    expect(count(condition!.sql, ') and (')).toBe(11);
  });

  it('refuses an operator that does not apply to its key’s type, naming each, rather than ignoring it', async () => {
    const { port } = service(EVERY_TYPE);
    const error = await port
      .condition('order', { amount: { contains: 'ten' }, flag: { in: ['x'] }, note: { contains: 'ok' } })
      .catch((caught: unknown) => caught);
    expect((error as { name?: string }).name).toBe('ZodError');
    expect((error as { issues: Array<{ path: unknown[] }> }).issues.map((issue) => issue.path)).toEqual([
      ['amount', 'contains'],
      ['flag', 'in'],
    ]);
  });

  it('refuses an inverted range rather than answering an empty list', async () => {
    const { port } = service(EVERY_TYPE);
    const error = await port
      .condition('order', { amount: { min: '10', max: '1' }, due: { from: '2026-02-01', to: '2026-01-01' } })
      .catch((caught: unknown) => caught);
    expect((error as { name?: string }).name).toBe('ZodError');
    expect((error as { issues: Array<{ path: unknown[] }> }).issues.map((issue) => issue.path)).toEqual([
      ['amount', 'min'],
      ['due', 'from'],
    ]);
  });

  it('answers null for a key whose filter names no operator', async () => {
    const { port } = service(EVERY_TYPE);
    expect(await port.condition('order', { note: {} })).toBeNull();
  });

  it('compares a date bound only where a YYYY-MM-DD string is stored', async () => {
    const { port } = service(EVERY_TYPE);
    const condition = await port.condition('order', { due: { from: '2026-01-01' } });
    expect(condition!.sql).toContain(`case when jsonb_typeof(t."custom_field_values"->?) = 'string' and t."custom_field_values"->>? ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then`);
    expect(condition!.params).toEqual(['due', 'due', 'due', '2026-01-01']);
  });

  it('builds one predicate for `in`, the OR inside it', async () => {
    const { port } = service(EVERY_TYPE);
    const condition = await port.condition('order', { source: { in: ['web', 'shop', 'app'] } });
    expect(count(condition!.sql, ') and (')).toBe(0);
    expect(condition!.params).toEqual(['source', 'web', 'shop', 'app']);
  });
});

describe('CustomFieldListFilterService.condition — caps', () => {
  it('refuses eleven keys with a ZodError before reading a definition', async () => {
    const { port, reads } = service(EVERY_TYPE);
    const eleven = { ...TEN_KEYS, extra: { contains: 'x' } };
    await expect(port.condition('order', eleven)).rejects.toMatchObject({ name: 'ZodError' });
    expect(reads).toEqual([]);
  });

  it('refuses 101 `in` values over three keys with a ZodError before reading a definition', async () => {
    const { port, reads } = service(EVERY_TYPE);
    const values = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    await expect(
      port.condition('order', {
        source: { in: values('s', 50) },
        tags: { in: values('t', 50) },
        region: { in: ['r'] },
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(reads).toEqual([]);
  });
});

describe('CustomFieldListFilterService.condition — refusal', () => {
  it('refuses every unavailable key together, in request order, and builds nothing', async () => {
    const { port } = service([
      ...EVERY_TYPE,
      { key: 'elsewhere', valueType: 'text', entityType: 'customer' },
      { key: 'off', valueType: 'text', listFilter: false },
    ]);
    const filters = JSON.parse(
      '{"unknown":{"contains":"x"},"note":{"contains":"y"},"elsewhere":{"contains":"x"},"off":{"contains":"x"},"constructor":{"contains":"x"},"tostring":{"contains":"x"}}',
    ) as CustomFieldFilters;
    // `toString` is not a definition key; `tostring` is — and neither is defined.
    const error = await port.condition('order', filters).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isCustomFieldFilterUnavailableFailure(error)).toBe(true);
    expect((error as { keys: string[] }).keys).toEqual(['unknown', 'elsewhere', 'off', 'constructor', 'tostring']);
  });

  it('takes no prototype member for a definition', async () => {
    const { port } = service([]);
    const error = await port
      .condition('order', JSON.parse('{"constructor":{"is":true},"valueof":{"is":true}}') as CustomFieldFilters)
      .catch((caught: unknown) => caught);
    expect((error as { keys: string[] }).keys).toEqual(['constructor', 'valueof']);
  });

  it('offers nothing and refuses every key while the type’s owner is absent', async () => {
    const { port, reads } = service(EVERY_TYPE, { served: false });
    expect(await port.listFilterable('quote_request')).toEqual([]);
    const error = await port
      .condition('quote_request', { note: { contains: 'x' }, flag: { is: false } })
      .catch((caught: unknown) => caught);
    expect(isCustomFieldFilterUnavailableFailure(error)).toBe(true);
    expect((error as { keys: string[] }).keys).toEqual(['note', 'flag']);
    expect(reads).toEqual([]);
  });
});

describe('CustomFieldListFilterService.condition — bound, never spliced', () => {
  const HOSTILE = ["it's", 'a"b', 'what?', '100%', 'x;--', '$1', 'a\\b', '?|'];

  it.each(['order', 'quote_request', 'opportunity', 'project'] as const)(
    'binds every key and value on %s and names the bound table',
    async (entityType) => {
      const { port } = service(EVERY_TYPE);
      const condition = await port.condition(entityType, {
        ...TEN_KEYS,
        note: { contains: HOSTILE.join(' ') },
        source: { in: HOSTILE },
        tags: { in: HOSTILE },
      });
      const { sql, params } = condition!;
      for (const value of HOSTILE) expect(sql).not.toContain(value);
      for (const key of Object.keys(TEN_KEYS)) {
        expect(sql).not.toContain(key);
        expect(params).toContain(key);
      }
      expect(params).toEqual(expect.arrayContaining(HOSTILE));
      expect(count(sql, '?')).toBe(params.length);
      expect(sql).not.toContain('::date');
      expect(sql).not.toMatch(/\?[|&]/);
      // No jsonb key-existence operator: a column or a parenthesis followed by a lone `?`.
      expect(sql).not.toMatch(/[")]\s+\?\s/);
      expect(outsideNumberGuards(sql)).not.toContain('::numeric');
      expect(sql).toContain(`from "${hostStorageBinding(entityType).table}" t`);
    },
  );

  it('escapes %, _ and \\ in a text pattern', async () => {
    const { port } = service(EVERY_TYPE);
    const condition = await port.condition('order', { note: { contains: '5%_a\\b' } });
    expect(condition!.params).toEqual(['note', '%5\\%\\_a\\\\b%']);
  });
});

describe('CustomFieldListFilterService.listFilterable', () => {
  it('offers the list-filter definitions, internal ones included, ordered, with options ordered and nothing else', async () => {
    const { port } = service([
      { key: 'zeta', valueType: 'text', sortOrder: 1 },
      { key: 'alpha', valueType: 'text', sortOrder: 1, audience: 'customer' },
      { key: 'first', valueType: 'select', sortOrder: 0, options: [
        { value: 'late', sortOrder: 2 },
        { value: 'early', sortOrder: 1 },
      ] },
      { key: 'hidden', valueType: 'text', listFilter: false },
    ]);
    const fields = await port.listFilterable('order');
    expect(fields.map((field) => field.key)).toEqual(['first', 'alpha', 'zeta']);
    expect(fields[0]!.options.map((option) => option.value)).toEqual(['early', 'late']);
    for (const field of fields) {
      expect(Object.keys(field).sort()).toEqual(['key', 'label', 'labelDefault', 'options', 'valueType']);
    }
    expect(fields[0]).toEqual({
      key: 'first',
      valueType: 'select',
      label: { en: 'EN first', pl: 'PL first' },
      labelDefault: 'first',
      options: [
        { value: 'early', label: { en: 'EARLY' }, labelDefault: 'early' },
        { value: 'late', label: { en: 'LATE' }, labelDefault: 'late' },
      ],
    });
  });
});
