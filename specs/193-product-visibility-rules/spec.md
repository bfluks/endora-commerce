# Feature Specification: Product visibility rules — admin roles by catalogue price, and a configurable website rule

**Feature Branch**: `feat/193-product-visibility-rules`
**Created**: 2026-11-24
**Status**: Draft — owner decisions of 2026-11-24 recorded under *Owner decisions*; all
clarifications answered under *Clarifications* (OQ-9 left to the architect); clarify exhausted;
plan and tasks done; analyze clean (round 3, 2026-11-25); build waits for owner go
**Input**: Issue #1908 (product visibility for admin roles by catalogue price, and a configurable
website rule), with the owner decisions of 2026-11-24.
**Depends on**: `specs/192-quote-request-draft-share/` (issue #1901) for the quote-request and
admin-kit product-search parts only — see *Dependencies and sequencing*.

## Context

Some B2B merchants sell part of their catalogue only through their sales team — offers prepared in
the Admin UI for products that must never appear on the storefront (customer-specific items, small
accessories). Their sales representatives work in different markets and may offer only the products
they can price in their own currency; a product with no catalogue price must not be offered at all,
and a product whose catalogue price is zero may be offered only by people allowed to negotiate the
price.

The platform cannot express either rule today.

### What the code does today

Verified against `origin/master` `67351db04` (2026-11-24). Paths are relative to the repository
root; `catalog/…` means `packages/modules/catalog/src/…`, and likewise for other modules.

- **F1 — Admin product reads have no per-role narrowing.** The admin product list
  `GET /api/v1/admin/catalog/products` (`catalog/backend/routes.admin.ts:601-602`), `POST
  …/products/resolve-ids` (`:692`), `POST …/products/batch-by-id` (`:1021-1024`) and the detail
  `GET …/products/:id` (`:724-727`) are gated by the permission `catalog:read` alone. The list
  answers `total` and per-status `counts` beside the page
  (`catalog/backend/services/catalog-admin.service.ts:1748-1754`); its only channel narrowing is an
  optional, caller-chosen `salesChannelId` (`:1856-1860`). Further by-id routes hang off the same
  product (`/content`, `/scopes`, `/scoped-values`, `/scope-overview`, `/attribute-set-preview`,
  `/gallery`, `/editor-preference`, and `/variants`, which the price book grid reads —
  `price_lists/admin/lib/price-books-api.ts:287`) and the writes (`PATCH`, `archive`, `restore`, `duplicate`,
  `bulk-update`) are gated by `catalog:write`.
- **F2 — Admin global search ignores who is asking.** The search contract hands every provider the
  caller's `adminUserId` (`packages/contracts/src/admin-search.ts:267`); the product provider
  forwards only the text, fields and limit (`catalog/backend/admin-search-provider.ts:77-85`) and
  returns every product that is not deleted (`:87-121`), through a database `ILIKE` query
  (`catalog/backend/services/catalog-admin-search.service.ts:38-40`).
- **F3 — The same list endpoint serves many screens.** The admin-kit product browser and quick
  picker read it (`packages/admin-kit/src/components/product-browser/product-browser-api.ts:43`,
  `packages/admin-kit/src/components/product-picker/ProductPicker.tsx:202`, detail at `:259`); the
  picker and browser are used by the product editor, order create, the price book grid, the price
  explainer, SEO, the product-feed template preview and both quote-request screens
  (`RfqCreatePage.tsx`, `RfqDetail.tsx`). The list is also called directly by, among others,
  `blog` (related products, `blog/admin/components/RelatedProductsPicker.tsx:40`), `cms`
  (catalogue preview, `cms/admin/components/AdminCatalogPreviewProvider.tsx:76`), `crm`, `projects`
  and `tasks` (their `admin/api.ts`), `price_lists` (display-mode overrides,
  `price_lists/admin/pages/DisplayModeOverridesPage.tsx:149`) and the admin-shell home page's
  product count (`packages/admin-shell/src/modules/home/HomePage.tsx:98`). Filtering the endpoint
  therefore changes every one of them.
- **F4 — One role per admin user; the platform administrator is a fixed role.** An admin user holds
  one `adminRoleId` (`admin_users/backend/entities/admin-user.entity.ts:42-44`). The
  platform-administrator role has the code `platform_admin`, is never deletable and grants the
  wildcard `*` (`admin_roles/backend/services/platform-administrator-role.ts:18-22`); any other
  role may also be given the wildcard (`admin_roles/backend/services/admin-role-service.ts:227`).
- **F5 — There is no separate "create quote" permission.** Every admin quote-request route —
  list, read, create and edit alike — is gated by `rfqs:handle`
  (`quote_requests/backend/routes.admin.ts:59`; declared in `quote_requests/manifest.ts:556`, which
  requires `price_lists:read`). Spec 192 keeps `rfqs:handle` as "the quote-handling permission".
  The holders of the permission that lets a role create offers are therefore exactly the holders
  of the permission that lets it see quotes.
- **F6 — Quote lines accept any non-archived product.** An operator's line for a product outside
  the quote's channel is only a warning (`PRODUCT_UNAVAILABLE_IN_SCOPE`,
  `quote_requests/backend/services/rfq-admin-service.ts:1089`); edit runs through `modify`
  (`:839`). The nearest precedent of a per-user narrowing is the sales-rep scoping of
  organizations on the same screens (`:298-303`, `:1111`). Spec 192 is changing this file now; the
  line numbers will move.
- **F7 — Price books.** A book has one currency, an audience (`everyone`, customer groups,
  organizations), a status and a schedule (`price_lists/backend/entities/price-list.entity.ts:49-73`).
  The per-currency system book is the currency's **base book**, which holds **only fixed product
  rows and variant rows** (fixed, or an adjustment of the product's base) — category, attribute and
  "all" rows and product-level adjustments exist only in other books
  (`specs/pricing/current-model.md` §1.1, *Row rules*; `price_lists/backend/services/book-resolver.ts:260-261`).
  A fixed amount may be `0`, and the resolver treats zero as a price and "no row" as unpriced
  (`current-model.md` §1.2). A non-base book applies only on the sales channels it is bound to;
  every engine entry point takes a sales channel. A book's schedule is read at resolution time; a
  status sweep moves the admin-visible status every 5 minutes. The engine answers from a 60-second
  per-process cache, cleared on every audited price-book write. The nearest precedent for "the
  price on one named book" is `namedListPrices` (product feeds pinned to a book —
  `price_lists/backend/services/pricing-service.interface.ts`), which also needs a channel.
- **F8 — The storefront already honours channel membership everywhere.** Product detail answers
  `404 PRODUCT_NOT_FOUND` for a product outside the request's channel
  (`catalog/backend/services/catalog-query.service.ts:2070-2071`); listings apply membership with
  status and audience as one condition (`:1154`) and fail closed (`:3300`); type-ahead uses the same
  membership (`catalog/backend/services/catalog-quick-search.service.ts:32-38`); the search index
  is wired to the membership port and reacts to `sales_channels.membership_changed`
  (`search/backend/index.ts:118-120`, `:243`).
- **F9 — Nothing owns a channel membership.** The membership row is `(sales_channel_id,
  product_id)` and nothing else (`catalog/migrations/20260912T094557_catalog_sales_channel_products.ts`).
  Inside this repository, products enter channels on create (`bindToDefaultIfEmpty`,
  `catalog-admin.service.ts:518`), on duplicate (`copyMemberships`, `:1159`), by bulk update
  (`addToChannel`, `catalog/backend/services/catalog-bulk-update.service.ts:562`, `:570`) and by
  manual edits; PIM connectors (tracked separately) also add products to their connection's
  channel on every synchronisation. Whoever wrote last wins.

## Owner decisions (2026-11-24)

The owner ruled on the shape before this spec was written; each decision below is encoded in the
requirements it names.

1. **Visibility categories** are defined by per-currency catalogue price conditions ("> 0",
   "≥ 0"); the currencies are any currency active on the platform. → FR-010 – FR-013.
2. **Catalogue price** is what the pricing engine resolves from a price book designated per
   currency in the Admin UI (default: that currency's base book), for quantity 1, no customer,
   valid now; category, attribute and "all" rows and adjustments count; price 0 is not "no price";
   no price makes the product invisible to every restricted category; a configurable parent is
   visible when at least one variant qualifies. → FR-001 – FR-007.
3. **Role → category mapping** in the Admin UI; an admin user has exactly one role. Unmapped roles
   holding the quote-handling permission `rfqs:handle` (the offer-creation permission, F5) are
   fail-closed on every filtered surface; the platform
   administrator is always unrestricted; other unmapped roles are unrestricted. → FR-020 – FR-026
   (amended 2026-11-25 by OQ-G and I-2: a role holding a self-lifting permission is always
   unrestricted and never mapped; a role can be mapped to "unrestricted").
4. **Server-side filtering** for restricted users of every admin product read that shares the
   product list endpoint (list, detail, resolve-ids / select-all, admin global search, the offer
   product browser and picker, and with them order create, the price grid, the price explainer,
   the product editor and SEO), with correct totals and paging; a hidden product answers as absent.
   → FR-030 – FR-038; further admin surfaces decided 2026-11-25 (OQ-D, OQ-E, OQ-H) → FR-080 –
   FR-088.
5. **Quote requests**: the server refuses creating or editing a line with a product outside the
   user's category; existing lines stay; a product visible only through a "≥ 0" condition at price
   0 carries a fixed, translated "no fixed price" marker. Sequenced after spec 192 merges.
   → FR-040 – FR-043.
6. **Website rule**: a named, configurable rule over product attributes and price conditions
   decides storefront sales-channel membership and is its source of truth; the default keeps
   today's storefront unchanged; the rule is a reusable named concept so a later "sales mode"
   feature can reuse it. PIM connectors must not re-add the channel against the rule; the connector
   change is a separate spec, and what the platform exposes for it is a design point. → FR-050 –
   FR-059; sales-team purchase paths and channel-level status (2026-11-25: OQ-B, OQ-F, I-4) →
   FR-090 – FR-093.
7. **Timing**: Admin UI changes apply on the next request; storefront membership follows within
   5 minutes; a scheduled price book becoming valid or expiring counts as a price change.
   → FR-060 – FR-062 (amended 2026-11-25 by OQ-A: admin read filtering follows a price-row change
   within 60 s and a catalogue-wide or designation change within 150 s; configuration and in-force
   changes stay next-request; order and quote line checks stay exact).
8. **Audit, permissions, off-state, languages**: configuration changes are audited; dedicated
   manage and read permissions; off means as never installed; Polish and English for every string.
   → FR-070 – FR-075; activation default off and configuration only while on (2026-11-25: OQ-C,
   I-3) → FR-076, FR-077.

## Clarifications

### Session 2026-11-24

- **OQ-1** — Price context of the catalogue price (FR-001, FR-002) → (a) **B**: a sales channel is
  set together with each designated book, and the catalogue price is resolved for that channel;
  (b) **i**: when a designated non-base book is in force but does not price a product, the base
  book's price stands; (c) **i**: only regular books with the *everyone* audience in that currency
  can be designated; (d) **i**: a designated book that is not in force (draft, expired, outside its
  schedule) means no catalogue price in that currency (fail-closed), even where the base book has a
  price. With no designation, the base book is used; a base book is channel-independent, so no
  channel is needed then.
- **OQ-2** — Who is fail-closed while unmapped (FR-023) → **A**: every role holding `rfqs:handle`
  or the wildcard `*`, except the platform-administrator role. *Amended 2026-11-25 by OQ-G*: a role
  holding `*` (or any other self-lifting permission) is now always unrestricted and never
  fail-closed; the fail-closed set is the unmapped roles holding `rfqs:handle` and none of the
  self-lifting permissions.
- **OQ-3** — How far "absent" reaches (FR-033) → **A**: every catalog admin route addressed by a
  product id, reads and writes, treats a hidden product as absent. **Plus**: the server refuses a
  restricted user's admin order-create line whose product is outside their category, with the same
  refusal as quote lines (FR-037). Price-book and SEO edits addressed by product id are not refused.
  Other modules' product-id inputs (blog, CMS, CRM, tasks and the like) are out of scope.
  *Refined 2026-11-25 by OQ-D, OQ-E and OQ-H*: cross-references, assistant tools, inventory lists,
  price history and the products import/export are now decided individually (FR-080 – FR-088).
- **OQ-4** — Existing out-of-category quote line (FR-042) → **A**: the line stays fully editable
  (quantity, price) and removable; its product cannot be changed; that product cannot be added in a
  new line.
- **OQ-5** — Variants → **A**: per variant — the picker lists only qualifying variants of a visible
  parent, a line with a non-qualifying variant is refused, and the marker is per variant.
- **OQ-6** — Which channels a website rule governs (FR-051) → **A**: a rule may be attached to any
  number of storefront channels; a channel has at most one rule.
- **OQ-7** — Rule conditions and activation (FR-050, FR-053) → (a) **A**: attribute conditions on
  boolean and choice attributes that are neither language- nor channel-scoped; (b) **A**: the
  join/leave preview is a mandatory confirmation step.
- **OQ-8** — Other writers on a governed channel (FR-054, FR-055) → for now, manual and bulk
  membership writes on a governed channel are **refused**; automatic writers (product create's
  default binding, duplicate, import, connectors) are **skipped** on a governed channel, so
  connectors comply unchanged; a port that connectors can ask is also available. The owner expects
  a manual change may be needed later: the design must not preclude a later per-product manual
  override (plan constraint, not a feature now — see *Dependencies and sequencing*).
- **OQ-9** — Module ownership → architect decides; the product owner's recommendation (a new
  module consuming `catalog`, `price_lists` and `admin_roles` through ports) stays a
  recommendation.
- **OQ-10** — First enable (FR-023) → **A**: accepted; until mapped, such roles see no products,
  and the configuration screen shows them as "sees no products".
- **OQ-11** — "The default keeps today's storefront" (FR-052) → **A**: the platform ships no rule
  attached to any channel; an instance attaches its own after the preview of FR-053.
- **OQ-12** — Marker for unrestricted users (FR-043) → **A**: the marker is shown only to restricted
  users.
- **Admission on a governed channel** (stated with the answers) → a product that a governed
  channel's rule has not yet admitted — newly created, or reactivated (by a connector or anyone
  else) — is not on that channel; a qualifying product may appear up to 5 minutes late. There is no
  window in which such a product is exposed before the rule admits it (FR-059).

### Session 2026-11-25

- **RQ-1** — A designated book that stops fitting (FR-001, FR-007) → **A**: designating a non-base
  book for a channel is refused unless the book is bound to that channel (and is a regular
  *everyone* book of that currency, OQ-1 c). If the designated book is later deleted, unbound from
  that channel or moved off the *everyone* audience, it counts as **not in force** — no catalogue
  price in that currency, fail-closed as OQ-1 (d), with no fallback to the base book — and the
  configuration screen flags the designation. Price-book administration is **not** blocked by a
  designation: deleting, unbinding or re-audiencing a designated book is allowed as today.
- **RQ-2** — Other admin paths that put a product on an order or quote (FR-037, FR-039, FR-043) →
  **C** (the recommendation): the admin order preview answers a line with a product or variant
  outside a restricted user's category the way admin order create does (the same refusal, naming
  the lines); admin reorder and admin clone-to-quote refuse such lines per variant with the same
  refusal (naming the lines, nothing created). The "no fixed price" marker is **not** shown on order
  create — it stays on quote screens only.
- **RQ-3** — Non-qualifying variants outside the picker (FR-005, FR-033) → **A** (the owner
  overruled the recommendation B: non-qualifying variants should not be displayed): for a restricted
  user, the product detail, the variant list (`/variants`), the price book grid and every other
  catalog admin route addressed by a product id show only the qualifying variants of a visible
  product; a non-qualifying variant addressed by id answers exactly as an absent product does.
  Restricted roles are not expected to edit products; if one holds `catalog:write`, its users still
  cannot see or edit non-qualifying variants (see *Assumptions*).

### Session 2026-11-25 — plan stage

Owner answers to the questions raised while planning. OQ-A – OQ-H are the owner questions of
`plan.md` (*Open questions for the owner*); I-2 – I-4 came from an instance's adoption plan and are
recorded here in generic terms.

- **OQ-A** — Timing of data-dependent changes (FR-060, FR-062) → **A**: bounded lag accepted. Admin
  read filtering follows a targeted catalogue-price change (a product or variant row on the base or
  designated book) within **60 s**, and a catalogue-wide change (category, attribute or "all" rows;
  a category membership or attribute value such a row selects by) or a change of a currency's
  designation within **150 s**. While a designation change is being applied, that currency
  contributes nothing: restricted users see no product that qualifies only through that currency
  (fail-closed, never early). A role, category, mapping or user's-role change, and a designated
  book entering or leaving force (schedule, status, deletion, unbinding, audience), apply from the
  next request. Order and quote **line** checks are always exact. → FR-060, FR-062, SC-008.
- **OQ-B** — Rule-excluded products on sales-team purchase paths → **B** (the owner answered
  "B, probably" — recorded as decided, with mild uncertainty; worth confirming at acceptance): quote → cart
  conversion and admin order create / preview accept a product that is absent from the request's
  channel **only** because that channel's website rule excludes it; a product absent for any other
  reason is still refused or dropped as today. → FR-090, FR-091.
- **OQ-C** — Activation default → **A**: the feature ships **off**; an operator turns it on.
  → FR-076.
- **OQ-D** — Cross-references to hidden products → **A**: links, grouped items and bundle options
  of a visible product that point to a hidden product are left out for restricted users; a write
  naming a hidden target answers not-found. → FR-080.
- **OQ-E** — Assistant tools and unique-key oracles → **A**: the assistant (prompt) tools' product
  reads are narrowed by the invoking user's scope; the bare SKU / URL-key "already taken" answer is
  accepted and documented, while the holder's id and name are never named to a user who cannot see
  that product (threat model TM-2). → FR-081, FR-082.
- **OQ-F** — Channel-level status as reactivation (FR-059) → **A**: a product's channel-scoped status
  moving to active on a governed channel counts as a reactivation for that channel; the membership
  is removed in the same transaction and the rule re-admits the product within 5 minutes.
  → FR-059, FR-092.
- **OQ-G** — Roles that could lift their own restriction → **1** (a new option; amends OQ-2): a role
  holding any **self-lifting permission** — `*`, `product_visibility:manage`,
  `platform.modules.activate` or `admin_users:manage` — is **always unrestricted**, cannot be mapped
  to a category and is never fail-closed. The fail-closed set is: unmapped
  roles holding `rfqs:handle` and none of the self-lifting permissions. → FR-022, FR-023, FR-026.
- **OQ-H** — Other admin read paths that return product data (threat model TM-9) → the plan's table
  is signed off as recommended (the owner answered "probably fine" — recorded as decided, with mild uncertainty):
  inventory admin lists and the inventory assistant "set stock" tool narrowed; inventory writes by
  product id accepted; price history by product answers as absent for a hidden product; a price
  change's lines leave hidden products out; price-book row writes accepted, row reads covered by the
  grid narrowing; products export and import through `import_export` refused (`403`) for a
  restricted user; audit log and admin notifications accepted (the configuration overview warns
  when a mapped role holds `audit_logs:read`); product feeds, CMS, blog, CRM and tasks accepted.
  → FR-038, FR-083 – FR-088.
- **I-2** — Explicit "unrestricted" mapping → **A**: a role can be mapped to **unrestricted** as well
  as to a category; such a role sees everything an unrestricted user sees, including products with
  no catalogue price. → FR-020, FR-025.
- **I-3** — Configuring before enabling → **A**: the configuration is available only while the
  feature is on (FR-073). On first enable, unmapped fail-closed roles see no products until an
  administrator maps them; an instance configures right after enabling. Accepted. → FR-077.
- **I-4** — Channel-scoped values for a not-yet-admitted product → **A**: per-language and
  channel-scoped values (status included) that a connector writes for a governed channel are stored
  even while the product is not on that channel only because the rule has not admitted it yet, so
  on admission it already has its correct per-language state; the first channel-scoped status write
  on that channel after admission does not count as a reactivation (OQ-F). → FR-093.
- **Release of the order checks before spec 192** — not decided by the owner. The plan's gate
  stands (the order create / preview / reorder checks start after spec 192 merges); releasing them
  earlier remains an option for the owner (see *Dependencies and sequencing*).
- **Q-1** — Is the first channel-scoped status write after admission exempt even when it really
  changes inactive → active? → **A**: yes. The rule has already admitted the product, so it shows on
  the channel at once; every other channel-scoped move to active follows the ordinary reactivation
  path (FR-092). → FR-092, FR-093.
- **Q-2** — A website rule's price condition during a designation rebuild → **A**: it keeps using the
  previous evaluation of that currency until the new one is ready, so a governed channel never drops
  and re-adds products because of the rebuild. Restricted admin users stay fail-closed for that
  currency during the rebuild (OQ-A). → FR-060, FR-061.
- **Q-3** — How far OQ-B reaches → (a) **yes**: admin reorder and admin clone-to-quote also accept a
  product absent from the channel only because of the website rule (the category check still
  applies to restricted users); (b) **yes**: checkout of a cart converted from an accepted quote
  keeps such a line through order placement (the product-owner proposal in FR-090 is now an owner
  decision). → FR-090, FR-091.

### Session 2026-11-25 — analyze stage

- **H2** — Which "channel-scoped status" counts for FR-090 – FR-093 (`analysis.md` H2) → **A**: only
  the product's **channel status** — its general status on that channel (the channel row) — counts.
  It alone decides whether a product is "inactive on that channel" for the sales-team paths
  (FR-090, FR-091) and whether a move to active is a reactivation (FR-092). **Per-language
  statuses** (channel × language) decide only storefront visibility in that language: they never
  make a product inactive on the channel for the sales-team paths, and a per-language status change
  is never a reactivation. Values stored before admission (FR-093) therefore have no effect on
  FR-090 / FR-091. → FR-090 – FR-093, US4 scenarios 6, 9, 10, 12. *Refined by N1 below*: the
  channel status counts whenever it was stored.
- **N1** — A channel status stored before admission, or left over for a product the rule excludes
  (`analysis.md` round 2, N1) → **A**: the **channel status always counts** for FR-090 / FR-091,
  whenever and by whomever it was stored — including values stored while the product was pending
  admission and values left over on a channel whose rule excludes the product. A product inactive
  on that channel by its channel status is not sold through the sales-team paths. Per-language
  statuses never count. Context: a PIM connector will get a setting so that it no longer writes an
  inactive channel status merely because a product is hidden in every language (a separate
  connector spec — see *Dependencies and sequencing*). → FR-090, FR-091, FR-093.
- **N6** — Which writers may store values pending admission → approved as proposed: every writer of
  channel-scoped values — the admin product save, copy to channels, connectors and the scoped-values
  CSV import — stores per-language and channel-scoped values for a governed channel the product is
  not yet admitted to, and an unrestricted admin user can read those pending values. → FR-093.
- **Client analyze N4** — Product references in `crm`, `projects` and `tasks` (mentions, opportunity
  links) → **accepted**: not narrowed. Creating an order or a quote from an opportunity MUST go
  through the same order and quote create paths that carry the refusals of FR-037 and FR-041 (the
  architect verifies). → FR-087.
- **N7** — Owner confirmation of the remaining product-owner text (the owner: "I approve them all")
  → each of the following is an owner decision:
  - the Polish marker text **"brak ustalonej ceny"** beside "no fixed price" (FR-043);
  - narrowing every catalog aggregate count for restricted users (FR-031);
  - bulk-operation list, detail, undo and execution rules (FR-033);
  - the not-cacheable header on the admin product list in every state (FR-036);
  - rules only narrow, never resurface inactive, archived or deleted products (FR-079);
  - a single overview permission warning, for `audit_logs:read` (FR-086);
  - every item formerly listed as a product-owner proposal under *Assumptions*.
- **Client analyze N8** — Does a channel status going from inactive to inherited count as "moving to
  active" (FR-092)? → product-owner clarification, consistent with N1 (no stored value is not
  inactive) and OQ-F, not a new owner question: **yes**, when the inherited global status is
  active; no, when it is inactive. → FR-092.

## User Scenarios & Testing *(mandatory)*

The examples use four categories an operator might configure: **domestic** (currency A > 0),
**export** (currency B > 0), **service** (A > 0 or B > 0) and **management** (A ≥ 0 or B ≥ 0).
They are examples of configuration, not shipped data.

### User Story 1 - A restricted user finds only the products their category allows (Priority: P1) — MVP

A domestic sales representative searches the admin product list, opens a product, uses the admin
global search and selects "all matching" for a bulk action. Everywhere they see only products with
a catalogue price above zero in currency A; the counts and pages are those of what they can see.

**Why this priority**: The core of the issue; every other part builds on the server knowing what a
user may see.

**Independent Test**: Five products (A > 0 only, B > 0 only, both > 0, A = 0 only, no price) and
three users mapped to domestic, export and management; call each enforced read and compare.

**Acceptance Scenarios**:

1. **Given** a product priced only in currency B, **When** a domestic user lists, searches or
   opens it by id, **Then** it is not listed and its detail answers exactly as for a product that
   does not exist; **When** an export user does the same, **Then** it is found.
2. **Given** a product with no catalogue price in any currency, **When** any restricted user
   searches, **Then** it is not found.
3. **Given** a product whose only catalogue price is 0 in currency A, **When** a domestic user
   searches, **Then** it is not found; **When** a management user searches, **Then** it is found.
4. **Given** 30 products of which 12 are visible to a domestic user, **When** the user pages
   through the list 10 at a time, **Then** the total is 12, the pages hold 10 and 2, and the
   status counts add up to 12.
5. **Given** the platform administrator, **When** they use any of these reads, **Then** they see
   exactly what they see today.
6. **Given** a role holding `rfqs:handle`, none of the self-lifting permissions
   (FR-026) and mapped to nothing, **When** a user with it opens the product list, **Then** it is
   empty and the screen says the role has no product visibility category.
7. **Given** a role without `rfqs:handle` and mapped to no category, **When** a user
   with it opens the product list, **Then** they see what they see today.
8. **Given** a product hidden from a domestic user, **When** the user calls any catalog admin route
   addressed by its id — a sub-resource read, update, archive, restore, duplicate, or a bulk update
   naming it — **Then** the server answers exactly as for a product that does not exist and changes
   nothing.
9. **Given** a domestic user creating an order in the Admin UI, **When** the request has a line for
   a product (or a variant) outside their category, **Then** the server refuses it, naming the line,
   and no order is created; **When** an unrestricted user sends the same request, **Then** the
   behaviour is today's.
10. **Given** a product hidden from a domestic user, **When** the user edits its price-book rows or
    its SEO data by product id, **Then** the edit behaves as today (not refused).
11. **Given** a role holding the wildcard `*` (not the platform-administrator role), or any other
    self-lifting permission together with `rfqs:handle`, **When** a user with it opens the product
    list, **Then** they see what they see today: the role is always unrestricted and cannot be
    mapped (OQ-G; amends the earlier reading of this scenario, which expected an empty list).
12. **Given** a visible configurable product with one qualifying and one non-qualifying variant,
    **When** a domestic user opens its detail, its variant list, any other catalog admin route
    addressed by its id, or the price book grid, **Then** only the qualifying variant is shown;
    **When** the user addresses the non-qualifying variant by its id (read or write), **Then** the
    server answers exactly as for a product that does not exist and changes nothing; **When** the
    user (holding `catalog:write`) saves the product, **Then** the non-qualifying variant is
    unchanged.
13. **Given** a domestic user, **When** they preview an order total in the Admin UI, reorder a past
    order or clone an order into a quote request, and a line's product or variant is outside their
    category, **Then** the server refuses with the same refusal as order create, naming the lines,
    and nothing is created; **When** an unrestricted user does the same, **Then** the behaviour is
    today's.
14. **Given** a management user and a product whose only qualifying price is 0, **When** they add it
    on admin order create, **Then** no "no fixed price" marker is shown.
15. **Given** a role holding `rfqs:handle` and mapped to **unrestricted**, **When** a user with it
    uses any of these reads, **Then** they see exactly what they see today, including products with
    no catalogue price (I-2).
16. **Given** a visible product linked to a hidden product (a related link, a grouped item or a
    bundle option), **When** a domestic user reads the visible product's links, grouped items or
    bundle options, **Then** the hidden target is left out; **When** they save a link, grouped item
    or bundle option naming the hidden target, **Then** the server answers as for a product that
    does not exist and changes nothing (OQ-D).
17. **Given** a product hidden from a domestic user, **When** the user asks an admin assistant tool
    about it (by name, SKU or id), including the inventory "set stock" tool, **Then** the tool
    answers as for a product that does not exist and writes nothing (OQ-E, OQ-H).
18. **Given** a domestic user creating a product whose SKU or URL key a hidden product already
    holds, **When** they save, **Then** the save is refused as "already taken" and the answer names
    neither the holder's id nor its name (OQ-E).
19. **Given** a product hidden from a domestic user, **When** the user lists inventory, reads the
    product's price history, or reads a price change's lines, **Then** the product is left out of
    the lists and its price history answers as for a product that does not exist; **When** the user
    runs a products export or import, **Then** the server refuses it with `403` (OQ-H).
20. **Given** a product priced only by a base-book row in currency A, **When** that row is removed,
    **Then** a domestic user stops seeing the product within 60 s; **When** a domestic user adds the
    product to an admin order line in that window, **Then** the line is refused at once (line checks
    are exact — OQ-A).

---

### User Story 2 - An administrator configures categories, price books and role mapping (Priority: P1)

An administrator names the categories, sets their currency conditions, designates which price
book holds each currency's catalogue price and maps each admin role to a category, all in the
Admin UI, without a deployment.

**Why this priority**: US1 has nothing to enforce without configuration; the merchant's role
matrix is data, not code.

**Independent Test**: Create a category "export: B > 0", map a new role to it, assign the role to
a user, and observe US1's export behaviour for that user without them signing in again.

**Acceptance Scenarios**:

1. **Given** a category with conditions "A > 0" and "B ≥ 0", **When** it is saved, **Then** a
   product qualifies for it when it meets at least one condition.
2. **Given** a currency with no designated book, **When** catalogue prices in it are evaluated,
   **Then** that currency's base book is used.
3. **Given** a role's mapping is changed from domestic to export, **When** a user with that role
   makes their next request, **Then** the export category applies.
4. **Given** an administrator holding only the read permission of this feature, **When** they open
   the configuration, **Then** they see it and cannot change it.
5. **Given** any configuration change, **When** it is saved, **Then** the audit log records who
   changed what, before and after.
6. **Given** the platform-administrator role, or any role holding a self-lifting permission
   (FR-026), **When** an administrator tries to map it to a category or to "unrestricted", **Then**
   the Admin UI does not offer that, and the server refuses it.
7. **Given** currency B designated to a non-base *everyone* book together with channel X, **When** a
   product has a row in that book, **Then** its catalogue price in B is the engine's price for
   channel X; **When** the book is in force but has no row pricing the product, **Then** the base
   book's price stands; **When** the book is not in force (draft, expired, outside its schedule),
   **Then** the product has no catalogue price in B, even if the base book prices it.
8. **Given** a book whose audience is not *everyone*, **When** an administrator tries to designate
   it, **Then** the Admin UI does not offer it, and the server refuses it.
9. **Given** the feature is enabled for the first time, **When** the configuration screen is
   opened, **Then** every unmapped role holding `rfqs:handle` and none of the self-lifting
   permissions is listed as "sees no products"; roles holding a self-lifting permission are listed
   as "unrestricted (cannot be mapped)" (OQ-G).
10. **Given** an *everyone* book of currency B that is not bound to channel X, **When** an
    administrator tries to designate it for B with channel X, **Then** the Admin UI does not offer
    it, and the server refuses it.
11. **Given** currency B designated to a book with channel X, **When** an administrator deletes the
    book, unbinds it from channel X or changes its audience from *everyone*, **Then** the price-book
    change is saved as today; from then on no product has a catalogue price in B (the base book is
    not used in its place), and the configuration screen flags the designation as not in force.
12. **Given** a role holding `rfqs:handle`, **When** an administrator maps it to **unrestricted**,
    **Then** its users see what an unrestricted user sees, the role screens show "unrestricted",
    and the change is audited (I-2).
13. **Given** a role mapped to a category, **When** an administrator later gives the role a
    self-lifting permission in role administration, **Then** from the next request its users are
    unrestricted, the stored mapping has no effect, and the configuration screen flags the role
    (FR-026).
14. **Given** a fresh upgrade of an instance, **When** nobody has turned the feature on, **Then** no
    user sees anything different and the configuration screens are absent; **When** an
    administrator turns it on, **Then** the configuration screens appear and unmapped fail-closed
    roles see no products until mapped (OQ-C, I-3).
15. **Given** currency B is re-designated to another book, **When** a domestic-B user lists products
    while the change is being applied, **Then** products that qualify only through B are not listed;
    within 150 s they are listed again according to the new book (OQ-A).

---

### User Story 3 - A sales representative can only quote what they may sell (Priority: P2; after spec 192)

On the quote-request create and edit screens, the product browser and picker list only the
representative's visible products; the server refuses a line with any other product; a product
the user sees only through a "≥ 0" condition at price 0 is marked "no fixed price".

**Why this priority**: Closes the gap a client-only filter would leave; sequenced after spec 192
because that spec is rewriting the same screens and service.

**Independent Test**: As a domestic user, send a quote create request with one visible and one
hidden product; then, as a management user, add a product priced 0 in currency A.

**Acceptance Scenarios**:

1. **Given** a domestic user, **When** they create a quote request with a line for a product
   priced only in currency B, **Then** the server refuses the request and names the line; no quote
   is created.
2. **Given** an existing quote with a line whose product has since left the user's category,
   **When** the user saves another change to the quote, **Then** that line stays on the quote;
   **When** the user changes that line's quantity or price, or removes it, **Then** the change is
   saved; **When** the user changes that line's product, or adds the same product in a new line,
   **Then** the server refuses it.
3. **Given** a management user and a product whose only qualifying price is 0, **When** it appears
   in the offer product search and on the quote line, **Then** it carries the marker "no fixed
   price", in the user's interface language; **When** an unrestricted user sees the same product,
   **Then** no marker is shown.
4. **Given** an unrestricted user, **When** they add any non-archived product, **Then** the
   behaviour is today's.
5. **Given** a visible configurable product with one qualifying and one non-qualifying variant,
   **When** a restricted user opens the offer picker, **Then** only the qualifying variant is
   offered; **When** they send a line with the non-qualifying variant, **Then** the server refuses
   it; the marker is decided per variant.

---

### User Story 4 - The storefront shows what the website rule says (Priority: P2)

An administrator defines a named rule — for example "attribute *flag A* is true and the catalogue
price in currency A is > 0" — and attaches it to a storefront sales channel. From then on, the
rule alone decides which products are members of that channel: products the rule excludes stay
sellable through the sales team but are absent from the storefront.

**Why this priority**: Lets a merchant keep sales-team-only products off the storefront without
hand-maintaining channel membership, and without a PIM connector undoing it.

**Independent Test**: Attach a rule to a channel; change a product's flag attribute; check the
storefront listing, type-ahead, search and product URL within 5 minutes.

**Acceptance Scenarios**:

1. **Given** no rule attached to a channel, **When** the feature is installed and enabled, **Then**
   the channel's membership is exactly what it was.
2. **Given** a rule attached to a channel, **When** a product stops meeting it (attribute value,
   catalogue price, or a price book's schedule starting or ending), **Then** within 5 minutes the
   product is absent from that channel's listings, search, type-ahead and URL (answered as an
   absent product), and stays available in the Admin UI.
3. **Given** a governed channel, **When** an administrator adds or removes a product on it by a
   manual edit or a bulk update, **Then** the server refuses the change with a translated message
   naming the website rule, and the membership is unchanged; **When** a product is created,
   duplicated, imported or synchronised by a connector, **Then** the governed channel's membership
   is not written by that writer (other channels are written as today).
4. **Given** the rule references an attribute a product has no value for, **When** it is
   evaluated, **Then** that condition is not met for that product, and no other product is
   affected.
5. **Given** a rule is edited, **When** it is saved, **Then** the audit log records the before and
   after, and the governed channels follow within 5 minutes.
6. **Given** a governed channel, **When** a new product that meets the rule is created, or an
   inactive product that meets it is reactivated (by a connector or anyone else — globally, or by its
   channel status on that channel, OQ-F, H2), **Then** it is not on the channel's listings,
   search, type-ahead or URL until the rule admits it, and it is admitted within 5 minutes.
7. **Given** a channel that already has a website rule, **When** an administrator attaches a second
   rule to it, **Then** the server refuses; **When** the same rule is attached to a second
   storefront channel, **Then** both channels are governed by it.
8. **Given** a rule to attach or a change to an attached rule, **When** the administrator saves it,
   **Then** the Admin UI first shows how many products would join and leave each governed channel
   and applies nothing until the administrator confirms.
9. **Given** a governed channel and a product not yet admitted to it, **When** a connector writes the
   product's per-language or channel-scoped values (status included) for that channel, **Then** the
   values are stored and the product stays off the channel; **When** the rule admits it, **Then** it
   appears with those values; **When** the connector's first channel-status write on that
   channel after admission arrives — even one that changes the channel status from inactive to
   active — **Then** it does not count as a reactivation and the product shows at once (I-4, Q-1);
   **When** the connector later changes a per-language status on that channel, **Then** it is never a
   reactivation (H2).
10. **Given** a product excluded from a governed channel only by its website rule, **When** a buyer
    converts an accepted quote that has a line for it into a cart on that channel, **Then** the line
    is kept and the buyer can check out and place the order with it; **When** an administrator
    creates or previews an order, reorders a past order, or clones an order into a quote on that
    channel with that product, **Then** the channel membership check does not refuse it (the
    visibility-category check of FR-037 and FR-039 still applies to restricted users); **When** the
    product is absent from the channel for any other reason (inactive, archived, inactive on that
    channel by its channel status, or not a member of an ungoverned channel), **Then** the behaviour
    is today's (OQ-B, Q-3); per-language statuses play no part in this (H2).
11. **Given** a governed channel whose rule has a price condition on currency B, **When** B's
    designation is changed and its new evaluation is being built, **Then** the channel keeps its
    membership as evaluated before the change (no product drops and re-appears because of the
    rebuild); once the new evaluation is ready, membership follows within 5 minutes (Q-2).
12. **Given** a sales-team-only product on a governed channel whose channel status is active but
    whose per-language status is inactive in every language (so the storefront never shows it),
    **When** a buyer converts an accepted quote with it and checks out, or an administrator creates,
    previews or reorders an order with it on that channel, **Then** the line is kept and the order is
    placed as for any available product (H2).
13. **Given** a product the rule excludes from a governed channel whose channel status on that
    channel is inactive — stored while it was pending admission, or left over — **When** a buyer
    converts an accepted quote with it, or an administrator creates, previews or reorders an order,
    or clones an order into a quote, with it on that channel, **Then** it is treated as absent for
    another reason (today's
    behaviour), not as rule-excluded (N1).
---

### Edge Cases

- **Price 0 versus no price**: a product with a row of amount 0 in the designated book has price 0;
  a product with no row that prices it has no price. They are never treated alike.
- **Designated book in force but silent on a product**: the base book's price stands (OQ-1 b).
- **Designated book not in force** (draft, expired, outside its schedule): no catalogue price in
  that currency, even where the base book has one (OQ-1 d).
- **Designated book deleted, unbound from its channel or moved off *everyone***: allowed in price-book
  administration; the designation counts as not in force (no catalogue price in that currency, no
  fallback to the base book) and the configuration screen flags it (RQ-1). Every restricted user
  whose category relies on that currency loses those products at once, and a governed channel whose
  rule has a price condition on that currency drops them within 5 minutes (FR-061) — a consequence
  the flag makes visible, not a separate rule.
- **Configurable products**: a parent is visible when at least one variant qualifies; on quote and
  order lines, visibility, refusal and the marker are per variant (OQ-5). On the product detail, its
  variant list, every other catalog admin route addressed by the product's id and the price book
  grid, a restricted user sees only qualifying variants; a non-qualifying variant addressed by id is
  absent (RQ-3).
- **Saving a visible product that has non-qualifying variants**: a restricted user's write through
  the parent MUST leave the non-qualifying variants unchanged — never edited, dropped or replaced
  because the user did not see them (RQ-3). Whole-product actions on a visible parent (archive,
  restore, duplicate) act on the product as today (product-owner proposal, owner-approved 2026-11-25).
- **Base book designated**: since a base book holds only product and variant rows (F7), category,
  attribute and "all" rows only ever count when a non-base book is designated.
- **Currency deactivated** while a category or designation uses it: conditions on it are not met
  (no price in an inactive currency); the configuration keeps the condition and shows it as
  inactive.
- **Inactive, archived or deleted products**: the rules only narrow; they never make such a product
  appear anywhere it does not appear today, and never put it on a storefront channel (FR-079).
- **A custom role holding the wildcard `*`**: always unrestricted and not mappable, like every role
  holding a self-lifting permission (OQ-G, FR-026; this replaces the earlier OQ-2 reading that made
  it fail-closed while unmapped).
- **A role gains or loses a self-lifting permission**: role administration does not ask this
  feature. A mapped role that gains one is unrestricted from the next request and its stored
  mapping has no effect (the configuration screen flags it); a role that loses its last one is
  judged again from the next request — by its stored mapping if it has one, otherwise fail-closed
  when it holds `rfqs:handle` (FR-023, FR-026; product-owner reading of "always unrestricted", owner-approved 2026-11-25).
- **First enable**: the feature ships off (OQ-C) and can be configured only while on (I-3). From the
  moment it is first turned on until an administrator maps them, every unmapped role holding
  `rfqs:handle` and no self-lifting permission sees no products anywhere; the configuration screen
  lists those roles as "sees no products" (OQ-10). The administrators who configure the feature
  hold `product_visibility:manage`, so they are unrestricted throughout (OQ-G).
- **Price change versus the admin list**: the admin list and search may show a product for up to
  60 s after a targeted price change (150 s after a catalogue-wide change) that removed its
  qualifying price, or hide it for as long after a change that gave it one; order and quote line
  checks never lag (OQ-A, FR-062).
- **Designation change in progress**: the currency contributes nothing to any category until the new
  designation is in effect (≤ 150 s), so restricted users relying on it briefly see fewer products,
  never more (OQ-A). A website rule's price condition on that currency keeps the previous
  evaluation until the new one is ready, so the storefront does not drop and re-add products
  because of the rebuild (Q-2).
- **Rule-excluded product bought through the sales team**: the storefront never lists it, but an
  accepted quote converts and checks out with it, and an administrator can order, preview, reorder
  or clone it into a quote on that channel (OQ-B, Q-3, FR-090, FR-091); a product absent for any
  other reason is handled as today.
- **Channel-level re-enable on a governed channel**: the channel status moving to active on that
  channel removes the membership at once; the rule re-admits the product within 5 minutes (OQ-F).
  A write that does not move the channel status to active (for example a connector writing "active"
  again) is not a reactivation, and a per-language status change never is (H2). Clearing a stored
  "inactive" so that the channel inherits an active global status is a reactivation (FR-092, N8).
- **Per-language statuses and the sales-team paths**: a product inactive in some or every language
  on a channel is hidden on the storefront in those languages only; for quote conversion, checkout
  and the admin order paths it is inactive on the channel only when its channel status is (H2).
- **Values written before admission**: per-language and channel-scoped values written for a
  not-yet-admitted product by any writer (admin save, copy, connector, CSV import) are stored; an
  unrestricted admin user can read them; the product appears with them on admission (I-4, N6).
- **Inactive channel status on a rule-excluded product**: a product the rule excludes from a channel
  but whose channel status there is inactive (stored before admission or left over) is not sold
  through quote conversion, checkout or the admin order paths on that channel; per-language
  statuses never have this effect (N1, FR-090, FR-091).
- **Cross-references on a visible product**: links, grouped items and bundle options pointing to a
  hidden product are left out for restricted users (OQ-D).
- **A user changes role mid-session**: the new role's category applies from the next request.
- **Hidden product reached another way**: a bookmarked URL, a saved view, a global-search result
  link or a select-all resolved earlier — each answers by the user's category at the time of the
  request, never from an earlier answer.
- **Counts and pages**: no response tells a restricted user how many products are hidden; no page
  is short because of filtering applied after paging.
- **Hidden product edited from another module**: price-book rows, SEO data and inventory writes
  addressed by product or variant id are not refused (OQ-3, OQ-H, FR-038); the price book grid itself lists only visible
  products and, of a visible configurable product, only its qualifying variants (FR-030, FR-005).
- **Website rule and an inactive product**: a governed channel never gains an inactive, archived or
  deleted product because of the rule.
- **New or reactivated product on a governed channel**: not on the channel until the rule admits it;
  it may appear up to 5 minutes late, never early (FR-059).
- **A product with no channel**: a product whose only channel is governed may have no channel at all
  — until the rule admits it, or after the rule removed it from its only channel. It is never moved
  to a default channel instead. Outside governed channels the "at least one channel" floor holds as
  today (FR-059).
- **Feature off**: see FR-073.

## Requirements *(mandatory)*

### Functional Requirements

**Catalogue price**

- **FR-001**: For each currency active on the platform, an administrator MUST be able to designate
  one price book, together with one sales channel, whose resolved prices are that currency's
  **catalogue price**. Only regular books with the *everyone* audience in that currency can be
  designated, and a non-base book only together with a sales channel it is bound to; the server
  MUST refuse any other designation. Until one is designated, the currency's base book is used
  (channel-independent). A designation MUST NOT block price-book administration: deleting the
  designated book, unbinding it from the designated channel or changing its audience from
  *everyone* MUST NOT be refused because of the designation; such a designation counts as **not in
  force** (FR-007).
- **FR-002**: A product's catalogue price in currency C MUST be the price the pricing engine
  resolves from C's designated book, for the sales channel designated with it, for quantity 1, with
  no customer, valid at the moment of evaluation; every row kind the book can hold (product,
  variant, category, attribute, category ∩ attribute, "all") and percentage and amount adjustments
  count. When the designated book is in force but does not price the product, the base book's price
  stands (the engine's own fallback).
- **FR-003**: The system MUST distinguish **price 0** (a catalogue price exists and is 0) from
  **no price** (nothing prices the product in that currency).
- **FR-004**: A product with no catalogue price in a currency MUST NOT meet any condition on that
  currency; a product with no catalogue price in any currency MUST be invisible to every restricted
  category.
- **FR-005**: A configurable (variant) product MUST be treated as visible to a category when at
  least one of its variants meets one of the category's conditions. Each variant's own visibility
  decides the picker, the line refusal and the marker of FR-037, FR-039, FR-040, FR-041 and
  FR-043. For a restricted user, the product detail, its variant list, every other catalog admin
  route addressed by the product's id (FR-033) and the price book grid MUST show only the qualifying
  variants of a visible product; a non-qualifying variant addressed by its id MUST be answered
  exactly as an absent product (FR-033), and no write by the restricted user — including an update
  of the parent — MAY change, drop or replace a non-qualifying variant.
- **FR-006**: The catalogue price evaluated here MUST be the same answer the pricing engine gives
  for the same inputs, never a second pricing implementation.
- **FR-007**: When C's designated book is not in force — draft, expired, outside its schedule, or
  (RQ-1) deleted, no longer bound to the designated channel, or no longer of the *everyone*
  audience — C MUST have no catalogue price for any product; the base book's price MUST NOT be used
  in its place, until the book is in force again or the designation is changed. The configuration
  screen MUST flag such a designation as not in force (owner decision RQ-1 for deleted, unbound and
  re-audienced books; product-owner proposal, owner-approved 2026-11-25, for draft, expired and
  out-of-schedule ones).

**Visibility categories**

- **FR-010**: An administrator MUST be able to create, rename, edit and delete **visibility
  categories**. A category is a name and one or more **conditions**; a condition is a currency and
  a threshold, either "price > 0" or "price ≥ 0".
- **FR-011**: A product MUST be visible to a category when it meets at least one of the category's
  conditions.
- **FR-012**: Conditions MUST be offered for every currency active on the platform, not a fixed
  list.
- **FR-013**: Deleting a category that a role is mapped to MUST be refused, naming the roles.
- **FR-014**: The platform MUST ship no categories; an instance has none until an administrator
  creates them.

**Role mapping**

- **FR-020**: An administrator MUST be able to map each admin role, in the Admin UI, to at most one
  target: one visibility category, or **unrestricted** (I-2). Roles of FR-022 and FR-026 are not
  mappable.
- **FR-021**: A user's visibility MUST be that of their single role (F4).
- **FR-022**: The platform-administrator role MUST always be unrestricted and MUST NOT be mappable.
- **FR-023**: A role with no mapping MUST be **fail-closed** — no product on any surface of FR-030 –
  FR-041 and FR-080 – FR-085, with a message that the role has no product visibility category —
  when it holds `rfqs:handle` and none of the self-lifting permissions of FR-026 (OQ-G, amending
  OQ-2); every other unmapped role MUST be unrestricted. This applies from the moment the feature is
  first enabled, with no grace period (OQ-10). **Restricted** in this spec means a role mapped to a
  category or fail-closed; every other role is unrestricted.
- **FR-024**: The role list, the role editor and the feature's configuration screen MUST show each
  role's mapping (a category, "unrestricted", "unrestricted — cannot be mapped" for the roles of
  FR-022 and FR-026, or "no category — sees no products") so an administrator can see the effect of
  the mapping where roles are managed.
- **FR-025**: A role mapped to **unrestricted** MUST see on every surface exactly what an unrestricted
  user sees (FR-035), including products with no catalogue price; no line of its users is refused and
  no marker is shown to them (I-2).
- **FR-026**: A role holding any **self-lifting permission** — the wildcard `*`,
  `product_visibility:manage`, `platform.modules.activate` or `admin_users:manage` — MUST always be
  unrestricted, MUST NOT be fail-closed, and MUST NOT be mappable: the server refuses mapping it to a
  category (OQ-G), and also to unrestricted, which would have no effect (owner-approved 2026-11-25). Because role administration does not consult this feature, a
  mapped role that later gains such a permission MUST be unrestricted from the next request, its
  stored mapping without effect, and the configuration screen MUST flag it (owner-approved
  2026-11-25).

**Admin product reads and writes**

- **FR-030**: For a restricted user, every answer of the admin product list endpoint MUST contain
  only products visible to the user's category, whatever screen or caller asks — including, not
  limited to, the product list, the product browser and picker, order create, the price book grid,
  the price explainer, the product editor, SEO and the other callers of F3; of a visible
  configurable product, only its qualifying variants (FR-005).
- **FR-031**: The list's `total`, its per-status counts and its paging MUST count only visible
  products; filtering MUST happen in the query that pages, not after it. No other catalog admin
  answer MAY count hidden products for a restricted user either: a category's product count, an
  attribute set's product count (including the "still in use" refusal when deleting it), an
  attribute's usage and scope-change preview, and the variant-derived figures on a visible product's
  detail (variant count, option and axis values, stock totals, price ranges, media) MUST be derived
  from visible products and qualifying variants only (analyze M9, threat model TM-6; narrowing chosen
  for every such count, owner-approved 2026-11-25, N7).
- **FR-032**: Select-all (`resolve-ids`) and fetching products by a list of ids (`batch-by-id`)
  MUST return only visible products, and totals counting only those.
- **FR-033**: Every catalog admin route addressed by a product id — the detail, its sub-resources
  (content, scopes, scoped values, scope overview, attribute-set preview, gallery, editor
  preference, variants) and the writes (update, archive, restore, duplicate, bulk update) — MUST
  answer a product outside the user's category exactly as it answers a product that does not exist
  (same status and error code), never as "forbidden", and MUST change nothing. A bulk update naming
  hidden products MUST treat them as absent. The same holds for a non-qualifying variant of a
  visible product addressed by its id (FR-005). **Bulk operations** (analyze M9, threat model
  TM-1): for a restricted user, the list and the detail of bulk operations MUST show only operations
  whose selection holds no product hidden from the user (hidden ids never appear in what is shown);
  undoing an operation that affected a hidden product MUST answer as for an operation that does not
  exist and change nothing; and a queued operation MUST NOT write a product hidden from the user who
  requested it at the moment of the write.
- **FR-034**: The admin global search MUST return only products visible to the searching user, and
  its "more results" indication MUST not reveal hidden ones.
- **FR-035**: An unrestricted user MUST see on every surface exactly what they see today.
- **FR-036**: The enforcement MUST be on the server for every surface above; hiding on the client
  alone does not satisfy any requirement of this section. The admin product list answers MUST be
  sent as not cacheable (`Cache-Control: private, no-store`) **whatever the feature's state** — on,
  off or absent — so no browser or proxy cache can serve one user's answer to another (threat model
  TM-14); because the header does not depend on the feature, it is not a difference under FR-073 or
  SC-003.
- **FR-037**: Creating an order in the Admin UI with a line whose product (or variant, FR-005) is
  outside the restricted user's category MUST be refused by the server, naming the offending lines,
  with the same refusal as quote lines (FR-041); nothing of the request is saved. Other admin entry
  paths: FR-039. The "no fixed price" marker of FR-043 is not shown on order create.
- **FR-038**: Edits addressed by product or variant id outside the catalog admin routes —
  price-book rows, SEO data, inventory writes (stock levels, thresholds, inventory import), and other
  modules' product-id inputs (blog, CMS, CRM, tasks, product feeds and the like) — MUST NOT be
  narrowed or refused by this feature. The exceptions are decided individually in FR-080 – FR-088
  (OQ-D, OQ-E, OQ-H).
- **FR-039**: For a restricted user, the admin order preview MUST answer a line whose product or
  variant is outside the user's category as admin order create does (FR-037: the same refusal,
  naming the lines); admin reorder and admin clone-to-quote MUST refuse such lines, per variant,
  with the same refusal, naming the lines, and create nothing. The storefront (buyer) reorder and
  clone paths are not affected. Unrestricted users see today's behaviour.

**Quote requests** (sequenced after spec 192 — see *Dependencies and sequencing*)

- **FR-040**: The product browser and picker on the quote-request create and edit screens MUST list
  only products visible to the user, and of a visible configurable product only its qualifying
  variants (FR-005; they read the endpoint of FR-030).
- **FR-041**: Creating a quote request, or adding a line or changing a line's product on an existing
  one, with a product or variant outside the user's category MUST be refused by the server, naming
  the offending lines; nothing of the request is saved.
- **FR-042**: Lines already on a quote whose product is no longer in the user's category MUST stay
  on the quote and stay editable: quantity and price can be changed and the line can be removed.
  Such a line's product MUST NOT be changed, and the product MUST NOT be added in a new line
  (FR-041).
- **FR-043**: For a restricted user, a product or variant visible only because a "≥ 0" condition is
  met at price 0 — no condition of the user's category is met with a price above 0 — MUST carry the
  fixed marker in the offer product search and on the quote line in the Admin UI. The text is fixed
  and not editable: English **"no fixed price"**, Polish **"brak ustalonej ceny"** (owner decision:
  a fixed text; the Polish wording is the owner's, confirmed 2026-11-25, N7). Unrestricted users MUST NOT see the
  marker, and it MUST NOT be shown on admin order create, order preview or reorder (RQ-2).

**Website rule**

- **FR-050**: An administrator MUST be able to define named **product rules**. A rule combines
  conditions on product attribute values and catalogue-price conditions (as in FR-010) with "all
  of" / "any of". Attribute conditions MUST be limited to boolean and choice attributes that are
  neither language- nor channel-scoped.
- **FR-051**: An administrator MUST be able to attach a product rule to a storefront sales channel
  as its **website rule**. A rule MAY govern any number of storefront channels; a channel MUST have
  at most one website rule. Once attached, the rule is the source of truth for that channel's
  product membership: an active, non-archived product is a member exactly when it meets the rule.
- **FR-052**: The platform MUST ship no rule attached to any channel; installing or enabling the
  feature MUST NOT change any channel's membership. A channel with no website rule keeps today's
  behaviour: its membership is whatever administrators, imports and connectors write. An instance
  attaches its own rule (for example "flag A is true") after the preview of FR-053.
- **FR-053**: Before a rule is attached to a channel, or an attached rule is changed, the Admin UI
  MUST show how many products would join and leave each affected channel, and nothing MUST be
  applied until the administrator confirms that preview.
- **FR-054**: On a governed channel, a manual membership change (product editor, channel screen)
  and a bulk update that adds or removes a product MUST be refused by the server with a translated
  message (naming the website rule — owner-approved 2026-11-25); automatic writers — product create's default binding,
  duplicate, import and connectors — MUST skip the governed channel (their other writes proceed as
  today). No writer other than the rule MAY change a governed channel's membership.
- **FR-055**: The platform MUST expose to modules a way to ask whether a channel is governed and
  whether a product meets its rule, so a PIM connector can avoid writing against the rule. The
  mechanism is a design point for the plan. The connector change itself is out of scope.
- **FR-056**: A product rule MUST be a named, reusable definition referenced by its users, so that a
  later feature (for example a per-product sales mode: order only / quote only / both) can
  reference the same rule. This feature delivers no such use beyond the website rule.
- **FR-057**: A condition on an attribute a product has no value for MUST be "not met" for that
  product; it MUST NOT fail the evaluation of other products or of the channel.
- **FR-058**: Detaching a website rule from a channel MUST leave the membership as the rule last
  left it, and return the channel to FR-052 behaviour.
- **FR-059**: A product that a governed channel's rule has not yet admitted — newly created, or
  reactivated by a connector or anyone else — MUST NOT be on that channel (listings, search,
  type-ahead, URL) until the rule admits it; a qualifying product MUST be admitted within the bound
  of FR-061. There MUST be no window in which such a product is exposed on the channel before the
  rule admits it. The channel status moving to active on a governed channel is a reactivation for
  that channel (FR-092, OQ-F, H2); values written before admission are kept (FR-093, I-4).
  **Zero-channel exception**: to keep this, a product MAY be on no sales channel at all — when it
  is not yet admitted to a governed channel that its writer named (for example a new product whose
  default channel is governed), or when the rule removes it from its only channel. This waives the
  platform's "at least one channel per product" floor for those two cases on governed channels
  only; every other membership change keeps the floor, and the product is never moved to another
  channel in its place.

**Timing**

- **FR-060**: A change of a role's mapping, a category, a condition or a user's role, and a
  designated book entering or leaving force (FR-007), MUST apply to admin reads from the affected
  users' next request, without them signing in again. A change of a currency's designation (to
  another book or channel) MUST apply within **150 s**; until it does, that currency MUST contribute
  nothing to any category, so restricted users see no product that qualifies only through it
  (fail-closed, OQ-A).
- **FR-061**: A governed channel's membership MUST follow a change of an attribute value, a
  catalogue price, a price book's schedule starting or ending, or the rule itself, within 5
  minutes, including the storefront search index. While a currency's designation change is being
  applied, a rule's price condition on that currency MUST keep the previous evaluation until the new
  one is ready; the rebuild alone MUST NOT drop and re-add products on a governed channel (Q-2). The
  fail-closed treatment of FR-060 applies to admin reads only.
- **FR-062**: A catalogue price change MUST apply to admin read filtering (lists, counts, search,
  by-id answers) within **60 s** when it is a product or variant row on the base or designated book,
  and within **150 s** when it is catalogue-wide (a category, attribute or "all" row, or a category
  membership or attribute value such a row selects by). A designated book's schedule starting or
  ending applies from the next request (FR-060). Order and quote line checks (FR-037, FR-039,
  FR-041) MUST always use the exact catalogue price at the time of the request (OQ-A, amending owner
  decision 7's "next request" for price changes).

**Configuration, audit and presence**

- **FR-070**: Every create, change and delete of a category, a role mapping, a designated book (and
  its channel), a product rule and a rule's attachment to a channel MUST be audited with actor,
  before and after.
- **FR-071**: The feature MUST declare a dedicated permission to manage its configuration and one to
  read it, shown on the admin-roles screen; the configuration screens MUST be reachable from the
  command palette.
- **FR-072**: Membership changes made because of a website rule MUST be attributable to the rule
  (who or what moved a product in or out of a governed channel is answerable).
- **FR-073**: With the feature off, the platform MUST behave as if it were never installed: no
  admin read is narrowed, no catalog write is answered as absent, no order or quote line is refused,
  no marker is shown, no rule is evaluated, no membership write is refused or skipped, and its
  screens and API are absent; channel memberships stay as last computed. Turning it on again
  restores the configuration unchanged. Price books cannot be switched off
  (`price_lists/manifest.ts:197-198`, non-deactivatable), so the catalogue price is always
  available while the feature is on. The feature's screen MUST warn that switching it off lifts
  every product restriction.
- **FR-074**: Every user-facing string — screens, messages, the marker, permission labels, audit
  labels, command-palette entries — MUST exist in Polish and English.
- **FR-075**: The feature MUST be tenant-agnostic configuration of the instance and MUST NOT name
  any deployment's categories, roles, attributes or currencies in code or shipped data.
- **FR-076**: The feature MUST ship **off** (activation default off); deploying a release that
  contains it MUST change nothing for any user or channel until an operator turns it on. The
  activation control MUST say that turning it on applies FR-023 at once (OQ-C).
- **FR-077**: The feature's configuration MUST be available only while the feature is on (FR-073);
  it cannot be prepared before the first enable. The window in which unmapped fail-closed roles see
  no products after the first enable is accepted (I-3, OQ-10).
- **FR-079**: Visibility categories, role mappings and website rules MUST only narrow: they MUST
  NEVER make an inactive, archived or deleted product appear on any admin surface, storefront
  channel, line check or search where it does not appear today, and a website rule MUST NEVER put
  such a product on a channel (*Edge Cases*; FR-051 "active, non-archived").

**Other admin product surfaces** (OQ-D, OQ-E, OQ-H — 2026-11-25)

- **FR-080**: For a restricted user, the links, grouped items and bundle options of a visible
  product MUST leave out targets hidden from the user; a write that names a hidden target (adding or
  changing a link, grouped item or bundle option) MUST answer as for a product that does not exist
  and change nothing (OQ-D).
- **FR-081**: The admin assistant (prompt) tools that read or address products — those of `catalog`
  and the inventory "set stock" tool — MUST narrow their product reads by the invoking user's scope;
  a hidden product MUST be answered as not found and MUST NOT be written (OQ-E, OQ-H).
- **FR-082**: A refusal because a SKU or URL key is already taken MUST NOT name the holder (its id or
  name) to a user who cannot see the holder; the bare "already taken" answer remains and is a
  documented, accepted existence oracle. More generally, no error answer to a restricted user MAY
  name a product hidden from them other than the one they addressed (OQ-E; threat model TM-2).
- **FR-083**: The inventory admin lists (stock list, levels, low stock, the legacy list and
  availability notifications) MUST contain only products visible to a restricted user, with counts
  and paging of what they can see (OQ-H).
- **FR-084**: A restricted user's read of a hidden product's price history MUST answer as for a
  product that does not exist; the lines of a price change MUST leave out products hidden from the
  user. Price-book row writes stay accepted (FR-038); price-book row reads are covered by the price
  book grid narrowing (FR-030) (OQ-H).
- **FR-085**: Products export and products import through `import_export` MUST be refused with `403`
  for a restricted user. This is a refusal of the operation for the user's scope, not a per-product
  answer, so FR-033's "absent, never forbidden" does not apply to it (OQ-H).
- **FR-086**: The audit log and admin notifications that name products are accepted as they are (not
  narrowed); the feature's configuration overview MUST warn when a role mapped to a category (or
  fail-closed) holds `audit_logs:read` (OQ-H). This is the only permission warning: the threat
  model's further warnings for `import_export:*` and `inventory:read` are not needed, because the
  products import and export are refused (FR-085) and the inventory lists are narrowed (FR-083) for
  restricted users.
- **FR-087**: Product feeds and the product inputs and references of CMS, blog, CRM, projects and
  tasks (for example mentions and opportunity links) are accepted as they are, not narrowed
  (FR-038; OQ-H; client analyze N4). Creating an order or a quote from such a module (for example
  from an opportunity) MUST go through the same order and quote create paths that carry the
  refusals of FR-037 and FR-041, so a restricted user cannot place a hidden product on an order or
  quote that way.
- **FR-088**: The feature's documentation MUST list every admin surface that returns product data
  with its treatment — narrowed, refused or accepted — and the reason, including the accepted
  oracles of FR-082 and FR-086 – FR-087 (OQ-E, OQ-H).
**Website rule — sales-team purchase paths and channel-level status** (OQ-B, OQ-F, I-4 — 2026-11-25)

- **FR-090**: When an accepted quote is converted into a cart, a line whose product (or variant) is
  absent from the request's channel **only** because that channel's website rule excludes it MUST be
  kept, as if the product were on that channel; a line absent for any other reason (inactive,
  archived, deleted, inactive on that channel by its **channel status**, or not a member of an
  ungoverned channel) MUST be dropped as today. Per-language statuses on that channel MUST NOT make
  a line "absent for another reason" (H2); the channel status MUST, whenever it was stored (N1,
  FR-093). Checking out such a cart MUST keep the line through
  order placement: no step from conversion to the placed order MAY drop or refuse it for the same
  reason (Q-3 b). The storefront listings, search,
  type-ahead and product URL still do not show the product (FR-051). With the feature off (FR-073)
  or after the rule is detached (FR-058), the channel is not governed and conversion behaves as
  today (OQ-B).
- **FR-091**: Admin order create, admin order preview, admin reorder and admin clone-to-quote MUST
  accept a line whose product (or variant) is absent from the order's channel only because that
  channel's website rule excludes it, and keep refusing a product absent for any other reason as
  today (OQ-B, Q-3 a). As in FR-090, only the channel status — not a per-language status — decides
  whether the product is inactive on the channel (H2). The visibility-category check of FR-037
  and FR-039 still applies to restricted users. With the feature off (FR-073) or after a rule is
  detached (FR-058), that channel is not governed and today's channel check applies unchanged.
- **FR-092**: A product's **channel status** moving to active on a governed channel MUST count as a
  reactivation for that channel (FR-059): its membership of that channel is removed in the same
  transaction and the rule re-admits it within 5 minutes. A write that does not move the channel
  status to active is not a reactivation (OQ-F), and a per-language status change MUST NEVER be one
  (H2). The **effective** channel status is what moves: a channel status that stops being a stored
  "inactive" and becomes **inherited** (no stored value, so the product's global status applies)
  moves to active when the global status is active, and so is a reactivation; it is not one when the
  global status is inactive (product-owner clarification consistent with N1 and OQ-F — a connector
  releases its own "inactive" by writing "inherit"). The only exception is FR-093: the first
  channel-status write after admission (Q-1).
- **FR-093**: Per-language and channel-scoped values (status included) written for a governed
  channel by any writer — the admin product save, copy to channels, a connector or the scoped-values
  CSV import — MUST be stored for a product that is not on that channel only because the rule has
  not admitted it yet, and MUST NOT put it on the channel; on admission the product appears with
  those values. An unrestricted admin user MUST be able to read such pending values (N6). The first channel-status write on that channel after the product's
  admission MUST NOT count as a reactivation, even when it changes the channel status from inactive
  to active: the product shows on the channel at once, since the rule has already admitted it
  (I-4, Q-1). For FR-090 and FR-091, per-language statuses never count, and the **channel status
  always counts, whenever it was stored** — including a value stored pending admission and a value
  left over on a channel whose rule excludes the product: a product inactive on that channel by its
  channel status is not sold through the sales-team paths (H2, N1).

### Key Entities

- **Catalogue price designation**: per active currency, a regular *everyone* price book of that
  currency and a sales channel the book is bound to, for which it is resolved; default the
  currency's base book (channel-independent). It is *in force* or *not in force* (FR-007).
- **Visibility category**: a name and one or more conditions (currency, "> 0" or "≥ 0"); a product
  qualifies when it meets any condition.
- **Role mapping**: admin role → at most one target, a visibility category or **unrestricted**
  (I-2). The platform-administrator role and every role holding a self-lifting permission (FR-026)
  are never mapped and always unrestricted.
- **Self-lifting permission**: `*`, `product_visibility:manage`, `platform.modules.activate`,
  `admin_users:manage` — a permission with which a role could undo its own restriction (OQ-G).
- **Channel status** and **per-language status**: a product's general status on one sales channel
  (the channel row), and its status on one channel in one language. Only the channel status decides
  "inactive on the channel" for FR-090 / FR-091 and reactivation for FR-092; a per-language status
  decides only storefront visibility in that language (H2).
- **Restricted user**: a user whose role is mapped to a category or is fail-closed (FR-023); every
  other user is unrestricted. Glossary note: in this spec "restricted" **includes** fail-closed
  (no category). The plan's scope type names the two cases separately — `restricted` (mapped to a
  category) and `no_category` (fail-closed) — and every requirement that says "restricted user"
  applies to both.
- **Product rule**: a named, reusable condition tree over boolean and choice attribute values and
  catalogue price conditions; result "meets" / "does not meet".
- **Website rule attachment**: a product rule attached to a storefront sales channel (at most one
  per channel; a rule may be attached to several channels), which makes the rule the source of
  truth for that channel's product membership.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a matrix of 4 categories × 5 price states (A > 0 only, B > 0 only, both > 0, A = 0
  only, no price) plus one configurable product with one qualifying and one non-qualifying variant,
  every enforced read (FR-030 – FR-034, including variant lists and variants by id), the
  order-line checks (FR-037, FR-039) and the quote-line check (FR-041) returns exactly the expected products and variants: zero leaked, zero missing.
- **SC-002**: For a restricted user, the list total equals the number of products they can open,
  and every page but the last is full.
- **SC-003**: The platform administrator's and every unrestricted user's answers have response
  bodies (and status codes) byte-identical to today's for the same data; the not-cacheable header of
  FR-036 is sent in every state and so is not a difference.
- **SC-004**: Deploying the feature (shipped off, FR-076) changes nothing for any user or channel;
  enabling it with no website rule attached changes no channel membership; attaching a rule moves
  exactly the products the preview of FR-053 announced.
- **SC-005**: A website-governed channel reflects an attribute, price, schedule or rule change on
  the storefront and in its search index within 5 minutes; every manual or bulk membership write on
  it is refused, a PIM synchronisation never changes its membership, and a new or reactivated
  product never appears on it before the rule admits it.
- **SC-006**: An administrator configures a category, its role mapping and a website rule in the
  Admin UI in under 5 minutes, with no deployment.
- **SC-007**: A restricted user's admin product list keeps the list's current response-time budget
  on a catalogue of 50 000 products (the plan states the budget it measures against).
- **SC-008**: On a catalogue of 50 000 products, a restricted user's admin reads reflect a targeted
  catalogue-price change within 60 s and a catalogue-wide or designation change within 150 s; while
  a designation change is applied, no product qualifying only through that currency is shown; and
  every order or quote line check made at any moment uses the exact current catalogue price
  (OQ-A).
- **SC-009**: For a restricted user, every surface of FR-080 – FR-085 returns or acts on zero hidden
  products, and no error answer names a hidden product (FR-082).

## Assumptions

- "Sales representative", "management" and similar are admin users of the Admin UI; customers on
  the storefront are governed only by the website rule (and today's audience and channel rules).
- One role per admin user (F4); a person who needs two categories gets a role mapped to a combined
  category.
- Catalogue prices are whatever the designated price books hold; how they get there (manual, import,
  ERP) is unchanged.
- The offer's own currency is a separate matter; this feature filters by the user's category, not by
  the quote's currency.
- The "no fixed price" marker is a fixed, translated text (owner decision 5).
- Restricted roles are not expected to edit products. If a restricted role holds `catalog:write`,
  its users still cannot see or edit non-qualifying variants (RQ-3, FR-005).
- A role meant to be restricted does not hold a self-lifting permission; an instance that gives one
  to such a role makes it unrestricted (OQ-G, FR-026). The audit log is an investigation surface
  and is not narrowed; giving `audit_logs:read` to a restricted role is the instance's choice, which
  the overview warns about (FR-086).
- Two plan-stage answers were given with mild uncertainty ("probably"): OQ-B (FR-090, FR-091) and the
  OQ-H table (FR-083 – FR-087). They are recorded as decided; acceptance should confirm them with
  the owner.
- **Formerly product-owner proposals, approved by the owner on 2026-11-25** (analyze stage, N7):
  refusing
  to delete a mapped category (FR-013); shipping no categories (FR-014); the platform-administrator
  role not being mappable (FR-022); showing the mapping on the role screens (FR-024); "all of" /
  "any of" combination in rules (FR-050); detaching a rule leaves membership as it was (FR-058);
  attributing membership changes to the rule (FR-072); conditions on a deactivated currency not
  being met; flagging a draft, expired or out-of-schedule designation as not in force (FR-007 —
  the flag for deleted, unbound and re-audienced books is an owner decision, RQ-1); naming the rule
  in the refusal of FR-054; the order-line refusal being per variant (FR-037, read from "same
  refusal as offer lines"); whole-product actions (archive, restore, duplicate) on a visible parent
  with non-qualifying variants acting on the product as today (*Edge Cases*); the figures in SC-006 (5 minutes) and SC-007 (50 000 products);
  a mapped role that gains a self-lifting permission keeping its stored mapping without effect and
  being flagged, and a role that loses one being judged by its stored mapping again (FR-026,
  *Edge Cases*); the
  general rule that no error answer names another hidden product (FR-082, from threat model TM-2);
  the overview warning applying to fail-closed roles as well as mapped ones (FR-086); refusing to map
  a self-lifting role to unrestricted (FR-026).

## Dependencies and sequencing

- **Spec 192** (`specs/192-quote-request-draft-share/`, issue #1901) is rewriting the quote-request
  screens, `rfq-admin-service` and the admin-kit product browser and picker. FR-040 – FR-043 and any
  admin-kit change of this feature **MUST NOT start until spec 192 has merged to `master`**; their
  tasks are sequenced after it. **State of spec 192 on 2026-11-25** (analyze): issue #1901 open, no
  pull request; its branch `feat/192-quote-request-draft-share` exists only on a fork, at
  `53db5236f` (analyze round 3; near done — the last commit since `3c740f2c0` is docs-only,
  touching `docs/docs/upgrading-an-instance.md` in English and Polish). At that commit it touches no file under
  `packages/modules/orders/` or `packages/admin-kit/`; it does touch the quote → cart conversion in
  `carts` (`cart-conversion-service.ts`, `carts/docs/carts.md`), the shared error codes in
  `packages/contracts/src/errors.ts` and `packages/contracts/src/index.ts`,
  `error-code-routing/reference-ledgers.ts`, the shared `_i18n/i18n/{en,pl}.json`, the OpenAPI
  baseline and the migrations registry — so FR-090 and this feature's contract, error-code,
  translation, OpenAPI and migration changes may conflict with it. Everything else (FR-001 – FR-039, FR-050 – FR-093) can
  start at once, except where the plan gates it: the plan gates the admin order create / preview /
  reorder / clone-to-quote checks (FR-037, FR-039) on spec 192 too (plan Phase 9a). FR-037 is a
  server check in the orders module and does not depend on spec 192's screens, so releasing those
  order checks before spec 192 merges is an option the owner has **not** decided (2026-11-25);
  until the owner decides, the plan's gate stands. The plan has decided that FR-090 and FR-091 (plan
  Phase 9b) share the gate, because the quote → cart conversion is in a file spec 192 changes; the
  admin order paths of FR-091 could be released together with FR-037 if the owner releases those.
  FR-040 is satisfied by FR-030 alone if 192 leaves the browser reading the same endpoint. FR-039's admin clone-to-quote lives in the
  orders module (`orders/backend/services/order-clone-to-quote-service.ts`, route
  `POST /api/v1/admin/orders/:id/clone-to-quote`); whether its refusal shares the quote-request
  create path that spec 192 is changing, and so follows FR-041's sequencing, is for the architect.
- **PIM connectors**: making a connector respect a governed channel is a separate spec per
  connector; this feature only provides FR-054 (skip) and FR-055 (the port). Because the channel
  status always counts for the sales-team paths (N1), a connector that writes an inactive channel
  status merely because a product is hidden in every language would stop such a product being sold
  through the sales team; a connector setting to stop that is expected in a separate connector
  spec.
- **Module ownership** (a new module, or extending `catalog`, `price_lists` and `admin_roles`) is an
  architect decision (OQ-9); the product owner recommends a new module consuming the others through
  ports, detachable as a whole.
- **Plan constraint — later manual override** (OQ-8): manual writes on a governed channel are
  refused now, but the owner expects a per-product manual change may be needed later. The design
  MUST NOT preclude adding a per-product manual override of a website rule later (for example, it
  keeps room for an owner or source marker on a membership). This is a constraint on the plan, not
  a feature of this spec.

## Out of Scope

- Changes to any PIM connector (separate spec per connector) beyond what FR-054 and FR-055 provide.
- The "sales mode" feature (order only / quote only / both) beyond the reusable rule of FR-056.
- Per-user (rather than per-role) visibility and more than one role per user.
- Per-product manual exceptions to a website rule (the design keeps room for them — see the plan
  constraint under *Dependencies and sequencing*).
- Customer-specific prices as a visibility input (the catalogue price has no customer).
- Narrowing or refusing other modules' product-id inputs (FR-038): price-book row edits, SEO, price
  explainer resolve, inventory writes, blog, CMS, CRM, tasks, product feeds, the audit log and admin
  notifications. In scope instead: admin order create, order preview, reorder and clone-to-quote
  (FR-037, FR-039); cross-references, assistant tools, inventory lists, price history, and the
  products export and import (FR-080 – FR-085).
- The storefront (buyer) reorder and clone-to-quote paths: governed by today's storefront rules and
  the website rule, not by visibility categories. The one buyer-side exception is converting an
  accepted quote into a cart, which keeps rule-excluded lines (FR-090, OQ-B).
- Visibility of quotes, orders or organizations per role (the existing sales-rep scoping is
  unchanged).
