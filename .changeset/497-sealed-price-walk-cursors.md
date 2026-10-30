---
'@endora-commerce/platform': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/test-kit': patch
---

A price-sorted or price-filtered catalogue cursor no longer reveals anything about a product the
viewer may not see (issue #497). Such a cursor was base64 of JSON. A page cut by its scan budget
continues from where its scan stopped, which can be a product hidden from the viewer, and under a
price sort that position held the product's resolved price and id; a full page ended on its last
card, whose price the viewer's display mode may withhold while the price order still ranks it.

- **`@endora-commerce/mod-catalog`.** Every cursor the price walks issue —
  `GET /api/v1/catalog/products` and the external catalogue API with `sort=price`, `sort=-price`,
  or `minPrice` / `maxPrice` under another sort — is sealed: it decodes to nothing and cannot be
  altered or forged. Paging is unchanged: a budget-cut page is still short or empty with
  `hasMore: true`, the walk still moves forward, and it still meets every product it shows once.
  The module now resolves the container value `cursorSeal` (`CatalogCradle.cursorSeal`), and
  `CatalogQueryService` takes it as a new last constructor argument; a price walk without it
  throws. The default listing's cursor is unchanged.
- **Cursors in flight.** A price-walk cursor of the old, readable format — a storefront link held
  across the upgrade — no longer continues the walk: it is discarded like any cursor that does not
  parse, and the listing answers its first page (`200`, not `400`). So does a cursor that was
  altered, and every price-walk cursor issued before the instance's `SESSION_COOKIE_SECRET` changes.
- **`@endora-commerce/platform`.** New `createCursorSeal(secret)` on `./composition`: AES-256-GCM
  from `node:crypto`, its keys derived with HKDF from the secret, the purpose bound as additional
  data, the plaintext padded to 128-byte blocks so a token's length does not follow an amount's
  digits. Deterministic (a synthetic IV, an HMAC of purpose and payload): one position seals to
  one token, so a storefront's next-page link stays one URL a cache and a crawler can reuse.
  `composeApp` registers `cursorSeal: createCursorSeal(process.env.SESSION_COOKIE_SECRET)`; no new
  environment input. The key is derived on first use, so a composition without a session
  key is not refused, and a seal or an open without one throws.
- **`@endora-commerce/test-kit`.** `composeTestServer` registers a `cursorSeal` with a pinned test
  key; a harness's own `values.cursorSeal` overrides it.
