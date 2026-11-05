# Tasks: Storefront language in the URL path

**Input**: `specs/167-storefront-locale-path/` — plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md
**Prerequisites**: `pnpm run build:packages` after every package edit (AGENTS.md § Stack).

**Tests**: mandatory (Constitution III). Every RED task MUST be run and seen failing for the
stated reason before its implementation task starts.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US7 (spec.md); Setup/Foundational/Docs tasks carry none

---

## Phase 1: Setup

- [X] T001 Confirm the worktree is on `167-storefront-locale-path` from `origin/master` and `.specify/feature.json` points at `specs/167-storefront-locale-path`; run `pnpm run build:packages` and record the baseline of `pnpm --filter backend run test:unit:fast` and `pnpm --filter storefront run test` *(2026-10-29: the baseline was not recorded before the first edit; suites were run after each phase instead)*
- [X] T002 Read `specs/conventions/module-migrations.md`, `module-i18n.md`, `module-activation.md`, `check-estate.md`, `release-intent.md`, `module-documentation.md` before the first task that touches their subject
- [X] T003 [P] List every storefront file using `usePathname`, `useSelectedLayoutSegment(s)` or `x-pathname` into a scratch note (input to T037)
- [X] T004 **Spike (throwaway, never committed)**: in a scratch copy of `storefront/middleware.ts`, rewrite `/en/<path>` to `/<path>` and verify on Next 15.5: (a) what `usePathname()` returns on SSR and on the client, (b) `<Link>` prefetch of `/en/x` passes through the middleware, (c) a server action posted from `/en/x` sees the forwarded request headers, (d) `redirect('/y')` inside that action reaches the browser as `/y`. Record the four answers in research.md R-1 ("Spike result") and delete the spike

---

## Phase 2: Foundational (blocks every story)

### Contracts first (Principle II)

- [X] T005 [P] RED `packages/contracts/src/storefront-language-path.test.ts` — data-model.md §4 examples table, uniqueness, prefix grammar, split aliases, default included when absent from `languages`, case-insensitive duplicate throws, `storefrontPagePath` for `/`, query + fragment preserved, unknown language throws, `storefrontDefaultPath`
- [X] T006 Implement `packages/contracts/src/storefront-language-path.ts` per `contracts/contracts-package.md` §1; export from `packages/contracts/src/index.ts`
- [X] T007 [P] RED `packages/contracts/src/product-url-keys.test.ts` — `productPath({ key, languageCode, channel })` prefixed in both setting states, never `?lang=`; `productDefaultPath`; `productKeyResolutionSchema` `redirect.permanent` required; `productPagePathsSchema.xDefault` required
- [X] T008 Implement `packages/contracts/src/product-url-keys.ts` (§2); replace the doc block's "later language path prefix" sentence with a pointer to this feature
- [X] T009 [P] RED `packages/contracts/src/sales-channels.test.ts` — `prefixDefaultLanguage` on summary/detail, create default `true`, update optional and counted by the "at least one field" refinement, `PublicSalesChannelSchema.urlLanguages` (min 1) and `urlLanguageAliases`
- [X] T010 Implement `packages/contracts/src/sales-channels.ts` (§3); `pnpm run build:packages`

### Kernel column, cache, migration

- [X] T011 [P] RED `packages/platform/src/kernel/sales-channels/sales-channels-cache.test.ts` — `toCachedChannel` carries `prefixDefaultLanguage`; key prefix is `sales-channels:v5:`
- [X] T012 [P] RED `backend/test/integration/sales_channels/prefix-default-language-migration.test.ts` — rows present before the migration read `prefix_default_language = false` (OR-10); a row inserted after it reads `true` (OR-1); on an empty database the reconciler's default channel reads `true`; column not null; `down()` drops it (mirror `anonymous-access-migration.test.ts`)
- [X] T013 Scaffold `pnpm --filter backend run migration:new -- --module core --name sales-channels-prefix-default-language`; write M1 (data-model.md §1: the DDL and the `update … = false` backfill in one `up()`); add `prefixDefaultLanguage` to `packages/platform/src/kernel/sales-channels/sales-channel.entity.ts` (+ `OptionalProps`), `sales-channels-cache.ts` (v5 + version log line), `default-channel-reconciler.ts`; run `pnpm --filter backend run composer:generate` and commit the regenerated registries

### Channel admin write and public read

- [X] T014 [P] RED `backend/test/contract/sales_channels/admin-crud-lifecycle.contract.test.ts` — create without the field → `true`; PATCH `prefixDefaultLanguage: false` with `sales_channels:write` → 200, exactly one audit entry with before/after, cached channel dropped (next resolve reads `false`); with `sales_channels:read` only → 403
- [X] T015 Implement `packages/modules/sales_channels/src/backend/commands/identity.command.ts` (create sets `true` explicitly; update; audit snapshot) and `routes.admin.ts` (summary/detail mapping)
- [X] T016 [P] RED `backend/test/contract/sales_channels/storefront-public-read.contract.test.ts` — `urlLanguages` / `urlLanguageAliases` for `pl-PL,en-US` and `pl-PL,en-US,en-GB` in both setting states; validates against `PublicSalesChannelResponseSchema`
- [X] T017 Implement `packages/modules/sales_channels/src/backend/routes.storefront.ts` with `channelUrlLanguages` / `channelUrlLanguageAliases`

### Existing `productPath` callers

- [X] T018 [P] RED update expectations in the catalog and seo tests that assert `?lang=` paths (find them with `command grep -rn "lang=" packages/modules/catalog packages/modules/seo backend/test storefront/test`) to the prefixed shape for both setting states, including the admin URL-keys panel's `effective[].url`
- [X] T019 Implement the new call in `packages/modules/catalog/src/backend/services/catalog-query.service.ts` (`#pagePaths`), `url-key-resolution.service.ts`, `url-key.service.ts`, `packages/modules/seo/src/backend/services/sitemap-generator.service.ts`, passing the resolved/cached channel as `ChannelUrlFacts`; `pnpm -r run typecheck` must find no other caller *(done; `xDefault` was implemented here as well, because T008 makes it required — T051's code, T050's test still to come)*

**Checkpoint**: shapes, column, cache, admin write and public read are live; emitted product paths are prefixed.

---

## Phase 3: US1 + US2 — one URL per language, old links keep working (P1) 🎯 MVP

US1 and US2 ship together: the middleware that makes the path win is the one that redirects old links.

### Tests first

- [X] T020 [P] [US1] RED `storefront/test/i18n/locale-path.test.ts` — `parseLocalePath` over every row of `contracts/url-shape.md` §3, §5 and the §9 table in both setting states (status, `Location`, `varyOnLanguageInputs`), including the `lang` cookie's place in the chain (`?lang=` → cookie → `Accept-Language` → default, setting on only; a cookie naming a non-channel language skipped; cookie ignored with the setting off) and a non-channel language prefix (`/de/…`) as an ordinary path (OR-11, OR-12); `localizePath` §2 table of `contracts/storefront-navigation.md`; `stripLocalePrefix`; `pageAlternates` (§8)
- [X] T021 [P] [US1] RED `storefront/test/lib/channel-identity.test.ts` — `parseChannelIdentity` reads `urlLanguages`, `urlLanguageAliases`, `prefixDefaultLanguage`; a body without them (older backend) yields an identity with no URL languages, which disables language handling (FR-019)
- [X] T022 [P] [US2] RED `storefront/test/i18n/middleware-language.test.ts` — through the exported `middleware()`: 307 with `Vary: Accept-Language, Cookie` + `Cache-Control: private, no-store`; the `lang` request cookie read for the 307 only; 308 with `max-age=3600`; query preserved minus `lang`; language headers written on render and **deleted** when a client sent them (FR-018); language-neutral and non-document paths untouched; outage → 503 at the requested URL with no redirect first (FR-017); closed store → one 307 to `/pl/login?next=%2Fpl`; identity unknown → no redirect (FR-019); cross-channel: channel B's prefix is an unknown segment on channel A
- [X] T023 [P] [US1] RED `storefront/test/lib/server-context-language.test.ts` (extend) — `locale` from `x-storefront-language`; cookie `lang` and `Accept-Language` ignored for the rendered language (the cookie matters only to the middleware's 307); a header naming a language outside the channel's `urlLanguages` falls back to the channel default; the platform-wide active list is no longer consulted (FR-005)
- [X] T024 [P] [US1] RED `storefront/test/seo/reserved-segments-language.test.ts` — `LANGUAGE_NEUTRAL_SEGMENTS ⊂ RESERVED_TOP_LEVEL_SEGMENTS`; every reserved segment not neutral fails the prefix grammar (FR-042)
- [X] T025 [P] [US1] RED `storefront/test/i18n/localized-navigation.test.tsx` — `<LocalizedLink>` under a provider for `/en` and for the unprefixed default; `useLocalizedPath`; `localizedPath`/`localeRedirect` read the forwarded header; already-prefixed input unchanged
- [X] T026 [P] [US1] RED `storefront/test/i18n/locale-href-lint.test.ts` — ESLint Node API over an in-memory fixture: one violation per selector of `contracts/storefront-navigation.md` §4 reported on the expected lines; every adapter form passes
- [X] T027 [P] [US2] RED `packages/modules/catalog/src/backend/services/url-key-resolution.service.test.ts` (or the existing catalog contract test of `/products/resolve/:key`) — key current in another channel language, product reachable at L → `redirect` `permanent: false` to L's key; former key → `permanent: true`; product unreachable at L → 404; a key of a language **not** in the channel is not considered (XII)
- [X] T028 [P] [US2] RED `storefront/test/catalog/pdp-redirect.test.ts` (extend) — `permanent: false` → 307, `true` → 308; `isProductPagePath` accepts `/<prefix>/p/<key>`; `?lang=` no longer read by the page

### Implementation

- [X] T029 [US1] Implement `storefront/lib/i18n/locale-path.ts` (pure, middleware-safe) to pass T020
- [X] T030 [US1] Implement `storefront/lib/channel/channel-identity.ts` changes to pass T021
- [X] T031 [US2] Implement `storefront/middleware.ts` per `contracts/url-shape.md` §3–§6 and research R-14; `lib/channel/closed-store.ts` returns a logical target the middleware localizes; add `LANGUAGE_NEUTRAL_SEGMENTS` to `storefront/app/reserved-segments.ts` (T022, T024)
- [X] T032 [US1] Implement `storefront/lib/server-context.ts` and `lib/i18n/locale.ts` (remove `langOverride` and the cookie read for rendering — the middleware reads the cookie for the 307; feed the channel's languages) to pass T023
- [X] T033 [US1] Implement `storefront/lib/i18n/localized-link.tsx`, `lib/i18n/navigation.ts` (`localizedPath`, `localeRedirect`, `localePermanentRedirect`), `LocalePathProvider` in `storefront/app/layout.tsx`; `<html lang>` from the path language (T025)
- [X] T034 [US1] Add the `no-restricted-syntax` block to `storefront/eslint.config.js` (T026); run `pnpm --filter storefront run lint` and use its findings as the conversion worklist for T035–T037
- [X] T035 [P] [US1] Convert hard-coded hrefs in `storefront/app/**` (catalog, content, blog, home, kontakt, compare, newsletter) to `LocalizedLink` / `localizedPath`
- [X] T036 [P] [US1] Convert hard-coded hrefs in `storefront/components/**` (header, footer, megamenu, breadcrumbs, mobile tab bar, product cards, account navigation); operator-authored links (megamenu items, footer columns) through `localizePath`
- [X] T037 [P] [US1] Convert every literal `redirect`/`permanentRedirect`/`router.push|replace`/`NextResponse.redirect(new URL(…))` in `storefront/app/(auth)/**`, `app/account/**`, `app/(account)/**`, `app/(commerce)/**`, `app/newsletter/**`, `app/(auth)/session-expired/route.ts`, and every `?next=` value; fix the T003/T004 `usePathname` consumers with `stripLocalePrefix`. `pnpm --filter storefront run lint` reports zero findings of the new rule *(done 2026-10-29 by a codemod over the 391 findings; plain `<a>` became `LocalizedAnchor` and literal `<form action>` became `LocalizedForm` — two adapters added beside `LocalizedLink` in `lib/i18n/localized-link.tsx` to keep plain-anchor and form semantics; every `next/link` import became `LocalizedLink`, dynamic hrefs included; dynamic `redirect(x)` calls and `window.location.href` literals were converted too, though the rule cannot see them)*
- [X] T038 [P] [US1] RED `packages/cms-components/src/utils/link-href.test.ts` — `LinkHrefEnv.localizePath` applied to `page`, `product`, `category` and root-relative `url` links, identity when absent; `CategoryGrid`/`CategoryList`/`CmsProductCard` hrefs localized
- [X] T039 [US1] Implement `packages/cms-components/src/utils/link-href.ts`, `components/render-context.tsx`, `CategoryGrid.tsx`, `CategoryList.tsx`, `CmsProductCard.tsx`; pass `localizePath` from the storefront's block renderer; `pnpm run build:packages` *(the storefront passes it through `components/LocalizedCmsRenderProvider.tsx`, a client wrapper — a function cannot cross into the client render context; `NewsletterSignupForm` posts to and returns to the localized path too)*
- [X] T040 [US2] Implement the third resolution step in `packages/modules/catalog/src/backend/services/url-key-resolution.service.ts` (research R-9) to pass T027
- [X] T041 [US2] Implement `storefront/app/(catalog)/p/[slug]/resolution.ts` and `page.tsx`: honour `permanent`; drop `requestedLanguage` and `langOverride`; drop the `<div lang>` workaround now that `<html lang>` is the page language (T028)
- [X] T042 [US1] Route-coverage test `storefront/test/i18n/route-coverage.test.ts` (SC-001): derive every page route from the `app/` tree (as `check:storefront-indexability` does) and assert each renders in the path language under `/pl` and `/en` with a cookie and `Accept-Language` pointing elsewhere *(done at the middleware seam — 53 routes derived from `app/`; the render's reading of the forwarded language is T023's)*
- [X] T043 [US2] Conformance `storefront/test/conformance/locale-path.spec.ts` (Playwright) — the url-shape §9 matrix and US2's pre-feature URL list in both setting states, at most two redirects to a 200 (SC-002) *(run 2026-10-29 against a local stack on throwaway Postgres/Redis/Meilisearch containers and the demo seed: 21/21 with the setting on and 21/21 with it off)*
- [X] T044 [US1] Conformance crawl in the same spec: zero root-relative internal links without the current prefix on home, category, product, search, CMS, blog, cart, checkout, account (SC-003) *(run with T043; the crawl found the megamenu department links unprefixed — fixed, with a regression test)*

**Checkpoint**: MVP — every page is language-addressed; every old link lands correctly.

---

## Phase 4: US3 — the per-channel switch in the admin (P2)

- [X] T045 [P] [US3] RED `packages/modules/sales_channels/src/admin/components/ChannelIdentityForm.test.tsx` — switch shown, default on for a new channel; read-only without `sales_channels:write`; derived prefix list (`channelUrlLanguages` on the form's current languages, updates as languages change); hint text; value sent in create and PATCH bodies *(written beside the form's other admin tests, `admin/test/modules/sales_channels/channel-form-prefix-default-language.test.tsx`, as 154's switch is; read-only is a new `readOnly` form prop the edit page sets from `sales_channels:write`)*
- [X] T046 [US3] Implement `ChannelIdentityForm.tsx` and `pages/SalesChannelEditPage.tsx` beside `anonymousAccess`, admin-kit primitives only
- [X] T047 [US3] Add `identity.prefixDefaultLanguage.label`, `.hint`, `.prefixesHeading`, `.urlChangeWarning` to `packages/modules/sales_channels/i18n/en.json` and `pl.json` (EN *"Prefix the default language in URLs"*, PL *"Prefiks języka domyślnego w adresach URL"*; hint per spec US3); run `pnpm run check:language` and the i18n bundle parity checks named in `specs/conventions/module-i18n.md`

---

## Phase 5: US4 — the switcher links to the same page (P2; same release as US1)

- [X] T048 [P] [US4] RED `storefront/test/components/language-switcher.test.tsx` — one `<a>` per channel language with `hreflang`/`lang`, `aria-current` on the current one, endonym labels, hidden for one language, activating an option writes `lang=<code>` (`path=/`, one year, `samesite=lax`) without preventing the navigation (OR-11), server-rendered href = `localizePath(logicalPath + search, code)`, after hydration replaced by `link[rel=alternate][hreflang]` when present
- [X] T049 [US4] Implement `LocaleSwitcher` in `storefront/components/HeaderPreferenceSwitchers.tsx`; add `header.language` to `storefront/lib/i18n/messages.ts` (en-US, pl-PL) replacing the hard-coded `Język:`

---

## Phase 6: US5 — canonical, hreflang, sitemaps (P2)

- [X] T050 [P] [US5] RED catalog contract test of the storefront product read — `paths.canonical`, `paths.alternates`, `paths.xDefault` in both setting states; alternates only where anonymous-available (163 FR-074)
- [X] T051 [US5] Implement `xDefault` in `catalog-query.service.ts` `#pagePaths`
- [X] T052 [P] [US5] RED `storefront/test/seo/page-alternates.test.ts` — metadata of home, catalogue, category, search, CMS, blog, kontakt and product pages: prefixed canonical, one alternate per channel language, `x-default` unprefixed; cart/checkout/account emit none *(held by `localizedAlternates`' behaviour and each page's source; the metadata literal keeps a `canonical` property so `check:storefront-indexability` still reads it — findings=0)*
- [X] T053 [US5] Implement `pageAlternates` use in each page's `generateMetadata` (`app/page.tsx`, `app/(catalog)/{catalog,c/[slug],search}/page.tsx`, `app/(content)/[...slug]/page.tsx`, `app/blog/[[...slug]]/page.tsx`, `app/kontakt/page.tsx`) and `x-default` on the PDP
- [X] T054 [P] [US5] RED `packages/modules/seo` sitemap test — products per language with the per-language key, categories and CMS pages per channel language (only the page's own languages for CMS), prefixed per setting, no `?lang=`
- [X] T055 [US5] Implement `packages/modules/seo/src/backend/services/sitemap-generator.service.ts` *(`CmsPageRecord` gained optional `languages` and, after the merge with 163 R24, `translations`, so each language is listed at its own slug; the storefront page index uses R24's per-language `alternates` — research R-18)*
- [X] T056 [P] [US5] RED storefront sitemap test (`storefront/test/seo/sitemap-language.test.ts`) — the same rules for `app/sitemap.ts`
- [X] T057 [US5] Implement `storefront/app/sitemap.ts`

---

## Phase 7: US6 — every emitter names its language (P3)

- [X] T058 [P] [US6] RED `packages/modules/product_feeds/src/backend/services/item-field-resolver.test.ts` — `link` = `<origin>` + `productPath(effective key in the feed language)`; no `?lang=`; global slug never used when a language key exists *(a feed written in a language the channel does not serve links the channel default language's page and key — `feedLinkLanguage`, FR-034's fallback)*
- [X] T059 [US6] Implement `item-field-resolver.ts` and the feed context wiring (`feed-generation.service.ts`, `template-preview.service.ts`): channel `ChannelUrlFacts` and effective keys through `CatalogProductUrlKeyReadPort`
- [X] T060 [P] [US6] RED `packages/modules/organizations` tests *(every emitter composes through a new contracts helper, `storefrontPagePathFor({ path, channel, requestedLanguage })`: the message language when the channel serves it, else the default; the invitation and the admin password reset know no recipient language and use the channel default — the reset uses the system-default channel, a customer having none)* — verification and invitation links prefixed for the e-mail's language and the channel's setting
- [X] T061 [US6] Implement `email-templates/verification.ts`, `email-templates/invitation.ts` and their callers (pass channel facts + language)
- [X] T062 [P] [US6] RED customers admin password-reset contract test — link targets the storefront's real reset route (`/password-reset/confirm?token=…`, verify against `storefront/app/(auth)/password-reset/`) under the right prefix
- [X] T063 [US6] Implement `packages/modules/customers/src/backend/routes.admin.ts` (path fix + prefix)
- [X] T064 [P] [US6] RED newsletter tests — confirm/unsubscribe redirects and e-mail links prefixed for the subscriber's language
- [X] T065 [US6] Implement `packages/modules/newsletter/src/backend/routes.storefront.ts` and the link builders
- [X] T066 [P] [US6] RED comparisons test — share URL prefixed for the document language
- [X] T067 [US6] Implement `packages/modules/comparisons/src/backend/document/comparison-document-data.ts`
- [X] T068 [P] [US6] RED mfa OAuth test — the transaction carries the starting page's language; `/login/mfa` and `/login?error=` returns prefixed; `next` passed through unchanged
- [X] T069 [US6] Implement `packages/modules/mfa/src/backend/routes.oauth.ts`
- [X] T070 [US6] Investigate the invoice e-mail link `/orders/:id/invoices/:id/pdf` (`packages/modules/invoices/src/backend/services/invoice-email-dispatch.ts:109`): no storefront route serves it. Find the intended target; if none can be established, record `[NEEDS CLARIFICATION]` in research.md R-10 and stop this task chain for the owner
- [X] T071 [P] [US6] RED invoices test — download link prefixed for `resolveLanguage(channelId)` (after T070)
- [X] T072 [US6] Implement the invoice link (after T070)
- [X] T073 [US6] SC-004 sweep: `command grep -rnE "lang=\\$\\{|\\?lang=" packages/modules/*/src packages/platform/src packages/contracts/src storefront/app storefront/lib storefront/components` returns no URL composition; fix any remaining

---

## Phase 8: US7 — CMS slugs never collide with a prefix (P3)

- [X] T074 [P] [US7] RED `packages/modules/cms` service test — slug `en`, `en/o-nas`, `en-gb/x` refused with `409 CMS_SLUG_RESERVED` `{ segment }` when any channel has that prefix or alias; a prefix of no channel is accepted, even when it is a platform language's (`de` with no German channel — OR-12); the existing reserved-segment Setting still applies
- [X] T075 [US7] Implement in `packages/modules/cms/src/backend/services/cms-page-service.ts` (`assertSlugNotReserved`) and `index.ts` wiring through the kernel channel resolution port
- [X] T076 [P] [US7] RED cms admin list contract test — `shadowedByLanguagePrefix` (prefix + channel codes) on a page whose first segment is a channel prefix; absent otherwise
- [X] T077 [US7] Implement the marker (contracts field on the cms admin list item, service, admin badge) with `pl`/`en` strings in `packages/modules/cms/i18n/{en,pl}.json`
- [X] T078 [US7] Off-state test: with `cms` off, a channel language edit succeeds and the storefront's language handling is unaffected (`backend/test/integration/cms/` or the module-activation off-state suite)

---

## Phase 9: Documentation and release intent

- [X] T079 [P] Update `packages/modules/sales_channels/docs/index.md`, `admin-usage.md` (the switch, URL shapes, prefixes, what changes when languages change, the one-hour redirect cache) and `developer-guide.md` (`channelUrlLanguages`, `storefrontPagePath`, `productPath`'s new call, the public read's `urlLanguages`, emitter rule)
- [X] T080 [P] Mirror T079 in Polish under `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/sales_channels/` and the matching `docs/translation-cache/pl/` entries; run `pnpm --filter backend run check:docs-translations` (workflow: `docs/docs/contributing/documentation-i18n.md`)
- [X] T081 [P] Upgrade note in `docs/docs/upgrading-an-instance.md` and its Polish counterpart: existing channels are left **off** by the upgrade so their default-language URLs do not move (OR-10), new channels start **on**, how and where to switch a channel on and what then happens (every URL under a prefix, old links 307 by `?lang=` → cookie → `Accept-Language`), non-default languages gain prefixes either way (`?lang=` links 308), CMS pages that may be shadowed, third-party `productPath` callers
- [X] T082 [P] Storefront developer note in `storefront/README.md`: the helpers, the lint rule and its message, language-neutral paths
- [X] T083 Changeset `.changeset/167-storefront-locale-path.md` — `minor` (0.x, D-225) for `@endora-commerce/contracts` (new exports; `productPath` old → new call; `permanent`, `xDefault`, channel fields) whose body carries the upgrade note's operator sentence: existing channels stay unprefixed, switch *Prefix the default language in URLs* on per channel to adopt prefixes (OR-10), and the platform, sales_channels, catalog, seo, product_feeds, cms, cms-components, organizations, customers, newsletter, comparisons, mfa, invoices packages whose published output changes; `pnpm --filter backend run check:release-intent -- --since origin/master`
- [X] T084 Regenerate if anything generated moved: `pnpm --filter backend run composer:generate`, `manifests:generate`, `pnpm install --lockfile-only` (no dependency change expected — the lockfile must not move)

---

## Phase 10: Verification

- [X] T085 Trap sweep (AGENTS.md): `command grep -rn "channelDefaultLanguage\|?lang=\|requestedLanguage\|langOverride" backend/test storefront/test packages --include='*.ts' --include='*.tsx'` — no stale expectation or caller left in the contract/integration trees `test:unit:fast` does not reach
- [X] T086 `pnpm run build:packages && pnpm -r run typecheck && pnpm -r run lint && pnpm run check:naming && pnpm run check:language`
- [X] T087 Targeted backend runs: `backend/test/contract/sales_channels`, `.../catalog`, `.../cms`, `.../product_feeds`, `backend/test/integration/sales_channels`; then `pnpm --filter '!backend' run test` (contracts, platform, cms-components, storefront, module packages)
- [X] T088 Walk `quickstart.md` on a local stack in both setting states *(every redirect row, `<html lang>`, canonical/alternates/x-default, both sitemaps, the closed store in both states and the outage notice checked by curl; the CMS 409 and the verification link were checked by their contract/unit tests rather than by hand)*
- [X] T089 Confirm the T004 spike left nothing in the tree (`git status`)

---

## Dependencies

- Phase 1 → Phase 2 → everything else. T004 must finish before T029–T037.
- US1+US2 (Phase 3) is one increment; US4 (Phase 5) ships in the same release.
- US3 (Phase 4) depends only on Phase 2. US5's backend half (T050–T051, T054–T055) depends only on
  Phase 2; its storefront half (T052–T053, T056–T057) on T029/T033. US6 and US7 depend only on Phase 2.
- Docs (Phase 9) after the stories they describe; T083 last before Phase 10.

## Parallel examples

- After T010: T011, T012, T014, T016, T018 in parallel (different packages).
- In Phase 3: T020–T028 (all RED) in parallel; then T035, T036, T037 in parallel after T034.
- Phases 4, 6 (backend half), 7, 8 in parallel with Phase 3 once Phase 2 is done.

## Requirement → test traceability

| FR | Tests |
| --- | --- |
| FR-001, FR-002 | T009, T011, T012, T014 |
| FR-001a | T012, T081, T083 |
| FR-003, FR-004 | T005, T016 |
| FR-005 | T023 |
| FR-010 … FR-016 | T020, T022, T043 |
| FR-017, FR-018, FR-019 | T021, T022 |
| FR-020 | T025, T038, T044 |
| FR-021 | T026 |
| FR-022 | T023, T042 |
| FR-023 | T048 |
| FR-024 | T027, T028, T043 |
| FR-030 | T050, T052 |
| FR-031 | T007, T018 |
| FR-032 | T054, T056 |
| FR-033 | T058 |
| FR-034 | T060, T062, T064, T066, T068, T071, T073 |
| FR-040, FR-041 | T074, T076 |
| FR-042 | T024 |
| FR-050 | T045, T047, T048 |
| FR-051 | T079–T082 (reviewed; `check:docs-translations`, `build:docs`) |
| FR-052 | T083 (`check:release-intent`) |

## Merge with 163 R24 (2026-10-29, research R-18)

- [X] M01 `cmsPageUrl` composes the prefixed path from the channel's URL facts (contracts test first)
- [X] M02 CMS resolver: per-language `url`/`alternates` prefixed, only channel languages, cache keyed by URL facts
- [X] M03 Storefront CMS route: no `?lang=` override, backend canonical, alternates + `x-default`, prefixed redirect
- [X] M04 Sitemaps: per-language CMS slugs (storefront from the index's `alternates`, `seo` via `cmsLocalizedPage`)
- [X] M05 Prefix reservation and the shadow marker cover every per-language slug
- [X] M06 R24 tests, cms docs (EN + PL) and 163 spec/data-model updated to the prefixed URLs

