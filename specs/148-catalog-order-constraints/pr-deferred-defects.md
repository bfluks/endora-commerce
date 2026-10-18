## Deferred defects (outside this feature)

Logged here (no `specs/deferred-defects.md` in this repository); carried into the PR description.

- **Login merge ignores the packaging unit** — `cart-service.ts:616–620` matches on product and
  variant only, so a pallet line merges into a piece line. Pre-existing, Out of Scope; checkout
  re-validation still holds.
- **Packaging dropped on reorder, quote → cart, accepted quote → basket, order → quote, resubmit** —
  `cart-read-port.ts:85–101`, `cart-conversion-service.ts:209–216`, `rfq-service.ts:933–942`,
  `order-clone-to-quote-service.ts:45–50`, `rfq-service.ts:686–698`. Pre-existing, Out of Scope.
- **Returns storefront pages are hard-coded English** — `storefront/app/(account)/returns/new/page.tsx`
  beyond the strings this feature touches.
- **`resubmit` keeps the packaging suffix in `productName` while dropping the packaging** —
  `rfq-service.ts:690` copies `src.productName` (which carries " (Pallet)") into a line with no
  packaging. Cosmetic; found while measuring.
- **The catalogue bulk edit is not on the Command Bus** — `catalog-bulk-update.service.ts:274` writes
  through the legacy `updateProduct` + `AuditPort.record`; per-product rows exist but outside
  `CommandBus.run` (Principle XIII). Pre-existing; this feature only adds a field to it.
- **Two concurrent return requests for one order line** — `createCase` reads the consumed quantities
  without a lock (`return-case-service.ts:101`, `:238`), so two simultaneous requests can each pass
  the remaining-quantity check. FR-033 closes the single-request split; the cross-request race is
  pre-existing.
- **The provenance stamp ignores the quote's validity** — `judgeQuoteRequestSource` stamps
  `source_quote_request_id` for an `Approved` quote whose `expiresAt` has passed. This feature applies
  the validity rule to exemptions only (R19); whether provenance should follow is a separate decision.
