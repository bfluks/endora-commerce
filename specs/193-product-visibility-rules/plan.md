# Implementation Plan: Product visibility rules — admin roles by catalogue price, and a configurable website rule

**Branch**: `feat/193-product-visibility-rules` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/193-product-visibility-rules/spec.md` (Clarifications 2026-11-24; owner answers
RQ-1 **A**, RQ-2 **C**, RQ-3 **A** of 2026-11-25). Issue #1908.
**Measured against**: `origin/master` **`c3e8a8755`** (the spec cited `67351db04`; the line
numbers these design documents cite were read at `c3e8a8755`; the spec's own F1 – F9 citations
were not all re-checked). Spec 192 measured on its branch
`feat/192-quote-request-draft-share` at `6f4259f45` (not on `origin`; it does not touch `orders/`
or `packages/admin-kit/` at that commit, see § *Sequencing*).

## Summary

A new detachable module **`product_visibility_rules`** owns the configuration (visibility
categories, per-currency catalogue-price designations, role → category mappings, named product
rules, website-rule attachments) and two derived, module-owned tables: the **catalogue-price
flags** per product and per variant (does a catalogue price exist in currency C; is it above
zero), refreshed by a BullMQ worker from a **new batched `price_lists` read** that runs the
pricing engine's own resolver over a fixed profile `[base book, designated book]` (FR-006: no
second resolver), and the **website-rule** evaluation that writes storefront channel membership.

- **Admin reads** (catalog list, counts, select-all, batch-by-id, global search, every by-id
  route, `/variants`, the price book grid's product and variant lines) are narrowed **inside the paging statement** by a SQL predicate the module
  hands `catalog` through a port — the shape `inventoryStockReadPort.predicate` already uses
  (`catalog/backend/services/catalog-admin.service.ts:1868`). `catalog` declares the edge
  `degrades-without`: module off ⇒ no narrowing, exactly as never installed (FR-073).
- **By-id absence** is one guard seam in `catalog`'s admin route registration plus a
  route-inventory test that derives every `/api/v1/admin/catalog/products/:id…` route from the
  running app and asserts "hidden ≡ non-existent" per route (R-7).
- **Governed channel membership** is enforced where every membership write already goes: the
  kernel's `SalesChannelMembershipService`
  (`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`). A module
  contributes a **membership governor**; the service **skips** governed channels by default
  (automatic writers — create, duplicate, import, connectors — comply unchanged) and **refuses**
  where the caller says it is a manual write (the channel-side routes in `sales_channels`, the
  catalog bulk update). Only the governor's own token writes a governed channel (R-10).
- **Order/quote line refusals and the "no fixed price" marker** (FR-037, FR-040 – FR-043, RQ-2 C)
  are a separate phase **gated on spec 192 merging to `master`** (coordinator instruction).

Eight owner questions are open (OQ-G and OQ-H from the threat model, `threat-model.md`) (§ *Open questions for the owner*); OQ-A (timing bounds of FR-060 /
FR-062 for data-dependent changes) and OQ-B (quote conversion drops rule-excluded products) change
what US1/US4 deliver and must be answered before Phase 4 and Phase 6 start.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17 (repo baseline).
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, BullMQ, ioredis,
the platform Command Bus and command hooks (`@endora-commerce/platform/commands`), React 19 admin
with `@endora-commerce/admin-kit`. **No new runtime dependency.**
**Storage**: PostgreSQL. New module tables (data-model.md): 6 configuration tables, 3 derived
price-flag tables, 3 website-rule work tables. No column added to another module's table.
**Testing**: Vitest — co-located module tests (`packages/modules/product_visibility_rules/src/**/*.test.ts`),
backend contract/integration suites (`backend/test/{contract,integration}/product_visibility_rules/`,
`…/catalog/`, `…/price_lists/`, `…/sales_channels/`), one perf bench
(`backend/test/perf/product_visibility_rules/`), admin component tests (`admin/test/modules/product_visibility_rules/`).
**Target Platform**: backend API + worker, Admin SPA. Storefront code unchanged (it already
honours channel membership — spec F8).
**Project Type**: modular monorepo; one new module; touched owners: `price_lists` (one read port, one event, the price book grid's
narrowing), `catalog` (enforcement seam), platform kernel (membership governor), 
`sales_channels` (manual-write intent), `admin_users` (role-screen zones); gated: `orders`,
`quote_requests`, `packages/admin-kit`.
**Performance Goals** (architect-set budgets, owner may override; measured by T035):
restricted admin list/count page p95 ≤ **unrestricted p95 + 50 ms** and ≤ **300 ms** at 50 000
products × 3 currencies; targeted price change → admin flags ≤ **60 s** (p95 ≤ 5 s);
catalogue-wide change or designation change → ≤ **150 s** per currency (the SC-005 bound of the
price surface); governed-channel membership ≤ **5 min** (FR-061); restricted admin global search
stays under the constitution's product-search target (< 200 ms p95, *Performance & Scale Targets*).
Scale: 50 000 products / 150 000 variants is inside the constitution's "hundreds of thousands of
products including variants"; the rebuild bound grows linearly and is re-measured by T092.
**Constraints**: hidden ≡ absent on every by-id route (FR-033); no response counts hidden
products (FR-031, FR-034); unrestricted answers byte-identical (SC-003); module off ⇒ as never
installed (FR-073); no window before admission (FR-059).
**Scale/Scope**: ~45 backend files, ~14 admin files, 2 contracts files, 1 platform file + port
type, 2 module migrations. Owner of the gated phase's files: spec 192 first.

## Constitution Check

*Gate before Phase 0; re-checked after Phase 1 design — passes with three recorded deviations
(Complexity Tracking).*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | Pass | All new state in `product_visibility_rules`. Cross-module only through ports: `catalog` resolves `adminProductVisibilityPort`; the module resolves `catalogueReferencePricePort` (`price_lists`), `permissionService` (`admin_roles`), catalog read ports, `currencyReadPort`; SQL against module tables is produced only by the owner and embedded by the caller (precedent `inventoryStockReadPort`). No table of another module is read or written. |
| II API-first | Pass | Zod first: new `packages/contracts/src/product-visibility.ts`; additive optional fields on the admin product list/variant schemas (gated phase). `contracts/` lists every shape. |
| III TDD (NN) | Pass | Each phase opens with failing tests; FR → test map in tasks.md. |
| IV YAGNI / deps | Pass | No dependency. No override table (constraint only, R-12). No per-user visibility. |
| V / VI / VIII | Pass | Module id `product_visibility_rules` (plural snake_case); tables plural; English artefacts. |
| VII SEO | N/A | Storefront unchanged; membership already drives listings, PDP and index. |
| IX UI reuse | Pass | Admin-kit primitives; role screens through `AdminZone` (`packages/admin-kit/src/zones/AdminZone.tsx`). |
| X Queues | Pass | Flag refresh, rule preview, rule apply and reconcile are BullMQ workers registered through `ctx.worker`; producers only enqueue; handlers idempotent (generation + marks). Co-location with the API is allowed (low steady volume); the first attach is bulk and SHOULD run in the worker process (noted for deploy). |
| XI Tenancy (NN) | Pass | All new tables are **platform-global** instance configuration / derived catalogue facts (FR-075); classified in the entity classification ledger. Workers run under `enterSystemScope(reason)`. |
| XII Channel scoping (NN) | Pass | Membership read and written only through `SalesChannelMembershipService`; the governor is a check inside that accessor, not a second writer. |
| XIII Command Bus (NN) | Pass | Every configuration write is a Command (`product_visibility.*`); rule-driven membership writes keep the kernel's existing per-row audit and add a `source` naming the rule (FR-072). |
| XIV Entity-agnostic | Pass | The kernel governor is entity-type agnostic (a governor declares which entity types it governs). |
| XV Untouched core | Pass | No deployment names; FR-075. |
| XVI Palette | Pass | Two palette actions (configuration, website rules). |
| XVII Toggleable (NN) | Pass, with R-3 | Deactivatable; **activation default off** (R-3, OQ-C). Off ⇒ no narrowing, no refusal, no skip, no evaluation; memberships stay as last computed. Off-state test per surface (T024, T050, T061, T069, T077, T087). |

## Project Structure

### Documentation (this feature)

```text
specs/193-product-visibility-rules/
├── spec.md            # product-owner
├── plan.md            # this file
├── research.md        # R-1 … R-17 decisions with rejected alternatives (R-17: threat-model amendments)
├── threat-model.md    # security-engineer (TM-1 … TM-16); mapped to tasks at the end of tasks.md
├── data-model.md      # tables, derived tables, states
├── quickstart.md      # how to see each user story working
├── contracts/
│   ├── admin-api.md           # configuration API + catalog/orders/quote shape changes
│   ├── ports.md               # adminProductVisibilityPort, productRuleGovernancePort,
│   │                          # catalogueReferencePricePort, kernel membership governor
│   └── events-and-errors.md   # price_lists.catalogue_prices_changed, error codes, audit actions
└── tasks.md
```

### Source Code (repository root)

```text
packages/modules/product_visibility_rules/          # NEW module (R-1)
├── package.json  i18n/{en,pl}.json  docs/{en,pl}/…
└── src/
    ├── manifest.ts                                  # permissions, actions, activation (default off),
    │                                                # dependencies, nonBindingDependencies, errorCodes
    ├── migrations/                                  # scaffolded by migration:new
    ├── backend/
    │   ├── index.ts                                 # registerModule: ports, routes, workers, subscribers,
    │   │                                            # command hooks, governor contribution
    │   ├── entities/                                # config + derived tables
    │   ├── commands/                                # product_visibility.* Commands
    │   ├── services/
    │   │   ├── visibility-config.service.ts         # categories, conditions, mappings, designations
    │   │   ├── admin-visibility-scope.ts            # resolveScope, predicates, line checks
    │   │   ├── catalogue-price-flags.ts             # generation, marks, refresh, swap
    │   │   ├── product-rule-evaluator.ts            # pure evaluator over facts
    │   │   ├── website-rule.service.ts              # attach / change / detach, preview, apply
    │   │   └── membership-governor.ts               # kernel governor implementation
    │   ├── workers/{catalogue-price-flags,website-rule}-worker.ts
    │   └── routes.admin.ts
    └── admin/                                       # screens, palette, role zones, list banner
packages/contracts/src/product-visibility.ts         # NEW
packages/modules/price_lists/src/backend/services/{book-pricing,pricing-service,catalogue-reference-price}.ts
packages/platform/src/kernel/sales-channels/{sales-channel-membership.service,membership-governors}.ts
packages/platform/src/kernel/ports/sales-channel.ts  # additive options
packages/modules/catalog/src/backend/{index.ts,routes.admin.ts,admin-search-provider.ts}
packages/modules/catalog/src/backend/services/{catalog-admin.service,catalog-admin-search.service,catalog-bulk-update.service}.ts
packages/modules/catalog/src/manifest.ts             # nonBindingDependencies entry
packages/modules/sales_channels/src/backend/routes.admin.ts   # onGoverned: 'refuse'
packages/modules/admin_users/src/admin/pages/AdminRolesPage.tsx  # zone hosts
# gated on spec 192:
packages/modules/orders/src/backend/{routes.ts,services/order-clone-to-quote-service.ts}
packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts
packages/admin-kit/src/components/{product-picker,product-browser}/…
```

**Structure Decision**: one new module package beside its peers under `packages/modules/`;
every other change is a seam in the owner of the surface it narrows.

## Design overview (details in research.md)

1. **Catalogue price** (FR-001 – FR-007, RQ-1 A) — `price_lists` gains
   `catalogueReferencePricePort` (capability port beside `pricingService`): `resolve` runs
   `BookPricing.resolve` over a fixed profile whose books are the currency's base book plus the
   designated book (the CATALOGUE tier restricted to that book; BASE stands where it is silent —
   OQ-1 b), per product **and per variant**, quantity 1, no buyer, now; `designationStatus` answers
   in force or why not (`not_found`, `currency_mismatch`, `not_regular`, `audience_restricted`,
   `not_on_channel`, `not_active`, `outside_schedule`) — RQ-1 A's set, extending
   `namedBookPublishability` (`price_lists/backend/services/book-pricing.ts:682`) by the regular-type
   check. An identity test holds it equal to `resolveLinePrices` for a guest on a channel whose only
   everyone book is the designated one (R-4).
2. **Flags at list scale** — module tables `product_catalogue_prices` and
   `variant_catalogue_prices` (rows only where a price exists; `has_positive`), per currency and
   **generation**. Refreshed by marks (targeted) and generations (whole currency); the designated
   book's in-force window is evaluated **at request time** (R-5, R-6).
3. **Admin scope** — `resolveScope(adminUserId)` → unrestricted | restricted(conditions) |
   no-category (fail-closed, FR-023); `productPredicate`/`variantPredicate` return SQL over the
   module's own tables for `catalog` to embed (R-7).
4. **Website rule** — a pure evaluator over (status, archived, boolean/choice attribute values,
   product-level flags); a worker computes desired membership per governed channel and applies the
   diff with the governor token (R-9, R-10, R-11).
5. **Admission** (FR-059) — automatic writers skip governed channels; a `beforeCommit` command
   hook on catalog's reactivation and restore removes governed memberships in the same transaction;
   the worker re-admits within 5 min (R-11).

### Timing per change kind (FR-060 – FR-062; OQ-A)

| Change | Admin read filtering | Governed channel |
| --- | --- | --- |
| Category, condition, role mapping, user's role | next request (read at request) | rule's price conditions are categories-independent; n/a |
| Designated book enters / leaves its schedule window, or is deleted / unbound / re-audienced / deactivated | next request (`designationStatus` read per request) | delayed job at the boundary; ≤ 5 min |
| Designation changed to another book or channel | the currency contributes **no** condition until its new generation is built (≤ 150 s, fail closed — TM-7 (4)), then swapped atomically — **deviates from FR-060 "next request"** (OQ-A) | same generation swap, then ≤ 5 min |
| Price row on the base or designated book (product / variant row) | ≤ 60 s (p95 ≤ 5 s) — **deviates from FR-062 "next request"** (OQ-A) | ≤ 5 min |
| Catalogue-wide row (all / category / attribute) on the designated book; category membership or attribute value that a row selects by | ≤ 150 s — deviation as above | ≤ 5 min |
| Order / quote **line** checks (gated phase) | **live** through the engine: exact, next request (R-8) | n/a |

## Sequencing and spec 192

- Phases 1 – 8 (catalog/price/role/rule side and its admin UI) start now.
- **Phase 9 is gated**: `quote_requests` line refusals, the admin-kit product browser / picker
  variant narrowing and marker, and the `orders` create / preview / reorder / clone-to-quote checks
  start only after spec 192 (issue #1901) has merged to `master` (coordinator instruction).
  Deviation recorded: the spec says FR-037 could start at once, and spec 192's branch at
  `6f4259f45` touches no file under `packages/modules/orders/` or `packages/admin-kit/`; the
  coordinator may lift the gate for T079 – T080 (orders only) without re-planning. Clone-to-quote
  stays gated (it reaches `RfqAdminService.createOnBehalf`, which 192 rewrites).
- Before Phase 9: rebase, re-measure every cited line in `rfq-admin-service.ts`,
  `RfqCreatePage.tsx`, `RfqDetail.tsx`, `ProductPicker.tsx`, `product-browser-api.ts`.

## Parallel builders (max 2 after Phase 4)

| Stream | Phases | Owns (exclusive) |
| --- | --- | --- |
| **A — admin reads** | 5a, 5b, 5c (+ T067, T075, T084) | `packages/modules/catalog/**` (incl. `catalog-bulk-update.service.ts`), `packages/modules/price_lists/src/backend/services/price-book-reads.ts`; in 5c (pending owner) `packages/modules/inventory/src/backend/{routes.admin,prompt-tools}.ts`, `price_lists/src/backend/routes.price-books.ts` (price-history routes), `import_export/src/backend/services/adapters/products.adapter.ts`; `backend/test/{contract,integration}/catalog/visibility-*`, perf bench |
| **B — website rule** | 6, 7 | `packages/platform/src/kernel/sales-channels/**`, `packages/platform/src/kernel/ports/sales-channel.ts`, `packages/modules/sales_channels/**`, `product_visibility_rules/src/backend/{services/{product-rule-evaluator,website-rule.service,membership-governor}.ts,workers/website-rule-worker.ts}`, `backend/test/integration/product_visibility_rules/{website-*,admission,off-state.website-rule,off-state.governance}.test.ts`, `backend/test/contract/sales_channels/governed-membership.contract.test.ts` |

Phases 1 – 4 are one stream (foundation). Cross-stream edge: T067 (catalog bulk update passes
`onGoverned: 'refuse'`) is owned by stream A and starts after T063 (kernel option) is merged into
the shared branch. `product_visibility_rules/src/manifest.ts`, `src/backend/index.ts`,
`i18n/*.json` and the generated registries are touched by both streams: each stream appends its
own block; the second to merge regenerates (`composer:generate`, `manifests:generate`) rather than
hand-merging.

## Open questions for the owner

Each is an owner-level product call; the plan proceeds on the recommendation and marks the tasks
that change if the answer differs.

- **OQ-A — Timing of data-dependent changes (FR-060 designated book, FR-062 price change).** Admin
  read filtering at list scale needs a precomputed fact; recomputing one currency at 50 000
  products takes the engine ~11 s (price-surface bench: 5 profiles in 53 – 60 s,
  `specs/pricing/read-paths-and-performance.md` §7), so "next request" cannot hold for a price
  row change or a designation change. (A) Accept bounded lag: ≤ 60 s for a targeted price change,
  ≤ 150 s for a catalogue-wide change or a designation change; window / in-force changes stay
  next-request; line checks stay exact (live) — **recommended**; amends FR-060/FR-062 wording.
  (B) Fail closed while a mark is pending: a restricted user does not see a marked product until it
  is refreshed (never early, sometimes late; a catalogue-wide change hides the currency's products
  for up to 150 s). (C) Live evaluation per request — rejected as infeasible (seconds per page).
  Tasks affected: T027 – T030, T033.
- **OQ-B — Rule-excluded products and the storefront paths that need channel membership.** Quote →
  cart conversion drops every line whose product is not published in the request channel
  (`carts/backend/services/cart-conversion-service.ts:239`), and admin order create / preview refuse
  a product outside the order's channel (`orders/backend/routes.ts:985-1000`). So a product the
  website rule removes from a channel cannot be bought on that channel through an accepted quote or
  an admin order — which contradicts owner decision 6 ("stay sellable through the sales team") on
  an instance with one channel. (A) Document: keep an ungoverned channel for sales-team orders and
  quotes; no code change. (B) Spec amendment: quote conversion and admin order create treat "absent
  only because a website rule excluded it" as available on that channel, asked through
  `productRuleGovernancePort` (a new FR; ~5 tasks in `carts` and `orders`) — **recommended**.
  (C) The rule hides from browse/search/PDP only and does not own membership — contradicts owner
  decision 6. Phase 6 can start under any answer; (B) adds a phase.
- **OQ-C — Activation default.** Every instance composes every core module; with activation default
  **on**, upgrading would put every unmapped role holding `rfqs:handle` or `*` into "sees no
  products" at once (FR-023, OQ-10). (A) Default **off**; an operator enables it after mapping —
  **recommended** (planned). (B) Default on, as OQ-10 literally reads.
- **OQ-D — Cross-references to hidden products on a visible product.** Links, grouped items and
  bundle options of a visible product name their targets by id and name
  (`catalog/backend/routes.admin.ts:1765-2032`). (A) For restricted users, strip hidden targets from
  those reads and answer a write that names one as absent — **recommended**. (B) Show them as today
  (FR-033 is per addressed product). Tasks affected: T045.
- **OQ-E — Other admin read paths that do not use the product list.** The assistant tools `catalog`
  contributes to `promptActionToolRegistry` and the existence oracles of unique keys (a SKU or URL
  key "already taken" on create/update). *Correction from the threat model (TM-2)*: today the URL-key
  conflict names the holder's id and name; T046 redacts that regardless of this answer, so only the
  bare "already taken" remains to accept.
  (A) Narrow the assistant tools' product reads by the invoking admin's scope; accept the
  unique-key oracle (masking it would break create) and document it — **recommended**.
  (B) Leave both out of scope. Tasks affected: T048 (the unique-key half is reshaped by TM-2, T046).
- **OQ-F — Channel-scoped status as "reactivation" (FR-059).** A product's status can also be set
  per channel (feature 163), and an external connector switches products on and off per channel
  that way. (A) A channel-scoped status moving to active on a governed channel counts as a
  reactivation for that channel: the membership is removed in the same transaction and the rule
  re-admits within 5 min — **recommended** (never early). (B) Only the product's global status and
  restore count; a channel-level re-enable of an admitted product shows at once. Tasks affected:
  T049, T068.
- **OQ-G — May a restricted role hold a permission that lifts its own restriction? (threat model
  TM-4 a).** A role holding `*`, `product_visibility:manage`, `platform.modules.activate` or
  `admin_users:manage` can undo its restriction (edit its mapping, switch the module off, change its
  own role). The threat model asks the mapping Command to refuse such roles; that conflicts with
  OQ-2 / FR-023 (an unmapped `*` role is fail-closed, so it must be mappable to see anything).
  Planned regardless of the answer: configuration writes refused (`403`) for any non-unrestricted
  caller, `liftable` flag on the overview, activation audited (T017, T020, T021, T024).
  (A) Keep mapping allowed; flag `liftable` roles on the overview and in the docs ("a `*` role is
  not a restrictable role") — **recommended**: it keeps OQ-2 and the remaining gap needs a
  deliberate act by someone who already holds administrator-grade permissions. (B) Refuse to map a
  role holding a lifting permission other than `*` (`product_visibility:manage`,
  `platform.modules.activate`, `admin_users:manage`), keep `*` mappable. (C) Refuse all four,
  including `*` — amends OQ-2: an unmapped `*` role would then be unmappable and permanently see
  nothing. Tasks affected: T019, T070.
- **OQ-H — Other admin read paths that return product data (threat model TM-9).** Sign-off of the
  table below; rows answered "accepted" drop their task in Phase 5c (pending) and go into the docs
  table (T088). Measured at `c3e8a8755`.

  | Surface | Recommendation | Reason | Task |
  | --- | --- | --- | --- |
  | Inventory admin lists — `/api/v1/admin/inventory`, `/levels`, `/low-stock`, `/legacy` (SKU, name, stock), `/availability-notifications` (`inventory/backend/routes.admin.ts:124-615`) | **Narrowed** (product predicate on their product column) | They list products by id, SKU and name: the same disclosure as the product list | T052 |
  | Inventory assistant "set stock" tool (`inventory/backend/prompt-tools.ts:86-101`) | **Narrowed** (scoped product lookup; hidden ⇒ not found, no write) | Reads a name and writes for any id; same class as the catalog tools (OQ-E) | T052 |
  | Inventory writes by product id (`/levels` PUT, thresholds, import) | **Accepted** | Stock is not price or assortment; FR-038's reasoning for other modules' product-id inputs | — |
  | Price history by product (`price_lists/backend/routes.price-books.ts:536-550`) | **Refused as absent** for a hidden product | A read keyed by product id, with amounts; FR-038 covers edits, not reads | T053 |
  | Price history change lines (`…/price-history/:changeId/lines`, `:552-567`) | **Narrowed** (hidden products' lines dropped) | Lists products of a change | T053 |
  | Price book rows (`…/rows`, read and write) | **Accepted** for writes (FR-038); reads covered by the grid narrowing (T043, T044) | Owner ruling OQ-3: price-book edits by id are not refused | — |
  | `import_export` products export / import (`import_export/.../adapters/products.adapter.ts`) | **Refused (403)** for a non-unrestricted scope | An export lists the whole catalogue; an import by SKU writes a hidden product and its result is an oracle; narrowing a file format is out of scope | T054 |
  | Audit log and admin notifications naming products | **Accepted**, documented; overview warns when a mapped role holds `audit_logs:read` | Narrowing audit history needs its own spec; audit is an investigation surface | — |
  | Product feeds, CMS / blog / CRM / tasks product inputs | **Accepted** (FR-038, spec Out of Scope) | Already decided | — |

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Kernel change: membership governor inside `SalesChannelMembershipService` (platform package) | FR-054/FR-059 require that **no** writer other than the rule changes a governed channel, including connectors outside this repository that call `salesChannelMembershipPort`; the accessor is the only place every writer passes (Principle XII) | Refusing per caller in `catalog` misses connectors and `sales_channels`' generic routes; a periodic "repair" lets a product appear before admission (FR-059) |
| Products may end with zero channels when a governor removes or skips (exception to feature 005 FR-008's at-least-one-channel floor, products only, governed channels only) | FR-059 says a new product is on no governed channel until admitted; a rule must be able to remove a product from its only channel | Falling back to the default channel re-adds it to the (possibly governed) default — the exposure FR-059 forbids |
| Admin filtering lags price/designation changes (OQ-A) | See OQ-A | Live evaluation is seconds per page |
