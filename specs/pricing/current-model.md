# Pricing — the current model, as shipped

How a product price is stored and resolved **today**: tables, the resolution algorithm with its precedence and tie-breaks, where the two targeting layers (Application Rule and Price matrix) overlap, and the pain points that keep bringing pricing back. This describes the code, not the proposal — for the proposal see `decision-record.md`. When the model changes, rewrite this file in the same merge request.

**Verified against** `master` at `b1021c71b` on 2026-10-21, and **re-verified for the P0 read-path hardening and the #166 reorder fix** (D-287 P0, branch `fix/pricing-read-path-hardening` on `fd6255339`) on 2026-10-21. File:line citations in passages P0 did not touch are as of `b1021c71b`; re-check them before relying on one.

**Section numbers.** `§N` references follow the numbering of the original analysis, which is split across this directory: §1 → `current-model.md`; §2 → `read-paths-and-performance.md` (its summary table); §3–§9, §11, §12 → `decision-record.md`; §10 → `worked-examples.md`. `read-paths §N` points into `read-paths-and-performance.md`, `peers §N` into `peer-platforms.md`. Path abbreviations: `PL/` = `packages/modules/price_lists/src/`, `CON/` = `packages/contracts/src/`, `CAT/` = `packages/modules/catalog/src/`, `SF/` = `storefront/`.

---

## 1. Current state (verified in code)

### 1.1 Data model

| Table / column | Owner | What it is | Evidence |
| --- | --- | --- | --- |
| `price_lists` | price_lists | header: `name`, `type base\|sale`, `status draft\|active\|scheduled\|expired`, `starts_at/ends_at`, `application_rule jsonb`, `is_system`, `modified_at`; **legacy** `code`, `currency` (always written `'PLN'`), `priority` (always 0, unread by the engine), `is_default` | `PL/backend/entities/price-list.entity.ts:40-81`; `PL/migrations/20260504T125655_price_lists_engine.ts:44-92`; create writes `currency: 'PLN', priority: 0` at `PL/backend/services/price-list-service.ts:395-420` |
| `hasMatrixEntries` | — | computed `exists(...)` formula on every list read | `price-list.entity.ts:90-94` |
| `price_list_products` | price_lists | (list, product) roster | `…engine.ts:97-112`; entity `price-list-product.entity.ts` |
| `price_list_price_brackets` | price_lists | **the** stored price: (list, product, currency, min_qty) → max_qty, amount numeric(14,4); FK to roster; no variant column | `…engine.ts:117-138`; entity `price-list-price-bracket.entity.ts:17-45` |
| `price_list_price_brackets_unit_amount_idx` | price_lists | partial covering `(price_list_id, currency_code, amount, product_id) where min_quantity = 1` for price sort | `PL/migrations/20260821T135907_price_lists_unit_price_amount_index.ts:37-45` (7.4 MB / 112k, 132 MB / 1.6M) |
| `price_list_matrix_entries` (148) | price_lists | selection (product\|category\|attribute key+value) × optional `organization_id` × qty window × `fixed` (amount + `currency_code`) or `discount_percent` | `PL/migrations/20261016T131148_price_lists_price_matrix_entries.ts:26-87`; entity `price-list-matrix-entry.entity.ts:25-88` |
| `price_display_mode_overrides` | price_lists | gross/net/both/none per org/category/product | `…engine.ts:143-156` |
| Default system list | price_lists | id `00000000-0000-4000-8000-00000000d51b`, rule `{kind:'all'}`, DB-enforced singleton | seed `…engine.ts:167-218`; singleton `20260817T055457…:38-52`; refuses delete/status change/rule `price-list-service.ts:338-379` |
| `products.attribute_values.defaultPrice` (`price`) | catalog | bare number, no currency, edited in the Product editor ("Default unit price — Price-list overrides take precedence at checkout") | `CAT/admin/pages/ProductEditor.tsx:267-278`; whitelisted `CAT/backend/services/catalog-admin.service.ts:114-125`; label `packages/modules/catalog/i18n/en.json:390-391` |
| `product_variants.price_override` | catalog | numeric(12,2), written by the admin, **never read by `price_lists`** | `CAT/backend/entities/product-variant.entity.ts:29-30`; grep of `PL/` finds no reader |
| customer group | customer_accounts | one per organization (`organizations.customer_group_id`), a customer account may override | `packages/modules/organizations/src/backend/entities/organization.entity.ts:109-113`; `packages/modules/customer_accounts/src/backend/entities/customer-account.entity.ts:144-149` |

Where the **rule** sits: `ApplicationRule` = `all | criterion(type, values[]) | group(AND|OR, children)`,
criterion types `salesChannel, customerGroup, organization, category, currency`
(`CON/price-lists.ts:40-68`), depth ≤ 5 (`:87-90`). Evaluated by the pure
`evaluateApplicationRule` (`CON/price-lists.ts:1193-1245`), shared with `organizations`' "effective
price lists" panel (`packages/modules/organizations/src/backend/services/organization-effective-pricelists-service.ts:1-60`).
A non-system list cannot be activated with `{kind:'all'}` (`price-list-service.ts:566-572`).

### 1.2 Resolution algorithm, exactly as shipped

Inputs: product (id, `attributeValues`), quantity, organization (id, `customerGroupId`), optional
`customerGroupId`, optional `customerAccountId` (P0), sales channel (id, defaultCurrency), optional
currency (`PL/backend/services/pricing-service.interface.ts`, `PricingResolutionInput`).

**The customer group** (`group` below) is one rule on every entry point since P0
(`effectiveCustomerGroupId`, `PL/backend/services/customer-group-rule.ts`):

```
group = context.customerGroupId                 -- a group the caller already resolved
     ?? account(customerAccountId).customerGroupId   -- read once per call; only when the account
                                                 --   belongs to `organization`, else ignored
     ?? organization.customerGroupId
     ?? null
```

Callers name the buyer and the engine applies the rule: the catalogue listing, the product detail,
search, the typeahead, comparisons, product links, the `resolved-price` route and the cart pass
`customerAccountId`; quote reference prices and the admin order preview pass the group they
resolved. The price ordering (`orderByUnitPrice`, `pricedProductIds`) applies the same rule.

```
resolveEngine(product, qty, org, group, channel, currency)          pricing-service.ts:367-524
 0. cache key (product, variant, qty, currency, channel, org, group) → in-process LRU 60 s
 1. categories(product)            via catalog port                  :423-424, :337-347
    orgChain = [org, ...ancestors] via organizations port            :427-428
 2. ALL lists with status='active'  (no channel/currency filter)     :440
 3. for each list: evaluateApplicationRule(rule, ctx)                 :443-455
      matched? → partition by type (base | sale)
      explicitOn = criterion types that contributed; orgRank = nearest chain index
 4. matrix prefetch: entries of matched lists with hasMatrixEntries,
      product null|this, org null|in chain                            :231-272
 5. per partition — pickAndResolveBracket (fall-through walk)         :1356-1389
      pickPriorityChain(remaining):                                   price-list-resolver.ts:27-57
        level 1 explicit organization (nearest org rank wins)
        level 2 explicit customerGroup
        level 3 explicit category
        level 4 explicit salesChannel
        level 5 anything else (Default lives here)
        tie-break: newest modifiedAt, then name                      price-list-resolver.ts:59-69
      resolveListCandidate(list, product, qty, currency)              matrix-price-resolver.ts:231-300
        candidates: own bracket (orgRank ∞, specificity 4)  +
                    each entry whose selection/org/qty/currency match
        order:  orgRank asc → specificity desc (product 4, cat∩attr 3,
                attribute 2, category 1, all 0) → minQuantity desc →
                amount asc → entry id                                 :117-125, :205-219
        percent amount = reference × (100−p)/100, half-up 4 dp,
          reference = own bracket on this list, else Default bracket  :235-239, :260-270
        no candidate priced → fall through to next list
 6. line = sale partition if it priced anything, else base           pricing-service.ts:88-110
 7. display mode chain (new PriceListService per call)                :491-504
```

```
            ┌──────────── all active lists (JSONB rules) ────────────┐
buyer ─────▶│ evaluate rule ─▶ base partition      sale partition    │
            │                 org>group>cat>chan>other (+modifiedAt) │
            └──────┬───────────────────────────┬─────────────────────┘
                   ▼ first list that prices     ▼ first list that prices
            ┌──────────────────────┐     ┌──────────────────────┐
            │ inside the list:     │     │ inside the list:     │
            │ own bracket vs matrix│     │ own bracket vs matrix│
            │ orgRank>spec>qty>amt │     │ (same)               │
            └─────────┬────────────┘     └─────────┬────────────┘
                      ▼                            ▼
                  base price  ◀── replaced wholesale by ──  sale price (if any, even if higher)
                      ▼ none
               product.defaultPrice (listing/cart only, in the channel-default currency)
                      ▼ none
                   unpriced
```

**Entry points.** `resolveEngine` / `resolveLinePrice` resolve one product at one quantity. Three
batched entry points run the same algorithm over a set in "priority waves" — one bracket statement
per fall-through level, not per product — and answer exactly what the single call answers per item:
`resolveListingPrices` (quantity 1; the listing chain's `ListingPrice` per product),
`resolveListingPriceDetails` (P0; the same plus `basePrice`, `salePrice` and `displayMode` from one
resolution — `basePrice` is the base bracket, else the Product's own price when that is the listing
answer — which the catalogue emits as `ProductSummary.resolvedPrice` for the PDP, the home cards and
the typeahead) and `resolveLinePrices` (P0; many keyed lines, each at its own quantity, for the cart,
the placement price check, quote reference prices and the external catalogue API). Consequence for
the typeahead: a suggestion's `basePrice` now includes the own-price arm, which it lacked when it
was built from `resolveEngine`. The identities are asserted in
`backend/test/integration/price_lists/listing-prices-batch.test.ts` and `line-prices-batch.test.ts`.

The listing batch is the same algorithm
batched in "priority waves"; the price sort (`orderByUnitPrice`, `:791-883`) re-expresses it as a
merge of per-list index streams built by running `pickPriorityChain` to exhaustion
(`PL/backend/services/price-list-candidate-vector.ts:132-157`), with category criteria enumerated
as 2^k subsets and refused above 8 per rule (`:104-126`, `UnorderableRuleError`).

### 1.3 Where the two layers overlap

| Concept | Application Rule (list level) | Matrix entry (row level) | Own brackets |
| --- | --- | --- | --- |
| Organization | `organization` criterion, org-chain rank | `organization_id`, org-chain rank | — |
| Customer group | `customerGroup` criterion | **absent** | — |
| Category | `category` criterion (product-dependent) | `category_id` selection | — |
| Attribute | **absent** | `attribute_key/value` (isPriceRule) | — |
| Sales channel | `salesChannel` criterion | — | — |
| Currency | `currency` criterion | `currency_code` on fixed rows | `currency_code` per bracket |
| Product price | — | product entry **must** name an org (`CON/price-lists.ts:266-273`) | per product |
| Quantity | — | `min/max_quantity` | brackets |

So "Acme pays −10% on Screws" has at least three spellings (Acme list + category entry; any list +
category×Acme entry; category-rule list + brackets per product), and they resolve differently.

### 1.4 Pain points (why pricing keeps coming back)

Verified in code unless marked:

1. **Two base prices, no sync.** Default-list brackets are the effective base; the Product editor
   still edits `defaultPrice`, which was copied into the Default list **once**
   (`…engine.ts:226-301`) and never again (no subscriber in `PL/backend`). A re-priced product keeps
   its old Default bracket; the editor's field is silently shadowed. A product created later has no
   Default bracket and is priced from the attribute (listing only in the channel default currency,
   `PL/backend/services/listing-price-chain.ts:49`; the cart labels it with the basket channel's
   default currency since P0 — it was hard-coded PLN — and refuses it on a basket whose channel is
   gone, `CartLinePricing.orderablePrices`). Price sort ignores the
   attribute arm (unpriced tail, `CAT/backend/services/catalog-query.service.ts:949-959`).
2. **Percentage reference ignores the attribute arm**: `defaultBrackets` is only the Default list
   (`pricing-service.ts:278-291`), so a % entry on a product priced only by `defaultPrice` prices nothing.
3. **`modifiedAt` decides between same-level lists**, and renaming a list bumps it
   (`price-list-service.ts:518-545`) → renaming can change what customers pay. Matrix writes do not
   bump it (no `modifiedAt` in `price-matrix-service.ts`), an inconsistency on top.
4. **Sale wins even when higher.** `lineFromEngine` charges the sale bracket whenever one exists
   (`pricing-service.ts:88-110`): an "everyone" sale at 98 overrides Acme's contract at 95.
5. **Customer group is not a matrix coordinate**, and a product entry requires an organization, so
   "group VIP −10% on product P" is only expressible as a fixed bracket per currency on a group-rule list.
6. **Attribute only in the matrix, category in both**, org in both, currency in three places.
7. **The Default list cannot carry everyone-wide rules usefully**: its own bracket (specificity 4)
   outranks any non-org entry (≤ 3), so E1 needs a second list with a dummy non-empty rule (§10 E1).
8. **No channel/currency on the header** → every resolution loads every active list and evaluates
   every rule in memory, O(products × lists) (`pricing-service.ts:440,664,993`); no index can answer
   "which lists apply to me".
9. ~~**Customer's own group is ignored** on listings, PDP and cart~~ — fixed by P0: one rule on
   every path (§1.2). Still not applied by the external catalogue API, which names the bound
   organization but not the API key's customer account.
10. **Variants have no price dimension** (#377); `price_override` exists and is dead for pricing
    (since P0 the storefront variant picker no longer displays it).
11. **Cache**: process-local LRU (`pricing-cache.ts`). Since P0 it is cleared after commit, on
    every process (Redis `b2b:price_lists:pricing-generation`, best effort, TTL as the degraded
    bound) and by a status sweep that flips a list (read-paths §2.4); the sweep still runs every
    5 min; catalog writes (categories, attributes, `defaultPrice`) never invalidate; 5.3 % hit
    rate at 50 organisations (read-paths, `backend/test/perf/catalog/listing-price-viewer-cost.bench.ts:24-27`)
    because the key carries the organisation even when its prices equal everyone's.
12. **Several resolution chains** (listing chain, cart chain, order intake probe, buyer line
    price) — since P0 they share the customer-group rule and the batched entry points, and the cart
    has **one** chain for the read and for placement: `GET /api/v1/cart` prices through
    `CartLinePricing.orderablePrices` (agreed price at the agreed quantity → price list → own price
    in the basket channel's currency → refusal; display mode `none` refused), the chain placement's
    drift check runs, and a line it refuses reads as unavailable — #168 (read-paths §5). A
    reorder seeds through the same chain: every line at its current price, and a line the chain
    refuses is left out and reported in `unavailableItems` as `no_price` — #166.
13. **PLP cards cannot show strikethrough**: `ListingPrice` carries one amount + `isSale`
    (`CON/price-lists.ts:514-529`); only PDP/typeahead/home cards render base+sale — since P0 every
    `ProductSummary` carries `resolvedPrice`, so PLP cards could, but `ProductGrid` does not pass it
    yet.
14. **Promotions stack on sale prices with no way to exclude** (no price-list criterion in
    `packages/modules/promotions/src/backend/services/promotion-rule-evaluator.ts`, read-paths §6).

Already shipped and relevant to the PO's list: **duplication exists** — `PriceListService.duplicate`
copies rule, roster, brackets and matrix, resets to draft, names `(copy)`
(`price-list-service.ts:622-722`). The **`isPriceRule` attribute flag exists** and is consumed by
the matrix only (`PL/backend/services/matrix-price-resolver.ts:66-90`, filter: choice/boolean value
types, not language- or channel-scoped).
