# Implementation Plan: Storefront language in the URL path

**Branch**: `167-storefront-locale-path` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/167-storefront-locale-path/spec.md` (issue #396)

## Summary

Every storefront page URL carries the language of the page as a path prefix derived from the sales
channel's languages (`/pl/p/wiertarka`, `/en/p/drill`); a per-channel switch decides whether the
default language is prefixed too (on for new channels; existing channels are switched off by the
upgrade so their URLs do not move — OR-10). The storefront middleware — already the seam for
robots, channel stamping, the 503 rewrite and the closed-store redirect — parses the prefix,
answers the 307/308 redirects of the owner's rulings, and **rewrites** to the unchanged route tree
with the language on forwarded headers. One pure derivation in `@endora-commerce/contracts`
(`channelUrlLanguages`, `storefrontPagePath`, a re-signatured `productPath`) is used by every
backend emitter and answered to the storefront on the public channel read. One storefront helper
(`localizePath` and its adapters) produces every internal link and redirect, held by an ESLint rule.
The flag is a kernel column on `sales_channels` (migration `--module core`, which backfills
existing rows to off), edited through the existing audited identity Command. With the setting on,
an unprefixed request is redirected by `?lang=` → `lang` cookie → `Accept-Language` → default
(OR-11); the switcher both navigates and writes the cookie.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing only — Next.js 15.5 (storefront middleware, App Router),
Fastify, MikroORM, Zod, ESLint (`no-restricted-syntax`, core rule). **No new runtime, dev or
workspace dependency.**
**Storage**: PostgreSQL — one column on the kernel-owned `sales_channels` table; Redis channel
cache shape bumped to v5.
**Testing**: Vitest (contracts, platform, module co-located tests, storefront `test/`), backend
contract + integration suites (`backend/test/contract/sales_channels`, `.../catalog`, `.../cms`,
`.../product_feeds`), Playwright conformance for the redirect matrix.
**Target Platform**: Linux server (backend), Next.js Node runtime (storefront).
**Project Type**: web — `packages/contracts`, `packages/platform`, `packages/modules/*`,
`packages/cms-components`, `storefront`, `admin` (through the module's `src/admin`), `docs`.
**Performance Goals**: no added backend round-trip per storefront request (SC-005); the middleware
work is a string parse over the already-cached channel identity.
**Constraints**: Constitution VII (pages stay SSR), XII (channel languages from the resolved
channel), XIII (audited write), XVII (no new gate needed — research R-15).
**Scale/Scope**: ~139 hrefs and ~205 redirect sites converted in the storefront, 14 backend
emitters (research R-10), ~40 storefront routes covered by the route-table test.

## Constitution Check

*GATE: passed before research; re-checked after design (below the table).*

| Principle | Verdict | How |
| --- | --- | --- |
| **I. Modular (NN)** | PASS | The derivation lives in `contracts` (a leaf), the flag in the kernel entity that already owns the table, each emitter changes inside its own module and reaches channel facts through the kernel's `SalesChannelResolutionPort`/`getResolvedChannel()`; feeds reach product keys through the existing `CatalogProductUrlKeyReadPort` (163 R28). No module imports another's internals; `sales_channels` gains no dependency on `cms` (reservation is enforced on the `cms` side, research R-11). |
| **II. API-first** | PASS | Zod shapes change first (`contracts/contracts-package.md`), with tests. The public channel read answers the derived prefixes so no consumer re-derives. All changes are additive response fields or optional request fields except `productPath`'s signature, which the changeset documents. |
| **III. TDD (NN)** | PASS | `tasks.md` orders a failing test before each implementation task; every FR maps to a test (traceability table in `tasks.md`). |
| **IV. YAGNI / deps** | PASS | No new dependency. Lint rule is a core ESLint rule, not a new `check-*` script (research R-6). No stored prefix, no redirect table, no new cache. |
| **V. TypeScript** | PASS | Strict; middleware parses the identity body by hand as today (no validation library at the edge), the backend validates with Zod. |
| **VI. Naming (NN)** | PASS | Column `prefix_default_language`, field `prefixDefaultLanguage`, headers `x-storefront-language*` in the existing `x-…` style. |
| **VII. SEO** | PASS | Pages stay server-rendered; one URL per language with canonical, `hreflang` and `x-default`; sitemaps prefixed; duplicate default-prefixed URLs 308. |
| **VIII. English** | PASS | Code comments and `docs/` pages in English; Polish only in `pl.json`, `messages.ts` and `docs/i18n/pl/`. |
| **IX. UI reuse** | PASS | Admin: one switch in `ChannelIdentityForm.tsx` beside `anonymousAccess`, existing admin-kit primitives. Storefront switcher reuses existing header styles. |
| **X. Queues** | N/A | No long-running work. |
| **XI. Tenancy (NN)** | PASS | No tenant-scoped entity touched; `SalesChannel` is `@GlobalEntity`; no no-organization path. |
| **XII. Channel scoping (NN)** | PASS | The language list is the resolved channel's (research R-17); the storefront stops consulting the platform-wide list; CMS reservation and shadow marker read channels through the kernel port, not a bridge table. Cross-channel test: a prefix of channel A is an unknown segment on channel B. |
| **XIII. Command Bus (NN)** | PASS | The flag is written by the existing channel identity Command (before/after); no hand-written audit call. |
| **XIV. Extensibility** | N/A | A behavioural switch on a kernel record, not a "add a field" requirement. |
| **XV. Untouched core** | PASS | Deployments choose the behaviour by the setting; an overlay needs no core edit. |
| **XVI. Palette** | PASS | No new admin surface; the switch lives on the channel edit screen already reachable through `open-sales-channels`. |
| **XVII. Toggleable (NN)** | PASS | `sales_channels` is non-deactivatable; every other touched module's off state removes its own emitter only (research R-15). No new route, worker, subscriber or timer. Off-state test added for `cms` off: channel language edits and storefront parsing unaffected. |

**Post-design re-check**: PASS. No violation to justify.

## Design decisions (detail in `research.md`)

- **D1 — Middleware rewrite, unchanged route tree** (R-1). `app/[lang]/` rejected.
- **D2 — Derivation in contracts, answered by the backend** (R-2), with split aliases (FR-015).
- **D3 — Kernel column + core migration (default `true`, existing rows backfilled `false`, OR-10), identity Command, cache v5** (R-3, R-4, data-model §1–§3).
- **D4 — Status/caching table** (R-5): 307 private/no-store + `Vary: Accept-Language, Cookie` (OR-11); 308 with
  `max-age=3600`.
- **D5 — `localizePath` + adapters, ESLint `no-restricted-syntax`** (R-6, `contracts/storefront-navigation.md`).
- **D6 — Switcher as links, upgraded from `hreflang` alternates after hydration, writing the `lang` cookie on activation** (R-7, R-12).
- **D7 — `x-default` = unprefixed URL in both states** (R-8).
- **D8 — PDP cross-language key → 307 to the language's own key** (R-9).
- **D9 — Emitters through `storefrontPagePath`/`productPath`, in the message's language** (R-10).
- **D10 — Reservation on the CMS side + shadow marker + storefront segment test** (R-11).
- **D11 — The channel's languages are authoritative** (R-17).

## Project Structure

### Documentation (this feature)

```text
specs/167-storefront-locale-path/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── url-shape.md
│   ├── contracts-package.md
│   └── storefront-navigation.md
└── tasks.md
```

### Source code touched

```text
packages/contracts/src/
├── storefront-language-path.ts (+ .test.ts)        # new: derivation, storefrontPagePath
├── product-url-keys.ts (+ .test.ts)                # productPath signature, permanent, xDefault
├── sales-channels.ts (+ .test.ts)                  # prefixDefaultLanguage, urlLanguages
└── index.ts                                        # export the new module
packages/platform/src/
├── kernel/sales-channels/sales-channel.entity.ts   # prefixDefaultLanguage
├── kernel/sales-channels/sales-channels-cache.ts   # CachedChannel + v5
├── kernel/sales-channels/default-channel-reconciler.ts
└── migrations/<timestamp>_core_sales_channels_prefix_default_language.ts  # scaffolded
packages/modules/sales_channels/
├── src/backend/commands/identity.command.ts
├── src/backend/routes.admin.ts, routes.storefront.ts
├── src/admin/components/ChannelIdentityForm.tsx, pages/SalesChannelEditPage.tsx
├── i18n/en.json, i18n/pl.json
└── docs/index.md, admin-usage.md, developer-guide.md
packages/modules/catalog/src/backend/services/
├── catalog-query.service.ts, url-key-resolution.service.ts, url-key.service.ts
packages/modules/seo/src/backend/services/sitemap-generator.service.ts
packages/modules/product_feeds/src/backend/services/item-field-resolver.ts (+ context wiring)
packages/modules/cms/src/backend/services/cms-page-service.ts (+ index.ts wiring, admin list marker)
packages/modules/{organizations,customers,newsletter,invoices,comparisons,mfa}/src/backend/…  # emitters (R-10)
packages/cms-components/src/utils/link-href.ts, components/{CategoryGrid,CategoryList,CmsProductCard}.tsx, render-context.tsx
storefront/
├── middleware.ts
├── lib/i18n/locale-path.ts, localized-link.tsx, navigation.ts, locale.ts, messages.ts
├── lib/server-context.ts, lib/channel/channel-identity.ts, lib/channel/closed-store.ts
├── app/layout.tsx, app/reserved-segments.ts, app/sitemap.ts, app/(catalog)/p/[slug]/{page,resolution}.ts(x)
├── app/**, components/**                                # href / redirect conversion
├── components/HeaderPreferenceSwitchers.tsx
└── eslint.config.js
docs/docs/upgrading-an-instance.md (+ docs/i18n/pl/…)
docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/sales_channels/*.md (+ translation cache)
.changeset/167-storefront-locale-path.md
```

**Structure Decision**: extend existing modules and the kernel; no new module, no new package.
The derivation is a contracts module because both the backend and API consumers need it and
`productPath` already lives there.

## Phasing and dependencies

1. **Spike** (T004): verify R-1's four Next.js behaviours; throw the spike away.
2. **Foundational**: contracts shapes → kernel column, cache, migration → identity Command and
   routes → public channel read. Blocks everything.
3. **US1 + US2 together** (both P1, one middleware): `parseLocalePath` → middleware → server
   context → helper adapters → conversion of hrefs/redirects → lint rule → PDP cross-language
   redirect. Shipping US1 without US2 would break every existing link; they are one increment.
4. **US3** (admin switch) can run in parallel with step 3 once Foundational is done.
5. **US4** (switcher) must ship in the same release as US1 (the old switcher does nothing once the
   path wins).
6. **US5, US6, US7** in parallel after Foundational; US5's storefront part after US1's helper.
7. Docs, changeset, full verification.

## Risks

| Risk | Mitigation |
| --- | --- |
| A Next.js rewrite detail (R-1 a–d) differs from expectation | Spike first; the helper isolates the answer in `stripLocalePrefix`. |
| An unconverted link silently switches language through the 307 | Lint rule + crawl test (SC-003) over the rendered pages. |
| Browsers caching a 308 and looping after the setting is flipped | Bounded `max-age=3600` on 308s (R-5); admin hint says URL changes take effect for cached redirects within an hour. |
| Operators expecting prefixes after upgrade find existing channels off | Upgrade note in docs (EN + PL) and in the changeset says existing channels are unchanged and where to switch them on (OR-10). |
| Third-party consumers of `productPath` | Changeset with the old and new call; `minor` in `0.x` takes every caret dependent out of range. |

## Complexity Tracking

No constitution violation and **no new dependency** (runtime, dev or workspace). Nothing to
justify.

## Handoff to `endora-commerce-dev`

- Start with T001–T004 (setup, spike), then Phase 2. Do not start the storefront conversion before
  the spike answers R-1 (a)–(d).
- Scaffold the migration with `--module core`, not `--module sales_channels`; run
  `composer:generate` and commit the registries; bump the channel cache to v5.
- `productPath`'s callers are four (catalog ×3, seo ×1) plus the new ones (feeds, emitters); the
  type-check finds them all.
- The owner answered every open question on 2026-10-29 (`spec.md` OR-10…OR-13): existing channels
  backfilled off; the `lang` cookie in the 307 chain with `Vary: Accept-Language, Cookie` and
  written by the switcher; a non-channel language prefix is an ordinary path.
- Two pre-existing defects found by the survey are in scope because the same lines change: the
  admin password-reset e-mail links `/reset-password` (served by nothing) and the product feed uses
  the global slug instead of the per-language key. The invoice e-mail's `/orders/…/pdf` link targets
  no storefront route — confirm the intended target before prefixing it (T070).
- Verify with `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, the targeted
  backend tests, `pnpm --filter '!backend' run test` (contracts, platform, cms-components and the
  storefront are reached only there), and the storefront Playwright conformance spec.
