import { describe, expect, it } from 'vitest';
import type {
  CustomFieldAudience,
  CustomFieldValueType,
  SupportedEntityType,
} from '@endora-commerce/contracts';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import type { DefinitionSource } from './custom-field-value.service.js';
import { CustomFieldCarryService } from './custom-field-carry.service.js';

/**
 * The carry port (`specs/158-custom-fields-value-carry/contracts/carry-api.md`
 * §4.1, research R-5): which source values carry into a target bag. Pure over
 * the definitions it is handed — no database write, no audit — and it never
 * overwrites, never consults an unrelated target field, and carries nothing
 * while either side's owner is absent.
 */

interface Spec {
  key: string;
  valueType?: CustomFieldValueType;
  audience?: CustomFieldAudience;
  required?: boolean;
  carryTo?: SupportedEntityType[];
  options?: string[];
}

function cached(entityType: SupportedEntityType, spec: Spec): CachedDefinition {
  const definitionId = `${entityType}-${spec.key}`;
  return {
    definition: {
      id: definitionId,
      entityType,
      key: spec.key,
      label: {},
      labelDefault: spec.key,
      valueType: spec.valueType ?? 'text',
      required: spec.required ?? false,
      audience: spec.audience ?? 'internal',
      sortOrder: 0,
      config: {},
      listFilter: false,
      carryTo: spec.carryTo ?? [],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    options: (spec.options ?? []).map((value, index) => ({
      id: `${definitionId}-${value}`,
      definitionId,
      value,
      label: {},
      labelDefault: value,
      isDefault: false,
      sortOrder: index,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  } as unknown as CachedDefinition;
}

function source(definitions: Partial<Record<SupportedEntityType, Spec[]>>): DefinitionSource {
  return {
    listForEntity: async (entityType) =>
      (definitions[entityType] ?? []).map((spec) => cached(entityType, spec)),
  };
}

const QR_TO_ORDER = { sourceType: 'quote_request', targetType: 'order' } as const;

function service(
  definitions: Partial<Record<SupportedEntityType, Spec[]>>,
  absent: string[] = [],
): CustomFieldCarryService {
  return new CustomFieldCarryService(source(definitions), (moduleId) => !absent.includes(moduleId));
}

describe('CustomFieldCarryService.plan', () => {
  it('carries a same-key value into an empty target field', async () => {
    const plan = await service({
      quote_request: [{ key: 'order_source', carryTo: ['order'] }],
      order: [{ key: 'order_source' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { order_source: 'fair' }, targetValues: {} });
    expect(plan).toEqual({ values: { order_source: 'fair' }, carried: ['order_source'], skipped: [] });
  });

  it('carries nothing when the source does not carry to the target type', async () => {
    const plan = await service({
      quote_request: [{ key: 'order_source', carryTo: ['opportunity'] }],
      order: [{ key: 'order_source' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { order_source: 'fair' }, targetValues: { kept: 1 } });
    expect(plan).toEqual({ values: { kept: 1 }, carried: [], skipped: [] });
  });

  it.each([[''], [null], [[]]])('carries nothing for an empty source value %j', async (empty) => {
    const plan = await service({
      quote_request: [{ key: 'k', carryTo: ['order'] }],
      order: [{ key: 'k' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: empty }, targetValues: {} });
    expect(plan).toEqual({ values: {}, carried: [], skipped: [] });
  });

  it('ignores a dormant source key (no live source definition)', async () => {
    const plan = await service({ order: [{ key: 'gone' }] }).plan({
      ...QR_TO_ORDER,
      sourceValues: { gone: 'x' },
      targetValues: {},
    });
    expect(plan).toEqual({ values: {}, carried: [], skipped: [] });
  });

  it('keeps a target value already held — neither carried nor skipped (FR-009)', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', carryTo: ['order'] }],
      order: [{ key: 'k', valueType: 'number' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: 'new' }, targetValues: { k: 'old' } });
    expect(plan).toEqual({ values: { k: 'old' }, carried: [], skipped: [] });
  });

  it('skips a key with no target definition — target_missing', async () => {
    const plan = await service({ quote_request: [{ key: 'k', carryTo: ['order'] }] }).plan({
      ...QR_TO_ORDER,
      sourceValues: { k: 'v' },
      targetValues: {},
    });
    expect(plan).toEqual({ values: {}, carried: [], skipped: [{ key: 'k', reason: 'target_missing' }] });
  });

  it('skips a key whose value types differ — value_type_mismatch', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', valueType: 'number', carryTo: ['order'] }],
      order: [{ key: 'k', valueType: 'text' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: 12 }, targetValues: {} });
    expect(plan.skipped).toEqual([{ key: 'k', reason: 'value_type_mismatch' }]);
    expect(plan.values).toEqual({});
  });

  it('skips an internal value into a customer-visible field — audience_mismatch', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', audience: 'internal', carryTo: ['order'] }],
      order: [{ key: 'k', audience: 'customer' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: 'secret' }, targetValues: {} });
    expect(plan).toEqual({ values: {}, carried: [], skipped: [{ key: 'k', reason: 'audience_mismatch' }] });
  });

  it('carries a customer value into an internal field', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', audience: 'customer', carryTo: ['order'] }],
      order: [{ key: 'k', audience: 'internal' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: 'v' }, targetValues: {} });
    expect(plan.carried).toEqual(['k']);
  });

  it('skips a select value the target does not offer — value_invalid', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', valueType: 'select', options: ['fair', 'web'], carryTo: ['order'] }],
      order: [{ key: 'k', valueType: 'select', options: ['fair'] }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: 'web' }, targetValues: {} });
    expect(plan).toEqual({ values: {}, carried: [], skipped: [{ key: 'k', reason: 'value_invalid' }] });
  });

  it('judges a multiselect per value: carried when every held value exists on the target', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', valueType: 'multiselect', options: ['a', 'b', 'c'], carryTo: ['order'] }],
      order: [{ key: 'k', valueType: 'multiselect', options: ['a', 'b'] }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: ['a', 'b'] }, targetValues: {} });
    expect(plan).toEqual({ values: { k: ['a', 'b'] }, carried: ['k'], skipped: [] });
  });

  it('coerces the value with the target definition', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', valueType: 'number', carryTo: ['order'] }],
      order: [{ key: 'k', valueType: 'number' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: '12' }, targetValues: {} });
    expect(plan.values).toEqual({ k: 12 });
  });

  it('never consults an unrelated required target field', async () => {
    const plan = await service({
      quote_request: [{ key: 'k', carryTo: ['order'] }],
      order: [{ key: 'k' }, { key: 'mandatory', required: true }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { k: 'v' }, targetValues: {} });
    expect(plan).toEqual({ values: { k: 'v' }, carried: ['k'], skipped: [] });
  });

  it('carries the key "constructor" like any other', async () => {
    const plan = await service({
      quote_request: [{ key: 'constructor', carryTo: ['order'] }],
      order: [{ key: 'constructor' }],
    }).plan({ ...QR_TO_ORDER, sourceValues: { constructor: 'v' }, targetValues: {} });
    expect(plan.carried).toEqual(['constructor']);
    expect(Object.hasOwn(plan.values, 'constructor')).toBe(true);
    expect(plan.values['constructor']).toBe('v');
  });

  it.each([['quote_requests'], ['crm']])('carries nothing while the owner "%s" is absent', async (absent) => {
    const definitions = {
      quote_request: [{ key: 'k', carryTo: ['opportunity'] as SupportedEntityType[] }],
      opportunity: [{ key: 'k' }],
    };
    const plan = await service(definitions, [absent]).plan({
      sourceType: 'quote_request',
      targetType: 'opportunity',
      sourceValues: { k: 'v' },
      targetValues: { held: 'x' },
    });
    expect(plan).toEqual({ values: { held: 'x' }, carried: [], skipped: [] });
  });

  it('never loses a target key, carried and skipped alike', async () => {
    const plan = await service({
      quote_request: [
        { key: 'a', carryTo: ['order'] },
        { key: 'b', carryTo: ['order'] },
      ],
      order: [{ key: 'a' }],
    }).plan({
      ...QR_TO_ORDER,
      sourceValues: { a: '1', b: '2' },
      targetValues: { other: 'kept', dormant: [1] },
    });
    expect(plan.values).toEqual({ other: 'kept', dormant: [1], a: '1' });
    expect(plan.skipped).toEqual([{ key: 'b', reason: 'target_missing' }]);
  });
});
