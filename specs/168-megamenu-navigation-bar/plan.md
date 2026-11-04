# Implementation Plan: Megamenu navigation bar — tabs, columns, category trees and audiences

**Branch**: `feat/522-megamenu-navigation` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/168-megamenu-navigation-bar/spec.md`

## Summary

Turn the megamenu's top-level items into the tabs of a horizontal navigation bar, each with a
presentation (`link`, `dropdown`, `mega`, `catalog`) and an alignment; add the `group` and
`category-tree` kinds; inherit labels from targets; and give every item an audience. The
storefront replaces its single *Wszystkie kategorie* trigger with one bar component that
renders each kind as itself. Every menu write moves onto the Command Bus.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis; React 19 (admin),
Next.js 15 App Router (storefront). **No new dependency.**
**Storage**: PostgreSQL — three columns on `megamenu_items`; Redis read-through cache
(existing `MegamenuCache`)
**Testing**: Vitest — module unit tests beside their subjects, backend contract and
integration suites, admin and storefront Testing Library suites
**Target Platform**: backend API, admin SPA, storefront SSR
**Project Type**: web (backend + admin + storefront + packages)
**Performance Goals**: SC-006 — one catalogue read per menu resolution, however many
categories a tree expands to; one CMS read for every page link of the menu
**Constraints**: no item a visitor may not see leaves the API (FR-019); anonymous responses
stay cacheable (Principle VII)
**Scale/Scope**: menus of tens of tabs and hundreds of items; catalogues of thousands of
categories

## Constitution Check

| Principle | Status | Note |
| --- | --- | --- |
| I. Modular architecture (NN) | ✅ | Cross-module reads through published ports only: `catalogCategoryReadPort`, `cmsPageReadPort` (one new method), `customerAccountReadPort`, `organizationDetailsPort`. |
| II. API-first | ✅ | Shapes change in `packages/contracts/src/megamenu.ts` first. A breaking change, allowed by the owner (FR-028), declared `major` for `@endora-commerce/contracts`? — see *Complexity Tracking*. |
| III. TDD (NN) | ✅ | Every FR is traced to a test in `tasks.md`; each test is written red first. |
| IV. YAGNI | ✅ | No dependency. Organisation allow-list, badges, scheduling stay out (spec A-1, A-4). |
| VI / VIII | ✅ | English code and docs; Polish only in the PL bundles and docs mirror. |
| VII. SEO & performance | ✅ | The anonymous menu stays cacheable; the bar is server-rendered HTML with links crawlers follow. |
| IX. UI reuse | ✅ | Admin: `CustomerGroupPicker`, `CategorySelect`, `CmsPagePicker`, existing `Select`/`Label`. Storefront: existing `MenuButton`, `MenuAsset`, `MenuCmsBlockEmbed` and the `industria-nav` / `industria-mega` styles. |
| XI. Multi-tenant isolation (NN) | ✅ | Menu entities stay `@GlobalEntity()`. The audience is derived from the server-resolved actor, never from the request. |
| XII. Sales-channel scoping (NN) | ✅ | Resolution stays per resolved channel; CMS page links resolve in that channel's page tree. |
| XIII. Command Bus (NN) | ⚠️ → ✅ | **Planning amendment**: no megamenu write runs a Command today and `megamenu` is absent from `MIGRATED_MODULES`. This feature moves every write of the module onto `CommandBus.run` and adds the module to the list — see R-7. |
| XVI. Command palette | ✅ | No new surface. |
| XVII. Module activation (NN) | ✅ | `customer_accounts` and `organizations` are non-deactivatable; adding them to `dependencies` costs no operator a control. The spec's "customer_accounts off" edge case cannot occur and is removed (planning amendment). |

## Decisions (research)

- **R-1 Presentation lives on the item row**, as two nullable columns plus a check constraint
  (both set exactly when `parent_id is null`). Rejected: a separate `megamenu_tabs` table — it
  would split one tree into two and complicate the full-overwrite save (feature 015 R4).
- **R-2 Audience is one `jsonb` column**, `{ kind: 'everyone' | 'guests' | 'signed_in' }` or
  `{ kind: 'customer_groups', customerGroupIds: uuid[] }`, default `{"kind":"everyone"}`.
- **R-3 The resolver resolves the whole tree once per (channel, language)** — every audience's
  items included, with their audience kept on an internal field — and caches that. The route
  then **filters by the request's audience** and strips the internal field. One cached entry
  serves every visitor; no audience-keyed cache multiplies entries.
- **R-4 Caching per audience**. The backend sets `Cache-Control: private, no-store` on a
  response for an identified caller, as `markPersonalisedPricing` does for prices. The
  storefront fetches the menu with `apiGetForViewer`: no session → the existing
  `revalidate: 60` + tag; a session → `no-store` with the cookie forwarded. The anonymous menu
  is therefore never served to a signed-in buyer and vice versa (FR-019).
- **R-5 Effective customer group, one rule**. `effectiveCustomerGroupId` moves from
  `price_lists`' `customer-group-rule.ts` into `@endora-commerce/contracts`
  (`customer-accounts.ts`); `price_lists` re-exports it, so pricing and navigation cannot
  disagree about a buyer's group. The megamenu route reads the customer's account
  (`customerAccountReadPort`) and organisation (`organizationDetailsPort`) **only when the
  cached tree contains a `customer_groups` item** and the caller is a signed-in customer.
- **R-6 Category trees expand from one read**: `catalogCategoryReadPort.listAll({ liveOnly:
  true })` once per resolution, shared by every `category-link` and `category-tree` of the
  menu, indexed by id and by parent. An inactive category ends its branch. Expanded nodes get
  the id `<tree item id>:<category id>`, so the resolved `id` becomes a string rather than a
  uuid (breaking, allowed). `category-tree` never appears in a resolved tree: its expansion is
  spliced into its parent's children at its position.
- **R-7 Command Bus migration**. Every write of `MegamenuService` and `MegamenuItemService`
  runs inside `commandBus.run` with actions `megamenu.create`, `megamenu.update`,
  `megamenu.delete`, `megamenu.items.set`, `megamenu.binding.add`, `megamenu.binding.remove`,
  `megamenu.binding.activate`, `megamenu.binding.deactivate`, object type `megamenu`, and an
  audit state that carries the menu's metadata and, for `items.set`, the item tree (kind,
  presentation, alignment, audience, target, labels). The cache drop stays after the Command,
  as in `cms`. `megamenu` joins `MIGRATED_MODULES`.
- **R-8 CMS page links in the served language** need the page's localised name and its
  address in the channel's page tree (feature 163 R19D and R24), which `CmsPageRecord` does not
  carry. `CmsPageReadPort` gains `findStorefrontLinks(ids, { salesChannelId, language,
  channelDefaultLanguage })` → `{ id, name, url }[]`, implemented in `cms` with
  `loadChannelPageNodes`, `channelPaths`, `cmsLocalizedPage` and `cmsPageUrl`. This also
  repairs the megamenu half of feature 163 T478 (links built as `/<slug>`). The branch is
  therefore **stacked on `feat/521-cms-page-translations`** (PR #536).
- **R-9 One storefront renderer**. A new `NavigationBar` (client component, needed for hover
  intent, overflow measurement and keyboard handling) replaces `CategoriesMega`, `Megamenu`
  and `MegamenuPanel`. Panels are three components — `DropdownPanel`, `MegaPanel`,
  `CatalogPanel` — over shared item renderers. Overflow (*More*) is measured with a
  `ResizeObserver` on the bar; server HTML renders every tab, so crawlers and no-JS visitors
  see them all.
- **R-10 No data migration of stored menus** (owner, FR-028). The migration backfills
  `presentation = 'mega'`, `alignment = 'start'` on existing top-level rows so the new check
  constraint holds; nothing else is converted. The demo composition re-creates its menu.

## Project Structure

### Documentation (this feature)

```text
specs/168-megamenu-navigation-bar/
├── spec.md
├── plan.md              # this file
├── data-model.md
├── contracts/
│   └── megamenu-navigation.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/contracts/src/
├── megamenu.ts                     # kinds, presentation, alignment, audience, resolved shape
├── customer-accounts.ts            # effectiveCustomerGroupId (moved, R-5)
└── cms.ts                          # CmsPageReadPort.findStorefrontLinks (R-8)

packages/modules/megamenu/
├── src/manifest.ts                 # + customer_accounts, organizations; new error codes
├── src/migrations/<ts>_megamenu_navigation_bar.ts
├── src/backend/entities/megamenu-item.entity.ts
├── src/backend/services/
│   ├── tree-rules.ts (+ .test.ts)          # FR-001..003, FR-012, FR-016 refusals
│   ├── audience.ts (+ .test.ts)            # FR-017..020 filter
│   ├── category-tree.ts (+ .test.ts)       # R-6 expansion
│   ├── storefront-resolver.ts              # labels, trees, CMS links, audience kept internal
│   ├── megamenu-item-service.ts            # Command Bus, rules
│   └── megamenu-service.ts                 # Command Bus
├── src/backend/routes.storefront.ts        # audience filter, private marking
├── src/admin/components/                   # presentation, audience, category-tree fields
├── i18n/{en,pl}.json
└── docs/megamenu/index.md

packages/modules/cms/src/backend/services/cms-page-read-port.ts   # findStorefrontLinks
packages/modules/price_lists/src/backend/services/customer-group-rule.ts  # re-export

storefront/components/Megamenu/
├── NavigationBar.tsx               # replaces CategoriesMega, Megamenu, MegamenuPanel
├── panels/{DropdownPanel,MegaPanel,CatalogPanel}.tsx
├── MenuItemView.tsx                # per-kind rendering
└── MegamenuMobileDrawer.tsx        # tabs at the root, groups as headings
storefront/lib/api/megamenu.ts      # apiGetForViewer
storefront/components/Header.tsx    # mounts NavigationBar, drops hard-coded Quick Order

packages/demo-composition/src/      # default menu in the new shape (FR-027)
backend/test/{contract,integration}/megamenu/   # updated + new audience/tree cases
backend/scripts/check-command-coverage.ts       # + 'megamenu'
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Breaking change to the megamenu contract (`ResolvedMenuItem.id` a string, required `presentation` on tabs, `labels` optional) | Owner ruled compatibility out (FR-028); synthetic ids are how category-tree nodes are addressed | Keeping uuids would need persisted rows per category, i.e. the manual upkeep the feature removes. Declared in the changeset; the platform's packages version together (0.x), so it ships as a `minor` with a **Breaking** line, as earlier 0.x breaking changes did. |
| Command Bus migration of the whole module | Principle XIII is non-negotiable and the feature rewrites the module's main write | Migrating `items.set` alone would leave the module half-audited and still outside `MIGRATED_MODULES`. |
| Stacking on PR #536 | R-8 needs R24's localised page fields | Shipping `/<slug>` links would knowingly keep T478's defect in a feature that rewrites them. |
