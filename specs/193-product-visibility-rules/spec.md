# Feature Specification: Product visibility rules — admin roles by catalogue price, and a configurable website rule

**Feature Branch**: `feat/193-product-visibility-rules`
**Created**: 2026-11-24
**Status**: Draft — owner decisions of 2026-11-24 recorded under *Owner decisions*; OQ-1 – OQ-12
(2026-11-24) and RQ-1 – RQ-3 (2026-11-25) answered under *Clarifications* (OQ-9 left to the
architect); clarify exhausted, ready for `/speckit.plan`
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
   holding the offer-creation permission are fail-closed on every filtered surface; the platform
   administrator is always unrestricted; other unmapped roles are unrestricted. → FR-020 – FR-024.
4. **Server-side filtering** for restricted users of every admin product read that shares the
   product list endpoint (list, detail, resolve-ids / select-all, admin global search, the offer
   product browser and picker, and with them order create, the price grid, the price explainer,
   the product editor and SEO), with correct totals and paging; a hidden product answers as absent.
   → FR-030 – FR-038.
5. **Quote requests**: the server refuses creating or editing a line with a product outside the
   user's category; existing lines stay; a product visible only through a "≥ 0" condition at price
   0 carries a fixed, translated "no fixed price" marker. Sequenced after spec 192 merges.
   → FR-040 – FR-043.
6. **Website rule**: a named, configurable rule over product attributes and price conditions
   decides storefront sales-channel membership and is its source of truth; the default keeps
   today's storefront unchanged; the rule is a reusable named concept so a later "sales mode"
   feature can reuse it. PIM connectors must not re-add the channel against the rule; the connector
   change is a separate spec, and what the platform exposes for it is a design point. → FR-050 –
   FR-059.
7. **Timing**: Admin UI changes apply on the next request; storefront membership follows within
   5 minutes; a scheduled price book becoming valid or expiring counts as a price change.
   → FR-060 – FR-062.
8. **Audit, permissions, off-state, languages**: configuration changes are audited; dedicated
   manage and read permissions; off means as never installed; Polish and English for every string.
   → FR-070 – FR-075.

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
  or the wildcard `*`, except the platform-administrator role.
- **OQ-3** — How far "absent" reaches (FR-033) → **A**: every catalog admin route addressed by a
  product id, reads and writes, treats a hidden product as absent. **Plus**: the server refuses a
  restricted user's admin order-create line whose product is outside their category, with the same
  refusal as quote lines (FR-037). Price-book and SEO edits addressed by product id are not refused.
  Other modules' product-id inputs (blog, CMS, CRM, tasks and the like) are out of scope.
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
6. **Given** a role holding the offer-creation permission and mapped to no category, **When** a
   user with it opens the product list, **Then** it is empty and the screen says the role has no
   product visibility category.
7. **Given** a role without the offer-creation permission and mapped to no category, **When** a user
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
11. **Given** a role holding the wildcard `*` (not the platform-administrator role) and mapped to no
    category, **When** a user with it opens the product list, **Then** it is empty, as in
    scenario 6.
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
6. **Given** the platform-administrator role, **When** an administrator tries to map it to a
   category, **Then** the Admin UI does not offer that, and the server refuses it.
7. **Given** currency B designated to a non-base *everyone* book together with channel X, **When** a
   product has a row in that book, **Then** its catalogue price in B is the engine's price for
   channel X; **When** the book is in force but has no row pricing the product, **Then** the base
   book's price stands; **When** the book is not in force (draft, expired, outside its schedule),
   **Then** the product has no catalogue price in B, even if the base book prices it.
8. **Given** a book whose audience is not *everyone*, **When** an administrator tries to designate
   it, **Then** the Admin UI does not offer it, and the server refuses it.
9. **Given** the feature is enabled for the first time, **When** the configuration screen is
   opened, **Then** every unmapped role holding `rfqs:handle` or `*` (other than the
   platform-administrator role) is listed as "sees no products".
10. **Given** an *everyone* book of currency B that is not bound to channel X, **When** an
    administrator tries to designate it for B with channel X, **Then** the Admin UI does not offer
    it, and the server refuses it.
11. **Given** currency B designated to a book with channel X, **When** an administrator deletes the
    book, unbinds it from channel X or changes its audience from *everyone*, **Then** the price-book
    change is saved as today; from then on no product has a catalogue price in B (the base book is
    not used in its place), and the configuration screen flags the designation as not in force.

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
   inactive product that meets it is reactivated (by a connector or anyone else), **Then** it is not
   on the channel's listings, search, type-ahead or URL until the rule admits it, and it is admitted
   within 5 minutes.
7. **Given** a channel that already has a website rule, **When** an administrator attaches a second
   rule to it, **Then** the server refuses; **When** the same rule is attached to a second
   storefront channel, **Then** both channels are governed by it.
8. **Given** a rule to attach or a change to an attached rule, **When** the administrator saves it,
   **Then** the Admin UI first shows how many products would join and leave each governed channel
   and applies nothing until the administrator confirms.
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
  restore, duplicate) act on the product as today (product-owner proposal).
- **Base book designated**: since a base book holds only product and variant rows (F7), category,
  attribute and "all" rows only ever count when a non-base book is designated.
- **Currency deactivated** while a category or designation uses it: conditions on it are not met
  (no price in an inactive currency); the configuration keeps the condition and shows it as
  inactive.
- **Inactive, archived or deleted products**: the rules only narrow; they never make such a product
  appear anywhere it does not appear today, and never put it on a storefront channel.
- **A custom role holding the wildcard `*`**: counts as holding `rfqs:handle`, so it is fail-closed
  while unmapped (OQ-2).
- **First enable**: before any mapping exists, every non-administrator role holding `rfqs:handle` or
  `*` sees no products anywhere; the configuration screen lists those roles as "sees no products"
  (OQ-10).
- **A user changes role mid-session**: the new role's category applies from the next request.
- **Hidden product reached another way**: a bookmarked URL, a saved view, a global-search result
  link or a select-all resolved earlier — each answers by the user's category at the time of the
  request, never from an earlier answer.
- **Counts and pages**: no response tells a restricted user how many products are hidden; no page
  is short because of filtering applied after paging.
- **Hidden product edited from another module**: price-book rows and SEO data addressed by product
  or variant id are not refused (OQ-3, FR-038); the price book grid itself lists only visible
  products and, of a visible configurable product, only its qualifying variants (FR-030, FR-005).
- **Website rule and an inactive product**: a governed channel never gains an inactive, archived or
  deleted product because of the rule.
- **New or reactivated product on a governed channel**: not on the channel until the rule admits it;
  it may appear up to 5 minutes late, never early (FR-059).
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
  re-audienced books; product-owner proposal for draft, expired and out-of-schedule ones).

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

- **FR-020**: An administrator MUST be able to map each admin role to at most one visibility
  category, in the Admin UI.
- **FR-021**: A user's visibility MUST be that of their single role (F4).
- **FR-022**: The platform-administrator role MUST always be unrestricted and MUST NOT be mappable.
- **FR-023**: A role with no mapping MUST be **fail-closed** — no product on any surface of FR-030 –
  FR-039 or FR-040, with a message that the role has no product visibility category — when it holds
  `rfqs:handle` or the wildcard `*` and is not the platform-administrator role; every other unmapped
  role MUST be unrestricted. This applies from the moment the feature is first enabled, with no
  grace period (OQ-10).
- **FR-024**: The role list, the role editor and the feature's configuration screen MUST show each
  role's category (or "unrestricted", or "no category — sees no products") so an administrator can
  see the effect of the mapping where roles are managed.

**Admin product reads and writes**

- **FR-030**: For a restricted user, every answer of the admin product list endpoint MUST contain
  only products visible to the user's category, whatever screen or caller asks — including, not
  limited to, the product list, the product browser and picker, order create, the price book grid,
  the price explainer, the product editor, SEO and the other callers of F3; of a visible
  configurable product, only its qualifying variants (FR-005).
- **FR-031**: The list's `total`, its per-status counts and its paging MUST count only visible
  products; filtering MUST happen in the query that pages, not after it.
- **FR-032**: Select-all (`resolve-ids`) and fetching products by a list of ids (`batch-by-id`)
  MUST return only visible products, and totals counting only those.
- **FR-033**: Every catalog admin route addressed by a product id — the detail, its sub-resources
  (content, scopes, scoped values, scope overview, attribute-set preview, gallery, editor
  preference, variants) and the writes (update, archive, restore, duplicate, bulk update) — MUST
  answer a product outside the user's category exactly as it answers a product that does not exist
  (same status and error code), never as "forbidden", and MUST change nothing. A bulk update naming
  hidden products MUST treat them as absent. The same holds for a non-qualifying variant of a
  visible product addressed by its id (FR-005).
- **FR-034**: The admin global search MUST return only products visible to the searching user, and
  its "more results" indication MUST not reveal hidden ones.
- **FR-035**: An unrestricted user MUST see on every surface exactly what they see today.
- **FR-036**: The enforcement MUST be on the server for every surface above; hiding on the client
  alone does not satisfy any requirement of this section.
- **FR-037**: Creating an order in the Admin UI with a line whose product (or variant, FR-005) is
  outside the restricted user's category MUST be refused by the server, naming the offending lines,
  with the same refusal as quote lines (FR-041); nothing of the request is saved. Other admin entry
  paths: FR-039. The "no fixed price" marker of FR-043 is not shown on order create.
- **FR-038**: Edits addressed by product or variant id outside the catalog admin routes —
  price-book rows, SEO data, and other modules' product-id inputs (blog, CMS, CRM, tasks and the
  like) — MUST NOT be narrowed or refused by this feature.
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
  fixed marker "no fixed price" in the offer product search and on the quote line in the Admin UI.
  The text is translated (Polish and English) and not editable. Unrestricted users MUST NOT see the
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
  message (naming the website rule — product-owner proposal); automatic writers — product create's default binding,
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
  rule admits it.

**Timing**

- **FR-060**: A change of a role's mapping, a category or a currency's designated book MUST apply
  to admin reads from the affected users' next request, without them signing in again.
- **FR-061**: A governed channel's membership MUST follow a change of an attribute value, a
  catalogue price, a price book's schedule starting or ending, or the rule itself, within 5
  minutes, including the storefront search index.
- **FR-062**: A catalogue price change (a row added, edited or removed, or a schedule starting or
  ending) MUST apply to admin read filtering from the next request (owner decision 7). The pricing
  engine's 60-second per-process cache (F7) is a constraint the plan must meet, not a relaxation of
  this requirement.

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

### Key Entities

- **Catalogue price designation**: per active currency, a regular *everyone* price book of that
  currency and a sales channel the book is bound to, for which it is resolved; default the
  currency's base book (channel-independent). It is *in force* or *not in force* (FR-007).
- **Visibility category**: a name and one or more conditions (currency, "> 0" or "≥ 0"); a product
  qualifies when it meets any condition.
- **Role mapping**: admin role → at most one visibility category. The platform-administrator role is
  never mapped and always unrestricted.
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
- **SC-003**: The platform administrator's and every unrestricted user's answers are byte-identical
  to today's for the same data.
- **SC-004**: Installing and enabling the feature with no website rule attached changes no channel
  membership; attaching a rule moves exactly the products the preview of FR-053 announced.
- **SC-005**: A website-governed channel reflects an attribute, price, schedule or rule change on
  the storefront and in its search index within 5 minutes; every manual or bulk membership write on
  it is refused, a PIM synchronisation never changes its membership, and a new or reactivated
  product never appears on it before the rule admits it.
- **SC-006**: An administrator configures a category, its role mapping and a website rule in the
  Admin UI in under 5 minutes, with no deployment.
- **SC-007**: A restricted user's admin product list keeps the list's current response-time budget
  on a catalogue of 50 000 products (the plan states the budget it measures against).

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
- **Product-owner proposals, not owner decisions** (the owner may strike any of them): refusing
  to delete a mapped category (FR-013); shipping no categories (FR-014); the platform-administrator
  role not being mappable (FR-022); showing the mapping on the role screens (FR-024); "all of" /
  "any of" combination in rules (FR-050); detaching a rule leaves membership as it was (FR-058);
  attributing membership changes to the rule (FR-072); conditions on a deactivated currency not
  being met; flagging a draft, expired or out-of-schedule designation as not in force (FR-007 —
  the flag for deleted, unbound and re-audienced books is an owner decision, RQ-1); naming the rule
  in the refusal of FR-054; the order-line refusal being per variant (FR-037, read from "same
  refusal as offer lines"); whole-product actions (archive, restore, duplicate) on a visible parent
  with non-qualifying variants acting on the product as today (*Edge Cases*); the figures in SC-006 (5 minutes) and SC-007 (50 000 products).

## Dependencies and sequencing

- **Spec 192** (`specs/192-quote-request-draft-share/`, issue #1901) is rewriting the quote-request
  screens, `rfq-admin-service` and the admin-kit product browser and picker. FR-040 – FR-043 and any
  admin-kit change of this feature **MUST NOT start until spec 192 has merged to `master`**; their
  tasks are sequenced after it. Spec 192's branch was not on `origin` when this spec was written.
  Everything else (FR-001 – FR-039, FR-050 – FR-075) can start at once — FR-037 is a server check in
  the orders module and does not depend on spec 192's screens; FR-040 is satisfied by FR-030 alone
  if 192 leaves the browser reading the same endpoint. FR-039's admin clone-to-quote lives in the
  orders module (`orders/backend/services/order-clone-to-quote-service.ts`, route
  `POST /api/v1/admin/orders/:id/clone-to-quote`); whether its refusal shares the quote-request
  create path that spec 192 is changing, and so follows FR-041's sequencing, is for the architect.
- **PIM connectors**: making a connector respect a governed channel is a separate spec per
  connector; this feature only provides FR-054 (skip) and FR-055 (the port).
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
- Narrowing or refusing other modules' product-id inputs (FR-038): price-book rows, SEO, price
  explainer resolve, blog, CMS, CRM, tasks, exports, product feeds. Admin order create, order
  preview, reorder and clone-to-quote are in scope (FR-037, FR-039).
- The storefront (buyer) reorder and clone-to-quote paths: governed by today's storefront rules and
  the website rule, not by visibility categories.
- Visibility of quotes, orders or organizations per role (the existing sales-rep scoping is
  unchanged).
