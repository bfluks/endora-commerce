# Tasks: Megamenu navigation bar (feature 168)

**Input**: `spec.md`, `plan.md`, `data-model.md`, `contracts/megamenu-navigation.md`
**Tests**: TDD (Principle III) — each test task is written red before its implementation task.
**Status**: all tasks done (2026-10-29). Exceptions to red-first, stated rather than hidden:
T020's unit test and its implementation were written in one step; the T032 contract test was
written after the implementation and proven by mutation (bypassing the audience filter turns it
red); T060's demo-shop assertion was changed before the seed but not run red.

## Phase 1 — Foundation (contracts, schema, shared rule)

- [x] T001 [P] Contract tests for the new item shapes (kinds `group` / `category-tree`, presentation, alignment, audience, optional labels) and the resolved shape — `packages/contracts/src/megamenu-navigation.test.ts`
- [x] T002 Implement the shapes — `packages/contracts/src/megamenu.ts`, exports in `index.ts`
- [x] T003 [P] Move `effectiveCustomerGroupId` to `packages/contracts/src/customer-accounts.ts`; `price_lists`' `customer-group-rule.ts` re-exports it (its existing test stays the truth table)
- [x] T004 Integration test for the migration (columns, defaults, check constraints, backfill) — `backend/test/integration/megamenu/migration.test.ts`
- [x] T005 Migration + entity — `packages/modules/megamenu/src/migrations/`, `megamenu-item.entity.ts`; `composer:generate`

## Phase 2 — US1 + US2 backend (tabs, rules, kinds) — P1

- [x] T010 Unit tests for the tree rules: tab kinds, `link` tab rules, presentation only on tabs, required labels, warnings — `src/backend/services/tree-rules.test.ts`
- [x] T011 Implement `tree-rules.ts`; wire into `MegamenuItemService.setTree`; new error codes in the manifest and both i18n bundles
- [x] T012 Move every `MegamenuService` / `MegamenuItemService` write onto `CommandBus.run` (R-7); add `megamenu` to `MIGRATED_MODULES`; contract tests assert one audit entry per write — `backend/test/contract/megamenu/admin-audit.contract.test.ts`
- [x] T013 Update the existing megamenu contract/integration tests to the new request shape (tabs carry a presentation)
- [x] T014 Resolver: `presentation` / `alignment` on tabs, `group` items, a tab with no children and no URL dropped — `storefront-resolver` contract cases in `storefront-by-channel.contract.test.ts`

## Phase 3 — US3 + US4 backend (category trees, inherited labels) — P2

- [x] T020 Unit tests for the category-tree expansion (root/none, depth, sort order, inactive branch, localised names, synthetic ids) — `src/backend/services/category-tree.test.ts`
- [x] T021 Implement `category-tree.ts`; the resolver reads categories once (`listAll`) for trees and category links (SC-006)
- [x] T022 CMS port: test then implement `findStorefrontLinks` — `packages/modules/cms/src/backend/services/cms-page-read-port.test.ts`, `cms-page-read-port.ts`, `CmsPageReadPort` in contracts
- [x] T023 Resolver: inherited labels for `category-link`, `cms-page-link`; CMS links through `findStorefrontLinks` (localised name and URL) — integration test `backend/test/integration/megamenu/navigation-resolution.test.ts`

## Phase 4 — US5 backend (audiences) — P2

- [x] T030 Unit tests for the audience filter (four kinds, subtree hiding, deleted groups, effective group) — `src/backend/services/audience.test.ts`
- [x] T031 Implement `audience.ts`; the route resolves the caller's audience (group read only when needed), filters, strips, marks private — `routes.storefront.ts`; manifest `dependencies` + `customer_accounts`, `organizations`
- [x] T032 Contract test: guest / signed-in / group customer answers and `Cache-Control` — `backend/test/contract/megamenu/storefront-audience.contract.test.ts`
- [x] T033 Validation: an audience naming a missing group is refused on save

## Phase 5 — Admin editor (FR-021..024)

- [x] T040 Tests: presentation + alignment shown for tabs only, kinds offered per level, audience control with groups, category-tree fields, inherited-label placeholder — `admin/test/modules/megamenu/megamenu-editor-navigation.test.tsx`
- [x] T041 Implement in `MenuItemConfigPanel.tsx`, `MenuItemTree.tsx` (audience badge), `MegamenuEditor.tsx` (new item defaults); i18n en/pl

## Phase 6 — Storefront (US1, US2, US6)

- [x] T050 Tests: the bar renders tabs in order and alignment; `link` tab navigates; panels open by click/Enter, close by Escape; *More* overflow; no hard-coded chrome text — `storefront/test/components/NavigationBar.test.tsx`
- [x] T051 Tests: per-kind rendering and the three panel layouts — `storefront/test/components/MegamenuPanels.test.tsx`
- [x] T052 Implement `NavigationBar`, the three panels and `MenuItemView`; mount in `Header.tsx`; remove `CategoriesMega`, `Megamenu`, `MegamenuPanel`; storefront dictionary keys
- [x] T053 Tests then implementation: the mobile drawer lists tabs, `link` tabs navigate, groups as headings, translated chrome — `storefront/test/components/MegamenuMobileDrawer.test.tsx`
- [x] T054 `getActiveMegamenu` through `apiGetForViewer` (R-4) — `storefront/test/lib/megamenu-fetch.test.ts`

## Phase 7 — Default menu, docs, release

- [x] T060 Demo composition: the default menu in the new shape (FR-027) and its test
- [x] T061 Module docs EN + PL (translation cache rehashed)
- [x] T062 Changeset (contracts, mod-megamenu, mod-cms, mod-price-lists) with a **Breaking** line
- [x] T063 Verify: build:packages, typecheck, lint, targeted suites, `check:*`, `check:command-coverage`

## Owner review (2026-10-29)

- [x] T070 Panel contrast: rule `.industria-mega__list a span` removed, group headings in `text-muted`, `MenuButton` on the storefront `.btn` styles — test in `storefront/test/components/NavigationBar.test.tsx`
- [x] T071 Editor label *Kind* → *Type* (EN; PL was already *Typ*)
- [x] T072 *All in …* only for a category, in the side-list panel and the mobile drawer (`featuredRowText`)
- [x] T073 `catalog` presentation named *Panel with side list* / *Panel z listą po lewej* in the editor; the API value stays `catalog`
- [x] T074 `clickNavigates` (FR-005a): contracts, tree rule, migration `20261029T190956_megamenu_tab_click_navigates`, resolver, editor checkbox, storefront link + toggle — tests red first in each layer
- [x] T075 Hydration mismatch: a panel's id comes from its tab's id, not `useId` (the header's tree differs between server and client) — test in `storefront/test/components/NavigationBar.test.tsx`, red first
- [x] T076 End-aligned tabs: the end list really sits right (`m-0` on it outranked the component layer's `ml-auto`; now `my-0`) and stretches its tabs to the bar height; an end tab's dropdown opens from its right edge (`industria-dropdown--end`); tab widths are measured on every pass instead of frozen at the first read — tests in `storefront/test/components/NavigationBar.test.tsx`, red first (the measurement has no test: it is DOM layout, checked in Chrome)
- [x] T077 Rebase onto feature 167 (language in the URL path): every link the bar, its panels and the drawer render goes through `LocalizedAnchor` / `LocalizedLink` — `storefront/test/i18n/megamenu-links.test.tsx` (167's test, rewritten from the removed `CategoriesMega` to the bar), red first; `findStorefrontLinks` answers the page's logical path in the language, with no `?lang=`, so the storefront prefixes it like a category link and the cached menu holds no channel URL facts — `page-paths.test.ts`, `navigation-bar.contract.test.ts`
