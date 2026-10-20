import { describe, expect, it, vi } from 'vitest';
import type { CustomFieldCarryPlan, CustomFieldCarryPort } from '@endora-commerce/contracts';
import { carryIntoOpportunity } from './opportunity-custom-field-carry.js';

/**
 * Order / Quote Request → Opportunity custom-field carry
 * (`specs/158-custom-fields-value-carry/` research R-9, data-model §4.3): the
 * plan `custom_fields` answers, and the member the create or link Command adds
 * to its audit `after` — present only when something was carried or skipped.
 */
const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';

function port(plan: CustomFieldCarryPlan): CustomFieldCarryPort & { plan: ReturnType<typeof vi.fn> } {
  return { plan: vi.fn(async () => plan) };
}

describe('carryIntoOpportunity', () => {
  it('asks for an Opportunity plan over the current bag', async () => {
    const carry = port({ values: { held: 1 }, carried: [], skipped: [] });
    await carryIntoOpportunity(
      carry,
      { sourceType: 'order', recordId: ORDER_ID, sourceValues: { k: 'v' } },
      { held: 1 },
    );
    expect(carry.plan).toHaveBeenCalledWith({
      sourceType: 'order',
      targetType: 'opportunity',
      sourceValues: { k: 'v' },
      targetValues: { held: 1 },
    });
  });

  it('adds nothing to the audit entry when nothing was carried or skipped', async () => {
    const result = await carryIntoOpportunity(
      port({ values: { held: 1 }, carried: [], skipped: [] }),
      { sourceType: 'order', recordId: ORDER_ID, sourceValues: {} },
      { held: 1 },
    );
    expect(result).toEqual({ values: { held: 1 }, carried: [], after: {} });
  });

  it('names the source, the carried and the skipped keys when anything happened', async () => {
    const result = await carryIntoOpportunity(
      port({
        values: { k: 'v' },
        carried: ['k'],
        skipped: [{ key: 'gone', reason: 'target_missing' }],
      }),
      { sourceType: 'quote_request', recordId: ORDER_ID, sourceValues: { k: 'v', gone: 'x' } },
      {},
    );
    expect(result).toEqual({
      values: { k: 'v' },
      carried: ['k'],
      after: {
        customFieldCarry: {
          source: { entityType: 'quote_request', recordId: ORDER_ID },
          carried: ['k'],
          skipped: [{ key: 'gone', reason: 'target_missing' }],
        },
      },
    });
  });

  it('records a skip alone', async () => {
    const result = await carryIntoOpportunity(
      port({ values: {}, carried: [], skipped: [{ key: 'k', reason: 'audience_mismatch' }] }),
      { sourceType: 'order', recordId: ORDER_ID, sourceValues: { k: 'v' } },
      {},
    );
    expect(result.after).toEqual({
      customFieldCarry: {
        source: { entityType: 'order', recordId: ORDER_ID },
        carried: [],
        skipped: [{ key: 'k', reason: 'audience_mismatch' }],
      },
    });
  });
});
