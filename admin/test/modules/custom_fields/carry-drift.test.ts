import { describe, expect, it } from 'vitest';
import type { CustomFieldAudience, CustomFieldValueType, SupportedEntityType } from '@endora-commerce/contracts';
import {
  carryCounterpartsBrokenBy,
  carryDriftProceed,
  type CarryDriftDefinition,
} from '../../../../packages/modules/custom_fields/src/admin/lib/carry-drift';

/**
 * Feature 162 (T041, US4-6, US4-8, FR-019) — which enabled carries a change a
 * definition is about to undergo turns from compatible to incompatible
 * (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §1.4).
 */

let sequence = 0;
function def(
  entityType: SupportedEntityType,
  key: string,
  overrides: {
    valueType?: CustomFieldValueType;
    audience?: CustomFieldAudience;
    options?: string[];
    carryTo?: SupportedEntityType[];
  } = {},
): CarryDriftDefinition {
  sequence += 1;
  return {
    id: `def-${sequence}`,
    entityType,
    key,
    valueType: overrides.valueType ?? 'select',
    audience: overrides.audience ?? 'internal',
    options: (overrides.options ?? ['north', 'south']).map((value) => ({ value })),
    carryTo: overrides.carryTo ?? [],
  };
}

describe('carryCounterpartsBrokenBy', () => {
  it('names the carrying source when a target loses an option the source holds', () => {
    const source = def('quote_request', 'region', { carryTo: ['order'] });
    const target = def('order', 'region');
    expect(
      carryCounterpartsBrokenBy({ kind: 'remove-option', definitionId: target.id, optionValue: 'south' }, [source, target]),
    ).toEqual([{ entityType: 'quote_request', key: 'region', role: 'source' }]);
  });

  it('answers nothing when the removed option is one no source holds', () => {
    const source = def('quote_request', 'region', { carryTo: ['order'] });
    const target = def('order', 'region', { options: ['north', 'south', 'east'] });
    expect(
      carryCounterpartsBrokenBy({ kind: 'remove-option', definitionId: target.id, optionValue: 'east' }, [source, target]),
    ).toEqual([]);
  });

  it('names the target when a source gains an option the target lacks', () => {
    const source = def('quote_request', 'region', { carryTo: ['order', 'opportunity'] });
    const order = def('order', 'region');
    const opportunity = def('opportunity', 'region', { options: ['north', 'south', 'east'] });
    expect(
      carryCounterpartsBrokenBy({ kind: 'add-option', definitionId: source.id, optionValue: 'east' }, [
        source,
        order,
        opportunity,
      ]),
    ).toEqual([{ entityType: 'order', key: 'region', role: 'target' }]);
  });

  it('names the internal source when its target becomes visible to customers', () => {
    const source = def('order', 'channel', { valueType: 'text', options: [], carryTo: ['opportunity'] });
    const target = def('opportunity', 'channel', { valueType: 'text', options: [] });
    expect(
      carryCounterpartsBrokenBy({ kind: 'audience', definitionId: target.id, audience: 'customer' }, [source, target]),
    ).toEqual([{ entityType: 'order', key: 'channel', role: 'source' }]);
  });

  it('names the customer-visible target when its source becomes internal', () => {
    const source = def('order', 'channel', { valueType: 'text', options: [], audience: 'customer', carryTo: ['opportunity'] });
    const target = def('opportunity', 'channel', { valueType: 'text', options: [], audience: 'customer' });
    expect(
      carryCounterpartsBrokenBy({ kind: 'audience', definitionId: source.id, audience: 'internal' }, [source, target]),
    ).toEqual([{ entityType: 'opportunity', key: 'channel', role: 'target' }]);
  });

  it('answers nothing for an audience change the rule allows', () => {
    const source = def('order', 'channel', { valueType: 'text', options: [], carryTo: ['opportunity'] });
    const target = def('opportunity', 'channel', { valueType: 'text', options: [], audience: 'customer' });
    expect(
      carryCounterpartsBrokenBy({ kind: 'audience', definitionId: source.id, audience: 'customer' }, [source, target]),
    ).toEqual([]);
  });

  it('names every carrying source when a target is deleted', () => {
    const fromQuote = def('quote_request', 'region', { carryTo: ['order'] });
    const fromOpportunity = def('opportunity', 'region', { carryTo: ['order'] });
    const unrelated = def('opportunity', 'other', { carryTo: ['order'] });
    const target = def('order', 'region');
    expect(
      carryCounterpartsBrokenBy({ kind: 'delete', definitionId: target.id }, [fromQuote, fromOpportunity, unrelated, target]),
    ).toEqual([
      { entityType: 'quote_request', key: 'region', role: 'source' },
      { entityType: 'opportunity', key: 'region', role: 'source' },
    ]);
  });

  it('names the targets when a source is deleted, even a carry that already drifted', () => {
    const source = def('quote_request', 'region', { carryTo: ['order', 'opportunity'] });
    const order = def('order', 'region');
    // Already incompatible: the target lacks "south". Deleting still ends the carry.
    const opportunity = def('opportunity', 'region', { options: ['north'] });
    expect(carryCounterpartsBrokenBy({ kind: 'delete', definitionId: source.id }, [source, order, opportunity])).toEqual([
      { entityType: 'order', key: 'region', role: 'target' },
      { entityType: 'opportunity', key: 'region', role: 'target' },
    ]);
  });

  it('does not re-report a carry that was already incompatible before a non-delete change', () => {
    const source = def('quote_request', 'region', { carryTo: ['order'] });
    // Already lacks "south", so removing "north" too breaks nothing new.
    const target = def('order', 'region', { options: ['north'] });
    expect(
      carryCounterpartsBrokenBy({ kind: 'remove-option', definitionId: target.id, optionValue: 'north' }, [source, target]),
    ).toEqual([]);
  });

  it('answers nothing for a definition that carries nothing and receives nothing', () => {
    const lonely = def('order', 'region');
    const other = def('opportunity', 'region');
    expect(carryCounterpartsBrokenBy({ kind: 'delete', definitionId: lonely.id }, [lonely, other])).toEqual([]);
  });

  it('answers nothing for an unknown definition id', () => {
    expect(carryCounterpartsBrokenBy({ kind: 'delete', definitionId: 'missing' }, [def('order', 'region')])).toEqual([]);
  });

  it('handles a key that names an Object.prototype member', () => {
    const source = def('quote_request', 'constructor', { carryTo: ['order'] });
    const target = def('order', 'constructor');
    const lonely = def('order', 'toString', { carryTo: ['opportunity'] });
    expect(
      carryCounterpartsBrokenBy({ kind: 'remove-option', definitionId: target.id, optionValue: 'north' }, [source, target, lonely]),
    ).toEqual([{ entityType: 'quote_request', key: 'constructor', role: 'source' }]);
    expect(carryCounterpartsBrokenBy({ kind: 'delete', definitionId: lonely.id }, [source, target, lonely])).toEqual([]);
  });

  it('tolerates a definition read without carryTo', () => {
    const legacy: CarryDriftDefinition = {
      id: 'legacy',
      entityType: 'order',
      key: 'region',
      valueType: 'text',
      audience: 'internal',
      options: [],
    };
    expect(carryCounterpartsBrokenBy({ kind: 'delete', definitionId: legacy.id }, [legacy])).toEqual([]);
  });
});

/** Owner ruling W1 (2026-10-21): one proceed button per action, named after it. */
describe('carryDriftProceed', () => {
  it.each([
    ['remove-option', 'customFields.carry.warning.proceedRemoveOption', true],
    ['add-option', 'customFields.carry.warning.proceedAddOption', false],
    ['audience', 'customFields.carry.warning.proceedChangeAudience', false],
    ['delete', 'customFields.carry.warning.proceedDeleteField', true],
  ] as const)('names %s by %s, destructive: %s', (kind, labelKey, destructive) => {
    expect(carryDriftProceed(kind)).toEqual({ labelKey, destructive });
  });
});
