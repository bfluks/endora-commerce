# Research: Product visibility rules (spec 193)

Measured against `origin/master` `c3e8a8755` (2026-11-25). Paths: `catalog/…` means
`packages/modules/catalog/src/…`, likewise for other modules; `PVR/…` means
`packages/modules/product_visibility_rules/src/…` (new). Every entry is decision → rationale →
alternatives rejected.

## R-1 Module ownership (spec OQ-9)

**Decision**: a new module **`product_visibility_rules`**, deactivatable, depending on `catalog`,
`price_lists`, `admin_roles`, `currencies`, `sales_channels`, `audit_logs`; consumed by `catalog`
(and, in the gated phase, `orders` and `quote_requests`) through ports declared
`nonBindingDependencies` kind **`degrades-without`**, probed with `effectiveState.isPresent` in
front of the call (`specs/conventions/module-composition.md` item 4a; precedent: `catalog`'s
`seoProductMetaPort` entry, `catalog/manifest.ts`).

**Rationale**: the feature is one policy with one owner: categories, mappings, designations,
rules and the derived flags change together and are switched off together (FR-073 "as if never
installed"). None of the candidate hosts owns that policy: `catalog` is `nonDeactivatable`
(cannot honour FR-073 as a whole), `price_lists` is locked on both axes
(`price_lists/manifest.ts:197-198`), `admin_roles` knows roles, not products. Principle I asks for
detachability; a separate module is the only shape whose off state removes every narrowing,
refusal and skip at once. The edges from the non-deactivatable hosts cannot be `dependencies`
(cycle: this module depends on them) and must not be `acknowledgedDependencies` (that would lock
this module on); `degrades-without` states the honest absent answer — "not narrowed" — and a
present-but-failing module still fails closed because the call is not caught.

**Rejected**: (a) extend `catalog` + `price_lists` + `admin_roles` — three owners for one policy,
no single off switch, `catalog` cannot be switched off; (b) an overlay module — the feature is
generic and tenant-agnostic (FR-075) and belongs in the platform, not in one deployment (Principle XV); (c) `refuses-without`
on the catalog edge — module off would 503 the product list, the opposite of "as never installed".

## R-2 Naming

**Decision**: module id `product_visibility_rules`; permission codes
`product_visibility:read`, `product_visibility:manage`; Command actions
`product_visibility.category.{create,update,delete}`, `product_visibility.role_mapping.set`,
`product_visibility.designation.{set,clear}`, `product_visibility.product_rule.{create,update,delete}`,
`product_visibility.website_rule.{attach,change,detach}`; admin routes under
`/api/v1/admin/product-visibility/…`.

**Rationale**: plural snake_case module id (Principle VI); a short permission/action prefix keeps
audit labels readable. **Rejected**: `product_visibility` (singular — refused by `check:naming`).

## R-3 Activation default (OQ-C)

**Decision** (owner: OQ-C A, I-3 A — FR-076, FR-077): `activation` deactivatable, **default off**.
The configuration exists only while the module is on — nothing can be prepared before the first
enable — so on first enable every unmapped fail-closed role (FR-023 as amended by OQ-G) sees no
products until an administrator maps it; the owner accepted that window, and the docs say to map
right after enabling (T094). The activation control states that switching it on applies FR-023 at
once and switching it off lifts every restriction (FR-073 warning). **Rejected**: a configuration
surface usable while off — contradicts FR-073 ("its screens and API are absent") and Principle XVII
("a deactivated module's own configuration surface MUST NOT be editable").

**Rationale**: every core module is composed on every instance; default on would make an upgrade
the "first enable" of OQ-10 on every instance, and every unmapped role holding `rfqs:handle` or `*`
would see no products the moment the release is deployed. **Rejected**: default on (OQ-10 read
literally).

## R-4 Catalogue price entry point (FR-001 – FR-007, RQ-1 A)

**Decision**: `price_lists` publishes a capability port **`catalogueReferencePricePort`**
(contracts/ports.md §3), implemented over `BookPricing`:

- `resolve({ currencyCode, designation: { priceListId, salesChannelId } | null, productIds })` →
  per product its lines (the product itself when it has no variants, else one per variant — the
  same lines `BookPricing.#listingLines` builds, `price_lists/backend/services/book-pricing.ts:650`),
  each `amount: string | null`. It resolves a **fixed profile** whose `books` are the currency's
  base book plus, when designated, the designated book with audience everyone — so tier 2
  (CATALOGUE) can only be that book and tier 1 (BASE) stands where it is silent (OQ-1 b). Quantity 1,
  no organization, no group, not signed in, the designation's channel (a placeholder of the
  currency's base context when undesignated — base books are channel-independent). Sale books are
  not in the profile, so the answer is the catalogue price, not a promotional price.
  Fixed-profile resolutions bypass the answer cache (`book-pricing.ts:296-302`), so the 60 s cache
  never delays this read. **`resolve` ignores the designated book's in-force state** (status,
  schedule window): it answers what the designation prices *when* in force, so flags built while
  the book is draft, scheduled or expired are already right the moment it comes into force. A book
  that no longer exists contributes no rows (base stands); its `not_found` status is applied at read
  time like every other not-in-force reason.
- `designationStatus({ currencyCode, priceListId, salesChannelId })` → `{ inForce: true, window }`
  or `{ inForce: false, reason }`, reasons `not_found | currency_mismatch | not_regular |
  audience_restricted | not_on_channel | not_active | outside_schedule` — the checks of
  `namedBookPublishability` (`book-pricing.ts:682-724`) plus `type = 'regular'`. Not in force ⇒ the
  currency has **no** catalogue price (OQ-1 d, RQ-1 A), applied by the **caller at read time**
  (scope resolution, line checks, rule evaluation), and the configuration screen shows the reason.
- `designatableBooks(currencyCode)` → regular, everyone books of the currency in **any** status
  (a draft or scheduled book may be designated — it shows "not in force" until it is), with their
  channel ids (the designation form's options; the server re-checks on save). Designation is
  refused only for `not_found`, `currency_mismatch`, `not_regular`, `audience_restricted` and
  `not_on_channel` (RQ-1 A); `not_active` and `outside_schedule` are accepted.

**Identity test** (pricing.md: "a new resolution path owes the same kind of identity test"):
for a channel whose only everyone book is the designated one, `resolve` equals
`resolveLinePrices` for a guest on that channel, per line (variants included), under every
precedence preset. Worked-example vectors for the three OQ-1 cases (designated row wins; designated
silent → base; designated out of window → null) go into `specs/pricing/worked-examples.md` and
`backend/test/integration/price_lists/worked-examples/`, and `current-model.md` lists the new
consumer.

**Rejected**: (a) `namedListPrices` — keyed by product only (drops variant rows), its fallback is
the channel's guest catalogue price *without* the book (not the base book), and it answers empty
while the book does not publish, conflating "not in force" with "unpriced"
(`book-pricing.ts:730-822`); (b) the price surface (`price_profile_prices`) — min over variants
only, includes sale tiers, withholds display-mode-`none` products, keyed by everyone profiles of a
channel (all everyone books, not one designated book), and lags by design; (c) a SQL reimplementation
in the new module — forbidden by FR-006 and by pricing.md ("never query `price_lists`' tables").

## R-5 Making the catalogue price queryable at list scale

**Decision**: module-owned derived tables (data-model.md §2): `product_catalogue_prices`
(product-level: a price exists in C on the product or on any of its variants; any such price > 0)
and `variant_catalogue_prices` (per variant), **rows only where a price exists**, keyed by
`(currency_code, generation, …)`; plus `catalogue_price_generations` (served / building generation
and the designation snapshot it was built for) and `catalogue_price_stale_products` (targeted
marks).

- **Targeted refresh**: a mark per (currency, product) → the `product_visibility_rules.flags`
  worker re-resolves the marked products through `resolve` in batches of 500 and replaces their
  rows of the **served** generation in one transaction (the price surface's R17 pattern).
- **Whole-currency rebuild**: a designation change or a catalogue-wide change builds generation
  n+1 in batches of 1 000 products, then swaps `served_generation` in one statement; generation n
  keeps serving until then, and is deleted after the swap.
- **Change feed**: R-6.
- **Read-time part**: the designated book's in-force state (schedule window, status, deletion,
  channel binding, audience) is read **per request** through `designationStatus` (one statement for
  all designated currencies) and a currency not in force contributes no condition — so a schedule
  boundary needs no rebuild and applies from the next request (FR-007, FR-062 for that case).

**Cost estimate (50 000 products, 150 000 variants, 3 currencies)**: product rows ≤ 150 000
(~10 MB with PK index), variant rows ≤ 450 000 (~35 MB). A whole-currency rebuild resolves 200 000
lines: the price-surface bench resolved 5 profiles × 50 000 products in 53 – 60 s
(`specs/pricing/read-paths-and-performance.md` §7), i.e. ~11 s per profile without variants;
with variants estimated 20 – 45 s per currency, inside the 150 s bound. A targeted refresh of one
product is one batch (< 0.5 s). Steady-state worker load: proportional to price writes.

**Rejected**: (a) live evaluation in the list request — ~11 s per currency per page at 50 000;
(b) storing per-category visibility — categories and mappings would then need a rebuild on every
config change, breaking FR-060's next request for configuration; per-currency facts make every
category a pure predicate; (c) `x_product_visibility_rules_*` extension columns on `products`
(`specs/178-extensible-columns/`) — the facts are per currency and per variant (not one column), an
extension column is written only inside a Command of the host (catalog), and the price facts change
on price-book writes, not catalog writes.

**Measured (T035, 2026-11-25, on `26a40f13a` + Phase 4, MikroORM 7; WSL2 dev box, Postgres 16 test
container with fsync off; `backend/test/perf/product_visibility_rules/admin-list-visibility.bench.ts`,
`PERF_RUN=true`):** 50 000 products, 150 000 variants, 3 currencies — whole rebuild per currency
**8.0 – 8.8 s** (bound 150 s); targeted base-price change → flags reflect it in **65 ms** after the mark
(bound 60 s, the worker's pickup latency excluded). The rebuild ends with `analyze` of the two flag
tables: without it the restricted deep page measured 185 ms p95 against 47 ms with it (stale planner
statistics after a whole generation is written).

## R-6 Price change feed from `price_lists`

**Decision**: `price_lists` emits one EventBus event **`price_lists.catalogue_prices_changed`**
from the writer's `afterBump` (`price_lists/backend/services/pricing-generation.ts` — run once per
change by the writing process, after commit), carrying the `SurfaceChange` description in names-only
form (contracts/events-and-errors.md §1). The module's subscriber (registered with `ctx.subscribe`)
turns it into marks: a change concerning the base book or a designated book's rows for products →
targeted marks; a book change with `selections: 'stored'` or category/attribute rows, a
`categories`/`attributes`/`all`/`channels` change → a whole-currency rebuild of the currencies it
names (all designated currencies when it names none). The status sweep already bumps when it flips
a book and so emits too. A **safety reconcile** rebuilds every designated currency nightly (a
repeatable BullMQ job), bounding a lost announcement.

**Rationale**: the facts that move a catalogue price are exactly the ones `price_lists` already
describes for its own surface (`surface-change.ts`); reusing the description avoids a second change
model. Catalogue events that move a price (category membership, attribute values, variants) already
reach `price_lists`, which bumps with a description — so the module needs no catalog subscription
for prices.

**Rejected**: (a) a `beforeCommit` hook on every price-book Command — the module would re-derive
what a write moved (duplicating `SurfaceChange` construction per action); (b) subscribing to the
Redis generation channel — carries no description (whole rebuild per write); (c) reading the price
surface's stale marks — another module's table.

## R-7 Admin read narrowing seam (FR-030 – FR-036)

**Decision**: `adminProductVisibilityPort` (contracts/ports.md §1):
`resolveScope(adminUserId)` → `{ kind: 'unrestricted' } | { kind: 'restricted', category, conditions,
servedGenerations } | { kind: 'no_category' }`, read **per request** (no cache: one role read
through `permissionService.resolveRole`, one mapping read, one `designationStatus` read — each an
indexed lookup), and two pure builders returning SQL over the module's own tables for the caller to
embed: `productPredicate(scope, { productId })` and `variantPredicate(scope, { variantId })`.
`no_category` yields `false`; `unrestricted` yields no clause at all (SC-003 byte-identical).

`catalog` applies it in every listing statement: both branches of `listProducts`
(`catalog-admin.service.ts:1748`; the un-narrowed `findAndCount` branch moves to the statement path
when a scope is restricted), `#productListCounts` (`:1922`, also on the early-empty return),
`resolveProductIds` (`:1946`), `listProductsByIds` (`:2036`), the admin search query
(`catalog-admin-search.service.ts:38-73`, inside the statement, so `hasMore` counts visible rows
only — FR-034), `listVariants` (`:2287`, RQ-3 A), and the price book grid, whose product page is
cut by `catalog`'s `pageProductsByAdminName` port (`price_lists/backend/services/price-book-reads.ts:426-440`)
— that port takes the caller's admin id and applies the same predicate; the grid's variant lines are
filtered with `filterVisible`. Writes through a visible parent never touch its hidden variants (spec
edge case, RQ-3 A). The list response carries
`visibility: { restricted, reason? }` only when restricted (FR-023 message; additive, absent for
unrestricted — SC-003).

**By-id routes**: one guard applied by `catalog` to every route whose path starts
`/api/v1/admin/catalog/products/:id` or `…/:productId` (and `…/variants/:variantId`), answering
`404 PRODUCT_NOT_FOUND` "Product not found." (the answer of `getProductById`,
`catalog-admin.service.ts:1977-1988`) or the variant route's own not-found when hidden. **Placement
is the oracle question**: the platform moves a route's declared `preHandler` chain to
`preValidation` (`packages/platform/src/http/guards-before-validation.ts`;
`module-admin-surfaces.md` item 3), so a guard declared there would answer 404 for a hidden id
with a malformed body where a non-existent id answers 400. The guard therefore runs **after schema
validation** as a **plugin-scope `addHook('preHandler')`** on the plugin that mounts the catalog
admin routes (threat-model TM-5: scope hooks run after validation and before the route-level
`preHandler` chain, where the platform appends other modules' API pre-interceptors —
`packages/platform/src/http/interceptors/dispatch.ts:19-98` — so no interceptor ever sees a hidden
id; a handler-first check would let them run), keyed on `request.routeOptions.url`, and it makes the
route answer **its own** not-found (a per-route map T036 derives and checks), not a generic 404. A
route whose handler answers a non-existent id with something other than its not-found **before**
looking the product up (a 422 on a semantically invalid body, say) gets its check inside its own
lookup instead of the shared guard. Bulk update narrows its id list (and the resolved "select all" set) in the request **and**
again in the worker for the requester (the worker already re-checks the requester's permission,
`catalog/manifest.ts` `admin_roles` comment). Guarantee: a contract test enumerates the app's
registered routes matching those prefixes (`app.printRoutes`/`onRoute` inventory) and, per route
and per request shape (valid body/query, schema-invalid body, schema-invalid query, semantically
invalid body), asserts that a hidden product's answer equals a random non-existent id's answer
(status, `error.code`) and that nothing was written — so a route added later is covered by construction (≈ 60 routes today,
`catalog/backend/routes.admin.ts:309-2032`, `routes.admin.url-keys.ts:32-47`).

**Rejected**: (a) filtering after paging — FR-031; (b) a hand-placed check per handler — ≈ 60
routes, the next one forgets; (c) `catalog` passing an id array (`= any(?::uuid[])`) of visible
products — up to 50 000 uuids per statement; (d) a `refuses-without` edge — off would 503.

## R-8 Line checks are live (gated phase; FR-037, FR-041, RQ-2 C)

**Decision**: `checkLines(scope, lines[{ productId, variantId? }])` resolves the lines through
`catalogueReferencePricePort.resolve` **live** (one batch, ≤ the order item bound) and applies the
category; refusal `422 PRODUCT_NOT_IN_VISIBILITY_CATEGORY` with `details[].path = items[i]` per
offending line. Marker (`noFixedPrice`) computed from the same answer.

**Rationale**: the line check is the commercial guard; exact and cheap at line counts.
**Rejected**: reading the flags tables — inherits OQ-A's lag on the one path where a stale answer
lets a hidden product onto a quote. **Security note**: a refusal distinct from `PRODUCT_NOT_FOUND`
confirms existence of a product id the caller already holds; FR-041 requires naming the line, and
the caller supplied the id. Threat model item T-4.

## R-9 Product rule (FR-050, FR-056, FR-057)

**Decision**: `product_rules` row = name + `definition` (jsonb, Zod-validated, contracts/ports.md
§4): root `{ match: 'all' | 'any', conditions: [...] }`, condition kinds `attribute_boolean { key,
value }`, `attribute_choice { key, optionKeys[] }`, `catalogue_price { currencyCode, threshold:
'gt_zero' | 'gte_zero' }`, and one nesting level `group { match, conditions }`. Attribute keys are
validated on save against `catalogAttributeReadPort` (boolean / choice, not language- or
channel-scoped). Evaluation is a **pure function** over facts `{ status, archived, deleted,
attributeValues, flags }` — missing value ⇒ condition not met (FR-057); `active ∧ ¬archived ∧
¬deleted` is applied outside the rule (FR-051). Product-level price conditions read
`product_catalogue_prices` (a configurable parent meets "> 0 in A" when any variant does — FR-005).

**Rejected**: free expressions / SQL predicates in configuration (injection surface, not
previewable); reusing `price_lists`' attribute rows (different semantics).

## R-10 Governed channel membership (FR-051, FR-054, FR-055, FR-058)

**Decision**: a kernel **membership governor** contribution point in
`packages/platform/src/kernel/sales-channels/` (contracts/ports.md §5):

- A module registers `{ moduleId, entityTypes: ['product'], governs(em, channelId) → { ruleLabel }
  | null }` at boot and receives an unforgeable **write token**. The host filters a governor whose
  module is not effectively present (contribution-sink pattern; module off ⇒ nothing governed,
  FR-073).
- `MembershipMutationOptions` gains `onGoverned?: 'skip' | 'refuse'` (default **`skip`**) and
  `governorToken?`. For every mutation touching a `(channel, product)` pair on a governed channel:
  with the governing token → applied (and exempt from the at-least-one-channel floor and from the
  default fallback); `onGoverned: 'refuse'` → `409 CHANNEL_MEMBERSHIP_GOVERNED` naming the rule,
  nothing written; otherwise → that pair is skipped, the rest of the mutation proceeds, and the
  result lists `skippedGovernedChannelIds`. `replaceChannelsForEntity` keeps governed rows as they
  are and replaces the rest; `bindToDefaultIfEmpty` onto a governed default binds nothing;
  `removeFromChannel`'s fallback onto a governed default is treated as no fallback.
- **The at-least-one-channel floor** (feature 005 FR-008) is waived for a product in exactly two
  cases: a governor-token write, and a mutation whose request named a governed channel that was
  skipped (`bindToDefaultIfEmpty` onto a governed default; `replaceChannelsForEntity` whose desired
  set is only governed channels — a connector's create on its governed channel). Both end with the
  product on no channel until the rule admits it, which is FR-059's required state. Every other
  path keeps the floor: removing a product's last ungoverned channel without fallback is still
  `ENTITY_WOULD_HAVE_ZERO_CHANNELS`.
- `governs` reads the module's `website_rule_attachments` on the mutation's own `em` (same
  transaction, one PK lookup) — no cache, so an attach is effective on the next write in every
  process.
- Manual callers pass `onGoverned: 'refuse'`: `sales_channels/backend/routes.admin.ts:387-431`
  (channel-side add/remove) and `catalog-bulk-update.service.ts:562,570,576` (also refused at
  enqueue time when the patch names a governed channel). Automatic callers are unchanged:
  `catalog-admin.service.ts:518` (create), `:1159` (duplicate), import through catalog create, and
  connectors that call `salesChannelMembershipPort` (they get `skip`).
- **FR-055**: `productRuleGovernancePort` (`governedChannels()`, `meetsRule(channelId, productIds)`)
  for a connector that wants to avoid writing against the rule.
- Detach (FR-058) deletes the attachment row; memberships stay; the channel is ungoverned from the
  next write.
- Channel delete with `fallbackToDefault` onto a governed default is no fallback for products:
  refused `ENTITY_WOULD_HAVE_ZERO_CHANNELS` before any write (T100).

**Measured — product-membership writers on `c3e8a8755`**: catalog create `:518`, duplicate
`:1159`, bulk update `:562/:570/:576`, `sales_channels` channel-side routes `:394/:420`; no other
module in this repository writes `product` memberships (`import_export` creates through catalog;
`pim_connector`, `erp_connector` have no membership call). External connector packages call the
platform's `salesChannelMembershipPort` (`replaceChannelsForEntity` on create, `addToChannel`
otherwise), so the kernel governor intercepts them with no connector change. **Known side effect**:
such a connector also writes channel-scoped values through `catalogProductScopeWritePort.applyScopes`,
which runs the `product.scoped_values.import` Command (`catalog/backend/services/scoped-values-import.ts:241,304`).
**Today** a product not admitted to the governed channel has those cells refused with `SCOPE_INVALID`
by `resolveRequestScope` (`catalog/backend/services/scoped-values-state.ts:204`) — reported by the
connector as run warnings (counted, not transient, the record still applies and is not retried).
**With FR-093 (R-11)** they are stored for a governed channel while admission is pending, so the
warnings disappear and the product appears with its values on admission. A connector change that asks
`productRuleGovernancePort` first stays optional (FR-055).

**Rejected**: (a) refusing in each caller — misses connectors and the generic channel routes;
(b) a `sales_channels`-owned "governed" column written by the module — the kernel would then need a
presence check on a foreign module id, and governance state would live outside its owner;
(c) default `refuse` — connectors would fail every sync (OQ-8 says they must comply unchanged);
(d) a caching governor — an attach would leak writes for a TTL in other processes.

## R-11 Applying the rule and admission (FR-051, FR-053, FR-059, FR-061, FR-072)

**Decision**:

- **Preview** (FR-053): `POST …/website-rules/previews` enqueues a job that evaluates the draft
  (rule definition + target channels) over every live product and stores the join/leave **snapshot**
  per channel (`website_rule_previews`, `website_rule_preview_changes`); the screen polls. Confirm
  (`attach` / `change` Commands) names the preview id; it is refused when expired (15 min) or when
  the rule's `version` moved since. The apply job writes exactly the snapshot's joins and leaves
  (SC-004 "exactly what the preview announced"); anything that changed since is picked up by the
  normal triggers within 5 min.
- **Steady state**: product marks (`website_rule_stale_products`) from `product.created.v1`,
  `product.updated.v1`, `product.archived.v1`, `product.deleted.v1` and from flag refreshes that
  changed a product's row; a debounced job (every 30 s) evaluates marked products for every governed
  channel and applies the diff with the governor token. Designated-book window boundaries schedule a
  delayed job at `starts_at` / `ends_at` (from `designationStatus.window`). A whole-currency flag
  swap marks every product. A reconcile of each governed channel runs hourly (bounded drift).
- **Admission** (FR-059): automatic writers skip (R-10), so a created or duplicated product is on
  no governed channel until a job admits it (FR-059's zero-channel exception for governed channels).
  A `beforeCommit` command hook on **every** catalog Command that writes a global status, an archive
  flag, a channel-scoped status or channel-scoped values — measured at `c3e8a8755` (H1):

  | Command action | Where | Writes |
  | --- | --- | --- |
  | `product.update` | `catalog-admin.service.ts:693` | global status (and channel cells through the editor save) |
  | `product.restore` | `catalog-admin.service.ts:1525` | archive cleared |
  | `product.bulk_update` | `catalog-bulk-update.service.ts:599` | global status |
  | `product.bulk_update.undo` | `bulk-operation.service.ts:727` | restores pre-state, may re-activate |
  | `product.scopes.update` | `product-scopes.service.ts:862` | channel / channel × language status |
  | `product.scoped_values.save` | `commands/scoped-values.commands.ts:119` | channel-scoped values incl. status |
  | `product.scoped_values.import` | `services/scoped-values-import.ts:304` | connector `applyScopes` and the CSV import: channel-scoped values incl. status |
  | `product.scoped_values.copy_to_channels` | `commands/scoped-values.commands.ts:324` | text fields only (`copyable`, `:259-266`: name, description, alt texts, attachment / packaging names, string C×L attributes) — **no status**, so not hooked; its pending-channel writes go through T070 |

  (all but `copy_to_channels` declared hookable by `catalog`, T049, with a test that fails on an
  undeclared status writer)
  removes, **in the same transaction** and with the governor token, every governed membership of a
  product whose status moves to `active` or whose archive is cleared — so a reactivation can never
  expose a stale membership; the job re-admits it within 5 min. **Channel-scoped status**
  (feature 163; written by `product.scopes.update` and the scoped-values save, which is how a
  connector switches a product on and off per channel): owner OQ-F A (FR-092) — a channel-scoped
  status moving to active **on a governed channel** is a reactivation for that channel; the same hook
  evicts that one membership and the job re-admits it. **Owner H2 A**: only the channel status (scope level `channel`) counts;
  per-language statuses decide only storefront per-language visibility and never reactivate. **Exception (FR-093, I-4 A, Q1 A)**: the
  first channel status write (scope level `channel`) on that channel after the product's admission is not a
  reactivation, even inactive → active — a connector's first sync after admission sets the
  per-channel state it was holding. The module records each admission in `website_rule_admissions`
  (channel, product, admitted_at, `post_admission_status_seen`): the apply job inserts and deletes rows
  and clears a channel's rows on detach; the reactivation hook deletes the row with each eviction it
  makes (so a re-admission starts a fresh row) and sets the flag in the same transaction (data-model
  N2). **Values before admission (FR-093)**: the
  refusal seam is `resolveRequestScope` (`scoped-values-state.ts:181-215`), shared by the admin save,
  the copy, the import / connector path and the read, plus the twin checks in
  `product-scopes.service.ts:243` and `url-key.service.ts:275`. It gains a `governedPending` option
  (channel → languages) that **callers** build from `productRuleGovernancePort.governedChannels()`
  (presence-probed; absent ⇒ empty ⇒ today's `SCOPE_INVALID`), so the function stays pure and the
  allowance is visible at each call site. Writes are stored and never add a membership; the product
  appears with them on admission. **Read side** (`scoped-values-read.service.ts:324`): an
  unrestricted admin may read the pending values of a governed channel (FR-093 as amended by the owner;
  documented in T094); every writer listed above stores pending values (N6); a restricted caller is already subject to FR-033 for the product. **Rejected**: letting
  `resolveRequestScope` call the port itself (a pure helper would acquire a cross-module dependency
  and a presence probe).
- **Designation rebuild and the rule (Q2 A)**: while a currency's new generation builds, the
  evaluator reads the **served** (previous) generation, so no product leaves and re-joins a
  governed channel because of the rebuild; only admin scopes drop the currency (TM-7 (4)). After the
  swap only products whose flags changed are marked. T068 must also prove that removing and re-adding a membership keeps the product's
  channel-scoped values (the bridge delete must not cascade into them).
- **Attribution** (FR-072): governor writes pass `source: 'website_rule:<ruleId>'` into the
  kernel's membership audit row (actor `system`); the rule name is resolvable from the id.

**Cost estimate**: evaluation reads attribute values through `catalogProductReadPort` in batches
of 1 000 (≈ 50 batches at 50 000 products, ~2 s) plus one flag read per batch. Each membership
change is one bridge statement, one audit row and one `sales_channels.membership_changed` event
(which the search index consumes per product). A first attach that removes 20 000 products:
~20 000 × (insert/delete + audit + event) ≈ 40 – 80 s in transactions of 500, plus 20 000 index
updates in `search`'s own queue. Steady state: a handful per change.

**Rejected**: (a) applying a fresh evaluation at confirm — may move products the preview did not
announce (SC-004); (b) a synchronous preview — Principle X, seconds of work; (c) evicting on
deactivation instead of on reactivation — deactivations made while the module was off would leave a
stale membership to expose later.

## R-12 Room for a per-product manual override (plan constraint)

**Decision**: no override now. The room is structural: (1) the desired member set is computed by
the module in one function (`desiredMembers(channel) = { p | live(p) ∧ meets(rule, p) }`), so an
override is a second module-owned input (`… ∪ includes − excludes`), not a second writer; (2) the
kernel governor already distinguishes the governor's writes from everyone else's, so an override
screen writes through the module (token) rather than through the refused manual path; (3) the
audit `source` already names who moved a membership. **Rejected**: a `source` column on
`sales_channel_products` now — kernel schema change with no reader (YAGNI).

## R-13 Role mapping and fail-closed (FR-020 – FR-024, OQ-2, OQ-10)

**Decision** (owner: OQ-G 1, I-2 A — FR-020, FR-022, FR-023, FR-025, FR-026):
`visibility_role_mappings(admin_role_id PK, target 'category' | 'unrestricted',
visibility_category_id null unless target = category)`. Scope resolution, in this order:
1. role code `platform_admin` ⇒ unrestricted;
2. the role holds a **self-lifting permission** (`*`, `product_visibility:manage`,
   `platform.modules.activate`, `admin_users:manage`) ⇒ unrestricted, whatever is stored (a stored
   mapping is "without effect" and flagged on the overview);
3. mapped to `unrestricted` ⇒ unrestricted (FR-025: sees unpriced products too, no refusal, no
   marker);
4. mapped to a category ⇒ restricted;
5. unmapped and holding `rfqs:handle` ⇒ `no_category` (fail-closed);
6. otherwise unrestricted.
Mapping `platform_admin` or a role holding a self-lifting permission — to a category or to
unrestricted — is refused `409 ROLE_NOT_MAPPABLE`. The role's permissions come from the same
`permissionService.resolveRole` answer. A role deleted in `admin_roles` leaves an orphan mapping
row that matches nothing (no cross-module FK; the configuration screen hides it and the delete
Command of a category ignores it).

**Rejected**: FK to `admin_roles`' table with cascade — a cross-module FK adds a hard migration
edge for one cleanup; the orphan is harmless. Refusing to map only some self-lifting permissions,
or fail-closing unmapped `*` roles (the earlier OQ-2 reading) — superseded by OQ-G 1.

## R-14 Role screens (FR-024)

**Decision**: `admin_users`' `AdminRolesPage.tsx` gains two read-only zone hosts
(`admin_users.roles.list.columns`, `admin_users.roles.editor.aside`) through `AdminZone`; the module
contributes a category cell and a panel linking to its mapping screen. Mapping is edited only on
the module's screen (no zone panel that writes, so the "save once" rules of
`module-admin-surfaces.md` §Zone-panel editors do not apply). Module off ⇒ contributions absent.

## R-15 Off state (FR-073)

**Decision**: one off-state test per surface: config API absent (404/503 per the gate), admin
screens and palette absent, catalog reads byte-identical to an instance without the module,
membership writes not skipped/refused, workers paused (jobs left waiting), command hook not run,
flags and rules kept; re-enable restores configuration, enqueues a reconcile of every governed
channel and a rebuild of every designated currency.

## R-16 Performance verification (SC-007)

**Decision**: `backend/test/perf/product_visibility_rules/admin-list-visibility.bench.ts`
(`PERF_RUN=true`): 50 000 products / 150 000 variants / 3 currencies; unrestricted vs restricted
first page, deep page, counts, select-all, search; budget restricted p95 ≤ unrestricted p95 + 50 ms
and ≤ 300 ms (architect-set, owner may override, recorded like D-5 in
`specs/pricing/read-paths-and-performance.md`); flag refresh latency (targeted ≤ 60 s, rebuild ≤
150 s).

**Measured (T035, same run as R-5):** the predicate in isolation over `products` — count p95
**6.1 ms → 23.4 ms** restricted, deep page (offset 20 000) p95 **7.8 ms → 46.6 ms**: inside restricted ≤
unrestricted + 50 ms and ≤ 300 ms. The budget against the real catalog list endpoint is asserted when
the catalog seam lands (Phase 5a).

## R-17 Threat-model amendments (`threat-model.md`, TM-1 – TM-16)

Decisions taken from the security review; task numbers in tasks.md § *Threat-model finding → task
map*.

- **Inventory = every catalog admin route** (TM-1, TM-5): the route-inventory test derives every
  `/api/v1/admin/catalog/**` route, not only the product-id prefix; product-free routes are an
  explicit allow-list in the test. Bulk operations (`catalog/backend/routes.admin.ts:479-560`) are
  narrowed in list/detail and undo, and the worker re-checks per product at write time for the
  requester. **Rejected**: filtering operations by requester only — another admin's operation can
  still carry hidden ids.
- **Error details naming another product** (TM-2) are redacted when that product is hidden
  (`URL_KEY_TAKEN` `heldByProductId/Name`, `catalog/backend/services/url-key.service.ts:309-337`, and
  a sweep of `catalog`, `price_lists`, `sales_channels`). The residual "already taken" oracle is
  accepted and documented (TM-15). This replaces OQ-E's premise that the oracle "names nothing".
- **Scope is a required, typed argument** (TM-3): `AdminProductVisibilityScope` gains an explicit
  `system` member; the catalog admin service's reads and writes take it as a required parameter and
  an architecture test fails on an omission; predicates are the union `none | sql | deny`;
  `resolveScope` never catches; off-request work resolves the requester's scope at execution.
  **Rejected**: an optional scope defaulting to unrestricted — a forgotten call site is a silent
  leak.
- **Self-lifting roles** (TM-4): owner OQ-G 1 — roles holding a lifting permission are always
  unrestricted and unmappable (R-13); a mapped role that later gains one is reported
  `mapping_without_effect` on the overview; the configuration write routes keep a scope check as
  defence in depth (unreachable end to end, unit-tested with a stubbed scope, T020); module
  activation/deactivation audit is verified in the lifecycle ledger (T024).
- **Flags race hardening** (TM-7): marks are cleared only if older than the refresh's read start; a
  targeted refresh writes under the generation row lock; marks survive a build and are re-applied
  after the swap; a partial build is never swapped; a served generation built for another
  designation contributes no condition (fail closed for the ≤ 150 s rebuild — supersedes R-5's
  "old generation keeps serving" for the designation case); a drift poll every 2 minutes on
  `catalogueReferencePricePort.changeWatermark()` bounds a lost announcement (the nightly rebuild
  stays as last resort).
- **SQL fragments** (TM-8): column identifiers from the caller are allow-listed by pattern; a test
  checks placeholder counts; no cache of scope or fragments.
- **Other admin read paths** (TM-9): plan.md § *TM-9 surfaces*, signed off (OQ-H), FR-083 – FR-088.
- **Governor token** (TM-10): identity-checked, boot-only, never in the container, `governs()`
  failure refuses, `source` only with the token, bridge-writer inventory test.
- **Preview and evaluation** (TM-11): creator check against the session, caps on concurrent
  previews and snapshot size, Zod bounds, attribute keys re-validated at evaluation.
- **Event as hint** (TM-12): validated, never a value source, capped, coalesced rebuilds.
- **Off state** (TM-13): activation texts say restrictions lift; release note says default off
  means no restriction until enabled.
- **Client caches** (TM-14): list routes send `Cache-Control: private, no-store`; the SPA drops its
  query cache on sign-out and `401` (verified or fixed in admin-shell).

## R-18 Rule-excluded products on sales-team purchase paths (FR-090, FR-091; owner OQ-B B, Q3)

**Decision**: `productRuleGovernancePort.excludedOnlyByRule(channelId, refs)` answers, per product
(or variant), whether it is absent from the channel **only** because the channel's website rule
excludes it: the channel is governed, the product is not a member, it is active, not archived or
deleted — and its **currently stored channel status** (scope level `channel`) is not `inactive`
(owner N1: the stored value counts whenever it was written — before admission, after admission or
left over from an earlier membership; inherited / no value counts as not inactive). Per-language
statuses are never read (H2 A); they decide only storefront per-language visibility. Built from the
module's own tables, the membership port and catalog read ports only.

**External dependency (not this spec)**: a PIM connector under a "follow publish" policy writes an
inactive channel status for a product hidden in every language, which under N1 makes such a product
drop out of the sales-team paths. A separate connector spec adds a setting to stop writing that
channel status for hidden-everywhere products; nothing in this plan depends on it. Callers keep today's check and add
this one as an allowance:
- `carts`: quote → cart conversion keeps such lines (`cart-conversion-service.ts:239`), and
  checkout / order placement does not drop or refuse them **when the cart line came from an accepted
  quote** (the line's quote origin is the condition, so the storefront cart is unaffected);
- `orders`: admin order create, preview, reorder and clone-to-quote accept them; for a restricted
  user the visibility-category check (FR-037, FR-039) runs first and is unchanged.
Module off or rule detached ⇒ no channel is governed ⇒ today's behaviour. The storefront listing,
search, type-ahead and product URL still hide the product (FR-051).

**Gate**: with Phase 9a, after spec 192 merges (conversion file is in 192's diff; the order paths
share 9a's gate, which the owner kept).

**Rejected**: re-adding the product to the channel for the duration of the order (a membership write
the rule would undo, visible on the storefront meanwhile); a separate "sales channel" requirement
(OQ-B A, not chosen).

## R-19 CRM opportunity → order / quote (FR-087, analyze round 2)

**Verified at `c3e8a8755`**: the CRM module creates no order or quote itself. "Create from
opportunity" (`crm/src/admin/components/CreateFromOpportunity.tsx:32-39`) navigates to the admin
screens `/orders/new` and `/quote-requests/new`, which submit `POST /api/v1/admin/orders` and
`POST /api/v1/admin/quote-requests`; the CRM admin API only **reads** orders and quotes
(`crm/src/admin/api.ts:275,286,594,607`), and the CRM backend has no product-line write. So FR-037 /
FR-041 checks (T081, T084) and the FR-091 allowance (T093) already cover the opportunity paths; no
extra task. T080 / T083 each add one case starting from an opportunity hand-off (same request body).
