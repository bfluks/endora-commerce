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
- **The catalogue bulk edit, including the bulk "returnable" edit, is not on the Command Bus** —
  `catalog-bulk-update.service.ts:274` writes through the legacy `updateProduct` +
  `AuditPort.record`; per-product audit rows exist but outside `CommandBus.run` (Principle XIII), so
  a bulk change is not undoable. Deferred by owner ruling; pre-existing, and this feature only adds
  a field to it.
- **Two concurrent return requests for one order line** — `createCase` reads the consumed quantities
  without a lock (`return-case-service.ts:101`, `:238`), so two simultaneous requests can each pass
  the remaining-quantity check. FR-033 closes the single-request split; the cross-request race is
  pre-existing.
- **The provenance stamp ignores the quote's validity** — `judgeQuoteRequestSource` stamps
  `source_quote_request_id` for an `Approved` quote whose `expiresAt` has passed. This feature applies
  the validity rule to exemptions only (R19); whether provenance should follow is a separate decision.
- **Line quantities have no upper bound** — a cart, quote or order line accepts any positive
  quantity. Pre-existing; tracked in issue #351.
- **A price edited between the pre-check and the write can still refuse after the basket was
  cleared** — a replacing batch (`replaceExisting`, `onLineError: 'throw'`) prices every line before
  it clears the basket (T162), but a price removed or switched to quote-only in the window between
  that pre-check and the write refuses the line after the clear. Residual race; placement re-prices
  every line, so no order is placed on a stale price.
- **A placement refusal after a one-click seed leaves that line in the basket** — one-click writes
  its line through `addItems` and refusals before the write leave the basket as it was (T167), but a
  refusal at `placeOrder` (stock, the organization, a payment or delivery method) comes after the
  write, so the basket holds the one one-click line. Inherent to one-click buying through the
  basket.
- **Storefront client interactions are not exercised in a DOM** — the storefront convention allows
  server-render tests only (owner ruling), so the blur normalisation, the quote draft's "Set to N"
  and the product card and comparison clicks are covered by tests of the pure helpers the
  components call (`normaliseOnBlur`, `draftQuantityFloor`, `draftQuantityOnType`,
  `draftQuantityOnBlur`, `cardAddToCartPayload`), source-wiring assertions and the owner's manual
  test. A proposal to permit jsdom for client components is raised separately in issue #355.
