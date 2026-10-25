# Contract: every consumer of availability and of effective values (FR-004, FR-017, FR-024)

One row per seam. "Port" = `catalogProductAvailabilityPort` (`product-scopes.md` §3). "L" =
`resolveScopeLanguage(channel, request tag)` for a buyer, `channel.defaultLanguage` for an operator. Every
refusal keeps the seam's **existing single not-found answer** (#227, #259). Research: R5–R10, R19.

| # | Module · file | Today | After |
| --- | --- | --- | --- |
| 1 | catalog · `catalog-query.service.ts` `listProducts` (`:661`) and the two price paths | `status: 'active'` + membership + audience | `availabilityCondition` replaces status/membership/audience in `#listingNarrowing`; `#passesPageFilters` calls the pure rule with the page's scope rows (defence in depth stays) |
| 2 | catalog · facets (`:1840`) | `status: 'active', deletedAt: null` | same condition; counts over effective attribute values (FR-017 b) |
| 3 | catalog · `getProductByIdOrSlug` (`:1286`) | 410 on `inactive`, 404 off-channel/audience, **draft reachable** | 410 when archived; 404 unless available at (C, L) (FR-005); by id or current key at (C, L) only |
| 4 | catalog · links / related (`product-link.service.ts:360`), bundle configuration validate | `status: 'active'` / via PDP | port semantics on linked/child ids (a child off at (C, L) is not purchasable via the parent — edge case) |
| 5 | catalog · quick search (`catalog-quick-search.service.ts:118`, consumer `quick_order`) | `p.status = 'active'`, baseline name | availability condition; match and return effective name (FR-017 a) |
| 6 | catalog · listing free-text, attribute filters, name sort | baseline JSONB; name sort keyed on slug | `effectiveTextSql` per key; name sort keyset `(effective name, id)` (FR-017 b) |
| 7 | search · `search-indexer.ts` `isPublishable` (`:787`), `buildDocument` | status/deleted/archived; default-language doc | `describeChannelAvailability`; doc fields of `data-model.md` §11; indexed when `liveLanguages` non-empty |
| 8 | search · `search-query.service.ts` filter + hydrate | channel index; hydrate `isProductVisibleTo` | index filter adds `liveLanguages`/window (R8); `attributesToSearchOn: ['localizedNames.<L>', …]`; hydrate through `filterAvailable` |
| 9 | seo · `sitemap-generator.service.ts:122-140` | `activeOnly` + anonymous audience | `describeChannelAvailability` + anonymous audience; one URL per live language with effective key (FR-074) |
| 10 | storefront · `app/sitemap.ts` | `listProducts` slugs | unchanged call; `ProductSummary.slug` now **is** the effective key at (C, L) |
| 11 | product_feeds · `product-selection.service.ts` | own status predicate | `filterAvailable` at the feed's channel and language, anonymous audience |
| 12 | comparisons · `comparison-service.ts:374`, `:530`, `:617` | `isProductVisibleTo` + in-memory status | `filterAvailable`; names and compared values via #384's `effectiveSystemText` / `effectiveAttributeValues` (FR-017 c) |
| 13 | carts · `cart-service.ts:782-819` add (and batch add) | audience + channel, **no status** (R0 F1) | `filterAvailable`; line and batch-outcome names via `effectiveNames` (FR-017 d); packaging-unit name snapshot in L; the basket view of a line whose product went off keeps `productName` and `productSku`, reads `unavailable`, and has `productSlug: null` (owner decision S1 = A) |
| 14 | carts / orders · `cart-minimums.ts:380`, `placement-minimums.ts:48` | missing record → `product_unavailable` | also unavailable when `filterAvailable` (cart's channel, cart's language, buyer, now) excludes it — re-evaluated at placement (FR-006, edge case *window boundary*) |
| 15 | carts / orders · feature-155 MOQ and `returnableAtPurchase` | global record fields | `effectiveOrderRules(ids, cart.salesChannelId)` / order's channel (FR-100) |
| 16 | quote_requests · `rfq-service.ts:223-225`, `:758`, snapshots `:462`, `:635` | audience + channel; baseline name | buyer: `filterAvailable` at (RFQ channel, L) → single not-found (FR-018); operator (`createOnBehalf`): accept + `warnings: [{ productId, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]`; names via `effectiveNames` in L (N2) |
| 17 | shopping_lists · `shopping-list-service.ts:236-249`, `:462` | audience + channel | `filterAvailable` |
| 18 | quick_order · `catalog-lookup.ts:56`, `routes.ts:106` | `productIdsInRequestChannel` + status | `filterAvailable`; `'unrestricted'` operator arm unchanged (exempt) |
| 19 | cms · product blocks — `storefront/lib/page-builder/catalog-block-data.ts` over `packages/cms-components/src/utils/catalog-block-data.ts` (cms's own `storefront-resolver.ts` reads pages only, never products) | `listProducts` + `getProductBySlug` (slugs stored in the block) | through rows 1 and 3, no own predicate; the stored slug keeps resolving after the product gains a language key (R28 stable handle) — T045a, T107 |
| 20 | orders · reorder (`order-reorder-service.ts:91`), quote `convertToOrder` and the operator's `prepare-customer-basket` (issue #170 — both go through `RfqService.seedBasketFromApproved`) | exempt (2026-08-21 ruling) | **unchanged** — commitments rebuild; placement (row 14) still refuses an unavailable line |
| 21 | price_lists · `routes.storefront.ts` `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId` | `findById` + global `isProductVisibleTo` (security review, checkpoint B) | `filterAvailable` at (request channel, L) for the viewer → the route's single 404; `markPersonalisedPricing` stays ahead of the read |
| 22 | inventory · `routes.ts` `GET /api/v1/storefront/inventory/stock/:id`; `availability-notification-service.ts` `#mayAcquire` (both notify-when-available routes) | `findById` + global `isProductVisibleTo` (+ `outOfRequestChannel` on notify) | `filterAvailable` at (request channel, L) for the caller → the one `PRODUCT_NOT_FOUND` (no 409/422 reachable for an unavailable product); outside a request the audience rule alone, as before |
| 23 | orders · `order-api-intake-service.ts` (external `POST /api/v1/external/orders`) | `findBySkus(activeOnly)` + membership (`listChannelsForEntity`) | owner decision W5 = A: `filterAvailable` at (key's channel, channel default language) for the bound Organization; an unavailable product is the unknown SKU's per-line issue (`SKU_NOT_IN_ASSORTMENT` at `lines.<i>.sku`) inside the existing whole-order 422 |
| 24 | catalog · `catalog-org-price-decorator.ts` `resolveBulkPrices` (external bulk-price probe) | `status: 'active'` + membership | owner decision W5 = A: `filterAvailable` at (key's channel, channel default language) for the bound Organization; an unavailable product gets no price and reads `sku_not_in_assortment`, like an unknown SKU |

## Events (R10)

`product.updated.v1` `changedFields` values added: `scopedStatus`, `publicationWindow`, `audience`,
`urlKeys`, `orderRules`, `media`, `attachments`, `packagingUnits`. `search`'s subscriber upserts on any of
them; `webhooks` delivers them unchanged in shape.

## Window sweep (R9)

Queue `catalog.publication-window.sweep`, Job Scheduler every 5 min, registered with `ctx.worker`.
`sweep(now)` selects product ids with `products.publish_from|publish_until` or an overridden
`product_channel_scopes.publish_from|publish_until` in `(lastSweep, now]`, emits one `product.updated.v1`
`['publicationWindow']` per id, then stores `now` as the watermark. Idempotent; a crash re-emits (harmless
upserts).

## Off-state tests (Constitution XVII)

- `seo` off: redirects answer 404, PDP metadata is derived, redirect and SEO rows persist and reappear on
  re-enable (FR-111) — `backend/test/integration/catalog/url-redirects-seo-off.test.ts` [PG].
- `search` off: the Postgres listing applies the same availability predicate (rows 1–2) — covered by the
  existing degrade path; asserted in `backend/test/contract/catalog/scoped-availability-matrix.test.ts` with the search backend off
  (T146).
- Consumers (`carts`, `quote_requests`, `comparisons`, `shopping_lists`, `quick_order`, `product_feeds`)
  keep their own off-state tests; the port's owner is non-deactivatable, so no new off-state case arises.
