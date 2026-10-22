---
title: price_lists
description: Customer / group / default pricing with volume tiers + per-category adjustments
---

# `price_lists`

Pricing engine — a reshape on top of the original pricing foundation.
Owns:

- **CustomerGroup** — addressable bucket of Organizations sharing pricing.
- **PriceList** — a named pricing artefact with a lifecycle status
  (`draft`, `scheduled`, `active`, `expired`), a `type` (`base` or
  `sale`), an optional active window (`startsAt` / `endsAt`), and an
  `applicationRule` AST that decides which customer / org / channel
  the list applies to.
- **PriceListProduct** — composite-PK assignment of a Product to a
  PriceList.
- **PriceListPriceBracket** — composite-PK row keyed
  `(priceListId, productId, currencyCode, minQuantity)` carrying the
  per-currency unit price for a quantity bracket. Bracket gaps are
  allowed; the resolver falls through to the next-priority list.
- **PriceListMatrixEntry** — a price inside a list for a *selection* of
  products (one product, a category, an attribute value, a category and an
  attribute value, or every product), optionally for one organization, over a
  quantity window, at a fixed unit price or a percentage discount. See
  *Price matrix* below.
- **PriceDisplayModeOverride** — composite-PK row keyed
  `(scope, targetId)` overriding the resolver's display-mode chain at
  Organization / Category / Product scope. The chain root is two
  Settings keys (`pricing.default_display_mode`,
  `pricing.unauthenticated_display_mode`).

The legacy `PriceListItem` and `PriceListAssignment` tables (and the
`code` / `currency` / `priority` / `isDefault` columns on `price_lists`)
are kept by migration `20260504T125655_price_lists_engine.ts` only as a
transitional shim during the
expand → migrate → contract rollout. Newly written code MUST consume
the engine schema via `@endora-commerce/contracts`.

## Lifecycle

```text
draft ──activate──▶ scheduled ──auto on startsAt──▶ active ──auto on endsAt──▶ expired
  ▲                     │                              │                        │
  └──── draftify ───────┴────── draftify ──────────────┴────── activate (resets) ┘
```

- `activate` flips a `draft` (or `expired`) list to `scheduled` if a
  future `startsAt` is set, otherwise straight to `active`.
- `draftify` returns any non-system list to `draft`.
- `PriceListStatusWorker.sweep()` runs the two clock-driven transitions
  (`scheduled → active` at `startsAt`, `active → expired` at `endsAt`).
  In production it's invoked by a 5-min BullMQ repeatable job; in tests
  the same `sweep()` is exposed via `POST /api/v1/admin/price-lists-engine/internal/sweep`.
  A sweep that flips at least one list clears the pricing cache on every
  process (see *Pricing cache*).

The seeded `Default` list (`isSystem = true`) refuses every state
change, every delete, and every non-empty `applicationRule`.
Migration `20260504T125655_price_lists_engine.ts` also seeds bracket rows on it from each
product's legacy `attributeValues.defaultPrice`, so the platform always
has a usable terminal-fallback price.

## Application Rule (AST)

The `applicationRule` JSONB column stores a discriminated union:

```ts
type ApplicationRule =
  | { kind: 'all' }
  | {
      kind: 'criterion';
      type: 'salesChannel' | 'customerGroup' | 'organization' | 'category' | 'currency';
      values: string[];                  // UUIDs (or ISO 4217 for currency)
    }
  | {
      kind: 'group';
      op: 'AND' | 'OR';
      children: ApplicationRule[];        // 1..20
    };
```

Constraints (enforced both client-side in the rule builder and by the
service-layer normaliser):

- Depth ≤ 5 nested groups.
- Per-criterion value lists are deduplicated; currency codes uppercased.
- Empty groups are dropped; if the root group ends up empty, it is
  replaced with `{ kind: 'all' }` — but `{ kind: 'all' }` is only valid
  on the `Default` system list. Any other list with an empty rule is
  refused at activation time (`400 empty_rule_on_non_default`).
- Unknown target IDs (channel / customer-group / organization /
  category) are refused with `400 unknown_target { type, values }`.

## Resolver

`PricingService.resolveEngine({ product, variantId?, context })`
returns:

```ts
{
  base:  { listId, bracket, listName },        // never null — Default is the floor
  sale:  { listId, bracket, listName } | null, // optional second tier
  displayMode: 'gross_only' | 'net_only' | 'both' | 'none',
  currencyCode: string
}
```

Algorithm:

1. Load every `status='active'` price list.
2. Evaluate each list's `applicationRule` against the resolution
   context; keep matchers, partition by `type`.
3. For each partition, walk the **priority chain**:
   - Level 1: explicit organization match.
   - Level 2: explicit customer-group match.
   - Level 3: explicit category match.
   - Level 4: explicit sales-channel match.
   - Level 5: any other matching list.
4. Pick the winner per level via `tieBreak()` — most recent
   `modifiedAt` first, lexicographic `name` ASC second.
5. Look up the price the picked list charges for `(productId,
   currencyCode, quantity)` — its own bracket, or one of its price matrix
   entries (see *Price matrix*). If the list prices nothing (gap), fall
   through to the next-priority list in the same partition; the Default
   list is always at level 5 of the Base partition and serves as the
   terminal floor.
6. Resolve the display mode independently via
   `displayModeResolver(product, organization, customerKind)` along
   the chain Settings → Organization → Category → Product.

Determinism: same inputs → same outputs (no clock, no randomness, total
tie-break order). The resolver is consumed by the storefront
(`GET /api/v1/storefront/products/:id/resolved-price`) and by the cart
+ order-placement code paths.

**The customer group** in step 2 is the same on every path: the signed-in
customer account's own group, else its organization's group, else none. A caller
names the buyer — the organization and, for a signed-in customer, the customer
account — and the engine applies the rule. The catalogue listing, the product
page, search, the typeahead, comparisons, product links, the resolved-price
endpoint and the cart all name the account; quote reference prices and the
admin order preview pass the group they already resolved. An account that does
not belong to the organization it is named with is ignored.

**Batched entry points.** Besides the single `resolveEngine` /
`resolveLinePrice`, the engine prices many products at once:
`resolveListingPrices` (a listing page, quantity 1), `resolveListingPriceDetails`
(the same plus the base / sale / display-mode split, for the product page, the
home page cards and the typeahead) and `resolveLinePrices` (many lines, each at
its own quantity — the cart, the placement price check, quote reference prices,
the external catalogue API). Each costs a number of statements that does not
grow with the number of products or lines, and each answers exactly what the
single call answers for every product or line.

## Price matrix

A price list can price **many products with one entry**. A *matrix entry*
names:

| Coordinate | Values |
| --- | --- |
| Applies to | one product · a category · an attribute value · a category **and** an attribute value · all products |
| Organization | one organization, or none (*all buyers*) |
| Quantity | from N units, optionally up to M units |
| Price | a fixed unit price in one currency, or a discount of 0 < p ≤ 100 % (two decimals) in whatever currency the line is priced in |

Example: *Fasteners × Acme Sp. z o.o. × from 500 units × 12 % off*. Acme's
buyers ordering 600 fasteners pay 12 % less; 400 units, another organization or
a product outside the category pay as before.

The list's **application rule still decides which buyers the list serves** —
an entry only prices a line on a list the buyer already qualifies for, on the
request's sales channel. Entries only decide the price *within* that list.

**Rules an entry must follow** (refused with a message otherwise):

- A product entry needs an organization — without one it is the list's own
  product price, which the *Products & brackets* tab already holds.
- A fixed price needs a product, category or attribute selection.
- Two entries with the same selection and organization may not overlap in
  quantity in a currency they share (a percentage shares every currency) —
  `409 PRICE_MATRIX_ENTRY_OVERLAP`, naming the conflicting entry.
- A list holds at most **5 000** entries — `409 PRICE_MATRIX_ENTRY_LIMIT`.

### Attribute selections and *Price list rules*

Only attributes marked **Price list rules** on *Catalog → Attributes* may be
used, and only those whose values are a single choice, multiple choices or
yes/no, and that are neither per-language nor per-sales-channel
(`400 PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE` with the reason otherwise). A
single-choice value matches by equality, a multiple-choice attribute when the
product's values include it, a yes/no attribute on *yes* or *no* — a product
with no value matches neither. The product's own values are read, not a
variant's and not a channel override.

Clearing the flag on an attribute **deactivates** its entries: they stop
pricing anything within the pricing refresh window, pricing never errors
because of them, the *Price matrix* tab shows them as *Inactive* with the
reason, and they resume when the flag is set again.

### Which candidate wins

On the picked list the candidates are its own product bracket and every entry
that applies (selection, organization, quantity window, currency). The first by
this order prices the line:

| Order | Rule |
| --- | --- |
| 1 | Organization-specific before not organization-specific; the buyer's own organization before a nearer parent before a farther one |
| 2 | Product, then category ∩ attribute, then attribute, then category, then all products (the list's own product bracket counts as a not organization-specific product candidate) |
| 3 | The higher starting quantity |
| 4 | The lower resulting price |
| 5 | A fixed internal order (the entry id), so the outcome never depends on timing |

Category selections use the product's own category assignments, not
sub-categories — the meaning the application rule's category criterion has.

### Percentages

A percentage is taken off the **reference price**: the product's own bracket on
the same list at that quantity, else its bracket on the system **Default**
list. The result is rounded half-up to four decimals, the precision brackets are
stored at, in integer arithmetic. A percentage with no reference prices
nothing and the next candidate is tried; when nothing on the list prices the
line, resolution continues with the next applicable list exactly as for a list
without a bracket. A 100 % discount is a free line, deliberately.

### Where matrix prices appear

Every surface that uses the shared resolver — catalogue listing, product page,
search, comparison, product links, cart, checkout, order intake, quote-request
reference prices and the admin resolved-price check — returns the same matrix
price for the same buyer, product, quantity and channel. The product page's
quantity-tier ladder includes the entries' starting quantities, and the
resolved-price check names the entry that produced a price (`matrixEntryId`).

**Sorting and filtering the storefront catalogue by price follow matrix
prices too.** A list carrying an entry the viewer meets at quantity 1 is
ordered from a relation computed over its brackets and entries, by the order
above, so the sequence matches the prices the cards show; a product priced only
by an entry sorts by that price rather than with the unpriced products. Lists
without such an entry keep the index-ordered path. Measured on 2 000 products
(`backend/test/perf/price_lists/matrix-resolver.bench.ts`): a first page costs
about 3 ms with no entry, about 40 ms with a category percentage and about 20 ms
with an all-products percentage; a 50-product listing page costs no extra
statement when its lists carry no entry and at most three when they do.

**Known limitation:** a product feed pinned to a named price list reads that
list's product brackets only; matrix entries do not reach a pinned feed. Feeds
priced through the resolver (anonymous) do see entries that are not
organization-specific.

### Managing the matrix

The **Price matrix** tab on a price list (`/price-lists/:id?tab=matrix`) lists
entries with filters by selection and organization, paging, and add / edit /
delete for `price_lists:write`; `price_lists:read` sees the tab read-only. Every
change is audited as `price_list.matrix_entry_create|update|delete` on the
list, with the entry before and after, and shows on the dashboard's *Recent
activity* card. A sales representative sees entries that are not
organization-specific or name one of their organizations, and cannot create one
for another organization. Duplicating a list copies its matrix; deleting a list
deletes it. Permanently removing a product, category or organization deletes
the entries naming it; deleting one in the admin (recoverable) keeps them,
marked *Deleted item*, for the operator to decide.

## Display modes

Four values: `gross_only`, `net_only`, `both`, `none`. The first three
control the column layout on every storefront price-bearing surface;
`none` hides every price element and replaces Add-to-cart with the
existing Quote Request CTA. The cart-line and
order-placement endpoints additionally refuse the line with
`400 CART_PRODUCT_QUOTE_ONLY` when the resolved mode is `none` for the
`(product, organization, channel)` tuple — defence in depth.

## Public surface

### Engine endpoints (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/price-lists-engine?status=&type=&search=` | List engine-shape lists with optional filters |
| `POST /api/v1/admin/price-lists-engine` | Create a draft list |
| `GET /api/v1/admin/price-lists-engine/:id` | Read one list |
| `PATCH /api/v1/admin/price-lists-engine/:id` | Update name / type / dates / applicationRule |
| `POST /api/v1/admin/price-lists-engine/:id/activate` | Lifecycle → scheduled or active |
| `POST /api/v1/admin/price-lists-engine/:id/draftify` | Lifecycle → draft |
| `POST /api/v1/admin/price-lists-engine/:id/duplicate` | Clone (resets dates and status) |
| `GET /api/v1/admin/price-lists-engine/:id/products` | List roster + per-currency brackets |
| `PUT /api/v1/admin/price-lists-engine/:id/products` | Replace roster (delta) |
| `POST /api/v1/admin/price-lists-engine/:id/products` | Append one product |
| `POST /api/v1/admin/price-lists-engine/:id/products/bulk-add` | Append up to 200 products in one audited write — see *Adding many products at once* |
| `DELETE /api/v1/admin/price-lists-engine/:id/products/:productId` | Remove (cascade brackets) |
| `GET /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Read brackets for one product |
| `PUT /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Replace brackets (`{ bracketsByCurrency }`) |
| `POST /api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy` | Identity copy of one currency to N others |
| `GET /api/v1/admin/price-lists-engine/:id/matrix?page=&pageSize=&selectionKind=&organizationId=&productId=&categoryId=&lang=` | Price matrix entries, filtered and paged (`organizationId=none` for not organization-specific) — `price_lists:read` |
| `GET /api/v1/admin/price-lists-engine/:id/matrix/:entryId` | One entry — `price_lists:read` |
| `POST /api/v1/admin/price-lists-engine/:id/matrix` | Create an entry — `price_lists:write` |
| `PATCH /api/v1/admin/price-lists-engine/:id/matrix/:entryId` | Change an entry; every rule runs on the merged result — `price_lists:write` |
| `DELETE /api/v1/admin/price-lists-engine/:id/matrix/:entryId` | Delete an entry — `price_lists:write` |
| `POST /api/v1/admin/price-lists-engine/internal/sweep` | Test-only worker tick |

### Adding many products at once

`POST /api/v1/admin/price-lists-engine/:id/products/bulk-add`, gated by
`price_lists:write`, takes `{ productIds }` — 1 to 200 product ids
(`bulkAddPriceListProductsRequestSchema` in `@endora-commerce/contracts`) —
and only ever appends. Duplicates are collapsed, the first occurrence kept.

An accepted request answers `200 { data: { added, unchanged, failed } }`, each
id in exactly one of the three:

- **`unchanged`** — already on the list; its brackets are left exactly as they
  were.
- **`failed`** — `{ productId, reason: 'product_not_found' }`, for an id the
  catalogue does not hold as a live product (unknown or soft-deleted). A draft
  or inactive product is live and is added.
- **`added`** — every other product, in request order, whatever its status or
  type.

The whole request is one Command, `price_list.products_add`, and writes one
audit entry whose after-state holds counts only (`{ name, added, unchanged,
failed }`) — and no entry at all when nothing was added. The entry shows on the
home dashboard's **Recent activity** card as *added products to price list*.
Sending the same body again is therefore safe: the products added the first
time come back `unchanged`, silently.

Refusals write nothing:

| Case | Answer |
| --- | --- |
| The caller lacks `price_lists:write` | `403 FORBIDDEN` |
| The list is the system Default (its roster is seeded from each product's default price) | `403 FORBIDDEN` |
| The list is unknown or deleted | `404 NOT_FOUND` |
| The body is not an object, or `productIds` is missing, empty, longer than 200 or holds a non-uuid | `400 VALIDATION_FAILED` |
| Another request added the same new product at the same moment | May answer `409 VERSION_CONFLICT`; retrying reports the product `unchanged` |

### Rule-builder pickers (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/pricing/rule-targets/sales-channels` | Channel options for the rule builder |
| `GET /api/v1/admin/pricing/rule-targets/customer-groups` | Customer-group options |
| `GET /api/v1/admin/pricing/rule-targets/organizations?search=&limit=` | Paginated org options |
| `GET /api/v1/admin/pricing/rule-targets/categories` | Full category tree |
| `GET /api/v1/admin/pricing/rule-targets/currencies` | Currencies exposed by any sales channel |
| `GET /api/v1/admin/pricing/rule-targets/attributes?lang=` | Attributes a price matrix entry may select on (flagged *Price list rules*, eligible type), with their option values |

### Display-mode admin

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/pricing/display-mode-overrides?scope=` | List overrides |
| `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Read one |
| `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Upsert (`{ mode }` or `{ mode: 'inherit' }` to delete) |

### Linked price-lists panel (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/products/:productId/price-lists` | Lists every price list a product is part of, with per-currency bracket summary and a deep-link path |

### Buyer price probe (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/products/:id/resolved-price?organizationId=&customerAccountId=&quantity=&currency=&variantId=&salesChannelId=` | The price a given buyer would pay for one product, as the admin quote-request screens show it. Gated by `price_lists:read` |

- **`matrixEntryId`** in the answer names the price matrix entry that priced
  the line, or `null` when a stored bracket did.
- **`salesChannelId`** names the sales channel to resolve on; absent, the system
  default channel. An unknown or malformed id is refused with
  `400 VALIDATION_FAILED`, and the message does not repeat the id.
- **The buyer is checked before anything is priced.** The organization asked
  about is `organizationId`, else the customer account's own. An organization
  or customer account that does not exist, and — for a sales representative —
  one outside the organizations they may see, all answer the same `404`, so the
  probe does not tell anybody what exists. A platform administrator skips only
  the representative check. A customer account that is not a member of the
  named organization is `400 VALIDATION_FAILED`.
- **Behaviour change.** Earlier releases answered an unknown or out-of-scope
  organization or account with the anonymous price; it is now `404`. A request naming neither an organization nor an account is still the
  anonymous price.

### Storefront (public)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | Per-customer Base + Sale + display mode |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | Display mode only (used by the cart, and by batch surfaces that resolve the price separately) |

Both storefront reads are resolved **for the viewer**: they take the buyer's
session when one is there and answer as the public when it is not. They also
derive that viewer through one function, so the display mode carried inside a
resolved price and the one this endpoint returns cannot disagree for the same
caller — they once could, and a signed-in buyer read net on the
product page and gross in the cart wherever `pricing.default_display_mode` and
`pricing.unauthenticated_display_mode` were set differently. A response resolved
for an Organization carries `Cache-Control: private, no-store`; the anonymous
one is unstamped and stays the representation a crawler and the storefront's
shared window hold.

### Legacy (still served until every reader migrates)

| Verb + Path | Purpose |
| --- | --- |
| `GET / PUT / DELETE /api/v1/admin/price-lists{,/:code,/:id}` | Legacy CRUD over the old shape |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/items{,/:itemId}` | Legacy items CRUD |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/assignments{,/:assignmentId}` | Legacy assignments CRUD |
| `GET /api/v1/admin/price-lists/preview?productSku=&quantity=&organizationId=&salesChannelCode=` | Legacy preview |

## Migration notes (engine reshape)

The module's migration `20260504T125655_price_lists_engine.ts` reshapes the schema in one transaction:

1. Take a transaction-scoped advisory lock (`pg_advisory_xact_lock`) so
   concurrent migrators serialise; it is released when the transaction
   ends.
2. Add the new columns on `price_lists` (`type`, `status`, `startsAt`,
   `endsAt`, `modifiedAt`, `isSystem`, `applicationRule` JSONB).
3. Create the three new tables (`price_list_products`,
   `price_list_price_brackets`, `price_display_mode_overrides`).
4. Seed the `Default` list with the deterministic UUID
   `00000000-0000-4000-8000-00000000d51b`.
5. Walk every `Product` whose `attributeValues` carries `defaultPrice`
   (or `price` as fallback), assign it to the `Default` list and insert
   one bracket row per currency exposed by any sales channel, copying the
   same amount into every currency.

The legacy `attributeValues.defaultPrice` and `attributeValues.price`
keys are **not** stripped, so existing readers keep working, and the
migration writes no report file.

The migration is **additive** to the legacy schema — the
`price_list_items` and `price_list_assignments` tables and the
`code`/`currency`/`priority`/`isDefault` columns on `price_lists`
remain in place until the readers in `cart-service`, `comparison-service`,
`catalog-query`, `search-query`, and `product-link.service` swap to the
resolver. A follow-up migration drops the legacy columns once that
audit lands.

The same backfill is available as a service,
`DefaultPriceListMigrator`
(`src/backend/services/default-price-list-migration.ts` in this module).
It is idempotent, so it is safe to re-run, and it returns a structured report
that lists every product whose single legacy price was copied into more than
one currency.

## Storefront integration

- Catalogue reads carry the price split with them: every `ProductSummary` the
  catalogue (and search) returns has `resolvedPrice` — `basePrice`, `salePrice`
  and `displayMode` — from the same resolution that produced `price`. The
  product page and the home page's product cards render it, so each product is
  priced once per page; neither calls
  `GET /api/v1/storefront/products/:id/resolved-price` any more.
- `GET /api/v1/storefront/products/:id/resolved-price` stays available, through
  `storefront/lib/api/pricing.ts` (`getResolvedPrice`), for a surface that needs
  one product at another quantity.
- `BaseSalePriceBlock`, `PriceTag`, and `ProductCard` consume the base / sale /
  display-mode split; `displayMode === 'none'` hides every price element and
  surfaces the `QuoteRequestCta` (which routes through `AddToRfqForm`).
- The PDP swaps the Add-to-cart row for the QuoteRequest CTA when the mode is
  `none`.
- The variant picker shows no price per variant. A variant is charged its
  product's price — price lists have no variant dimension yet — so the price
  block above the picker is the price of every variant.

## Admin integration

- `/price-lists` (engine list) and `/price-lists/:id` (editor with
  Details / Products & brackets / Application rule / Price matrix tabs;
  `?tab=matrix` opens the price matrix).
- `/price-lists/display-modes` — overrides browser plus the two
  `pricing.*` settings keys.
- **Products & brackets** lists the roster by name and SKU for a list of
  any size — names are resolved through the catalogue's
  `POST /api/v1/admin/catalog/products/batch-by-id`, 500 ids per request and
  at most two requests in flight — and opens the bracket editor for every
  roster product; a product whose name cannot be resolved shows its id prefix.
  **Add** opens the admin's shared product browser on the **All** tab, where
  every status and type can be ticked and products already on the list are
  marked *Already on this price list*. **Add N** sends one bulk-add request for
  up to 200 products. When it is accepted the browser closes, the roster
  reloads, the first added product is selected with its bracket editor open,
  and any product that could not be added is named with its reason. When it is
  refused, or the answer is lost, the browser stays open with the selection
  kept, an error and **Retry**, which sends the same products again; the error
  names the cause where the answer gives one — the Default list or a missing
  permission (403), a list that no longer exists (404), an invalid request
  (400), or someone changing the list at the same moment (409) — and says that
  nothing was changed. **Add** is disabled on the system Default list, and
  disabled with a hint for an operator without `price_lists:write` or without
  `catalog:read`.
- `DisplayModeOverrideRow` is embedded in the Organization editor,
  the Categories tree EditForm, and the LinkedPriceListsPanel that
  replaces the old `PricingPlaceholder` on the catalog Product editor.

## Ports

- **`buyerLinePricePort`** (`BuyerLinePricePort` in `@endora-commerce/contracts`)
  — `resolveForBuyer({ buyer, salesChannelId, currencyCode?, lines })` answers,
  for each line, the net unit price the buyer would pay on a normal order on
  that channel, now: the account's customer group before the organization's,
  the quantity bracket, an active sale price. `salesChannelId: null` is the
  system default channel; `currencyCode` absent is the channel's default
  currency; `quantity` is in base pieces. A product that does not exist answers
  `price: null` for its line; an unknown channel throws `400 VALIDATION_FAILED`.
  Keys are echoed in order and lines are resolved in bounded chunks. It is the
  same implementation the buyer price probe above serves, and it carries **no**
  authority check — the caller passes a buyer it has already authorised. The
  `quote_requests` module uses it for every line's reference price.

## Pricing cache

Resolutions are cached per process in an in-memory LRU (`PricingCache`, 60 s,
5 000 entries), keyed by product, variant, quantity, currency, sales channel,
organization and effective customer group.

- **Cleared after commit.** Every audited price-list write clears it once the
  Command Bus has committed the write — never before, so a read racing the write
  cannot put the old price back for a whole TTL. A write that changed nothing
  clears nothing. A resolution that started before a clear is answered but not
  stored.
- **Cleared on every process.** A clear is announced on the Redis channel
  `b2b:price_lists:pricing-generation`; every API and worker process subscribes
  when it boots and clears its own cache when another process announces one. If
  Redis cannot deliver the announcement, other processes catch up within the
  60 s TTL.
- **Cleared by the status sweep** whenever it activates or expires a list.
- **Not cleared** by catalogue writes (a product's categories or its own
  price): those still take up to 60 s to reach a cached price.

## Extension points

- **Cart-service / order-placement swap** — the foundation cart and
  order-placement code paths still read `attributeValues.defaultPrice`.
  The next iteration introduces `PricingService.resolveLinePrice()`
  and swaps the cart-service constructor to depend on it; the
  defence-in-depth check for `displayMode === 'none'` lands in the
  same change.
- **Status worker BullMQ wiring** — `PriceListStatusWorker.sweep()` is
  ready but the BullMQ repeatable-job registration (mirroring the
  RFQ expiry worker) is queued for a follow-up.
