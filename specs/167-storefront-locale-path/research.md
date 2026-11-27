# Research — Storefront language in the URL path (feature 167)

Every entry is *decision → rationale → alternatives rejected*. File paths are as of `4d2c03490`
(`origin/master`, 2026-10-29). Owner rulings OR-1…OR-9 are in `spec.md` and are not reopened here;
this document decides what they leave open. The owner's answers of 2026-10-29 (OR-10…OR-13) are
folded in below; no open question remains.

## Survey (verified, not copied)

| Fact | Where |
| --- | --- |
| Page locale resolved by `resolveLocale` (`langQuery` list → `Accept-Language` → `i18n/config` default), against the **platform-wide** active list | `storefront/lib/i18n/locale.ts` |
| Sole caller; passes `[langOverride, lang cookie]`; `langOverride` comes only from the PDP's `?lang=` | `storefront/lib/server-context.ts` (~l.116) |
| `?lang=` read only by the PDP through `requestedLanguage()` | `storefront/app/(catalog)/p/[slug]/resolution.ts`, `page.tsx` |
| Middleware: robots header, `x-pathname`, channel stamp, 503 rewrite, closed-store 307; matcher everything but `/_next/static` | `storefront/middleware.ts`, `lib/seo/robots-directive.ts` (`isDocumentPath`) |
| Channel identity cached per process (1 min), parsed without a validation library | `storefront/lib/channel/channel-identity.ts` |
| Switcher writes `lang` cookie + `router.refresh()`; hard-coded Polish label `Język:` | `storefront/components/HeaderPreferenceSwitchers.tsx` |
| 139 hand-written `href="/…"`/`` href={`/…`} `` in `app`, `components`, `lib`; 205 `redirect(`/`permanentRedirect(` call sites (most with a literal path); 20 files use `usePathname` | grep, 2026-10-29 |
| Reserved top-level segments, reconciled with the route tree by `check:storefront-indexability` | `storefront/app/reserved-segments.ts` |
| CMS refuses a slug whose first segment is in the deployment's `cms.reserved_slug_segments` Setting (`CMS_SLUG_RESERVED`) | `packages/modules/cms/src/backend/services/cms-page-service.ts` (`assertSlugNotReserved`), `index.ts` |
| CMS block links resolved by one function with an env object | `packages/cms-components/src/utils/link-href.ts` (`resolveLinkHref`, `LinkHrefEnv`); `CategoryGrid.tsx`, `CategoryList.tsx`, `CmsProductCard.tsx` hand-build `/c/…`, `/p/…` |
| `productPath()` — the one product URL composer; appends `?lang=` for a non-default language | `packages/contracts/src/product-url-keys.ts:51`; callers `catalog` (`catalog-query.service.ts` `#pagePaths`, `url-key-resolution.service.ts`, `url-key.service.ts`), `seo` (`sitemap-generator.service.ts`) |
| Product feed link hand-built as `${origin}/p/${item.slug}?lang=` — global slug, not the per-language key | `packages/modules/product_feeds/src/backend/services/item-field-resolver.ts:254` |
| `SalesChannel` entity and table are **kernel-owned** since 072 T019; per-channel flags are columns (154's `anonymous_access`, migration `--module core`) | `packages/platform/src/kernel/sales-channels/sales-channel.entity.ts`, `packages/platform/src/migrations/20261018T101912_core_sales_channels_anonymous_access.ts` |
| Channel cache `sales-channels:v4:`; `CachedChannel` is what resolvers and emitters read | `packages/platform/src/kernel/sales-channels/sales-channels-cache.ts` |
| Identity writes go through a Command | `packages/modules/sales_channels/src/backend/commands/identity.command.ts` |
| Category, CMS and blog slugs are per channel, not per language; only products have per-language keys | `catalog/.../category.entity.ts`, `cms/.../cms-page.entity.ts`, `blog/.../blog-post-sales-channel.entity.ts` |

## R-1 — Next.js routing: middleware rewrite, not `app/[lang]/…`

**Decision**: keep the route tree as it is. The middleware parses the prefix, then
`NextResponse.rewrite`s the request to the **logical path** (prefix stripped) and forwards the
language on request headers it always writes or deletes (`x-storefront-language`,
`x-storefront-language-prefix`); `x-pathname` keeps carrying the logical path. Redirects (307/308)
are issued by the same function.

**Rationale**:
- Setting **off** needs a rewrite anyway: an unprefixed URL is the default language, so a tree under
  `app/[lang]/` would still need the middleware to rewrite `/p/x` to `/pl/p/x`. The rewrite is the
  common mechanism of both states; the `[lang]` segment would add a second one.
- The tree, `RESERVED_TOP_LEVEL_SEGMENTS`, `SITEMAP_STATIC_ROUTES`/`SITEMAP_DYNAMIC_ROUTES`, the
  `check:storefront-indexability` reconciliation and the CMS root catch-all `(content)/[...slug]`
  all keep their meaning. Under `app/[lang]/` the first segment of every route becomes dynamic,
  which collides with the root catch-all and invalidates 105's reserved-segment contract.
- Caching semantics do not change: every page already reads cookies through `getServerContext`, so
  pages are dynamic; the Data Cache key already includes the `Accept-Language` the transport sends
  (`lib/api/client.ts`), which is now the path language. Only `app/offline/page.tsx` is static,
  and it is language-neutral (`contracts/url-shape.md` §4).
- The middleware already makes the channel identity read the language needs (154), so the decision
  costs no round-trip (SC-005).

**Alternatives rejected**:
- *Move every route under `app/[lang]/`* — touches every route file, still needs the rewrite for
  setting off, breaks the reserved-segment and indexability contracts, and buys only
  `generateStaticParams` per language, which nothing can use while pages read cookies.
- *Next's `i18n` config* — Pages Router only; not available in the App Router.
- *Rewrites in `next.config.js`* — static, cannot read the channel's languages or setting.

**Behaviour to verify by spike before the middleware lands (task T004)**: in Next 15.5 with a
middleware rewrite — (a) `usePathname()` on the client and during SSR returns the **browser** path
(prefixed) or the rewritten one; (b) `<Link>` prefetch of a prefixed URL passes through the
middleware; (c) a server action posted from `/en/x` runs with the forwarded headers; (d)
`redirect()` inside a server action keeps the target as written. Whatever (a) answers, components
that compare `usePathname()` against a route must go through `stripLocalePrefix()` — the 20 files
are listed by the spike and fixed in US1.

**Spike result (T004, 2026-10-29, Next 15.5.27, `next build && next start`, Chromium via
Playwright; the spike app lived outside the tree and was deleted)**. Middleware rewrote `/en/<p>` to
`/<p>` with `x-lang` and `x-pathname` on the forwarded request headers:

- **(a)** `usePathname()` returns the **browser** path, prefixed, both in the server-rendered HTML
  (`/en/x`) and on the client after hydration (`/en/x`). Components comparing it against a route
  therefore go through `stripLocalePrefix()`; the server sees the logical path only through
  `x-pathname`.
- **(b)** The `<Link prefetch>` of `/en/y` is requested as `GET /en/y?_rsc=…` and passes through the
  middleware (logged), so it is rewritten like a document request.
- **(c)** A server action posted from `/en/x` arrives as `POST /en/x` with `next-action`, passes
  through the middleware and runs with the forwarded headers (`x-lang=en`, `x-pathname=/x`).
- **(d)** `redirect('/y?…')` inside that action reaches the browser as `/y?…` — exactly as written,
  no prefix added — and the follow-up `GET /y` passes through the middleware again. So every
  server-side redirect must be localized by the caller (`localeRedirect`), which is the design.

Files using `usePathname`, `useSelectedLayoutSegment(s)` or `x-pathname` (T003): `app/layout.tsx`,
`components/analytics/PageViewTracker.tsx`, `components/CartCounterBadge.tsx`,
`components/CatalogToolbar.tsx`, `components/HeaderSwitch.tsx`, `components/mobile/MobileTabBar.tsx`,
`components/NavigationFeedback.tsx`, `components/rfq/RfqDraftBadge.tsx`,
`components/RouteTransition.tsx`, `components/ShoppingListHeartBadge.tsx`,
`lib/seo/robots-directive.ts` (11 files today, not 20).

## R-2 — Prefix derivation, and where it lives

**Decision**: one pure function in `packages/contracts/src/storefront-language-path.ts`:
`channelUrlLanguages({ languages, defaultLanguage, prefixDefaultLanguage })` →
`ChannelUrlLanguage[]` (`languageCode`, `prefix`, `prefixed`, `isDefault`), in channel order with
the default language included (the `toScopeChannel` rule). Prefix = lower-case primary subtag
when exactly one channel language has that primary subtag, else the lower-case full tag. The
backend computes it and answers it on the public channel read (FR-004); the storefront middleware
consumes the answered list and never derives (it stays free of a validation library and of a second
implementation). Backend emitters call the same function through `storefrontPagePath()`.

Additionally, when the primary subtag is split across variants, the bare primary subtag is a
**split alias** of those variants (FR-015): `/en/…` answers 307 to the variant chosen by
the `lang` cookie, then `Accept-Language`, among them, else the first in channel order (accepted
by the owner, OR-13). Without it, adding `en-GB` to a
channel that had `en-US` would turn every indexed `/en/…` link into an unknown segment.

**Rationale**: `productPath()` is already the "one URL seam" (163 D7) and lives in contracts for
exactly this reason; the prefix is its missing input. A derived value cannot drift from the
languages it is derived from, which a stored prefix column could (OR-5 says derived).
Uniqueness: two channel languages yield the same prefix only if their codes are equal
case-insensitively, which the dictionary does not allow; the function asserts it and a unit test
proves it.

**Alternatives rejected**: a stored, operator-editable prefix per language (OR-5 says derived; adds
a uniqueness and reservation surface); deriving in the storefront (a second implementation for
every headless consumer, and the backend emitters need it anyway); the platform-wide language list
(R-17).

## R-3 — The setting: a kernel column, not a Settings-store value

**Decision**: `sales_channels.prefix_default_language boolean not null default true`, field
`prefixDefaultLanguage` on `SalesChannel`, carried by `CachedChannel` (cache key bumped to
`sales-channels:v5:`), edited through the channel identity PATCH and its Command. Migration is
scaffolded with `--module core`, because the `sales_channels` **table** is kernel-owned since 072
T019 — not by the `sales_channels` module (whose `manifest.ts` comment says so).

**Rationale**: the flag is read on every storefront document request (through the identity read)
and by every backend URL emitter, all of which already hold the cached channel. 154 R-5 rejected a
per-channel Settings value for `anonymousAccess` on the same grounds: a second cache read and a
second invalidation path. Command Bus audit and cache invalidation then come for free from the
identity write path (Principle XIII; the write seam awaits `SalesChannelsCacheInvalidation`, D-93).

**Alternatives rejected**: a channel-scoped Setting in the `sales_channels` group beside
`sales_channels.storefront_url` (two caches to invalidate; emitters would need `SettingsReadPort`
on top of the channel they already hold); a platform-wide setting (OR-1 says per channel); a
`sales_channels` module migration (the module does not own the table; `migration:new` would place
DDL against a kernel table in the wrong history).

## R-4 — Existing channels on upgrade (owner ruling OR-10)

**Decision**: the core migration adds the column with default `true` and then, in the same `up()`,
sets `prefix_default_language = false` on every row that exists at that moment. Existing channels
keep every URL they had; new channels (created by the admin, the API or the default-channel
reconciler on a fresh database) start prefixed (OR-1). The upgrade note — in
`docs/docs/upgrading-an-instance.md` (EN + PL) and in the changeset — says existing channels are
unchanged, what switching the setting on does (every URL moves under a prefix, old links 307), and
where the switch is.

**Rationale**: an upgrade moves no default-language URL, so nothing indexed or bookmarked is
redirected unless an operator asks for it. Non-default languages still gain prefixes on upgrade
(their old `?lang=` links answer 308, R-5), which is the point of the feature.

**Consequence for a fresh install**: no migration inserts a channel — the boot-time default-channel
reconciler does (`core_sales_channels_promote` leaves the insert to it) — so on an empty database
there is no row to backfill and the default channel starts **on**. The migration's integration test covers both orders (T012).

**Alternative rejected**: existing channels on (one rule for every channel, but every storefront's
URLs would move at upgrade without an operator's decision).

## R-5 — Status codes and cache headers

**Decision**:

| Case | Status | Headers |
| --- | --- | --- |
| Setting on, unprefixed (OR-2, OR-11) | 307 | `Vary: Accept-Language, Cookie`, `Cache-Control: private, no-store` |
| Split alias `/en/…` (FR-015) | 307 | same (the variant is chosen by cookie → `Accept-Language` → first, in both setting states) |
| Setting off, default prefix (OR-3) | 308 | `Cache-Control: public, max-age=3600` |
| Setting off, unprefixed with `?lang=<channel language>` | 308 | same |
| Mixed-case prefix (FR-014) | 308 | same |
| PDP key of another language (FR-024) | 307 | page default (dynamic) |
| PDP former key (163) | 308 (unchanged) | unchanged |

**Rationale**: 307 where the answer depends on the visitor (OR-2) or on mutable data (a key held in
another language today may be another product's tomorrow). 308 where the mapping is a property of
the URL. The 308s carry a **bounded** `max-age` because the channel setting can be flipped: a
browser that cached `/pl/x → /x` forever would loop after the operator switches the setting back
on (`/x → /pl/x`). One hour bounds the stale window; search engines still read a 308.

**Alternatives rejected**: 301/302 (method-changing; a POST to an unprefixed form action would
become a GET); uncached 308 (no-store makes every bookmark a round-trip forever); 307 for setting
off (OR-3 says 308).

## R-6 — One storefront href helper, enforced by lint

**Decision**: `storefront/lib/i18n/locale-path.ts` (pure): `localizePath(path, urlState)`,
`stripLocalePrefix(pathname, urlState)`, `parseLocalePath(pathname, urlLanguages)`. Thin adapters:
`<LocalizedLink>` (client component over `next/link`, reads `LocalePathContext` provided by the root
layout), `useLocalizedPath()`, `localizedPath()` for server code (reads the forwarded header),
`localeRedirect()` / `localePermanentRedirect()` wrapping `next/navigation`. `localizePath` is
idempotent (an already-prefixed path is unchanged) and leaves language-neutral paths, absolute
URLs, `//…`, `#…`, `?…`, `mailto:`/`tel:` untouched. The 139 hrefs and the literal-path redirects
are converted in US1.

The rule is an ESLint `no-restricted-syntax` block in `storefront/eslint.config.js`: a JSX `href`
on `a`/`Link` whose value is a string or template literal starting with `/`; the first argument of
`redirect`, `permanentRedirect`, `router.push`, `router.replace`, `NextResponse.redirect(new URL(…))`
when it is such a literal. Exempt: `lib/i18n/locale-path*.ts(x)` and `test/**`. A companion test
lints a fixture and asserts each selector fires (red proof) and that the helper forms pass.

**Rationale**: lint already runs over `app components lib scripts test` in the `quality` workflow
(`pnpm -r run lint`), so the rule is enforced in CI and in the editor; it reads every storefront
file by construction, so the *green-that-means-not-looking* failure `check-estate.md` guards against
cannot occur. Dynamic `href={x}` cannot be judged statically; backend paths arrive prefixed, and
`LocalizedLink` localizes whatever it is given.

**Alternatives rejected**: a new `check-*` script (re-implements an AST walk ESLint already does,
and owes an inventory entry, an estate verdict, a recorded read size and CI wiring for no extra
signal); a middleware *Referer* heuristic that keeps the previous page's prefix on an unprefixed
navigation (unreliable — `Referer` is stripped by policy — and it hides the defect instead of
removing it); relying on the 307 alone (a buyer on `/en` with a Polish browser would be switched to
Polish by every unconverted link).

## R-7 — The switcher

**Decision**: the switcher renders, server-side, one `<a>` per channel language to
`localizePath(logicalPath + search, that language)` — the same logical path under the other prefix.
On a page that published `hreflang` alternates (`<link rel="alternate" hreflang>` in the head), the
client component replaces each option's `href` with the alternate for that language after
hydration, so the product page's English option is `/en/p/drill` directly. Without JavaScript the
generic link still arrives through FR-024's 307. Activating an option also writes the `lang` cookie
(OR-11: `path=/`, one year, `samesite=lax`, as today) in a click handler that does not cancel the
navigation, so the choice is remembered for the next unprefixed visit; without JavaScript the
navigation still happens and only the remembering is lost. It is hidden for a single-language
channel. Labels are each language's own name (endonym) from the dictionary; the
group's accessible name comes from `storefront/lib/i18n/messages.ts` (replacing the hard-coded
`Język:`).

**Rationale**: the header is rendered by the root layout, which in the App Router cannot read the
page's data; the alternates are already in the document head because the page's metadata emits
them. Reading them keeps one source for "this page in language L".

**Alternatives rejected**: a request-scoped store the page writes and the layout reads (render order
of layout and page is not guaranteed); parallel routes for the header (restructures the layout for
one widget); keep cookie + refresh only (the path overrides the cookie — the switcher would do
nothing); setting the cookie from the middleware on every prefixed render (it would record every
followed link as a preference, which OR-11 gives to the switcher alone).

## R-8 — Canonical, `hreflang`, `x-default`

**Decision**: a storefront helper `pageAlternates(logicalPath, urlState)` returns
`{ canonical, languages }` for the pages whose slug is language-independent (home, catalogue,
category, search, CMS, blog, contact); the product page uses the backend's `paths`, which gains
`xDefault`. `x-default` is the **unprefixed** URL in both states: setting on, it is the negotiating
entry (Google's documented use of `x-default` for a locale-redirecting page); setting off, it is the
default-language page itself. Non-indexable pages (cart, checkout, account) emit no alternates, as
today.

**Rationale**: OR-7; one rule for both states keeps the helper trivial.

**Alternatives rejected**: `x-default` = the default language's prefixed URL under setting on (it
would duplicate the `pl-PL` alternate and lose the negotiating entry).

## R-9 — A product key of another language under a prefix (FR-024)

**Decision**: `UrlKeyResolutionService.resolve` gains a third step after "current key in L" and
"redirect key in L": look the key up among the product's **current** keys of the channel's other
languages (channel order). A hit whose product is reachable at (C, L) answers
`{ kind: 'redirect', permanent: false, path: productPath(effective key at L) }`; the storefront
answers 307 for `permanent: false` and 308 otherwise. A miss, or an unreachable product, is the
ordinary 404.

**Rationale**: this is what makes the 307 of OR-2 safe for products: a pre-feature link
`/p/wiertarka` opened by an English browser goes `/en/p/wiertarka` → `/en/p/drill` instead of a
404 — the exact defect of #396. 163's K1 ("a key is valid only in its own language") holds: the
page is never **rendered** under a foreign key, it redirects to the language's own key. The issue's
rejected alternative ("fall back to the key's language") rendered the same URL differently per
visitor; this answers every visitor identically.

**Alternatives rejected**: 404 (reintroduces the defect through the 307); asking the backend for the
key's language in the middleware (a catalog round-trip on every product request); 308 (the mapping
depends on key data that can change hands).

## R-10 — Emitter inventory (FR-031…FR-034)

The rule for every emitter: compose with `storefrontPagePath({ path, languageCode, channel })`
(or `productPath`) from contracts, where `channel` is the `CachedChannel` the emitter resolves and
`languageCode` is the language the message is rendered in, else the channel default.

| Emitter | File | Channel known | Language | Change |
| --- | --- | --- | --- | --- |
| PDP canonical/alternates, resolve redirect, admin URL-keys panel | `catalog/.../catalog-query.service.ts`, `url-key-resolution.service.ts`, `url-key.service.ts` | yes | per entry | new `productPath` signature; `xDefault` |
| `seo` sitemap | `seo/.../sitemap-generator.service.ts` | yes | per channel language | prefixed product, **category, CMS** URLs per language (categories/CMS are listed once today) |
| Storefront sitemap | `storefront/app/sitemap.ts` | yes | per channel language | same |
| Product feeds `link` | `product_feeds/.../item-field-resolver.ts:254` | yes | feed language | effective key via `CatalogProductUrlKeyReadPort` (163 R28) + `productPath` |
| Org verification e-mail | `organizations/.../email-templates/verification.ts` | via registration channel | e-mail language | `/verify` prefixed |
| Org invitation e-mail | `organizations/.../email-templates/invitation.ts` | yes | e-mail language | `/invitations/…` prefixed |
| Admin-initiated password reset | `customers/.../routes.admin.ts:526` | customer's channel | e-mail language | prefixed; **note**: it links `/reset-password`, which no storefront route serves (`(auth)/password-reset/…` does) — fix the path in the same task |
| Newsletter confirm/unsubscribe redirects and links | `newsletter/.../routes.storefront.ts` | subscriber's channel | subscriber language | prefixed |
| Invoice download link | `invoices/.../invoice-email-dispatch.ts:109` | yes | `resolveLanguage(channelId)` | prefixed; **note**: `/orders/:id/invoices/:id/pdf` is served by no storefront route today — verify the intended target before prefixing |
| Comparison share link and PDF | `comparisons/.../document/comparison-document-data.ts` | yes | document language | prefixed |
| MFA OAuth return (`/login/mfa`, `/login?error`, `next`) | `mfa/.../routes.oauth.ts` | tx channel | language of the page that started it, carried in the tx | prefixed; `next` already prefixed by the storefront |
| Re-order `checkoutUrl` | `orders/.../order-reorder-service.ts` | consumed by the storefront | — | relative; localized by the storefront on use |
| Megamenu category links | `megamenu/.../cross-module-ports.ts:90` | — | — | relative; localized at render (FR-020) |
| CMS block links, product cards | `packages/cms-components` | — | — | `LinkHrefEnv.localizePath` |

**T070 investigation (2026-10-29) — `[NEEDS CLARIFICATION]` for the owner.** The invoice e-mail's
`downloadUrl` is `<storefront_url>/orders/<orderId>/invoices/<invoiceId>/pdf`
(`invoices/.../invoice-email-dispatch.ts`). No storefront route serves that path: the storefront has
the order page `/orders/[id]` (`app/(account)/orders/[id]/page.tsx`), whose download links point at
the **backend** route `GET /api/v1/orders/:id/invoices/:invoiceId/pdf` on the API origin
(`storefront/lib/api/invoices.ts` `invoiceDownloadUrl`, `invoices/.../routes.customer.ts`). Two
targets are plausible and they differ in kind: (a) the storefront order page `/orders/<orderId>`,
a page URL that would take the language prefix like every other emitter; (b) the backend PDF URL on
the API origin — not a storefront page, so not prefixed, and served only with the buyer's session
cookie on that origin. The owner has to choose; T071/T072 wait for it.
**Owner ruling (OR-14, 2026-10-29): option (a)** — the e-mail links `/<lang>/orders/<orderId>` through `storefrontPagePath`.

Not storefront page URLs (unchanged): `crm`/`projects`/`tasks` `reference-service.ts` (admin
routes), API URLs, asset URLs.

## R-11 — Reservation (OR-5)

**Decision**:
1. **CMS** (FR-040): `assertSlugNotReserved` also refuses a first segment equal to any prefix
   (including split aliases) of any channel, read through the kernel's channel resolution port
   (always present; `sales_channels` is non-deactivatable). Same `409 CMS_SLUG_RESERVED` with
   `{ segment }` — no new error code; the sentence already says the segment is reserved by the
   storefront. Platform-wide, like the existing reserved set, because a page publishes to *n*
   channels.
2. **Reverse direction** (FR-041): a channel save is never refused for a CMS slug (`sales_channels`
   cannot depend on `cms` — `cms` already depends on it). The CMS page list computes a `shadowedBy`
   marker at read time from the same port.
3. **Storefront segments** (FR-042): the storefront's parser checks language-neutral segments first
   and its reserved page segments are 1 character or ≥4 characters today, so no channel prefix
   (2–3-letter primary subtag, or a full tag with a hyphen) can equal one. A storefront unit test
   asserts that every reserved segment either is language-neutral or does not match the prefix
   grammar, so adding a route like `/faq` fails it and forces a decision.

**Alternatives rejected**: `sales_channels` reading `cms.reserved_slug_segments` (another module's
setting; `cms` may be off); a contracts constant mirroring the storefront route table (105 D-9
refuses a consumer fact written into the backend).

## R-12 — The `lang` cookie (owner ruling OR-11)

**Decision**: the cookie chooses the target of the setting-on 307 only: `?lang=` → `lang` cookie →
`Accept-Language` → default, each matched against the channel's languages (a cookie naming another
language is skipped). The 307 varies on `Accept-Language, Cookie`. It never chooses the language of
a rendered page: `getServerContext` stops reading it (the path decides, OR-4) and the PDP's
`langOverride` goes. With the setting off it is not read at all (OR-3). The middleware reads it from
the request (`request.cookies.get('lang')`); the switcher writes it (R-7).

**Rationale**: a buyer who chose English and later types the bare domain lands in English, as on
most multi-language shops; a shared cache cannot serve that redirect to someone else because of
`Vary: Cookie` and `private, no-store`.

## R-13 — A prefix the channel does not serve (owner ruling OR-12)

**Decision**: an ordinary path. `/de/p/x` on a channel without German is the logical path
`/de/p/x`: setting on → 307 to `/<L>/de/p/x` (CMS page or not-found), setting off → rendered as is
(CMS page or not-found). Only the channel's own prefixes and split aliases are reserved (R-11).

## R-14 — Order inside the middleware

1. Non-document → as today (robots header, channel stamp), no language work.
2. Language-neutral document path → as today.
3. Outage gate → 503 rewrite **at the requested URL**; notice language from the parsed prefix when
   the last-known identity allows, else `resolveLocaleWithoutConfig`.
4. Parse the prefix against the identity's URL languages (FR-010…FR-015) → either a redirect
   (stop) or `{ language, prefix, logicalPath }`.
5. Closed-store check on the **logical** path; its target localized (one hop).
6. Rewrite to the logical path with the language headers.

Identity unknown at step 4 → skip 4 and 5's localization, render (FR-019).

## R-15 — Tenancy, channel scoping, activation

- **XI**: no tenant-scoped entity is added; the column is on a `@GlobalEntity`. No no-organization
  path is introduced.
- **XII**: the language list comes from the resolved channel through `getResolvedChannel()` /
  `SalesChannelResolutionPort`; no bridge table is read.
- **XVII**: `sales_channels` is non-deactivatable, so the setting has no off state. `cms` off → no
  pages, no reservation needed. `seo` off → its sitemap is absent; the storefront still emits
  canonical and alternates (it did before). `product_feeds`, `newsletter`, `mfa`, `comparisons`,
  `invoices` off → their emitters are absent; nothing new to gate. No new route, worker or
  subscriber.

## R-16 — Precedent (OR-9)

- **Magento 2** — *Stores › Configuration › General › Web › Add Store Code to URLs* is a
  **global** switch: on, every store view (≈ language) is prefixed, including the default; hiding
  the default store's code needs third-party modules, and merchants report duplicate content
  between `/` and `/default/…`. → why the setting here is per channel and the default-prefixed
  duplicate answers 308 (OR-3).
- **Sylius** — shop routes are `/{_locale}/…` always; `/` redirects to the channel's default
  locale; locales are per channel. → closest to setting on, and to "the channel's language list is
  authoritative" (R-17).
- **Medusa Next.js starter** — `/[countryCode]/…` always; middleware redirects a bare path to a
  region chosen from the request. → the middleware-redirect shape of OR-2; the starter's route tree
  is `app/[countryCode]/…`, which R-1 declines for the reasons given there.

## R-17 — The channel's languages are authoritative

**Decision**: URL languages are the channel's `languages` (default included); `resolveLocale` is
fed the channel's list from the public channel read rather than `i18n/config`'s active list.

**Rationale**: content scoping is per channel (XII; CMS and megamenu refuse a language outside the
channel scope); a page in a language the channel does not sell in cannot be correct. The
dictionary validator already refuses an inactive language when a channel's list is changed.

**Alternative rejected**: the intersection with the platform's active list (a dictionary edit would
silently remove a prefix and its URLs from a live channel).

## R-18 — Merged with 163 R24: a CMS page has a slug per language (2026-10-29)

163 R24 (`specs/163-page-builder-marketing-pages/` FR-034a) landed on `master` while this feature
was in flight: a CMS page can set its name, slug and description per language, and R24 addressed a
non-default language with `?lang=` through a new `cmsPageUrl`, the CMS twin of `productPath`. The
merge keeps R24's data and replaces its URL shape with this feature's:

- `cmsPageUrl` takes the channel's `ChannelUrlFacts` and composes `/<prefix>/<slug in L>` through
  `storefrontPagePath`; `?lang=` is never emitted (OR-7). The resolved page's `url`/`alternates`
  and the storefront page index carry those URLs; a language the channel does not serve gets none
  (FR-005).
- The CMS route reads no `?lang=` override (OR-4); its canonical is the backend's `url`, its
  alternates every served language's URL plus `x-default` (the default language's URL without its
  prefix). A one-language page lists that language and `x-default` (FR-030) rather than R24's
  "none". R24's permanent redirect from another language's slug stays, now prefixed.
- The language switcher needs nothing new: it reads the page's `hreflang` alternates, so on a CMS
  page it lands on the other language's slug.
- The storefront sitemap lists the index's per-language URLs; the `seo` sitemap uses
  `cmsLocalizedPage` (via `translations` on `CmsPageRecord`). The index-entry `languages` field
  this feature had added is dropped — R24's `alternates` carry the same fact.
- CMS prefix reservation (FR-040): R24 already passes every per-language slug through
  `assertSlugNotReserved`, so every slug is reserved; the list's shadow marker looks at every slug.
- Resolved CMS pages are cached for five minutes; the cache key's channel segment now includes the
  channel's URL facts (`CmsCache.pageChannel`), so flipping the setting or the language list misses
  stale URLs.
