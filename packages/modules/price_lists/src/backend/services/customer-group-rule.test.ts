import { describe, expect, it } from 'vitest';
import { effectiveCustomerGroupId } from './customer-group-rule.js';

describe('effectiveCustomerGroupId — one rule for every pricing path (D-287 P0)', () => {
  const organization = { id: 'org-1', customerGroupId: 'org-group' };

  it("prefers the customer's own group over the organisation's", () => {
    expect(
      effectiveCustomerGroupId({
        customer: { organizationId: 'org-1', customerGroupId: 'vip' },
        organization,
      }),
    ).toBe('vip');
  });

  it("falls back to the organisation's group when the customer has none", () => {
    expect(
      effectiveCustomerGroupId({
        customer: { organizationId: 'org-1', customerGroupId: null },
        organization,
      }),
    ).toBe('org-group');
  });

  it('answers null for an anonymous viewer', () => {
    expect(effectiveCustomerGroupId({})).toBeNull();
  });

  it('lets a group the caller already resolved win', () => {
    expect(
      effectiveCustomerGroupId({
        explicit: 'resolved',
        customer: { organizationId: 'org-1', customerGroupId: 'vip' },
        organization,
      }),
    ).toBe('resolved');
  });

  it("ignores the group of an account that belongs to another organisation", () => {
    expect(
      effectiveCustomerGroupId({
        customer: { organizationId: 'org-2', customerGroupId: 'vip' },
        organization,
      }),
    ).toBe('org-group');
  });
});
