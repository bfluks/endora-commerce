# Pricing — how peer platforms model price lists

Reference research on Medusa.js v2 (primary), Shopware 6, commercetools, Magento / Adobe Commerce B2B, OroCommerce, SAP Commerce and BigCommerce: data model, conflict resolution (priority vs specificity), absolute vs percentage prices, where currency and channel sit, how buyer-specific prices are made fast for listing/sort/search, and admin UX worth copying. Every claim carries its source URL; researched from public documentation and source code on 2026-10-21.

**Verified against** `master` at `b1021c71b` on 2026-10-21; §3.6 written on 2026-10-25 for the four-place unit-price ruling. File:line citations are as of that commit; re-check them before relying on one.

**Section numbers.** `§N` references follow the numbering of the original analysis, which is split across this directory: §1 → `current-model.md`; §2 → `read-paths-and-performance.md` (its summary table); §3–§9, §11, §12 → `decision-record.md`; §10 → `worked-examples.md`. `read-paths §N` points into `read-paths-and-performance.md`, `peers §N` into `peer-platforms.md`. Path abbreviations: `PL/` = `packages/modules/price_lists/src/`, `CON/` = `packages/contracts/src/`, `CAT/` = `packages/modules/catalog/src/`, `SF/` = `storefront/`.

---

## What this means for Endora (architect's reading)

- **Medusa v2**: currency on each Price, no list-vs-list priority, specificity = rule count then
  cheapest, `sale` = min(list, default), `override` always wins, absolute amounts only (percent =
  Promotions), bulk grid rows = variants × columns = currencies with tiers in a cell, no duplication,
  no sort by calculated price (issue #11029). We **adopt**: sale/override semantics, in-cell tiers,
  audience on the list. We **deviate**: currency on the list (PO decision; one grid per currency),
  percentages in price lists (B2B contracts are written as "−15 % on screws"), explicit priority as a
  same-cell tie-break, a materialised price surface for sort.
- **Shopware**: explicit rule priority, first match; precomputed cheapest price keyed rule × currency;
  per-customer prices unsortable.
- **commercetools / SAP**: fixed specificity ladders (no priority number); commercetools documents
  the trap that a cheaper general price is never reached — we handle it with sale = min.
- **Magento B2B**: fixed or discount-% tier/group prices; price index per product × group × website.
- **OroCommerce** (closest B2B peer): priorities + merge flags per assignment level, strategy switch
  (merge-by-priority / minimal), percentage price rules **materialised to rows**, *Combined Price
  Lists* precomputed per distinct chain, shared by customers with the same chain, rebuilt on a queue,
  indexed in search as `minimal_price.<CPL>_<CUR>`.
- Synthesis I rely on: **every platform that offers percentages materialises them**, and fast
  buyer-specific sort is always "one precomputed price surface per pricing-context class". §6 does
  exactly that, keyed by audience class.

---

## Research

## 1. Medusa.js v2 (primary)

### 1.1 Data model

**PriceList** — https://docs.medusajs.com/resources/references/pricing/models/PriceList

| Field | Type | Notes |
| --- | --- | --- |
| `id` | id | |
| `title`, `description` | text | both required on create (admin API) |
| `status` | enum `PriceListStatus` | `active` / `draft` (admin shows derived *Scheduled* and *Expired* states, see 1.4) |
| `type` | enum `PriceListType` | `sale` / `override` |
| `starts_at`, `ends_at` | datetime, optional | |
| `rules_count` | number, optional | "The total number of rules of the price list" — maintained on upsert |
| `prices` | HasMany Price | |
| `price_list_rules` | HasMany PriceListRule | |
| `metadata` | JSON, optional | since v2.15.0 (https://docs.medusajs.com/resources/commerce-modules/pricing/concepts) |

**PriceListRule** — https://docs.medusajs.com/resources/references/pricing/models/PriceListRule
`attribute` (text, e.g. `region_id`), `value` (**JSON**, optional — stored as a JSON array so
`@>` containment can be used in the query, see 1.2), `price_list` (BelongsTo). There is no
operator and no priority on a price-list rule. The admin dashboard sends customer groups as
`rules: { "customer.groups.id": [ ...ids ] }`
(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/admin/dashboard/src/routes/price-lists/price-list-create/components/price-list-create-form/price-list-create-form.tsx),
and the store middleware puts the logged-in customer's groups into the pricing context as
`customer.groups[].id`
(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/medusa/src/api/utils/middlewares/products/set-pricing-context.ts).

**PriceSet** — https://docs.medusajs.com/resources/references/pricing/models/PriceSet
Just `id` + `prices`. "A PriceSet represents a collection of prices that are linked to a
resource" (variant, shipping option) through a module link
(https://docs.medusajs.com/resources/commerce-modules/pricing/concepts).

**Price** — https://docs.medusajs.com/resources/references/pricing/models/Price

| Field | Notes |
| --- | --- |
| `title` | optional |
| `currency_code` | **on each price** ("The currency code of the price. For example, `usd`.") |
| `amount` | BigNumber |
| `min_quantity`, `max_quantity` | optional; "minimum/maximum quantity that must be available in the cart for the price to be applied" |
| `rules_count` | number of `PriceRule` rows on this price |
| `price_set` | BelongsTo |
| `price_rules` | HasMany |
| `price_list` | BelongsTo, optional — null for a default price |

**PriceRule** — https://docs.medusajs.com/resources/references/pricing/models/PriceRule
`attribute` (e.g. `region_id`), `value` (e.g. `reg_123`), `operator` (`PricingRuleOperator`,
e.g. `eq`; docs also show `gte`, `in` — https://docs.medusajs.com/resources/commerce-modules/pricing/price-rules),
`priority` (number — present on the model, **but not read by the calculation code**, see 1.2),
`price` (BelongsTo).

**Where currency / region / channel sit.** Currency is **on every Price**, never on the list.
Region is **not** a column: it is an ordinary `PriceRule` with `attribute = "region_id"`
(https://docs.medusajs.com/resources/commerce-modules/pricing/concepts). Sales channel is not a
pricing dimension at all in the Pricing Module; it is a product-availability concern. Tax
inclusivity is a separate `PricePreference` keyed by `region_id` or `currency_code`
(https://docs.medusajs.com/resources/commerce-modules/pricing/tax-inclusive-pricing).

### 1.2 Price calculation algorithm

Documented behaviour (https://docs.medusajs.com/resources/commerce-modules/pricing/price-calculation):

- `calculatePrices(priceSetIds, context)` returns, per price set, a **calculated price** ("a
  price that belongs to a price list and best matches the specified context, or the same as the
  original price") and an **original price** (reference price for comparison / discount
  detection).
- Original-price selection: (1) no context rules → the default price (no rules); (2) a price
  matching **all** context rules; (3) otherwise prices matching at least one rule, "sorted by
  matched-rule count in descending order", first wins. "Prices from `sale` price lists are never
  selected as the original price."
- `override`: calculated and original are the same price-list price. `sale`: calculated may be
  the sale price, original is the non-sale price; if only sale prices match and there is no
  default price, `original_amount`/`original_price` are `null`.
- Returned object: `calculated_amount`, `original_amount`, `currency_code`,
  `is_calculated_price_price_list`, `is_original_price_price_list`,
  `is_calculated_price_tax_inclusive`, `is_original_price_tax_inclusive`, and
  `calculated_price`/`original_price` objects each with `id`, `price_list_id`,
  `price_list_type`, `min_quantity`, `max_quantity`. (Tax-inclusive flags per
  https://docs.medusajs.com/resources/commerce-modules/pricing/tax-inclusive-pricing.)

Actual implementation (develop branch):

**Repository query** —
https://raw.githubusercontent.com/medusajs/medusa/develop/packages/modules/pricing/src/repositories/pricing.ts

- Candidates: `price` rows for the price-set ids and the context `currency_code`, not deleted.
- Quantity: with a quantity in the context, a row qualifies when `min_quantity`/`max_quantity`
  bracket it (open bounds qualify); without one, rows with `min_quantity <= 1 or null`.
- Price lists are joined only if `status = active`, not deleted, inside `starts_at`/`ends_at`;
  a list survives if `pl.rules_count = 0` **or** the count of its `price_list_rule` rows
  matching the context (`plr.value @>` containment per attribute) **equals** `pl.rules_count`
  — i.e. a price list's rules are an AND and must all match.
- Per price, a LATERAL join counts matching `price_rule` rows; a price qualifies when
  `price.rules_count = 0` or `matched_count = price.rules_count` (all of the price's rules must
  match).
- With no context attributes at all ("simple context"), only rules-free prices and rules-free
  price lists qualify — lists with rules are skipped entirely.
- **ORDER BY** (this is the whole conflict-resolution policy):
  1. `price.price_list_id IS NOT NULL DESC` — price-list prices before default prices;
  2. `price.rules_count + COALESCE(pl.rules_count, 0) DESC` — **more total rules (price rules +
     price-list rules) wins**, i.e. built-in specificity by rule count;
  3. `price.amount ASC` — lowest amount breaks ties.

**Service** —
https://raw.githubusercontent.com/medusajs/medusa/develop/packages/modules/pricing/src/services/pricing-module.ts

- `priceListPrice = prices.find(p => p.price_list_id)` and `defaultPrice = prices.find(p =>
  !p.price_list_id)` — **first row in the ORDER BY wins**; a second matching price list is never
  looked at.
- `originalPrice = first non-SALE price-list price ?? defaultPrice`.
- `OVERRIDE`: `calculatedPrice = originalPrice = priceListPrice` (no amount comparison; the
  doc-comment says override "with the lowest amount", the code relies on the ORDER BY for that).
- `SALE`: `calculatedPrice = lte(priceListPrice.amount, defaultPrice.amount) ? priceListPrice :
  defaultPrice` — **a sale price never raises the price**; an override does.
- `rules_count` is not read in the service; `PriceRule.priority` is not read anywhere in the
  calculation path (only written). There is **no explicit priority between price lists**.

Consequences worth noting for a design:
- Two active price lists for the same customer group with the same rule count → the cheaper
  price wins (ORDER BY 3). A *customer-group* list (1 rule) beats a *global* list (0 rules)
  regardless of amount (ORDER BY 2) — even if the global list is cheaper.
- A quantity tier is just a Price with `min_quantity`/`max_quantity`; tiers are matched against
  the cart line's quantity ("Tiered pricing uses `min_quantity` and `max_quantity`", example
  with quantity 150 matching a `min_quantity: 100` price —
  https://docs.medusajs.com/resources/commerce-modules/pricing/price-calculation). Add-to-cart
  recomputes prices for the resulting total quantity (`getLineItemPricingQuantitiesStep`,
  https://raw.githubusercontent.com/medusajs/medusa/develop/packages/core/core-flows/src/cart/workflows/add-to-cart.ts).

### 1.3 Absolute vs percentage

**Absolute amounts only.** The admin create/update validators have `amount: z.number()`,
`currency_code`, `variant_id`, optional `min_quantity`/`max_quantity`, optional `rules`
record — "None of the schemas includes a percentage, discount, or discount-type field"
(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/medusa/src/api/admin/price-lists/validators.ts).
The user guide says prices are entered as fixed amounts in the bulk editor and does not mention
percentages (https://docs.medusajs.com/user-guide/price-lists/create). The module-level
`createPriceLists` input is the same: `amount`, `currency_code`, `min_quantity`,
`max_quantity`, `price_set_id`, `rules`
(https://docs.medusajs.com/resources/references/pricing/createPriceLists). Percentage-of-base
is the Promotion module's job (see 1.5).

### 1.4 Admin UX

Creation (https://docs.medusajs.com/user-guide/price-lists/create) — three steps, implemented
as tabs `detail → product → price` in the dashboard
(https://raw.githubusercontent.com/medusajs/medusa/develop/packages/admin/dashboard/src/routes/price-lists/price-list-create/components/price-list-create-form/price-list-create-form.tsx):

1. **Details** — Type (*Sale* "for temporary discounts on some products" / *Override* "for
   permanent price changes for a customer segment"), Title, Description, Status
   (Active/Draft), "Price list has a start date", "Price list has an expiry date", **Customer
   availability** (Browse → tick customer groups → Save; "Only customers in those groups see
   these prices"). Defaults: `type: "sale"`, `status: "active"`.
2. **Products** — searchable/filterable product picker.
3. **Prices** — the **Bulk Editor**: rows are the variants of each selected product;
   "You can set prices for every currency and region in the store" (columns are currencies and
   regions — the dashboard builds prices via `exctractPricesFromProducts(products, regions)`).
   **Quantity-based prices (v2.17.2+)**: click a price cell → expand icon → a form; "Add Price"
   adds tiers, each with a price, optional minimum cart quantity and optional maximum cart
   quantity.

Bulk editor mechanics (https://docs.medusajs.com/user-guide/tips/bulk-editor): spreadsheet-like
grid used for variant prices, inventory, price-list prices and shipping-option prices; "View"
button toggles columns (currencies); click-and-drag to select ranges; Tab saves and moves on;
Backspace clears selected cells; Cmd+Z undoes; drag the blue corner handle to fill down.

Management (https://docs.medusajs.com/user-guide/price-lists/manage): statuses shown are
**Draft**, **Active**, **Scheduled** (future start date) and **Expired**; edit details
(type/title/status/description); edit configuration (dates, customer groups); "Add products"
(select → bulk editor); "Edit prices" (bulk editor); remove products; metadata (v2.15+); delete
(type title to confirm).

**Duplication and import: not found.** Neither the create nor the manage guide mentions
duplicating a price list or importing prices into one. v1 had a price-list CSV import
(https://dev.to/medusajs/medusa-142-pricelist-import-medusa-hackathon-and-more-5076); in v2
only the product CSV import carries price columns (`Variant Price USD`, `Variant Price [Region]
[Currency]`) and those land on the default price set, not on a price list
(https://docs.medusajs.com/user-guide/products/import).

### 1.5 Interaction with promotions

- The cart line item's `unit_price` is the variant's `calculated_price.calculated_amount`
  (unless the caller passes a custom `unit_price`), and `compare_at_unit_price` is set to
  `original_amount` only when `price_list_type === "sale"` and the two amounts differ
  (https://raw.githubusercontent.com/medusajs/medusa/develop/packages/core/core-flows/src/cart/workflows/add-to-cart.ts,
  https://raw.githubusercontent.com/medusajs/medusa/develop/packages/core/core-flows/src/cart/utils/prepare-line-item-data.ts).
  `LineItem.compare_at_unit_price` is documented as "The original price of the item before a
  promotion or sale" (https://docs.medusajs.com/resources/references/cart/models/LineItem).
- Promotions are then applied **on top** as `LineItemAdjustment` rows (`amount`,
  `promotion_id`) computed by the Promotion module's `computeActions`; `is_discountable=false`
  excludes a line (https://docs.medusajs.com/resources/commerce-modules/cart/promotions).
  Promotions have `type: percentage|fixed`, target `items|shipping_methods|order`, allocation
  `each|across`, and rules on `customer.groups.id`, `region.id`, `currency_code`, etc.
  (https://docs.medusajs.com/resources/commerce-modules/promotion/concepts). So "10 % off for
  group X" is a promotion, not a price list.
- Storefront: `isSale = calculated_price.calculated_price.price_list_type === "sale"`; show
  `original_amount` as the compare-at price; only `sale` lists "can display as a
  strikethrough" — for `override` lists `original_amount === calculated_amount`, so there is
  nothing to strike through
  (https://docs.medusajs.com/resources/storefront-development/products/price/examples/sale-price).

### 1.6 Listing sort / search with customer-specific prices

- `calculated_price` is computed per request from the pricing context (region, currency,
  logged-in customer's groups) by the `setPricingContext` middleware and `QueryContext`
  (https://raw.githubusercontent.com/medusajs/medusa/develop/packages/medusa/src/api/utils/middlewares/products/set-pricing-context.ts,
  https://docs.medusajs.com/resources/commerce-modules/product/guides/price). It is a
  *decoration* of the result page, not a column.
- **Sorting by calculated price in the Store API is not supported.** Issue #11029 "[Bug]:
  Can't sort products by pricing based on the cheapest variant": `order=
  variants.calculated_price.calculated_amount` fails with `missing FROM-clause entry for table
  "calculated_price"`; the B2B starter sorts client-side after fetching; the issue was closed
  stale "not planned" with no maintainer answer, and users were still asking in 2025/2026
  (https://github.com/medusajs/medusa/issues/11029).
- The **Index Module** ("experimental and still in development") copies `Product`,
  `ProductVariant`, `Price`, `PriceSet`, `SalesChannel` into a relational side store at startup
  (kept in sync only with the Redis event bus) and enables cross-module filters; it is used by
  `/store/products` only behind `MEDUSA_FF_INDEX_ENGINE=true`
  (https://docs.medusajs.com/learn/fundamentals/module-links/index-module,
  https://medusajs.com/blog/improved-medusa-index/). It indexes **raw `Price` rows**, so a
  filter on `variants.prices.amount` is possible but it does not evaluate price-list rules,
  customer groups or quantity tiers — neither page claims calculated-price support.
- Search plugins (Meilisearch/Algolia) index whatever the configured `transformer` emits;
  community guides index `variants.prices.amount`/`currency_code` as sortable attributes —
  again raw prices, not buyer-specific calculated prices
  (https://docs.medusajs.com/plugins/search/meilisearch,
  https://rigbyjs.com/blog/complete-guide-on-how-to-integrate-meilisearch-with-medusajs —
  third-party).

**Net:** Medusa has no precomputed per-buyer price surface; buyer-specific sorting is an open
gap that each project solves outside the core.

---

## 2. Secondary platforms

### 2.1 Shopware 6 — Advanced Pricing + Rule Builder

- Model: `product.price` (default, per currency, gross+net, optional list price) and
  `product.prices` ("advanced prices"): each row has `ruleId`, `quantityStart`, optional
  `quantityEnd`, `price` per currency (gross/net), optional list price; a complete row needs
  `productId, ruleId, quantityStart`
  (https://docs.shopware.com/en/shopware-6-en/catalogues/products — "In the tab advanced pricing
  you can define different prices based on Rule Builder rules … as well as define scaled
  prices"; field names per the import/export reference found via
  https://docs.shopware.com/en/shopware-en/settings/importexport and the third-party
  https://shopware-import-export-docs.firebearstudio.com/entities/advanced-prices/entity/).
- **Conflict resolution = explicit rule priority, first match wins.** Rules carry a `priority`
  — "the higher the priority, the sooner it is executed"
  (https://docs.shopware.com/en/shopware-6-en/settings/rules). `RuleLoader` loads rules
  `ORDER BY priority DESC, id`
  (https://raw.githubusercontent.com/shopware/shopware/trunk/src/Core/Checkout/Cart/RuleLoader.php);
  `CartRuleLoader` filters them to those matching the cart and writes the ordered ids into the
  `SalesChannelContext` (`setRuleIds`), iterating up to 7 times until the matched set is stable
  (https://raw.githubusercontent.com/shopware/shopware/trunk/src/Core/Checkout/Cart/CartRuleLoader.php);
  `ProductPriceCalculator::filterRulePrices` loops `foreach ($context->getRuleIds() as $ruleId)`
  and returns the prices of the **first** rule id that has prices on the product, then sorts
  them by `quantityStart`; no rule match → fall back to `product.price`
  (https://raw.githubusercontent.com/shopware/shopware/trunk/src/Core/Content/Product/SalesChannel/Price/ProductPriceCalculator.php).
  No "lowest wins" between rules in core; a third-party note confirms "a higher number means a
  higher priority" (https://help.pickware.com/en/articles/659751-how-do-shopware-price-rules-behave-at-checkout).
- Percentage rules: **none in core advanced pricing** — rows are absolute per currency.
  Percentages live in Promotions. (The commercial B2B "Individual Pricing" component adds
  rule-based percentage pricing; it says core advanced prices rank above its rule-based prices
  and that among equal-priority rules the cheapest wins —
  https://developer.shopware.com/docs/products/extensions/b2b-components/individual-pricing/concepts/pricing-workflow.html.)
- **Listing performance: precomputed `cheapest_price` / `cheapest_price_accessor`.** A DAL
  indexer recomputes a per-product cheapest price on every product update "which removes the
  need for recalculation at read time"
  (https://developer.shopware.com/docs/guides/plugins/plugins/framework/data-handling/add-data-indexer.html).
  The accessor JSON is keyed `$.rule<ruleId|default>.currency<id>.<gross|net>` and the SQL for
  listing sort/filter is `COALESCE(rule-price for ctx rule 1, rule 2, …, ruledefault)`, with a
  second term per rule converting the default currency by the currency factor; the rule list
  is truncated to `maxRulePrices`
  (https://raw.githubusercontent.com/shopware/shopware/trunk/src/Core/Content/Product/DataAbstractionLayer/CheapestPrice/CheapestPriceAccessorBuilder.php).
  `CheapestPriceContainer::resolve` walks `[…ctx rule ids, 'default']` per variant, honours a
  `null` marker meaning "inherits default", filters by `sales_channel_ids` when present, and
  keeps the strictly lowest value
  (https://raw.githubusercontent.com/shopware/shopware/trunk/src/Core/Content/Product/DataAbstractionLayer/CheapestPrice/CheapestPriceContainer.php).
  Admin sortings may reference `product.cheapestPrice`
  (https://developer.shopware.com/docs/guides/plugins/plugins/storefront/howto/add-custom-sorting-product-listing.html).
  Trade-off stated by the B2B component: "Price sorting uses the indexed original prices, and
  individual pricing is applied after query execution" (pricing-workflow page above) — i.e.
  anything outside the rule/currency key space cannot be sorted on.

### 2.2 commercetools

- Price scope: "Prices are defined with a scope (currency and optionally country, CustomerGroup,
  and Channel and/or a validity period (validFrom and/or validTo)"; "Only one Price can exist
  for a given price scope"; a price without validity does not conflict with a time-bound one;
  max 100 embedded prices per variant (tiers count), else use Standalone Prices (SKU-keyed,
  up to 50 000 per variant, stageable)
  (https://docs.commercetools.com/api/projects/products#price-selection,
  https://docs.commercetools.com/api/pricing-and-discounts-overview,
  https://docs.commercetools.com/api/limits).
- **Price selection = fixed specificity ladder, cheapest within a rung, no priority
  number.** For the requested currency: (1) CustomerGroup+Channel+country, (2)
  CustomerGroup+Channel, (3) CustomerGroup+country, (4) CustomerGroup, (5) Channel+country,
  (6) Channel, (7) country, (8) none. "Within each step, time-bound prices take precedence over
  non-time-bound prices"; several matches in one step → cheapest (using the product-discounted
  value, tiers ignored); equal → first customer group in the customer's/business unit's
  assignment order. Documented pitfall: a cheaper price on a lower rung is never reached (Delta
  $99 at rung 7 loses to Beta $100 at rung 1)
  (https://docs.commercetools.com/api/pricing-and-discounts-overview).
- Multiple customer groups: B2C = cart group + customer's groups; B2B = business unit's groups
  only; a customer may hold up to 500 groups, project up to 10 000 (same page;
  https://docs.commercetools.com/api/limits).
- **Tiers** (`tiers[].minimumQuantity`): "Once reached, the tier price applies to the entire
  Line Item quantity"; evaluated per line item; ignored when a Product Discount applies
  (https://docs.commercetools.com/api/pricing-and-discounts-overview).
- **Product Discounts** = the percentage-of-base mechanism: relative (%) / absolute /
  external; predicate (SKU, category, attributes, customer group…); `sortOrder` is "a unique
  decimal between 0 and 1", closer to 1 = higher rank; "Only one Product Discount can apply to
  a Product at any given time (the highest ranked active Product Discount)"; max 500 active;
  `discountCombinationMode` default `Stacking` applies product discounts before cart discounts
  (https://docs.commercetools.com/api/projects/productDiscounts,
  https://docs.commercetools.com/learning-price-and-discount-your-products/product-discounts/how-discounts-work,
  https://docs.commercetools.com/api/limits). The discounted value is materialised on the
  price (`price.discounted`) rather than computed per request (the Products page notes changing
  a price drops an external discount "unless `price.discounted` is provided" —
  https://docs.commercetools.com/api/projects/products).

### 2.3 Magento / Adobe Commerce B2B

- **Tier / group prices** on the product (Advanced Pricing): Website, Customer Group (or
  Shared Catalog; "ALL GROUPS"), Qty (minimum), Price **Fixed or Discount %** ("The percentage
  is calculated against the Price field, not the Special Price field"). Group price = tier at
  qty 1. Resolution: **"Final Price = Min(Regular(Base) Price, Group(Tier) Price, Special
  Price, Catalog Price Rule)"**; among tiers the highest qualifying quantity applies
  (https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/products/pricing/product-price-tier,
  https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/products/pricing/product-price-group).
- **Catalog price rules**: Websites + Customer Groups scoping, From/To, **Priority ("lowest
  number … takes effect")**, Actions *Apply as percentage of original / Apply as fixed amount /
  Adjust final price to this percentage / Adjust final price to discount value*, **"Discard
  subsequent rules"** to stop stacking; rules are applied by a nightly job (Cloud Service:
  every minute) — a batch, not request time
  (https://experienceleague.adobe.com/en/docs/commerce-admin/marketing/promotions/catalog-rules/price-rules-catalog-create).
- **Shared Catalogs** (B2B): one public + any number of custom catalogs, each assigned to
  companies and backed by its own customer group; "Set Pricing and Structure" picks products
  then sets a Custom Price per product as **Fixed or Percentage**, with bulk actions *Set
  Discount* (percent to all selected) and *Adjust Fixed Price*; "The minimum value between the
  Base Price and the entered Fixed value is used as the final product price"; tier prices per
  product via Configure
  (https://experienceleague.adobe.com/en/docs/commerce-admin/b2b/shared-catalogs/define/catalog-shared-pricing-structure,
  https://experienceleague.adobe.com/en/docs/commerce-admin/b2b/shared-catalogs/catalog-shared).
  Base-price change: a percentage custom price follows it, a fixed one never changes
  (https://experienceleague.adobe.com/en/docs/commerce-knowledge-base/kb/faq/base-price-change-affect-on-shared-catalog-price).
- **Price index per (website, customer group)**: indexer `catalog_product_price`
  "Pre-calculates product prices"
  (https://developer.adobe.com/commerce/php/development/components/indexing/); dimension
  modes `none | website | customer_group | website_and_customer_group`, "Catalog Price can be
  paralleled by website and customer groups"
  (https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/cli/manage-indexers);
  the index table holds one row per product × customer group × website with `price`,
  `final_price`, `min_price`, `max_price`, `tier_price` and listing sort uses `min_price`
  (community evidence: https://community.magento.com/t5/Magento-2-x-Technical-Issues/Catalog-Price-Rule-s-not-taking-effect-2-2-3-EE/td-p/95814,
  https://community.magento.com/t5/Magento-2-x-Technical-Issues/Custom-csv-import-to-table-catalog-product-index-price/td-p/474475).
  Cost: "Each website, customer group, shared catalog, and product SKU is indexed against the
  others", so the indexer slows with the product of those counts; excluding websites from a
  customer group reduces work
  (https://developer.adobe.com/commerce/php/development/components/indexing/optimization).

### 2.4 OroCommerce (most relevant B2B peer)

- **Price list** = prices per product × unit × quantity tier × currency; created manually,
  imported, or generated by rules
  (https://doc.oroinc.com/5.1/user/concept-guides/catalog-promotions/pricing/).
- **Assignment** at four levels — system config, website, customer group, customer — each
  holding an ordered list of price lists with a **Priority** and a per-list **Merge Allowed**
  flag; "Custom configuration on the customer level has the highest priority"; **Fallback**
  per level (default chain Customer PLs > Customer Group PLs > Website PLs > Global PLs;
  disabling fallback at a level cuts off everything above it). Merge Allowed on: the list fills
  tiers higher-priority lists left empty; off: its prices are used only for products no
  higher-priority list priced, and the product is then closed to lower lists. Schedules: a
  price list can carry several activation time slots (same page;
  https://doc.oroinc.com/5.0/user/back-office/sales/price-lists/schedule/).
- **Pricing strategy (global switch)**: *Merge by priority* — "picks the first price from the
  given sequence of the Price Lists for an empty slot" (per quantity tier); *Minimal prices*
  (default since 2.2) — "picks the minimum price from the given sequence of Price Lists" per
  tier. Custom strategies implement `PriceCombiningStrategyInterface`
  (https://doc.oroinc.com/bundles/commerce/PricingBundle/pricing-strategy/).
- **Price rules (percentage-of-base and more)**: automatic price lists have a product
  assignment rule (`product.category.id == 12 and product.margin > 0.1`) and calculation rules
  with *Price for Quantity/Unit/Currency*, *Calculate As* (`99` or
  `pricelist[1].prices.value * 0.9`), *Condition*, *Priority*; "uses the rule with the highest
  priority" when several match; manual prices beat generated ones; recalculated whenever
  product data changes (https://doc.oroinc.com/user/back-office/sales/price-lists/auto/).
  The expression language is Symfony ExpressionLanguage compiled to Doctrine
  `INSERT … SELECT`; "Function calls are not supported by design, as every expression must be
  convertible to SQL"; division-by-zero guards, rounding to configured precision, negatives
  dropped (https://doc.oroinc.com/master/bundles/commerce/PricingBundle/price-rule-expression-language/).
  **Generated prices are materialised rows**, not formulas evaluated at read time.
- **Combined Price Lists (CPL)** = "an internal entity that stores prices displayed to the end
  customer". Each distinct chain (set of price lists; under merge-by-priority also their
  order and merge flags) becomes one CPL whose prices are precomputed; entities with identical
  chains share a CPL ("Reuse is more common under the minimal strategy, where only the unique
  set of price lists matters"). Rebuild triggers: price change (`PriceListProcessor` schedules
  per affected products), new chain, structural change (only active lists with ≥1 price are
  included), the `oro:cron:price-lists:schedule` cron for activation switches; three phases —
  gather assignments (seconds–minutes), build CPLs (minutes–hours, DB-heavy), garbage-collect
  unlinked CPLs and obsolete activation rules then reindex per website. Advice: avoid price
  lists not tied to any customer/group/website and empty lists (adding the first price rebuilds
  every CPL containing it)
  (https://doc.oroinc.com/master/bundles/commerce/PricingBundle/combined-price-lists/,
  https://doc.oroinc.com/master/bundles/commerce/PricingBundle/optimize-index-and-price-calculation/).
- **Search index**: the website search index gets `minimal_price.CPL_ID_CURRENCY_UNIT` and
  `minimal_price.CPL_ID_CURRENCY` fields per product (flat storage:
  `minimal_price.PRICE_LIST_ID_…`); storefront price sort/filter run on these; a `pricing`
  field group allows partial reindex of price fields only; "never requests an unconditional
  full reindex" — single price edits, imports, rule changes, assignment changes and
  activations each have a targeted path
  (https://doc.oroinc.com/master/bundles/commerce/PricingBundle/pricing-and-search/).
- **Flat pricing** mode: no strategies, no merging, no fallback; prices come straight from the
  assigned list (for ERP-driven setups)
  (https://doc.oroinc.com/5.1/user/concept-guides/catalog-promotions/pricing/).
- **Sharding**: optional "one table per price list" for very large price volumes; "Combined
  prices cannot be sharded at the moment"; cross-list reads need one JOIN per list
  (https://doc.oroinc.com/master/bundles/commerce/PricingBundle/price-list-sharding/).

### 2.5 SAP Commerce (Europe1 pricing)

- A `PriceRow` "is qualified by product, product price group, user, user group, currency,
  unit, min quantity and a daterange", and is net or gross. **Fixed specificity ladder**:
  "P + C > P + UG > PG + C > PG + UG > PG > UG" (Product+Customer, Product+UserGroup,
  ProductGroup+Customer, ProductGroup+UserGroup, …) — "since always one price must be found,
  but multiple rows may match there must be some kind of ordering"; among equal matches "the
  one with the greatest quantity is chosen"
  (https://help.sap.com/doc/02d5152884b34821a06408495ba0b771/1905/en-US/de/hybris/platform/europe1/jalo/PriceRow.html).
  Either a user or a user price group is set on a row, never both
  (https://help.sap.com/doc/9fef7037b3304324b8891e84f19f2bf3/2011/en-US/de/hybris/platform/europe1/jalo/Europe1PriceFactory.html).
  Percentage logic is the separate discount-row mechanism of the same factory (not researched
  further here).

### 2.6 BigCommerce

- A Price List is a per-variant override set: records keyed by (price list, variant,
  currency) with `price`, `sale_price`, `retail_price`, `map_price` and optional
  `bulk_pricing_tiers` (`quantity_min`, `quantity_max`, `type` with `percent` shown in the
  example, `amount`) (https://docs.bigcommerce.com/docs/rest-management/price-lists; field list
  via the CData mirror https://cdn.cdata.com/help/UBN/ado/pg_BigCommercetable-pricelistrecords.htm).
- **Fixed resolution ladder**, one list wins, missing variants fall back: (1) list assigned to
  the current customer group **and** channel, (2) list assigned to the customer group,
  (3) customer-group discounts, (4) channel default list, (5) catalog price — "any prices not
  found fall back to the catalog price"; a list cannot be assigned to a group that has
  group discounts; a variant with a price record ignores product-level bulk pricing
  (https://docs.bigcommerce.com/docs/rest-management/price-lists).

---

## 3. Synthesis

### 3.1 Explicit priority number vs built-in specificity

| Platform | Mechanism | Tie-break |
| --- | --- | --- |
| Medusa v2 | built-in: price-list prices first, then **rule count** (price rules + list rules), then **lowest amount**; `sale` never raises the price, `override` always wins | lowest amount, then arbitrary |
| commercetools | built-in: 8-rung scope ladder (group+channel+country … none); time-bound before open-ended | cheapest in the rung, then customer-group order |
| SAP Commerce | built-in: P+C > P+UG > PG+C > PG+UG > PG > UG | greatest min-quantity |
| BigCommerce | built-in: group+channel > group > group discounts > channel default > catalog | n/a (one list) |
| Magento | tier/group/special/catalog-rule: **min of all**; catalog rules: **explicit priority** (lowest number first) + "discard subsequent rules" | lowest price |
| Shopware 6 | **explicit rule priority** (higher number first), first matching rule's price wins | rule id |
| OroCommerce | **explicit priority per assignment level** + merge flag + per-level fallback, *or* global "minimal prices" strategy | strategy-dependent |

Known pain points:
- Pure specificity (commercetools, SAP) is predictable but **cannot express "this cheaper
  general price should still win"** — commercetools documents exactly that trap
  (https://docs.commercetools.com/api/pricing-and-discounts-overview).
- Medusa's rule-count heuristic makes a one-rule customer-group list beat a zero-rule global
  sale even when the sale is cheaper, and two equal-rule lists are decided by amount only —
  there is no way to say "list A beats list B" (source in 1.2).
- Explicit priorities (Shopware, Magento rules, Oro) are expressive but need an admin UI that
  shows the resulting order, and overlapping rules become a maintenance problem
  (Shopware third-party guidance to avoid overlaps: https://www.2hatslogic.com/?p=18541).
- Oro's "minimal prices" default sidesteps priority entirely by always taking the cheapest
  tier across all applicable lists — simple to reason about, impossible to use for "override
  upwards" (https://doc.oroinc.com/bundles/commerce/PricingBundle/pricing-strategy/).
- "Lowest wins" semantics (Magento final price, Medusa sale, commercetools rung) imply that an
  *override that raises a price* needs a distinct type — Medusa's `override`, Magento shared
  catalog *Fixed* (still capped by base price!), Shopware rule price (not capped).

### 3.2 Absolute vs percentage-of-base

- **Absolute only in the price-list entity**: Medusa (validators), Shopware core advanced
  prices, commercetools Price/StandalonePrice, SAP PriceRow, BigCommerce records (tiers may be
  `percent`).
- **Percentage available**: Magento tier price *Discount %*, Magento shared-catalog custom
  price *Percentage* (re-derived when the base changes), Magento catalog price rules (4 action
  types), commercetools Product Discounts (relative, one per price, materialised into
  `price.discounted`), Oro price rules (`pricelist[1].prices.value * 0.9`, compiled to SQL and
  **materialised as rows**), Shopware B2B Individual Pricing (commercial).
- Pattern: platforms that offer percentages **materialise the result** (Magento index, Oro
  generated rows, commercetools `discounted`) rather than evaluating formulas at read time,
  and keep "manual beats generated" (Oro) or "fixed never moves" (Magento) rules explicit.

### 3.3 Where currency / channel sit

- **Currency on each price, never on the list**: Medusa (`Price.currency_code`), commercetools
  (scope), Shopware (price JSON per currency, with a currency-factor fallback from the default
  currency), SAP (`PriceRow.currency`), BigCommerce (record key includes currency), Oro
  (price row has currency; price list declares the set of currencies it may hold).
- **Region / country / channel**: Medusa = a `PriceRule` (`region_id`) on the price, not a
  column; commercetools = `country` + `channel` in the scope with fallback ladder; Shopware =
  rule conditions (sales channel is a rule condition; cheapest-price entries can carry
  `sales_channel_ids`); BigCommerce = price-list **assignment** to channel; Oro = **website**
  as an assignment level; Magento = **website** dimension of the index.
- Customer scoping is almost universally **on the list / assignment**, not on the price
  (Medusa `PriceListRule customer.groups.id`, BigCommerce group assignment, Oro customer/group
  level, Magento shared catalog ↔ customer group, Shopware rule). commercetools and SAP are
  the exceptions: customer group is part of the price's own scope.

### 3.4 Fast buyer-specific listing / sort / search

Dominant technique: **precompute one price surface per "pricing context class" and index
that**, with the storefront resolving the buyer to a context id before querying.

- Oro: CPL per distinct chain; search index fields `minimal_price.<CPL>_<CUR>_<UNIT>`; partial
  reindex of the `pricing` field group; rebuild cost "minutes to hours"; CPL count kept down by
  sharing identical chains (https://doc.oroinc.com/master/bundles/commerce/PricingBundle/combined-price-lists/,
  https://doc.oroinc.com/master/bundles/commerce/PricingBundle/pricing-and-search/).
- Magento: `catalog_product_index_price` row per product × customer group × website
  (`final_price`, `min_price`…); parallelisable by dimension; cost grows with the product of
  websites × groups × SKUs (sources in 2.3).
- Shopware: per-product JSON `cheapest_price_accessor` keyed by rule × currency × gross/net;
  listing SQL = `COALESCE(ctx rule 1, ctx rule 2, …, default)`; rule list truncated at
  `maxRulePrices`; anything not expressible as rule×currency (the commercial per-customer
  pricing) is "applied after query execution" and cannot be sorted on (sources in 2.1).
- commercetools: price is selected server-side by scope ladder at query time; product
  discounts are materialised on the price; sorting by price in Product Search works on the
  selected price with the same `priceCustomerGroup`/`priceChannel`/`priceCountry` parameters
  (https://docs.commercetools.com/api/projects/products#price-selection) — effectively
  "index every scoped price, choose at query time", feasible because scope is a bounded
  ladder, not arbitrary rules.
- Medusa: none — request-time decoration, sort unsupported (issue #11029), experimental Index
  module indexes raw prices only.

Trade-offs: (a) precompute cost scales with distinct contexts × products (Magento, Oro) —
mitigated by deduplicating identical chains (Oro CPL sharing) and partial reindex; (b) rule-keyed
surfaces (Shopware) only work when the context is a small ordered id list; (c) materialised
surfaces lag writes (Magento nightly rule application, Oro build queue, Oro schedule cron) so
the design needs an explicit "pending recalculation" state; (d) quantity tiers are indexed as
the **minimal** price (Oro) or **min_price** (Magento) — sort/filter use the lowest tier, not
the qty-1 price, which must be a deliberate product decision.

### 3.5 UX patterns worth copying for a spreadsheet-like grid with quantity tiers

- **Wizard = Details → Audience → Products → Prices**, with type (`sale` vs `override`)
  chosen first because it changes the semantics (Medusa:
  https://docs.medusajs.com/user-guide/price-lists/create). Oro adds schedules (multiple
  activation windows) and Medusa derives *Scheduled*/*Expired* from dates instead of making the
  user manage status.
- **Grid**: rows = variants grouped under their product, columns = currency (and region)
  cells; column visibility toggle; drag-select, Tab to commit and move, Backspace clear,
  Cmd+Z, fill-down handle (Medusa bulk editor:
  https://docs.medusajs.com/user-guide/tips/bulk-editor).
- **Quantity tiers inside a cell**: Medusa (v2.17.2+) opens a per-cell sub-form via an expand
  icon with "Add Price" rows (price, min qty, max qty) — keeps the grid flat and tiers
  optional; Magento's "Configure" link in a Tier Price column showing "(n)" tier count is the
  same idea (https://experienceleague.adobe.com/en/docs/commerce-admin/b2b/shared-catalogs/define/catalog-shared-pricing-structure).
- **Bulk actions on a selection**: Magento *Set Discount %* / *Adjust Fixed Price* applied to
  all selected rows, and a Custom Price column that shows both value and kind (fixed vs %)
  (same page). Worth copying if percentage entries are allowed.
- **Visible derived state**: Magento's KB makes the "fixed never follows base, percentage does"
  rule explicit; Oro marks manual prices as protected from recalculation. A grid should show
  which cells are manual, derived, or inherited (Shopware's `null`="inherits default" marker is
  the data-model counterpart).
- **Fallback transparency**: BigCommerce and Oro both document a strict fallback ladder; the
  admin should show *effective price for a given customer* with the originating list — Oro
  users rely on this when debugging CPLs.
- **Import**: Oro and Magento treat CSV import of tier/price rows as the primary path for
  large catalogs ("use the Data Transfer import for multiple products"); Medusa v2 has none for
  price lists — the absence is a known regression from v1.

### 3.6 How prices are stored and rounded

Written for the four-place unit-price ruling of 2026-10-25 (`worked-examples.md` §10.18): a price
book stores four places, and the question is where a sub-cent unit price is rounded — at the unit,
or at the line. The facts below are the owner's, as given with the ruling; the URLs are where each
one is read, and they were not re-fetched for this change.

| Platform | Storage | Where a unit price is rounded | Source |
| --- | --- | --- | --- |
| **Magento / Adobe Commerce** | `decimal(20,4)` price columns (quote, order and index tables) | **At the unit**: the tax calculators round the unit price to `PriceCurrencyInterface::DEFAULT_PRECISION = 2` before multiplying it by the quantity (`AbstractAggregateCalculator`, the row- and total-based calculators) — so a 0.0125 price is charged as 0.01 per piece, the behaviour Endora had until this ruling | <https://github.com/magento/magento2/blob/2.4-develop/app/code/Magento/Tax/Model/Calculation/AbstractAggregateCalculator.php>, <https://github.com/magento/magento2/blob/2.4-develop/lib/internal/Magento/Framework/Pricing/PriceCurrencyInterface.php>, <https://github.com/magento/magento2/blob/2.4-develop/app/code/Magento/Quote/etc/db_schema.xml> |
| **Sylius** | **Integer minor units**: `ChannelPricing.price` and `OrderItem.unitPrice` are `integer` (cents) | Nowhere — a sub-cent price cannot exist; a price is a whole number of cents | <https://github.com/Sylius/Sylius/blob/2.0/src/Sylius/Bundle/CoreBundle/Resources/config/doctrine/model/ChannelPricing.orm.xml>, <https://github.com/Sylius/Sylius/blob/2.0/src/Sylius/Bundle/OrderBundle/Resources/config/doctrine/model/OrderItem.orm.xml> |
| **Medusa v2** | `BigNumber` in **major units**, each amount column paired with a `raw_` JSON column holding the exact value | **Not in the totals**: the line and tax total computations carry the exact `BigNumber` and do not round | <https://docs.medusajs.com/learn/fundamentals/data-models/properties#bignumber>, <https://github.com/medusajs/medusa/tree/develop/packages/core/utils/src/totals> |
| **commercetools** | **High-precision prices**: a `highPrecision` money type with an explicit `fractionDigits` beyond the currency's, beside the centAmount rounded to the currency | **At the line**: the line total is the high-precision unit price × quantity, rounded to the currency's minor unit — the model this ruling adopts | <https://docs.commercetools.com/learning-model-b2b-commerce/configure-b2b-pricing/high-precision-pricing> |

**What Endora does** (since 2026-10-25): commercetools' model on Magento's storage shape — a unit
price is `numeric(14,4)` from the price book to the invoice line, unrounded, and only the line value
is rounded to two places, once; VAT is per rate on the summed line nets (§10.17). Integer minor
units (Sylius) would forbid the B2B price the ruling is about, and Magento's per-unit rounding is
the defect it removes.

---

## 4. Open gaps in this research

- No official Shopware page states the tie-break between two rules of equal priority (the
  loader orders by `priority DESC, id`, so it is id order).
- Oro's exact CPL identifier format and the `combined_product_price` schema were not reached
  in the public docs (behaviour is documented; storage detail is not).
- Magento's `catalog_product_index_price` column semantics come from community threads, not
  vendor docs.
- BigCommerce's official record schema page returned 404; the CData mirror was used for field
  names.
- SAP's percentage discount rows were not researched.
