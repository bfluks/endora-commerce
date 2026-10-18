import { describe, expect, it } from 'vitest';
import { returnableAtPurchase } from './returnable-at-purchase.js';

/**
 * Feature 155, Phase 12 (T090a) — the value placement stamps on every new order
 * line (FR-016a, D-44): the product's returnable flag as read at purchase,
 * always an explicit boolean. Fail-closed (P4, US6 #9): only a record whose
 * flag is `true` records `true`; an absent record, or one whose flag is missing
 * (a stub, an older producer), records `false` — never `null`, which is
 * reserved for lines placed before the feature and means "returnable" (FR-025).
 */
describe('returnableAtPurchase', () => {
  it('records true only for a record whose returnable is true', () => {
    expect(returnableAtPurchase({ returnable: true })).toBe(true);
  });

  it('records false for a record whose returnable is false', () => {
    expect(returnableAtPurchase({ returnable: false })).toBe(false);
  });

  it('records false — never null — for an absent record', () => {
    expect(returnableAtPurchase(undefined)).toBe(false);
    expect(returnableAtPurchase(null)).toBe(false);
  });

  it('records false — never null — for a record whose flag is missing or not a boolean', () => {
    expect(returnableAtPurchase({})).toBe(false);
    expect(returnableAtPurchase({ returnable: null })).toBe(false);
    expect(returnableAtPurchase({ returnable: 'true' as unknown as boolean })).toBe(false);
    expect(returnableAtPurchase({ returnable: 1 as unknown as boolean })).toBe(false);
  });
});
