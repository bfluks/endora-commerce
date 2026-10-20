# Feature Specification: Product data scopes per sales channel and language

**Feature Branch**: `feat/159-product-data-scopes`
**Created**: 2026-10-20
**Status**: Draft — awaiting `/speckit.clarify`
**Issues**: #385 (source), depends on #384; adjacent to #377 and #241
**Input**: Issue #385 — *Catalog: Magento-style scopes for product data — status, visibility, URL, SEO,
media per sales channel and language.* An operator cannot set a product's status or visibility per sales
channel or per language: a product cannot be active in the B2B channel and a draft in B2C, nor published
in Polish but held back in German until it is translated. Everything on a product other than name,
description and flagged user attributes is global. The issue is explicitly a **starting proposal**; this
spec records the owner's binding decisions so far and leaves the rest open for clarify.

**Owner decisions recorded before specification (binding)**

1. **Scope model** follows Magento 2 (Global / Website / Store View) as closely as possible, mapped onto
   Endora's two axes: **Global**; **Sales channel** (≈ Website); **Sales channel × language** (≈ Store
   View); plus **Language only** — a value written once per language for every channel and overridable per
   channel — as an improvement over Magento.
2. **Status is a scoped value like every other**: a global value plus optional overrides per channel and
   per channel × language, with inheritance; "use inherited" removes the override. With no per-scope
   value, the single global switch turns the product on or off in every scope.
3. The product editor **does not warn** that some scopes override the global status when the global
   switch is changed.
4. Every field in the issue's "Proposed scope per field" table is in scope for this feature, subject to
   analysis; the improvements over Magento listed in the issue are welcome.
5. #384 (the storefront ignores the channel overrides that already exist) is a separate bug, fixed on its
   own branch; this spec assumes it lands first.

## Current state (origin/master cde5563ea)

Paths are relative to the repository root. Behaviour below is read from the code, not observed at
runtime, unless stated.

### Product record

- `products.status` is `draft` | `active` | `inactive`, default `draft`
  (`packages/modules/catalog/src/backend/entities/product.entity.ts:55`). Setting `inactive` **is**
  archiving: it sets `archivedAt` and emits `product.archived.v1` once per transition; moving away clears
  `archivedAt` (`packages/modules/catalog/src/backend/services/catalog-admin.service.ts:448-488`, `:608-615`).
- Audience `visibility` is `public` | `logged_in_only` | `organization_restricted`, plus
  `allowedOrganizationIds` (`product.entity.ts:68`, `:108`) — one value for every channel.
- `slug` is a single, globally unique value (`product.entity.ts:48`). There is no URL-redirect mechanism
  anywhere in the catalogue or `seo` module today.
- `minOrderQuantity` and `returnable` (feature 155) are global (`product.entity.ts:203`, `:211`).

### Where status is honoured

- Storefront product list: only `status = 'active'`
  (`packages/modules/catalog/src/backend/services/catalog-query.service.ts:639`); filter facets likewise
  (`:1817`).
- Product page: rejects **only** `inactive` with 410 (`catalog-query.service.ts:1273-1275`), then channel
  membership and audience (404). **A `draft` product that is a member of the channel is therefore
  reachable by its URL** (code reading; not verified at runtime).
- Search indexer: `active` and not deleted and not archived
  (`packages/modules/search/src/backend/services/search-indexer.ts:787`). Comparisons
  (`packages/modules/comparisons/src/backend/services/comparison-service.ts:613`), quick order
  (`packages/modules/quick_order/src/backend/routes.ts:106`), sitemap
  (`packages/modules/seo/src/backend/services/sitemap-generator.service.ts:122`) and product feeds
  (`packages/modules/product_feeds/src/backend/services/product-selection.service.ts`) each apply their own
  `active` predicate.
- Baskets: feature 155 introduced a `product_unavailable` line state that blocks placement
  (`packages/modules/carts/src/backend/services/cart-minimums.ts:197`, `:390-393`).

### Existing scoped content

- `product_value_overrides` (productId, attributeKey, channelId, languageCode nullable, value `{ v }`)
  holds channel and channel × language slots
  (`packages/modules/catalog/src/backend/entities/product-value-override.entity.ts`); the language-only
  slot is the per-language baseline on the product itself (`products.name` / `products.description` are
  per-locale values).
- The fallback chain is **channel × language → channel → global × language → global**, implemented once in
  `packages/contracts/src/product-value-resolver.ts` and used by both backend and admin. (The entity's doc
  comment still points at a `services/product-value-resolver.ts` in catalog that no longer exists.)
  Override rows left orphaned by a scope-flag change are skipped silently.
- System attributes with a scope: `name`, `description` (`SYSTEM_ATTRIBUTE_SCOPES`,
  `packages/contracts/src/catalog.ts:2649`); user attributes carry `channelScoped` / `languageScoped`.
- Admin editor: `packages/modules/catalog/src/admin/components/ProductScopeEditor.tsx`.

### Other product data

- SEO overrides: one per (entity, locale), unique on (entityType, entityId, locale) — no channel
  (`packages/modules/seo/src/backend/entities/seo-meta-override.entity.ts:12`).
- Gallery: `gallery_items` and `gallery_item_labels` (roles base / small / thumbnail, unique per product)
  are global (`packages/modules/catalog/src/backend/entities/gallery-item*.entity.ts`). Attachment names
  and packaging-unit names are plain strings.
- Price display mode overrides: scope `organization` | `category` | `product`, no channel
  (`packages/modules/price_lists/src/backend/entities/price-display-mode-override.entity.ts:23`).
- Channel membership `sales_channel_products` is a bare yes/no, read and written only through the platform
  membership service (`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`);
  admin zone `packages/modules/sales_channels/src/admin/zones/ProductChannelMembership.tsx`.
- A sales channel has an ordered `languages[]` and a `defaultLanguage`
  (`packages/platform/src/kernel/sales-channels/sales-channel.entity.ts:64-69`).

## Terms used in this spec

- **Scope** — one of: *Global*; *Language* (L, for every channel); *Channel* (C, every language);
  *Channel × language* (C×L). A scope is **valid for a product** only for channels the product is a member
  of and languages that channel offers.
- **Scoped value** — a field whose value may be set at more than one scope. Its global value always
  exists; a value at any narrower scope exists only where an operator set one (an **override**).
- **Inheritance** — the effective value at a scope is the nearest override along the existing fallback
  chain (C×L → C → L → Global), restricted to the scopes the field supports.
- **Use inherited** — removes the override at that scope; it does not store an empty value.
- **Status** — whether the product is switched on at a scope (value set: see FR-010).
- **Display visibility** — *where* a live product is listed: not visible individually / catalog only /
  search only / catalog and search. Distinct from **audience visibility** (who may see it: public /
  logged-in only / organization-restricted). Every requirement names which one it means.
- **Publication window** — an optional from / to period per channel inside which the product may be live.
- **Effectively available** at (channel, language, buyer, now) — see FR-001.

## User Scenarios & Testing *(mandatory)*

Stories follow the issue's phase list (phase 1 is #384, a dependency). Each is independently shippable on
top of the stories before it of higher priority.

### User Story 1 - Operator switches a product on or off per channel and per channel × language (Priority: P1)

An operator has a product live in "B2B" and "B2C". In the product editor they set its status to off for
B2C only, and off for B2B × German only, because the German text is not ready. B2B buyers in Polish and
English still see it; B2B buyers in German and every B2C buyer do not. Later the operator chooses "use
inherited" on B2C and the product returns there, following the global switch.

**Why this priority**: The core of #385 and the smallest slice that delivers it; every other story builds
on the per-scope availability defined here.

**Independent Test**: Seed one product in two channels, each with two languages. Set overrides at C and
C×L, then query the storefront list, product page and search in all four (channel, language) pairs and
compare against the expected matrix; then remove one override and repeat.

**Acceptance Scenarios**:

1. **Given** a product with global status on and no overrides, a member of channels A and B, **When** a
   buyer lists the catalogue in any language of A or B, **Then** the product appears.
2. **Given** the same product, **When** the operator sets status off at channel B, **Then** it disappears
   from B's listing, search and product page (in every language of B) and remains in A.
3. **Given** status off at channel B, **When** the operator sets status on at B × English, **Then** the
   product is live in B only in English (the narrower override wins).
4. **Given** an override at B, **When** the operator chooses "use inherited" at B, **Then** the override no
   longer exists and B follows the global status again.
5. **Given** overrides at several scopes, **When** the operator changes the global switch, **Then** the
   change is saved with **no** warning about those overrides (owner decision 3), and scopes without an
   override follow the new global value while overridden scopes keep theirs.
6. **Given** a product whose effective status is off at (C, L), **When** a buyer requests its page at
   (C, L) by URL, **Then** the answer is the same as for a product that does not exist in that channel.
7. **Given** the existing product base, **When** this story is deployed, **Then** every product is live in
   exactly the same (channel, language) pairs and lists as before deployment.
8. **Given** a per-scope status change, **When** an auditor opens the audit log, **Then** one entry
   records the actor, the product, the scope and the before / after value, and the change can be undone.

---

### User Story 2 - Display visibility and publication window per scope (Priority: P2)

An operator marks a spare part "search only" in B2C × Polish so that it is findable but does not clutter
category pages, and marks variant children "not visible individually" so that they are only reachable
through their parent. For a seasonal product they set a publication window from 1 to 31 December in B2C;
outside it the product is not live there, without anybody having to switch it on and off.

**Why this priority**: Completes "where and when is it live" — the second half of phase 2 — and replaces
manual on/off toggling for scheduled launches.

**Independent Test**: Seed products with each display-visibility value at one (C, L) and one product with a
window in the past, present and future; assert category listing, search results and product page per case
at a controlled "now".

**Acceptance Scenarios**:

1. **Given** display visibility "catalog only" at (C, L), **When** a buyer browses a category or the list
   at (C, L), **Then** the product appears; **when** they search, **Then** it does not.
2. **Given** "search only", **Then** the converse holds.
3. **Given** "not visible individually", **Then** the product appears in neither listing nor search, its
   page is reachable by direct link only if FR-022 allows it, and it remains purchasable as a variant or
   bundle / grouped child of a live parent.
4. **Given** a publication window whose start is in the future, **When** a buyer browses at a time before
   the start, **Then** the product is not live in that channel; **at** the start it becomes live without
   any operator action.
5. **Given** a window that has ended, **Then** the product is no longer live in that channel and its status
   value is unchanged.
6. **Given** no window, **Then** the product is not time-limited.

---

### User Story 3 - Audience visibility per channel (Priority: P3)

An operator sells a product publicly in B2C but restricts it to two contract organizations in B2B. They set
the audience rule (public / logged-in only / organization-restricted with an organization list) for the B2B
channel only; B2C keeps the global rule.

**Why this priority**: Required by the issue's table but rarer than status; it reuses the audience rule
already enforced on reads (#227) and only adds a channel scope to it.

**Independent Test**: One product, global audience public, B2B override organization-restricted to org X;
assert listing and product page for an anonymous buyer, a buyer of org X and a buyer of org Y in each
channel.

**Acceptance Scenarios**:

1. **Given** the B2B override above, **When** a buyer of organization Y opens the product in B2B, **Then**
   it is indistinguishable from a non-existent product; in B2C the same buyer sees it.
2. **Given** "use inherited" on the B2B audience, **Then** B2B follows the global audience rule.

---

### User Story 4 - Scope overview matrix in the product editor (Priority: P4)

In the product editor an operator opens one overview showing channels × languages for the product. Each
cell shows the effective status and display visibility and marks every field overridden at that cell (and
at the channel row and the language column). From a cell they jump to the field, or reset any override to
inherited.

**Why this priority**: The main UX improvement over Magento's per-field "Use Default Value" checkbox;
without it, operators cannot see why a product is or is not live somewhere.

**Independent Test**: Seed overrides at C, L and C×L for several fields; open the overview and assert each
cell's markers and effective values; reset one and assert the cell and the storefront update.

**Acceptance Scenarios**:

1. **Given** overrides at C×L, C and L, **When** the operator opens the overview, **Then** each cell names
   the overridden fields and where the effective value comes from (this cell, channel, language, global).
2. **Given** a cell with an override, **When** the operator chooses "reset to inherited" for one field,
   **Then** only that override is removed and the cell shows the inherited value.
3. **Given** the operator lacks the product-edit permission, **Then** the overview is read-only.
4. **Given** a product that is a member of no channel, **Then** the overview says so and offers only the
   global and language scopes.

---

### User Story 5 - Bulk edit status and display visibility per scope (Priority: P5)

From the product list an operator selects 300 products and sets status off and display visibility "catalog
and search" for B2C × German, or resets those overrides to inherited, in one action.

**Why this priority**: Launches and withdrawals happen per market for many products at once; doing it one
product at a time defeats the feature.

**Independent Test**: Select N products, run the bulk action at one scope, assert each product's override
at that scope and no other, the audit entries, and undo.

**Acceptance Scenarios**:

1. **Given** a selection and a chosen scope, **When** the bulk action runs, **Then** only that scope's
   override changes on each selected product.
2. **Given** a completed bulk action, **Then** every product's change is audited with its scope, and the
   operation can be undone as a whole with a per-product conflict report (Constitution XIII).
3. **Given** a selected product that is not a member of the chosen channel, **Then** it is skipped and
   reported, not silently added to the channel.

---

### User Story 6 - Completeness gate when enabling a product for a scope (Priority: P6)

When an operator switches a product on for (C, L) — directly, in bulk, or by changing the global switch so
that (C, L) becomes live — the system checks that the values required to sell there exist in L: name, URL
key and every required language-scoped attribute. Missing values are listed.

**Why this priority**: Prevents half-translated products going live in a market — the motivating example of
#385 — but the feature works without it.

**Independent Test**: A product lacking a German name; enable it at B2C × German; assert the gate's
response per FR-060.

**Acceptance Scenarios**:

1. **Given** a missing German name, **When** the operator enables the product at (B2C, de), **Then** the
   missing field is named, and the outcome follows FR-060.
2. **Given** all required values present, **Then** no gate message is shown.

---

### User Story 7 - URL key per language, overridable per channel, with redirects (Priority: P7)

An operator gives a product the URL key `wiertarka-udarowa` in Polish and `impact-drill` in English, and in
the B2B channel overrides the English key to `impact-drill-pro`. When they later change a key, the old URL
answers with a permanent redirect to the new one.

**Why this priority**: Localised URLs matter for SEO in multilingual channels (Constitution VII) but are a
separate phase (3) that the availability work does not need.

**Independent Test**: Set keys at L and C×L; resolve each URL per (C, L); change one key and assert the old
URL redirects permanently to the new one in the same (C, L).

**Acceptance Scenarios**:

1. **Given** keys per language, **When** a buyer requests the product page by the key of (C, L), **Then**
   the product is found; a key from another language resolves according to FR-071.
2. **Given** a key in use by another product in the same uniqueness space (FR-070), **When** the operator
   saves it, **Then** the save is refused naming the conflicting product.
3. **Given** a changed key, **When** a buyer requests the old URL, **Then** they receive a permanent
   redirect to the current URL for that (C, L).
4. **Given** a key changed twice, **Then** both old URLs redirect directly to the current one (no chain).

---

### User Story 8 - SEO metadata per channel × language (Priority: P8)

An operator sets a different meta title and description for B2B × Polish than for B2C × Polish; channels
without an override fall back to the language value, then the global one.

**Why this priority**: Phase 4; extends the existing per-language SEO override with a channel dimension.

**Independent Test**: Set SEO at L and at C×L; render product page metadata per (C, L) and assert the
source.

**Acceptance Scenarios**:

1. **Given** an SEO override at (B2B, pl) and one at (pl), **Then** B2B × Polish shows the first and B2C ×
   Polish the second.
2. **Given** existing per-language SEO overrides, **When** this story is deployed, **Then** they become the
   language-scope values and no page's metadata changes.

---

### User Story 9 - Media, attachments and packaging units per scope (Priority: P9)

An operator chooses a different base image for B2B, hides one lifestyle image in B2B, gives each image an
alt text per language, translates attachment names and descriptions and hides one attachment in B2C, and
translates packaging-unit names ("karton" / "carton").

**Why this priority**: Phase 5; content polish rather than availability.

**Independent Test**: Seed role, hide, label and translation overrides; render the product page per
(C, L) and assert gallery order / roles / alt text, attachments and unit names.

**Acceptance Scenarios**:

1. **Given** a base-image override for B2B, **Then** B2B listings and the page use that image and other
   channels use the global one.
2. **Given** an image hidden in B2B, **Then** B2B never shows it; other channels do.
3. **Given** alt text in Polish only, **When** rendering in English, **Then** the global alt text is used.
4. **Given** an attachment hidden in B2C, **Then** B2C neither lists nor serves it from the product page.
5. **Given** packaging-unit names per language, **Then** product page, basket and order lines show the
   name in the buyer's language, and order lines keep the name they were placed with.

---

### User Story 10 - Order constraints and price display mode per channel (Priority: P10)

An operator sets minimum order quantity 10 in B2B and 1 in B2C, makes the product returnable only in B2C,
and sets the price display mode (net / gross) for the product in B2B.

**Why this priority**: Phase 6; extends feature 155 and the price display chain with a channel step.

**Independent Test**: Seed overrides per channel; add to basket and place orders in each channel and assert
the minimum, the return eligibility and the displayed price mode.

**Acceptance Scenarios**:

1. **Given** MOQ 10 in B2B, **When** a B2B buyer adds 5, **Then** the basket refuses as feature 155 does;
   in B2C the same quantity is accepted.
2. **Given** returnable only in B2C, **Then** a return is offered on B2C orders and not on B2B orders.
3. **Given** a channel-level price display mode for the product, **Then** it applies in that channel
   according to the precedence in FR-101.

---

### Edge Cases

- **Product goes offline in a basket.** A product whose effective availability becomes false in the
  basket's (channel, language) while it sits in a basket: the line is kept and shown as unavailable and
  blocks placement, using the existing `product_unavailable` state from feature 155 (FR-006).
- **Window boundary during checkout.** The window ends between "add to basket" and "place order": placement
  re-evaluates availability at placement time and treats the line as unavailable.
- **Language removed from a channel** while C×L overrides exist for it: the overrides are retained but
  ignored (no error), reappear if the language is re-added, and are shown as orphaned in the overview.
- **Product removed from a channel**: its channel-scoped values are retained but ignored; re-adding restores
  them. (Membership removal is not deletion.)
- **Channel deleted**: its scoped values are removed with it.
- **Global archive vs per-scope enable**: an archived (or deleted) product is unavailable everywhere,
  whatever its per-scope status.
- **Variant / bundle child "not visible individually"**: still resolvable and purchasable through a live
  parent in the same (C, L); a child whose own status is off at (C, L) is not purchasable there even via
  the parent.
- **Parent off, child on**: the child does not make the parent reachable.
- **Unresolved channel** (no header, no host mapping and no default): no scoped value matches and no
  product is live — fail closed (Constitution XII).
- **URL key collision with a redirect**: a new key equal to another product's *old* (redirecting) key —
  resolved by FR-072.
- **Redirect to a product that is now unavailable** at (C, L): the redirect target answers as unavailable
  (not-found), the redirect does not leak that the product exists.
- **Attribute scope flag changed** after values exist (e.g. a language-scoped attribute made global):
  defined by FR-090.
- **Module off**: with `seo` off, redirects and SEO overrides are not served, but the data persists; with
  `search` off, "search only" products are simply not listed anywhere (FR-111).
- **Concurrent edits** at the same scope by two operators: last write wins, each audited.

## Requirements *(mandatory)*

### Functional Requirements

#### Effective availability (shared by every consumer)

- **FR-001**: A product MUST be **effectively available** at (channel C, language L, buyer, now) if and only
  if all hold: it is not deleted and not archived; it is a member of C; L is a language of C; its effective
  status at (C, L) is "on"; now is inside its effective publication window for C (if any); and its effective
  audience rule for C admits the buyer.
- **FR-002**: Effective availability MUST be computed by one shared definition that every consumer below
  uses; no consumer may apply its own status predicate.
- **FR-003**: Display visibility at (C, L) MUST decide only *where* an effectively available product is
  listed (category / product listing, search, both, neither); it MUST NOT make an unavailable product
  available.
- **FR-004**: The following consumers MUST honour FR-001 and FR-003 for their (C, L): storefront product
  list and filter facets; product page (including links, related products and bundle configuration);
  search indexing and search results; sitemap; product feeds; quick order; comparisons; CMS product blocks;
  basket add and order placement.
- **FR-005**: A product page request at (C, L) for a product not effectively available there MUST answer
  exactly as for a product that does not exist (no status-specific response that reveals existence),
  except for the archived case, which MUST keep its current "gone" answer. This closes the reachable-draft
  gap noted in *Current state*.
- **FR-006**: A basket line whose product is no longer effectively available at the basket's (C, L) MUST be
  shown as unavailable and MUST block placement, reusing the existing unavailable-line behaviour.
- **FR-007**: An unresolved request channel MUST NOT match any scoped value or any product (fail closed,
  Constitution XII); channel membership MUST be read only through the sanctioned membership service.

#### Scope model and inheritance

- **FR-008**: Every scoped field MUST resolve through the existing fallback chain (C×L → C → L → Global),
  restricted to the scopes that field supports (table in FR-009); a second fallback chain MUST NOT be
  introduced.
- **FR-009**: Supported scopes per field (interim, per the issue's table; see *Deferred to clarify* D-2):

  | Field | Global | Language | Channel | Channel × language |
  | --- | --- | --- | --- | --- |
  | Name, description | yes | yes | yes | yes (unchanged) |
  | User attributes | per attribute flags (unchanged) | | | |
  | Status | yes | — | yes | yes |
  | Display visibility | yes | — | yes | yes |
  | Audience visibility | yes | — | yes | — |
  | Publication window | yes | — | yes | — |
  | URL key | yes | yes | — | yes |
  | SEO meta title / description / OG | yes | yes | yes | yes |
  | Gallery: image roles, hide image | yes | — | yes | — |
  | Gallery: label / alt text | yes | yes | — | — |
  | Attachment name, description | yes | yes | — | — |
  | Attachment hidden | — (shown) | — | yes | — |
  | Packaging-unit name | yes | yes | — | — |
  | Minimum order quantity, returnable | yes | — | yes | — |
  | Price display mode | existing chain | — | yes | — |

  SKU, type, attribute set, stock flags, fulfilment strategy, product links, bundle / grouped / variant
  structure, prices, promotions and warehouses MUST remain as they are.
- **FR-010**: Status MUST hold [NEEDS CLARIFICATION: status value set — keep `draft` / `active` /
  `inactive` (with `inactive` = archived) as the scoped value, or make the scoped status enabled / disabled
  and move archiving (and draft?) to a separate global product state?]. Whatever the value set, archiving
  MUST remain a global, product-wide state (FR-001), not a per-scope one.
- **FR-011**: Every scoped field MUST have a global value; an override MUST exist only at a scope where an
  operator (or an integration) set one.
- **FR-012**: "Use inherited" MUST remove the override at that scope; the effective value MUST then be the
  inherited one. Storing an empty value MUST NOT be the way to inherit.
- **FR-013**: Changing a global value MUST NOT alter or remove any override, and the product editor MUST
  NOT warn about existing overrides when the global status (or any global value) is changed (owner
  decision 3).
- **FR-014**: An override MUST be accepted only for a scope valid for the product (FR-009 and *Terms*); an
  override for a channel the product is not a member of, or a language the channel does not offer, MUST be
  refused with a validation error naming the scope.
- **FR-015**: Overrides made invalid later (product leaves a channel, a language leaves a channel, an
  attribute's scope flags change) MUST be retained and ignored by resolution, and MUST be listed as orphaned
  in the scope overview with a way to delete them.
- **FR-016**: Status and display visibility MUST be filterable when listing, searching and generating
  sitemaps and feeds, without resolving every product's overrides one by one (performance target SC-004).

#### Display visibility and publication window

- **FR-020**: Display visibility MUST take one of: *not visible individually*, *catalog*, *search*,
  *catalog and search*; default *catalog and search*.
- **FR-021**: A product that is *not visible individually* at (C, L) MUST remain purchasable at (C, L) as a
  variant, bundle-slot option or grouped item of an effectively available parent.
- **FR-022**: Interim reading (the issue's): a product that is *not visible individually* at (C, L) and
  effectively available there MUST keep a product page reachable by direct link, and MUST NOT appear in the
  sitemap or feeds for (C, L). The alternative (no own page at all, Magento-style) is open — *Deferred to
  clarify* D-3.
- **FR-023**: A publication window MUST be an optional start, an optional end, or both, per channel; the
  start MUST be before the end. Outside the window the product MUST NOT be effectively available in that
  channel, and the transition MUST take effect without operator action and within the time stated in
  SC-005.
- **FR-024**: Entering or leaving a window MUST update every consumer of FR-004 (search, sitemap, feeds)
  the same way a status change does.

#### Audience visibility per channel

- **FR-030**: The audience rule (public / logged-in only / organization-restricted with its organization
  list) MUST be settable per channel, inheriting the global rule; evaluation MUST stay the existing read-time
  rule, and an out-of-audience answer MUST be indistinguishable from "does not exist".

#### Product editor

- **FR-040**: The product editor MUST offer, for every scoped field, a way to set it at each supported scope
  and to "use inherited", and MUST show the source of the effective value.
- **FR-041**: The editor MUST offer a scope overview: channels × languages for the product's channels, with
  the channel and language levels, marking per cell the overridden fields, the effective status and display
  visibility, and offering "reset to inherited" per field per cell.
- **FR-042**: The overview and scope controls MUST be read-only for an operator without the product-edit
  permission, and MUST be reachable from the product editor and discoverable in the command palette
  (Constitution XVI) as part of the product editor.
- **FR-043**: Every new operator-facing label and message MUST exist in Polish and English.

#### Bulk edit

- **FR-050**: The product list MUST offer a bulk action that sets, or resets to inherited, status and display
  visibility at one chosen scope for the selected products.
- **FR-051**: Products not valid for the chosen scope MUST be skipped and reported per product.
- **FR-052**: The bulk action MUST run on the existing durable bulk-operation path and be audited per product
  and reversible as a whole (FR-080, FR-081).

#### Completeness gate

- **FR-060**: When a product becomes effectively "on" at (C, L) through an operator action, the system MUST
  check that name, URL key and every required language-scoped attribute resolve to a non-empty value at
  (C, L), and MUST [NEEDS CLARIFICATION: gate behaviour — warn and save; refuse the save; or a setting
  choosing between warn and refuse (and its default and level: global or per channel)?]. Missing fields MUST
  be named.
- **FR-061**: The gate MUST apply equally to single edits, bulk edits and changes of the global switch that
  turn on scopes without overrides, and MUST NOT apply to imports and PIM synchronisation unless decided in
  clarify (assumption A-6).

#### URL key and redirects

- **FR-070**: The URL key MUST be settable per language (for every channel) and overridable per
  channel × language, and MUST be unique within [NEEDS CLARIFICATION: URL key uniqueness and redirect
  rules — unique per (channel, language), per language across all channels, or globally as today; how long
  old URLs redirect (forever vs a retention period); and whether a key that is another product's redirect
  source may be reused (taking the URL over) or is refused?].
- **FR-071**: A request at (C, L) for a key that belongs to the same product in another language of C MUST
  redirect permanently to the (C, L) URL; a key of no product MUST answer not-found.
- **FR-072**: Changing a URL key MUST keep the previous URL as a permanent redirect to the current URL in
  the same (C, L); redirects MUST never chain (an old URL always points directly at the current one), and
  MUST be removed when the product is deleted.
- **FR-073**: Existing slugs MUST become the global URL key at deployment, so every existing URL keeps
  resolving unchanged (SC-001).
- **FR-074**: The sitemap and every alternate-language link MUST use the effective key per (C, L).

#### SEO, media, attachments, packaging units

- **FR-075**: SEO meta title, description and OG fields MUST be settable per channel × language with the
  chain of FR-008; existing per-language overrides MUST become language-scope values without change.
- **FR-076**: Gallery image roles (base, small, thumbnail) and "hide image" MUST be settable per channel;
  a hidden image MUST NOT be served in that channel; role uniqueness MUST hold per channel.
- **FR-077**: Gallery label / alt text MUST be translatable per language.
- **FR-078**: Attachment name and description MUST be translatable per language, and an attachment MUST be
  hideable per channel; a hidden attachment MUST NOT be listed or downloadable from the product page in
  that channel.
- **FR-079**: Packaging-unit names MUST be translatable per language; order lines MUST keep the name in the
  language they were placed in.

#### Order constraints and price display mode

- **FR-100**: Minimum order quantity and "returnable" MUST be settable per channel, inheriting the global
  value, and every feature-155 check MUST use the value of the basket's or order's channel.
- **FR-101**: The price display mode chain MUST gain a channel-level product override, with precedence
  (most specific first): organization → product × channel → product → category → global default (interim
  reading; see *Deferred to clarify* D-5).

#### Auditing, tenancy, activation, integrations

- **FR-080**: Every write of a scoped value (set, change, use inherited) MUST run as an audited Command
  carrying the product, the field, the scope and the before / after value (Constitution XIII), with exactly
  one audit entry per product per command.
- **FR-081**: Single and bulk scoped writes MUST be reversible with the standard undo (all-or-nothing per
  product, conflict report for products changed since).
- **FR-082**: Status, display-visibility, window, audience and URL-key changes MUST emit domain events so
  that search, sitemap, feeds and webhooks update; an archive MUST still emit the existing archive event.
- **FR-083**: The new scoped data is catalogue data and MUST be classified as platform-global, as product
  value overrides are today (Constitution XI); audience evaluation stays at read time against the buyer's
  organization.
- **FR-084**: Admin permission codes for these writes MUST reuse the existing product-edit permission unless
  the plan justifies a new one; any new code MUST appear on `/admin-roles` with Polish and English labels.
- **FR-090**: Changing a user attribute's scope flags after values exist MUST follow a defined, previewable
  migration: narrowing (e.g. channel-scoped → global) MUST tell the operator how many overrides become
  orphaned and retain them (FR-015); widening MUST create no values.
- **FR-091**: PIM connectors (Ergonode, Akeneo, Pimcore, UnoPim) and catalogue import / export MUST each
  state which scope they read and write for every field of FR-009; a connector that writes only global
  values MUST NOT remove overrides set by operators.
- **FR-092**: Import / export MUST be able to round-trip status and display visibility per scope.
- **FR-110**: Deployment migration MUST make every existing product's effective availability and listing
  identical to before deployment: existing status becomes the global status, display visibility becomes
  *catalog and search* everywhere, no windows, existing audience rule becomes the global audience rule.
- **FR-111**: When `seo` is off, redirects and SEO overrides MUST NOT be served and their data MUST persist;
  when `search` is off, search-visibility has no surface; scoped catalogue data MUST persist across any
  module being turned off and on (Constitution XVII).

### Key Entities

- **Product (scoped values)** — the product's global values plus the set of overrides per scope for status,
  display visibility, publication window, audience, URL key, SEO, media roles / hidden flags, translated
  labels, minimum order quantity, returnable and price display mode.
- **Scope** — Global, Language, Channel, or Channel × language; valid only for the product's channels and
  their languages.
- **Override** — a value of one field at one scope; absent means inherit.
- **URL redirect** — an old URL key at (C, L) pointing permanently at a product's current URL there.
- **Channel membership** — unchanged yes / no bridge; a precondition for every channel-scoped value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After deployment, for every channel and language, the set of products listed, searchable,
  reachable by URL (all existing URLs) and in the sitemap and feeds is identical to the set before
  deployment, except that products that are not "on" (today: `draft`) are no longer reachable by URL
  (FR-005; the final wording follows the FR-010 / D-1 decision).
- **SC-002**: An operator can take a product live in one market and offline in another in under one minute
  from the product editor, without touching other markets.
- **SC-003**: For any product, an operator can tell from one screen why it is or is not live in every
  (channel, language) pair, without opening other screens.
- **SC-004**: Storefront listing and search response times at the catalogue sizes of the performance targets
  do not regress by more than 10% with overrides present on 20% of products.
- **SC-005**: A publication-window start or end is reflected on the storefront within 5 minutes and in search
  within 15 minutes.
- **SC-006**: 100% of scoped writes (single and bulk) appear in the audit log with their scope, and a bulk
  change of 1 000 products can be undone in one action.
- **SC-007**: Zero products reachable at a (channel, language) where their effective status is off, measured
  by automated tests across all FR-004 consumers.

## Assumptions

- **A-1**: #384 lands first; the storefront already resolves name / description overrides per (C, L).
- **A-2**: The language-only scope for fields that already have one (name, description, language-scoped
  attributes) is the existing per-language baseline; no new storage is implied by this spec.
- **A-3**: A buyer's language at (C, L) is the request language resolved today; an unsupported language
  falls back to the channel's default language before any scope resolution.
- **A-4**: The publication window does not change the stored status; it is a separate condition.
- **A-5**: Prices, promotions and warehouses are already channel-aware and are untouched.
- **A-6**: The completeness gate (US6) applies to operator actions in the admin, not to imports or PIM
  synchronisation, unless clarify decides otherwise.
- **A-7**: Scoped values are edited by operators with the existing product-edit permission (FR-084).
- **A-8**: Out-of-audience and out-of-channel answers keep their current not-found semantics (#227).

### Deferred to `/speckit.clarify` (not decided; interim reading only)

These have a reasonable interim reading taken from the issue's table, used above so the spec is complete,
but they are **open** and the owner decides them in clarify:

- **D-1**: Whether `draft` survives as a status value, and whether a never-published product should be
  reachable anywhere (tied to FR-010).
- **D-2**: Which fields really need channel × language rather than channel only — notably display
  visibility (interim: C×L) and audience / window (interim: channel only) (FR-009).
- **D-3**: "Not visible individually" semantics — reachable by direct link (issue) or not reachable at all
  except through its parent (Magento) (FR-022).
- **D-4**: Whether bulk edit (US5) also covers the other scoped fields (window, audience, MOQ) or only status
  and display visibility.
- **D-5**: Price display mode precedence between organization and product × channel (FR-101).
- **D-6**: Whether gallery images themselves (not only roles / hide) can differ per channel, and the
  relation to per-variant galleries (#377).

## Out of Scope

- #384 (storefront honouring existing overrides) — separate fix, a dependency.
- Per-variant galleries (#377), beyond not contradicting them.
- Making catalogue bulk writes other than those of US5 audited (#241).
- Per-channel prices, promotions, warehouses, stock, SKU, product type or structure.
- A Magento-style "store view" entity; the two existing axes are kept.
- Per-deployment overlays for any of this (Constitution XV).

## Constitution constraints

- **I / XVII** — catalogue owns the scoped product data; `seo`, `search`, `product_feeds`, `quick_order`,
  `comparisons`, `cms`, `carts` consume effective availability through catalogue's exported surface; each
  consumer's surface disappears when its module is off, the data persists.
- **XI** — new data platform-global; audience evaluated at read time; out-of-scope answers indistinguishable
  from not-found.
- **XII** — every scoped read resolves a concrete channel and fails closed; membership via the sanctioned
  service only; cross-channel tests for every FR-004 consumer.
- **XIII** — every scoped write and bulk write is a Command, audited per scope, reversible.
- **VII** — localised URLs, permanent redirects, correct alternate-language links.
- **XVI** — the scope overview and bulk action are reachable from the command palette with the product
  editor and product list.
