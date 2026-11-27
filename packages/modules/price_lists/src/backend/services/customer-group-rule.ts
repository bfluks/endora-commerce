/**
 * The effective-customer-group rule (D-287 P0). It lives in
 * `@endora-commerce/contracts` since feature 168, because the megamenu's
 * customer-group audience must name the same group pricing does; it is
 * re-exported here so this module's callers and its truth table
 * (`customer-group-rule.test.ts`) keep their import.
 */
export { effectiveCustomerGroupId } from '@endora-commerce/contracts';
