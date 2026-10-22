/**
 * D-287 P0 — the one customer-group rule every pricing path applies:
 *
 *     effective group = explicit ?? customer.customerGroupId ?? organization.customerGroupId ?? null
 *
 * `explicit` is a group a caller already resolved for the customer (the quote
 * reference price and the admin order preview pass one); otherwise the signed-in
 * customer's own group overrides the organisation's (feature 040 R6). Before
 * this, listings, the product page and the cart passed the organisation alone
 * and priced on its group while quotes and the admin preview honoured the
 * customer's — the same buyer met different winning lists
 * (`specs/pricing/read-paths-and-performance.md` §2.2).
 *
 * The customer's group counts only when the account belongs to the
 * organisation the resolution is for. An account named beside another tenant's
 * organisation is ignored rather than allowed to price that tenant's lists on
 * its group (the same mismatch `BuyerLinePriceService` refuses outright).
 */
export function effectiveCustomerGroupId(input: {
  explicit?: string | null;
  customer?: { organizationId?: string | null; customerGroupId?: string | null } | null;
  organization?: { id: string; customerGroupId?: string | null } | null;
}): string | null {
  if (input.explicit) return input.explicit;
  const organization = input.organization ?? null;
  const customer = input.customer ?? null;
  if (customer && (customer.organizationId ?? null) === (organization?.id ?? null)) {
    if (customer.customerGroupId) return customer.customerGroupId;
  }
  return organization?.customerGroupId ?? null;
}
