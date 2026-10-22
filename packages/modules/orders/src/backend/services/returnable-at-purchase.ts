/**
 * Feature 155 (FR-016a, D-44; research R14) — the value placement stamps on
 * an order line's `returnable_at_purchase`: the product's returnable flag as
 * read at purchase, always an explicit boolean.
 *
 * Fail-closed (P4): only a record whose flag is `true` records `true`. An
 * absent record, or one whose flag is missing or malformed (a stub, an older
 * producer), records `false` — never `null`, which is reserved for lines placed
 * before the feature and which `returns` reads as "returnable" (FR-025).
 *
 * The parameter is deliberately looser than `CatalogProductRecord` so the
 * "flag missing" case is expressible: the producer is another module.
 */
export function returnableAtPurchase(record: { readonly returnable?: unknown } | null | undefined): boolean {
  return record?.returnable === true;
}
