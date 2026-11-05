# Implementation Plan: product data scopes per sales channel and language

**Branch**: `feat/163-product-data-scopes` (from `origin/master`) | **Date**: 2026-10-21 | **Spec**:
`specs/163-product-data-scopes/spec.md` (clarify rounds 1–4, Session 2026-10-25)
**Input**: Feature specification from `specs/163-product-data-scopes/spec.md`; issue #385; depends on #384
(`fork/fix/storefront-channel-value-overrides`, `f855ffc8a`, not yet on `master`).
**Measured on**: `origin/master` `aa6891d63`.

> **Renumbered from 159, then from 162.** `origin/master` holds `specs/159-quote-request-item-groups/`, so this feature
> was renumbered to 162 before its first push; `origin/master` then took `specs/162-custom-fields-value-carry/`
> (PR #401), so it was renumbered again to 163. `.specify/feature.json` on this branch is left at
> `origin/master`'s value so that merging never repoints master's feature pointer.

## Summary

Make status, publication window, audience, URL key, SEO, media roles/visibility, translated labels, MOQ and
returnable settable per scope (global / language / channel / channel × language, per FR-009) with
inheritance along the existing chain, and make **every** storefront and buyer-facing consumer read the
effective (channel, language) value.

Technical approach (research R1–R30):

- **Typed scope tables owned by `catalog`** — `product_channel_scopes` (one row per product × channel:
  status, window pair, audience pair, MOQ, returnable; `NULL` = inherit) and
  `product_channel_language_scopes` (status at C×L); a global window on `products`. No JSONB `{v}` rows, so
  availability is plain, indexable SQL (FR-016).
- **One availability definition** — a pure rule in `packages/contracts/src/product-scopes.ts` and its SQL
  restatement in catalog, held equal by a generated-grid parity test (the `isProductVisibleTo` /
  `#audienceCondition` pattern). Every other module asks catalog through one port,
  `catalogProductAvailabilityPort`, replacing their own status/channel/audience checks (FR-002).
- **Search** keeps one index per channel; documents carry `liveLanguages` and the window as filterable
  fields evaluated **in the index filter** at query time; a 5-minute window sweep emits
  `product.updated.v1` for webhook/feed consumers (FR-024, SC-005).
- **URL keys** — `products.slug` stays the global key; `product_url_keys` (language and C×L keys) and
  `product_url_redirects` (catalog-owned); uniqueness per language across all channels enforced in the write
  Command under per-key advisory locks; redirects never chain; serving a redirect requires `seo` to be
  present (FR-111) while writes keep the invariant regardless.
- **SEO per C×L** in `seo` (channel column + port), wired into the PDP for the first time (R0 F2); `seo`'s
  override writes move from hand auditing onto the Command Bus first (R13, analyze C1).
- **Media, attachments, packaging units** — additive per-channel tables and per-language JSONB columns.
- **Effective names** (FR-017) — #384's walk restated as SQL for listing search/filter/count/sort, and a
  port method for snapshots.
- **Status model (owner Q1, 2026-10-25; R3, R30)** — `active` | `inactive` at every scope, `draft` removed
  with no alias; `inactive` is plain off everywhere and never archives; archiving is a separate global
  Archive / Restore pair of Commands (`product.archive` / `product.restore`, `POST …/products/:id/archive` /
  `…/restore`, bulk `fields.archived`) on the existing `archived_at`; one catalog migration converts the
  data (`archived_at` backfill on today's `inactive`, then `draft` → `inactive`) and narrows the `CHECK`s.
- **No backfill of the new tables, no new dependency, no new permission code, no new cache.** The one data
  conversion is the status value set above.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ, Meilisearch (backend);
React 19 + Vite through `@endora-commerce/admin-kit` (admin); Next.js 15 App Router (storefront) — **no new
runtime dependency**
**Storage**: PostgreSQL — catalog: seven new tables (`product_channel_scopes`,
`product_channel_language_scopes`, `product_url_keys`, `product_url_redirects`,
`gallery_item_channel_labels`, `gallery_item_channel_hidden`, `product_attachment_channel_hidden`), columns on `products`, `gallery_items`, `product_attachments`,
`product_packaging_units`, and the status value set narrowed in `products` and both scope tables by one data
migration (R30.1, R30.2); seo: one column + nullable `locale` on `seo_meta_overrides`; Redis — one BullMQ
Job Scheduler and one watermark key; Meilisearch — five document fields
**Testing**: Vitest — pure rules co-located in `packages/contracts/src/*.test.ts`; module unit tests in
`packages/modules/<id>/src/backend/**`; `[PG]` contract/integration tests in
`backend/test/{contract,integration}/<module>/` (run in fork `ci-pg`); perf in `backend/test/perf/catalog/`;
admin in `admin/test/modules/catalog/`; storefront in `storefront/test/`
**Target Platform**: Linux server; backend, admin SPA, storefront
**Project Type**: web application — monorepo
**Performance Goals**: SC-004 — storefront listing and search within +10% at the performance targets'
catalogue size with overrides on 20% of products (benches `backend/test/perf/catalog-list.bench.ts` and
`backend/test/perf/catalog/listing-scoped-availability.bench.ts`); SC-005 — window reflected on the storefront within 5 min (immediate by construction) and in
search within 15 min (immediate by query-time filter)
**Constraints**: every refusal at a buyer seam stays the single `PRODUCT_NOT_FOUND`; channel resolved or
fail closed (XII); deploy changes no storefront behaviour except the four listed under *Intended behaviour
changes* (R21)
**Scale/Scope**: 12 modules touched (`catalog`, `search`, `seo`, `product_feeds`, `comparisons`, `carts`,
`orders`, `quote_requests`, `shopping_lists`, `quick_order`, `cms` (verify only), `import_export`), plus
`packages/contracts`, `admin`, `storefront`

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — unchanged; re-checked after the owner's Q1
(2026-10-25, Block Q) — unchanged, the one break being owner-decided and versioned (II).*

| Principle | How the design satisfies it |
| --- | --- |
| I. Modular (NN) | Scope data and URL keys owned by `catalog`; SEO overrides stay `seo`'s. Other modules use ports (`catalogProductAvailabilityPort`, `catalogProductUrlKeyReadPort`, `catalogProductScopeWritePort`, `seoProductMetaPort`) declared as edges; no raw reach into another module's table (`check:module-boundary`) |
| II. API-first | Every shape is a Zod schema in `packages/contracts` (`product-scopes.ts`, `product-url-keys.ts`, `seo.ts`) before code. Additive **except one owner-decided break** (Q1, 2026-10-25): `productStatusSchema` narrows to `active` / `inactive`, the `archived` write alias and `productStatusWriteSchema` go, the admin list's `counts.draft` becomes `counts.archived` — shipped as breaking changesets (see *Compatibility and release*) |
| III. TDD (NN) | Each phase's RED tests precede implementation; requirement → test map below |
| IV. YAGNI / deps | No new dependency; no projection table, no cache, no new event type, no new permission code |
| V / VI / VIII | TypeScript; names follow the conventions (`check:naming`); English everywhere except the Polish bundles/docs |
| VII. SEO | Localised keys, permanent redirects, no chains, canonical + `hreflang` alternates with the effective key (FR-074) |
| IX. UI reuse | Scope controls extend `ProductScopeEditor.tsx`; overview and bulk dialog reuse admin-kit primitives |
| X. Queues | The window sweep is a BullMQ Job Scheduler through `ctx.worker` (`price-list-status-worker.ts` shape); bulk scoped status rides `BulkOperationService` |
| XI. Tenancy (NN) | New tables platform-global like `products`; audience evaluated at read time against the buyer's organization; no no-organization path introduced |
| XII. Channel scoping (NN) | Membership read only through the kernel accessor (subquery / filter); unresolved channel matches nothing (FR-007); cross-channel tests for every FR-004 consumer |
| XIII. Command Bus (NN) | Every scoped write, URL-key write, redirect delete, takeover, SEO override upsert/delete (converted from today's hand audit, R13), Archive / Restore single and bulk (`product.archive` / `product.restore`, R30.3) and bulk run is a Command, one audit entry per product with a complete before/after projection (FR-080); bulk runs undo through the existing bulk-operation undo, single writes have no undo and restore from the audit before-state (R29; owner Q-D → A) |
| XIV. Extensibility | Typed columns are justified (filterability, R1) — these are core commerce fields, not "add a field" requests |
| XV. Untouched core | Core feature; no overlay |
| XVI. Palette | Overview and scope controls are part of the product editor, reached by the existing `open-products` action (keywords extended); `targetRoute` cannot carry a product id (R23) |
| XVII. Toggleable (NN) | `catalog` non-deactivatable; `seo` off ⇒ redirects and SEO overrides not served, data kept, writes unaffected (FR-111), declared as `degrades-without`; consumers' off-states unchanged |

**Verdict: PASS.** No violation; Complexity Tracking records none.

## Deviations from the spec, and reinterpretations

- **D1 — SEO overrides start being served (R0 F2, R13).** No longer a deviation: US8 #2 now states that
  existing per-language overrides are served from deploy and that those pages' metadata changes as intended
  (owner Q-A → serve, 2026-10-21; spec reworded 2026-10-22). Kept here as the pointer to *Intended behaviour
  changes* 4, which the deploy-parity test T144 asserts.
- **D2 — Basket add gains a status check (R0 F1).** SC-001's parity statement is extended to name it.
- **D3 — Alt text is product-scoped per language (R15)**, falling back to the asset's own alt text, which is
  what "the global alt text" means in US9 #3.
- **D4 — FR-042 "discoverable in the command palette"** is met by the product editor's existing palette
  action; no per-product palette route is possible.
- **D5 — FR-091 connectors** are outside this repository (R0 F4); this feature ships the catalogue write
  port and its issue vocabulary, plus CSV import/export round-trip of scoped status (FR-092).
- **D6 — "name sort"** today orders by slug (`keysetFor('name')` → `{ slug, id }`); FR-017 (b) makes it the
  effective name at (C, L), which changes the order wherever slug and name disagree. Recorded in the
  release note.
- **D7 — Emitted product URLs carry `?lang=<L>`** when L is not the channel default (R0 F3), so K1's
  not-found for a key of another language does not hit links the platform itself produces. Every emitter
  goes through one backend-called helper, `productPath()` in `packages/contracts/src/product-url-keys.ts`
  (R12); the storefront receives ready paths (resolve `path`, PDP `paths`), so the owner's
  language-path-prefix issue (Q-B → C) replaces one function for every emitted URL.
- **D8 — Undo of a scoped write (R29).** The tree has undo only for bulk operations. Bulk scoped writes
  use it; single writes are Commands whose audit before-state is complete and is restored by re-applying
  it — no single-write undo. **Decided by the owner (Q-D → A, 2026-10-22)**; FR-081 and US1 #8 now say
  exactly this, so it is no longer a deviation.
- **D9 — The admin attribute editor gains the two scope flags (R27, analyze H2).** No admin surface edits
  `channelScoped` / `languageScoped` today; FR-090's preview needs the control it previews.

## Intended behaviour changes (listed beside SC-001; the deploy-parity test T144 asserts exactly these)

1. **A product that is off and not archived can no longer be added to a basket** (D2, R0 F1) — basket add
   checks no status today. After the Q1 migration this is today's `draft` products, now `inactive`.
2. **A product that is off and not archived is no longer reachable by URL** (FR-005) — its slug answers
   not-found (T038, T156s); today a `draft` member is reachable.
3. **Listing "name sort" sorts by the effective name** at (C, L), not by slug (D6), wherever slug and name
   disagree.
4. **Existing per-language SEO overrides start being served** on product pages (D1, Q-A): those products'
   title, description and Open Graph tags change to the values operators entered.

Operator-visible changes of the Q1 status model (spec *Compatibility and release*). They are not
deploy-parity exceptions: no product's storefront answer changes at deployment because of them (SC-009).

5. **Setting `inactive` switches a product off without archiving it**, and setting `active` never restores an
   archived one: every product archived before this feature — every product `inactive` today — needs an
   explicit Restore (O-5).
6. **New and duplicated products start `inactive`**, and the admin list hides archived products by default
   behind an *Archived* filter of its own (FR-010, FR-113).

Deploy-parity exceptions found by T144 and accepted by the owner on 2026-10-27 (spec Session 2026-10-27).
Like 1–4 they change a storefront answer at deployment; `deploy-parity.test.ts` asserts them.

7. **The 410 of an archived product is answered only to a caller who could see it were it not archived**
   (a channel member, inside the product's audience); everyone else gets the absent product's
   `404 PRODUCT_NOT_FOUND` (T036's deviation, security checkpoints A and B). Before this feature every
   `inactive` product answered 410 to everyone, before the channel or the audience was tested.
8. **An archived product can no longer be added to a basket** — refused like an absent id. Before this
   feature basket add checked no status (R0 F1), so today's `inactive` products were addable and only
   placement refused them; item 1 covers the off-and-not-archived half. A consequence of Q1: archived means
   gone from every channel.

## Questions for the owner (not decided here)

- **Q1 — decided 2026-10-25** (spec Session 2026-10-25, with O-1…O-6): `active` / `inactive` at every
  scope, `draft` removed with no alias, `inactive` plain off everywhere, archiving a separate global
  Archive / Restore action, today's `inactive` products stay archived (`archived_at` backfilled from
  `updated_at`), new and duplicated products `inactive`. Designed in R30; built as Block Q of `tasks.md`.
  Four consequences of the design; three were settled by the coordinator on 2026-10-25 during analyze, and
  none blocks Block Q:
  - **Changeset level — settled.** D-225 refuses `major` in `0.x`; the break is recorded at `minor` with a
    body marked BREAKING (R30.6). The spec's *Compatibility and release* was reworded to say so.
  - **`products_status_check` — accepted.** The plan adds a database `CHECK` so SC-009 holds after a rolling
    deploy too (R30.2, data-model §13).
  - **The admin product list today shows archived rows under "All"** (the page always sends
    `includeArchived=1`); FR-113's "hidden by default" (owner O-2) therefore changes what operators see on
    that screen, not only in the API (R30.4). This follows from O-2 as answered; it is listed for the owner
    to notice at acceptance, not as an open question.
  - **Bulk undo emits domain events — accepted as part of Phase 9b.** Today it emits none for any field,
    which leaves search, feeds and webhooks stale after an undo; undoing a bulk Archive must be announced
    (FR-082), so the undo emits `product.updated.v1` per reverted product for every field (R30.3, T156k,
    T156m).
- **Q-A — decided 2026-10-21: serve** existing per-language SEO overrides (D1; *Intended behaviour
  changes* 4).
- **Q-B — decided 2026-10-21: option C, as a separate issue.** A language prefix in the storefront path
  (`/en/p/drill`) is out of scope for 163. 163 keeps the interim: `?lang=<L>` on every URL the platform
  emits (canonical, alternates, sitemap, redirect targets, admin preview) when L is not the channel default,
  through the one `productPath()` seam (D7); **no** cross-language rendering. **Accepted residual gap**
  until the prefix issue lands: a link without `?lang` (typically a default-language link) opened by a
  browser whose language resolves to another channel language answers not-found under K1, once the product
  holds its own key in that language (R12).
- **Q-C — decided 2026-10-21: hide.** With `seo` off the redirect list is not shown (`GET …/url-keys` omits
  `redirects`); redirect data stays in catalog and keeps reserving keys; the takeover confirmation is part of
  the catalog URL-key editor, keeps working with `seo` off and names the product that loses the redirect
  (R12).
- **Q-D — decided 2026-10-22: option A.** No single-write undo: bulk scoped writes undo through the
  existing bulk-operation undo; a single write is restored from its audit before-state (D8, R29, FR-081). A
  generic single-Command undo is out of scope (a possible future issue).
- **M3 — decided 2026-10-22: option A.** Only a status write that turns a (C, L) on fires the completeness
  gate — not joining a channel, a channel gaining a language, a window opening or an audience change;
  the scope overview shows per cell what the gate would report missing (R18, FR-041, FR-060).

## Requirement → test (abridged; every FR maps to at least one test in `tasks.md`)

| FR / SC | Test |
| --- | --- |
| FR-001, FR-002, FR-016 | `packages/contracts/src/product-scopes.test.ts`; `backend/test/integration/catalog/availability-parity.test.ts` [PG] |
| FR-004, FR-005, FR-007, SC-007 | `backend/test/contract/catalog/scoped-availability-matrix.test.ts` [PG] (listing, facets, PDP, quick search, links/related, bundle configuration × 2 channels × 2 languages, plus the search-backend-off case); Meilisearch search in `backend/test/integration/search/scoped-availability.test.ts`; CMS product blocks in `backend/test/contract/cms/product-block-scoped-availability.test.ts`; consumer tests per row of `contracts/consumers.md`; `…/scoped-availability-all-consumers.test.ts` |
| FR-006, FR-018 | `backend/test/integration/carts/scoped-availability.test.ts`, `backend/test/integration/quote_requests/scoped-availability.test.ts` [PG] |
| FR-008–FR-015 | `backend/test/contract/catalog/product-scopes-api.test.ts` [PG] |
| FR-017 | `backend/test/integration/catalog/effective-text-parity.test.ts`, `…/listing-effective-names.test.ts`, carts/RFQ snapshot tests [PG] |
| FR-023, FR-024, SC-005 | `product-scopes.test.ts` (inclusive edges); `backend/test/integration/catalog/publication-window-sweep.test.ts` [PG] |
| FR-030 | `product-scopes-api.test.ts` (whole-rule override, non-member warning) |
| FR-040–FR-043 | `admin/test/modules/catalog/product-scope-*.test.tsx`; `registered-bundles-shape.test.ts`; FR-041's per-cell `missing` in `…/contract/catalog/scope-completeness-gate.test.ts` [PG] (T078) and `product-scope-overview.test.tsx` (T093) |
| FR-050–FR-052, SC-006 | `backend/test/contract/catalog/products-bulk-scoped-status.test.ts` [PG] |
| FR-060, FR-061 | `packages/contracts/src/product-scopes.test.ts` (`pairsTurningOn`, M3 non-trigger cases); `packages/modules/catalog/src/backend/services/scope-completeness.test.ts`; `…/contract/catalog/scope-completeness-gate.test.ts` [PG] |
| FR-070–FR-074, FR-093, SC-008 | `backend/test/integration/catalog/url-key-uniqueness.test.ts`, `…/url-key-resolution.test.ts` [PG]; `storefront/test/catalog/pdp-redirect.test.ts` |
| FR-075 | `backend/test/integration/seo/meta-channel-scope.test.ts` [PG] |
| FR-080 (SEO writes) | `backend/test/contract/seo/meta-override-commands.test.ts` [PG] |
| FR-076–FR-079 | `backend/test/contract/catalog/media-scopes.test.ts`, `…/attachment-packaging-translations.test.ts` [PG] |
| FR-080–FR-082 | Command/audit before-after assertions inside each write test; bulk undo in `products-bulk-scoped-status.test.ts`; events in `product-scopes-api.test.ts` |
| FR-090–FR-092 | `attribute-scope-change-preview.test.ts`, `admin/test/modules/catalog/AttributesManager.scope-flags.test.tsx`, `scope-write-port.test.ts`, `bulk-import-scoped-status.test.ts` [PG] |
| FR-100 | `backend/test/integration/carts/channel-order-rules.test.ts`, `…/orders/channel-returnable.test.ts` [PG] |
| FR-110, SC-001 | `backend/test/integration/catalog/deploy-parity.test.ts` [PG] |
| FR-111 | `backend/test/integration/catalog/url-redirects-seo-off.test.ts` [PG] |
| SC-004 | `backend/test/perf/catalog/listing-scoped-availability.bench.ts` against `backend/test/perf/catalog-list.bench.ts` |
| FR-010, FR-019, FR-082 (Archive / Restore), FR-112 | `packages/contracts/src/catalog-product-status.test.ts`; `backend/test/contract/catalog/product-archive-restore.test.ts` [PG] |
| FR-053 | `backend/test/contract/catalog/products-bulk-archive.test.ts` [PG]; `admin/test/modules/catalog/product-archive-restore.test.tsx` |
| FR-110 (Q1), SC-009 | `backend/test/integration/catalog/product-status-drop-draft-migration.test.ts` [PG]; `deploy-parity.test.ts` |
| FR-113 | `backend/test/contract/catalog/products-admin-list-archived.test.ts` [PG]; `admin/test/modules/catalog/products-list-archived.test.tsx` |

## Project Structure

### Documentation (this feature)

```text
specs/163-product-data-scopes/
├── spec.md, checklists/requirements.md
├── plan.md            # this file
├── research.md        # R0–R30
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── product-scopes.md          # rule, port, SQL, scope language
│   ├── admin-scopes-api.md        # scopes, overview, bulk, gate, FR-090 preview
│   ├── url-keys-and-redirects.md
│   ├── consumers.md               # every FR-004 / FR-017 seam
│   ├── seo-media-attachments.md
│   └── error-codes.md
└── tasks.md
```

### Source code touched

```text
packages/contracts/src/
  product-scopes.ts (+ .test.ts)          # new: rule, shapes, ports, scope language
  product-url-keys.ts (+ .test.ts)        # new: URL-key shapes, resolution union
  catalog.ts                              # bulk scopedStatus, record publishFrom/Until (additive)
  seo.ts                                  # seoProductMetaPort
  errors.ts, index.ts
packages/modules/catalog/
  src/manifest.ts                          # settings block, errorCodes, nonBindingDependencies (seo), action keywords
  src/migrations/<stamp>_catalog_{product_scopes,product_url_keys,product_media_scopes,attachment_packaging_translations,product_status_drop_draft}.ts
  src/backend/entities/{product-channel-scope,product-channel-language-scope,product-url-key,product-url-redirect,
                        gallery-item-channel-label,gallery-item-channel-hidden,product-attachment-channel-hidden}.entity.ts
  src/backend/services/{product-scopes.service,product-availability.service,product-availability.sql,
                        effective-value.sql,scope-completeness,url-key.service,url-key-resolution.service,
                        publication-window-sweep,scope-overview.service}.ts (+ tests)
  src/backend/services/{catalog-query,catalog-quick-search,catalog-admin,catalog-bulk-update,bulk-operation,
                        gallery,attachment,packaging-unit,catalog-bulk-import,catalog-product-read}.ts
  src/backend/{index.ts,routes.admin.ts,routes.public.ts}
  src/admin/components/{ProductScopeEditor,ProductScopeOverview,ProductUrlKeysPanel,ProductsBulkEditDialog,
                        ProductOrderRulesCard,PackagingUnitsEditor}.tsx, src/admin/pages/{ProductEditor,ProductsList}.tsx
  i18n/{en,pl}.json; docs/catalog/{per-channel-per-language-overrides,url-keys-and-redirects}.md
packages/modules/seo/        migration, entity, commands/seo-meta-override.commands.ts (new), meta-tag-resolver, routes, port,
                             sitemap-generator, admin SEO panel, i18n, docs
packages/modules/search/     search-indexer.ts, search-query.service.ts, docs
packages/modules/{carts,orders,quote_requests,comparisons,shopping_lists,quick_order,product_feeds}/  seam swaps
packages/modules/import_export/ (+ catalog-bulk-import)  scoped status columns
storefront/app/(catalog)/p/[slug]/page.tsx, storefront/lib/api/catalog.ts
backend/test/{contract,integration,perf}/…   # per tasks.md
docs/i18n/pl/…, docs/translation-cache/pl/…  # Polish mirrors
.changeset/*.md
```

**Structure Decision**: extend `catalog`, `seo` and `search`; no new module. Scope data is product data
and its owner is the catalogue (Principle I by domain ownership); the redirect table stays with the key
invariant it belongs to (R12).

## Migrations (by owner; order by manifest graph, never by number)

1. `catalog` `product_scopes` — two tables + two `products` columns (Phase 3).
2. `catalog` `product_url_keys` — two tables (Phase 16).
3. `seo` `meta_override_channel_scope` — column, nullable locale, uniques (Phase 18). `seo` already
   depends on what its FK needs, or the drift test names it.
4. `catalog` `product_media_scopes` (Phase 21) and `attachment_packaging_translations` (Phase 22).
5. `catalog` `product_status_drop_draft` (Phase 9a, R30.1–R30.2) — `archived_at` backfill, `draft` →
   `inactive` in `products` and both scope tables, the scope `CHECK`s replaced, `products_status_check`
   added, default `inactive`. A **new** migration: `…_catalog_product_scopes` is not amended, because a
   database that already ran it would never re-run an edited body.

Each: scaffold → entity → `composer:generate` → `manifests:generate` → `pnpm install --lockfile-only` →
commit artefacts together.

## Delivery shape (details in `tasks.md`)

- **#384 gate.** Phases 1–4 and 13 do not touch #384's files and start now. Phases 5+ (catalog query,
  search query, resolver, overrides doc) wait for #384 on `master` and a rebase — or the branch stacks on
  `fork/fix/storefront-channel-value-overrides` if the coordinator prefers.
- **Streams.** S1 backend availability (primary checkout), S2 URL keys + SEO, S3 admin UI — each in its own
  worktree, file ownership listed in `tasks.md`; shared files (contracts barrel, `catalog/src/backend/index.ts`,
  `routes.admin.ts`, catalog i18n bundles, manifest, generated registries, lockfile, AGENTS.md appendix) are
  S1's; S2/S3 hand over their lines at phase boundaries.
- **Review checkpoints** after every backend block and every UI block.
- **Block Q (owner Q1, 2026-10-25).** Phases 9a–9b run on S1 after Phase 9 and before Phase 10 (P10–P11
  build on the two-value set and the rewritten global status path); Phase 9c — the PDP's 410 condition, the
  block's only edit of `catalog-query.service.ts` — is **S2's, done inside Phase 17** (coordinator,
  2026-10-25), beside T110's edit of the same method; S3's Phase 15a runs after 9b and before Phase 15.

## Risks

1. **SC-004.** Two keyed sub-selects plus coalesced window/audience per listed row, and effective-name
   coalesces for search/sort, on a large catalogue. Mitigation: indexes on the scope PKs, a benchmark phase
   before the UI blocks; fallback is the projection of R1 (a plan change, not an emergency).
2. **Search reindex.** New document fields need one reindex per channel; until then the `NOT EXISTS`
   clause keeps pre-deploy behaviour (R8) — but C×L status and windows are not applied by search until the
   reindex runs. Release note + operator step.
3. **Shared links across languages (Q-B → C, accepted).** Until the language-path-prefix issue lands, a
   link without `?lang` opened in another channel language answers not-found once the product holds a key
   in that language. Every emitted URL carries `?lang`; the prefix issue changes `productPath()` for every
   emitted URL, **plus** the in-page storefront links (32 `/p/` sites in 23 files of `storefront/` and
   `packages/cms-components/` today), which stay `/p/<key>` in 163 — size that issue accordingly.
4. **#384 drift.** #384 may change before merging; the gated phases re-read its final API.
5. **Name sort order change (D6).**
6. **Concurrency of key writes** — advisory locks per key; covered by a two-connection test.
7. **External connectors** must adopt the new write port to honour FR-091/FR-093 (D5).
8. **The status value set (Q1)** — decided 2026-10-25 and planned as Block Q. Residual risks: a process
   still running pre-163 code during a rolling deploy writes `draft` after the conversion — refused by the
   new `products_status_check` rather than stored (R30.2); external integrations that archived through
   `status: 'inactive'` or `'archived'` (API-key upsert, CSV) silently switch products off instead, until
   they call Archive — release note (T156q).
9. *(Retired — Q-D decided A on 2026-10-22: no single-write undo, no platform phase.)*
10. **CMS blocks by slug.** Blocks store global slugs; the JSON lookup keeps answering them (R28). If a
   product's global slug is later taken over in L by another product's L key, a block naming that slug at L
   shows the other product — an edge the operator caused by confirming a takeover; blocks moving to product
   ids is a follow-up.

## Compatibility and release (owner Q1, 2026-10-25)

The status change is the feature's one breaking change (spec *Compatibility and release*, research R30.6).
The owner's Q1-e answer spoke of a **major** changeset for `@endora-commerce/contracts`; `specs/conventions/release-intent.md`
(owner ruling D-225) **refuses `major` while a package is in `0.x`** — `contracts` is `0.107.0` — and
`check:release-intent`'s `major-bump-in-a-zero-series` has no override, so a literal `major` would red the
final gate (T153). The break is therefore recorded at **`minor`** — which in a `0.x` series already
takes every caret dependent out of range — with a body marked BREAKING that names each removed symbol and
gives the old and the new call (T156q for `contracts` and `mod-catalog`, T156y for `admin-kit` and
`page-builder-admin`). The spec's *Compatibility and release* was reworded accordingly by the coordinator's
decision of 2026-10-25. Lockstep releases every package at the highest pending bump anyway.

## Complexity Tracking

No violations. **No new runtime, dev or workspace dependency** (R25). Block Q adds none either.

One manifest edge, recorded so it is not read as a new dependency: `@endora-commerce/mod-seo` gains
`react-router-dom` `^7` as an **optional peer** (and the matching devDependency), rendered by
`manifests:generate`, because its contribution to the new admin zone `product.editor.seo.after` (the
product editor's link to the SEO screen, Session 2026-10-26 *SEO stub*, UX-4) is a router `Link`. The
Admin UI already depends on `react-router-dom` 7, and `@endora-commerce/mod-catalog` declares the same
optional peer, so no application gains a runtime dependency and the lockfile resolves the same version.

## Handoff summary (for `endora-commerce-dev`)

Build in `tasks.md` order; the blocks and streams there are the unit of a builder spawn. Read before the
first phase: `research.md` R1–R12 and `contracts/product-scopes.md`. Non-negotiables: no consumer may test
a status value other than through the port or the pure rule; no SQL against another module's table;
availability narrowing goes **in the statement**, never after the page is cut; every write is a Command;
every buyer seam keeps one not-found answer; do not start a #384-gated phase before #384 is on `master`.
Owner decisions since planning: Q-A serve, Q-B interim `?lang` only (prefix is a separate issue; every
emitted URL through `productPath()`), Q-C hide redirects with `seo` off, M3 → A (the gate fires on status
writes only; the overview shows each cell's missing values), Q-D → A (no single-write undo; restore from the
audit before-state), **Q1 (2026-10-25): `draft` removed, `inactive` plain off at every scope, Archive /
Restore separate global Commands — Block Q, research R30**. No question is open. Non-negotiables added by
Q1: no status write at any scope touches `archivedAt`; no code reads `status` as "archived"; the gate reads
status, never the archive; do not edit `20261022T035133_catalog_product_scopes.ts`; changesets at `minor`
(D-225). The old global slug becomes a `NULL`-language
redirect only where it is free in every language (data-model §5, HIGH-2). Phase 18 converts `seo`'s hand-audited override writes to
Commands **before** adding the channel dimension — do not extend the hand audit.
