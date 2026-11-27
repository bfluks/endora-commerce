# Feature Specification: Storefront language in the URL path

**Feature Branch**: `167-storefront-locale-path`
**Created**: 2026-10-29
**Status**: Draft
**Input**: GitHub issue #396 — *"Storefront: language in the URL path (/en/p/…) so every product,
category and content link names its language"*, plus the owner's rulings recorded below.

**Related**: `specs/163-product-data-scopes/` (per-language product URL keys, issue #385; its
Q-B → C deferred the path prefix to this issue and left `?lang=<L>` as the interim, FR-071/FR-074),
`specs/154-sales-channel-access/` (closed-store redirect in the storefront middleware),
`specs/144-seo-search-engine-robots/` (per-channel robots through the same middleware seam),
`specs/108-storefront-response-status/` (pre-migration, cited for the 503 rewrite rule — its
directory is not in this tree).

## Context

A storefront URL does not say which language it is in today. The page language is picked from the
`lang` cookie, the browser's `Accept-Language`, or the configured default; only the product page
reads `?lang=`. Since product URL keys became per language (163), a Polish-default link
`/p/wiertarka` opened by a browser set to English resolves in English, finds no English key
`wiertarka` and answers not-found although the product exists. Search engines cannot index one URL
per language either.

This feature makes the language part of the path: `/pl/p/wiertarka`, `/en/p/drill`. A URL then
means one language for every visitor and every crawler, the language switcher links to the same
page in another language, and every URL the platform emits names its language.

## Owner rulings *(binding; recorded 2026-10-29, not to be reopened by this feature)*

- **OR-1 — Per-channel setting, default on.** Every sales channel has a setting *"prefix the
  default language"*, **on by default**, editable by an operator with the right to manage sales
  channels, labelled in English and Polish.
- **OR-2 — Setting on.** Every storefront page URL carries a language prefix. A request without one
  is answered **307** to the prefixed URL of the language chosen by `?lang=` → `Accept-Language` →
  the channel's default language, with `Vary: Accept-Language`. The rest of the query string is
  preserved.
- **OR-3 — Setting off.** A URL without a prefix always means the channel's default language — there
  is **no** `Accept-Language` negotiation (it would reintroduce the ambiguity). A URL prefixed with
  the default language is answered **308** to the unprefixed URL (no duplicate content). Every
  other language is prefixed.
- **OR-4 — The path wins.** The language in the path beats `?lang=`, the `lang` cookie and
  `Accept-Language`.
- **OR-5 — Prefix shape.** The short lower-case primary subtag (`/pl`, `/en`); the full lower-case
  tag (`/en-gb`) only when the channel has two active variants of the same primary language.
  Derived deterministically and unique within the channel. A channel's prefixes are reserved
  against CMS page slugs and against the storefront's reserved segments.
- **OR-6 — Switcher.** The language switcher links to the same page's URL in the other language
  (the product's key in that language), instead of setting a cookie and refreshing.
- **OR-7 — Every emitter.** Canonical and `hreflang` alternates (including `x-default`), the
  sitemap, product feeds, transactional e-mails and every other emitter use prefixed URLs.
- **OR-8 — Coverage.** Product, category, CMS, blog, search and every other page route are
  covered. API and file routes (`/api`, `/_next`, `robots.txt`, the sitemap, the web manifest,
  `llms.txt` and the like) are not prefixed.
- **OR-9 — Precedent.** Magento 2, Sylius and the Medusa starter were researched; see
  `research.md` R-16.

### Owner answers to the open questions *(2026-10-29, binding)*

- **OR-10 — Existing channels stay unprefixed at upgrade** (was OQ-3). The migration sets the
  setting **off** for every channel that exists when it runs; the column default stays **on**, so
  channels created afterwards start prefixed (OR-1). The upgrade note (docs and changeset) tells
  operators how to switch it on.
- **OR-11 — The `lang` cookie takes part in the 307** (was OQ-1). With the setting on, an
  unprefixed request is answered 307 to the language chosen by `?lang=` → `lang` cookie →
  `Accept-Language` → channel default, with `Vary: Accept-Language, Cookie`. This refines OR-2's
  chain. The switcher keeps writing the `lang` cookie **and** navigates to the other language's URL.
  With the setting off the cookie decides nothing (OR-3); on a prefixed URL the path still wins
  (OR-4).
- **OR-12 — Only the channel's own prefixes are special** (was OQ-2). A first segment that is a
  prefix of a platform language the channel does not serve (`/de/…` on a channel without German)
  is an ordinary path: a CMS page if one exists, else not-found, exactly as today. Only the
  channel's own prefixes are reserved (OR-5).
- **OR-13 — Two derived decisions accepted.** With the setting off, `/p/x?lang=en-US` answers 308
  to the prefixed URL (`/en/p/x`); a short prefix keeps working after a channel adds a second
  variant (`/en` answers 307 to `en-US` or `en-GB`, FR-015).

- **OR-14 — The invoice e-mail links the storefront order page** (T070, 2026-10-29). The invoice
  e-mail's link is the storefront order page `/<lang>/orders/<orderId>`, composed through the same
  prefixed-URL builder as every other emitter; that page already lists the order's invoices with a
  PDF download. The former `/orders/<id>/invoices/<id>/pdf` storefront address, which no route
  served, is retired.

- **OR-15 — A current key of another channel language redirects whatever `seo`'s state**
  (2026-10-29). 163's FR-111 hides a product's **redirect rows** (former keys) while `seo` is off,
  so such a key answers exactly what a key of no product answers. FR-024's step is not a redirect
  row: it reads the product's **current** keys of the channel's other languages, which `catalog`
  owns. So a key that is both a former key of the path language and a current key of another
  channel language (`/pl/p/new`, `new` being the product's current en-US key) answers 307 to the
  product's key in the path language even while `seo` is off; with `seo` on, the former-key 308
  answers first, as before. No redirect row is read for the 307.

## Clarifications

### Session 2026-10-29 (architect; decisions derived from the rulings — see `research.md`)

Items marked *(accepted, OR-13)* were confirmed by the owner on 2026-10-29.

- Q: Which languages may appear as a prefix — the platform's active list or the channel's? → A:
  **The channel's language list is authoritative** (with its default language always included).
  The storefront stops resolving against the platform-wide active list (R-17).
- Q: With the setting off, what does an unprefixed URL with `?lang=<non-default>` mean (every
  non-default product link 163 emitted looks like that)? → A: it is an explicit request, not
  negotiation: **308** to the prefixed URL of that language, `lang` removed. `?lang=<default>` →
  308 to the same URL without `lang`. An unknown `?lang=` is ignored (R-5). *(accepted, OR-13)*
- Q: A product key that is not a key in the path's language (`/en/p/wiertarka`)? → A: the product
  page looks the key up in the channel's other languages and answers **307** to the product's own
  URL in the path language (`/en/p/drill`) when the product is available there; otherwise
  not-found. The page is never rendered under a key of another language (163 K1 holds) (R-9).
- Q: Does a prefix change when a channel gains a second variant of a language? → A: yes — the rule
  is derived (OR-5). The short prefix then answers **307** to the matching variant, so links taken
  before the change keep working (R-2). *(accepted, OR-13)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 — One URL, one language, for everyone (Priority: P1)

A buyer opens `/en/p/drill`; a crawler, a colleague with a Polish browser and a visitor with a
`lang=pl` cookie all see the English page. Every page of the storefront — home, catalogue,
category, product, search, CMS page, blog, cart, checkout, account, authentication — lives under
the channel's language prefixes.

**Why this priority**: it is the defect in #396 and the precondition for every other story.

**Independent Test**: on a channel with Polish (default) and English and the setting on, request
the same page path under `/pl` and `/en` with every combination of cookie and `Accept-Language`;
the rendered language, `<html lang>` and the backend's content language follow the path only.

**Acceptance Scenarios**:

1. **Given** a channel with `pl-PL` (default) and `en-US`, setting on, **When** a browser with
   `Accept-Language: pl` and cookie `lang=pl-PL` opens `/en/p/drill`, **Then** the English product
   page is rendered with `<html lang="en-US">` and status 200.
2. **Given** the same channel, **When** `/pl/c/elektronarzedzia?sort=price` is requested, **Then**
   the category page renders in Polish with its query intact.
3. **Given** the same channel, **When** `/en` is requested, **Then** the English home page renders
   (no trailing slash is required; `/en/` answers the same page).
4. **Given** a prefixed page, **When** any link, form action or in-app redirect on it is followed,
   **Then** the target URL carries the same prefix (no unprefixed internal link is emitted).
5. **Given** a prefixed URL with `?lang=pl-PL`, **When** it is opened, **Then** the path language
   is used and `?lang=` is ignored (OR-4).

---

### User Story 2 — Every existing link and bookmark keeps working (Priority: P1)

Links shared, bookmarked, indexed or printed before this feature — unprefixed URLs, 163's
`?lang=<L>` product links — still land on the right page in the right language.

**Why this priority**: every new channel, and every existing channel an operator switches on
(OR-10), moves all its URLs; without this story every existing link degrades.

**Independent Test**: replay a list of pre-feature URLs (default-language and `?lang=` product
links, category, CMS and account URLs) against a channel in each setting state and assert the
status code, `Location`, `Vary` and the final page.

**Acceptance Scenarios**:

1. **Given** setting on, **When** `/p/wiertarka?variant=X` is requested with
   `Accept-Language: pl-PL`, **Then** the answer is 307 to `/pl/p/wiertarka?variant=X` with
   `Vary: Accept-Language, Cookie`.
2. **Given** setting on, **When** `/p/bohrer?lang=de-DE&variant=X` is requested (German is a
   channel language), **Then** 307 to `/de/p/bohrer?variant=X` whatever `Accept-Language` says.
3. **Given** setting on, **When** `/p/wiertarka` is requested with `Accept-Language: en`, **Then**
   307 to `/en/p/wiertarka`, which answers 307 to `/en/p/drill` (the product's English key), which
   renders the English page.
4. **Given** setting off, **When** `/p/wiertarka` is requested with `Accept-Language: en`, **Then**
   the Polish (default) page renders with 200 — no negotiation (OR-3).
5. **Given** setting off, **When** `/pl/p/wiertarka?variant=X` is requested, **Then** 308 to
   `/p/wiertarka?variant=X`.
6. **Given** setting off, **When** `/p/bohrer?lang=de-DE` is requested, **Then** 308 to
   `/de/p/bohrer`.
7. **Given** a key that is a former key in the path language (163 redirect key), **When** it is
   requested under its prefix, **Then** the existing permanent redirect to the current key still
   answers, prefixed.
8. **Given** setting on and cookie `lang=en-US`, **When** `/c/narzedzia` is requested with
   `Accept-Language: pl`, **Then** 307 to `/en/c/narzedzia` (OR-11); with `?lang=pl-PL` added,
   307 to `/pl/c/narzedzia`.
9. **Given** an instance upgraded to this feature, **When** its existing channels are read,
   **Then** the setting is off and every pre-feature URL renders as before (OR-10).

---

### User Story 3 — The operator chooses whether the default language is prefixed (Priority: P2)

On the sales channel's edit screen an operator sees a switch *"Prefix the default language in
URLs"* (PL: *"Prefiks języka domyślnego w adresach URL"*), on by default, with a hint showing the
resulting URL shapes and the derived prefix of every channel language.

**Why this priority**: the default (on) is useful without the switch; the switch serves shops that
want to keep their existing default-language URLs.

**Independent Test**: toggle the switch on a channel through the admin and the admin API; the
change is audited with before/after, the storefront follows within the channel identity cache
window, and other channels are unaffected.

**Acceptance Scenarios**:

1. **Given** a new channel, **When** it is created without the field, **Then** the setting is on.
2. **Given** an operator with `sales_channels:write`, **When** they switch it off and save,
   **Then** one audit entry records before/after, and within one minute unprefixed URLs on that
   channel render the default language.
3. **Given** an operator with only `sales_channels:read`, **When** they open the channel, **Then**
   the switch is shown read-only.
4. **Given** a channel with `pl-PL`, `en-US`, `en-GB`, **When** the edit screen is open, **Then**
   it lists `pl-PL → /pl`, `en-US → /en-us`, `en-GB → /en-gb` and says that changing the
   languages or the switch changes the storefront's URLs.
5. **Given** the admin in Polish, **When** the screen renders, **Then** label and hint are Polish.

---

### User Story 4 — The language switcher goes to the same page in the other language (Priority: P2)

A buyer on `/pl/p/wiertarka` picks *English* and lands on `/en/p/drill`. On a category, CMS page or
the cart they land on the same page under `/en`.

**Why this priority**: today's switcher only writes a cookie, which the path now overrides, so it
would do nothing once US1 ships; it must change in the same release as US1.

**Independent Test**: render the header on product, category, CMS, search and account pages; each
language option is a real link (works without JavaScript) whose target is that page's URL in the
language.

**Acceptance Scenarios**:

1. **Given** the product page `/pl/p/wiertarka` whose English key is `drill`, **When** the
   switcher renders, **Then** its English option links to `/en/p/drill`.
2. **Given** JavaScript disabled, **When** the English option is followed on a product page,
   **Then** the buyer still arrives at `/en/p/drill` (directly or through the 307 of US2-3).
3. **Given** `/pl/search?q=wiertarka`, **When** English is chosen, **Then** the target is
   `/en/search?q=wiertarka`.
4. **Given** a channel with one language, **When** a page renders, **Then** no switcher is shown.
5. **Given** the switcher, **Then** it offers the **channel's** languages only, labelled in their
   own language, and marks the current one with `aria-current`.
6. **Given** a buyer who picks English, **When** they later open the bare domain on a channel with
   the setting on, **Then** they land on `/en` — the switcher wrote `lang=en-US` (OR-11).

---

### User Story 5 — Search engines see one URL per language (Priority: P2)

Every indexable page declares its canonical (prefixed) URL and `hreflang` alternates for every
channel language it exists in, plus `x-default`; the sitemaps list prefixed URLs.

**Why this priority**: the SEO half of #396; it builds on US1.

**Independent Test**: fetch each indexable page type and both sitemaps on a two-language channel in
each setting state and validate canonical, alternates and `x-default` against the URL contract.

**Acceptance Scenarios**:

1. **Given** setting on, **When** `/pl/c/narzedzia` is fetched, **Then** its canonical is
   `/pl/c/narzedzia`, it lists `hreflang` `pl-PL → /pl/c/narzedzia`, `en-US → /en/c/narzedzia`
   and `x-default → /c/narzedzia`.
2. **Given** setting off, **When** `/c/narzedzia` is fetched, **Then** canonical is
   `/c/narzedzia`, alternates `pl-PL → /c/narzedzia`, `en-US → /en/c/narzedzia`, `x-default →
   /c/narzedzia`.
3. **Given** a product available to anonymous visitors in Polish only, **When** its page is
   fetched, **Then** only the Polish alternate and `x-default` are listed (163 FR-074 holds).
4. **Given** the `seo` module's sitemap and the storefront's own sitemap, **When** fetched,
   **Then** every page URL in them is prefixed per the channel's setting and no URL carries
   `?lang=`.

---

### User Story 6 — Everything the platform emits names its language (Priority: P3)

Product feeds, e-mails (verification, invitation, password reset, newsletter confirm/unsubscribe,
invoice links, comparison share links), backend-built redirects and the admin's *view in store*
preview links carry the prefix of the language they are for.

**Why this priority**: emitted unprefixed links still work through US2's redirects; this story
removes the redirect hop and the language guess.

**Independent Test**: run each emitter for a channel × language and assert the URL's prefix
matches the rendered language and the channel's setting.

**Acceptance Scenarios**:

1. **Given** an English Google feed of a channel with the setting on, **When** generated, **Then**
   every `link` is `<origin>/en/p/<English key>` — the per-language key, not the global slug, and
   no `?lang=`.
2. **Given** a verification e-mail rendered in Polish for a channel with the setting off, **When**
   sent, **Then** its link is `<origin>/verify?token=…`; for the setting on, `<origin>/pl/verify?…`.
3. **Given** the admin's product URL-keys panel, **When** it lists effective URLs, **Then** each is
   prefixed for its channel and language.

---

### User Story 7 — CMS pages never collide with a language prefix (Priority: P3)

An editor cannot save a CMS page whose first slug segment equals a language prefix of any channel,
and is told why in their language; an existing page shadowed by a newly added language is flagged.

**Why this priority**: rare, but silent shadowing is the exact defect 105's reservation exists for.

**Independent Test**: try to save a page slugged `en/o-nas` on an instance where a channel has
English; add English to a channel while a page slugged `en` exists.

**Acceptance Scenarios**:

1. **Given** a channel with English, **When** an editor saves a page slugged `en` or `en/o-nas`,
   **Then** the save is refused with `409 CMS_SLUG_RESERVED` naming `en`.
2. **Given** a published page slugged `de`, **When** German is added to a channel, **Then** the
   channel save succeeds, and the CMS page list marks the page as shadowed by a language prefix.

### Edge Cases

- **Unknown first segment** (`/xx/p/drill`, `xx` not a channel prefix): it is an ordinary
  unprefixed path. Setting on → 307 to `/<L>/xx/p/drill`, which answers not-found. Setting off →
  rendered in the default language, which answers not-found (unless a CMS page `xx/p/drill`
  exists). The same holds for a prefix of a platform language the channel does not serve
  (`/de/…` without German): it is an ordinary path (OR-12).
- **A language removed from the channel / a language deactivated in the dictionary**: its prefix is
  no longer a channel prefix and behaves as an unknown first segment. A language deactivated in
  the dictionary but still listed on the channel keeps its prefix (the channel list is
  authoritative).
- **Language not in the channel but in `?lang=` or `Accept-Language`**: ignored; the next rule in
  the chain decides.
- **Short prefix of a split language** (`/en/…` after `en-GB` joined `en-US`): 307 to the variant
  matched by the `lang` cookie, then `Accept-Language`, among the variants, else the first variant
  in channel order (OR-13).
- **Upper-case or mixed-case prefix** (`/EN/p/drill`, `/en-GB/…`): 308 to the lower-case prefix.
- **Trailing slash** (`/en/`): the same page as `/en`; canonical is `/en`.
- **Product key not existing in the path language** (`/en/p/wiertarka`): 307 to the product's key
  in the path language when the product is available there; not-found otherwise.
- **Cart, checkout, account, quote requests, shopping lists, returns**: prefixed like every page;
  the cart and the session are channel-scoped and language-independent, so switching language
  keeps the cart and the session.
- **Server actions and in-app redirects**: a form posts to the current (prefixed) URL; every
  `redirect()` in the app, every `?next=` value, the closed-store sign-in redirect and the
  session-expired redirect keep the current prefix.
- **Closed store (154)**: an anonymous visitor on a closed store is redirected in **one** hop to the
  prefixed sign-in page with a prefixed `next` (setting on: `/` → `/pl/login?next=%2Fpl`).
- **Backend unreachable (503)**: the outage gate runs first; the requested URL is answered 503 in
  place, never preceded by a language redirect. The notice's language is the path's when the
  prefix can be parsed from the last-known channel identity, else `Accept-Language`.
- **Channel identity never read** (cold process, backend up but the identity read failed): no
  language redirect is issued; the page renders in the channel default resolved by the backend.
  A wrong redirect is worse than one unprefixed render.
- **Cookies**: the `lang` cookie never decides the language of a rendered page — the path does
  (OR-4), and with the setting off an unprefixed URL is the default language (OR-3). It only
  chooses the target of the setting-on 307 (OR-11). The switcher writes it. A cookie naming a
  language the channel does not serve is skipped. Cookies are `path=/` and channel-wide, so
  session, cart and currency survive a language change.
- **Static and file routes** (`/_next/*`, `/api/*`, `/pwa/*`, `/robots.txt`, `/sitemap.xml`,
  `/llms.txt`, `/manifest.webmanifest`, `/offline`, `/service-unavailable`, public files): never
  prefixed, never redirected for language.
- **A CMS page slugged like a prefix that predates this feature** (slug `en`, English added): the
  prefix wins at the start of the URL. Under a prefix the page is still served (`/pl/en` is the
  logical path `/en`), but the unprefixed default-language URL `/en` (setting off) is the English
  home page, so the page is reported as shadowed (US7) until an editor renames it.
- **A channel with one language and the setting off**: no URL changes at all; `/pl/…` answers 308
  to the unprefixed URL.

## Requirements *(mandatory)*

### Functional Requirements

**Setting and derivation**

- **FR-001**: Each sales channel MUST carry a boolean *prefix the default language*, default **on**
  for new channels (OR-1), stored with the channel, exposed on the admin read and write shapes and
  on the public channel read.
- **FR-001a**: The upgrade MUST set the setting **off** for every channel that exists when the
  migration runs, leaving the default **on** for channels created later (OR-10).
- **FR-002**: Changing the setting MUST be an audited channel identity write (before/after), gated
  by `sales_channels:write`, and MUST invalidate the cached channel so the storefront and the
  backend emitters see the new value within the channel caches' documented window.
- **FR-003**: The platform MUST derive one URL prefix per channel language: the lower-case primary
  subtag when it is the only channel language with that primary subtag, else the full lower-case
  tag (OR-5). The derivation MUST be a single pure function shared by the backend and published to
  API consumers, and its output MUST be unique within the channel.
- **FR-004**: The public channel read MUST answer, per channel language, its language code, its
  prefix and whether its URLs are prefixed, so no consumer re-derives them.
- **FR-005**: The channel's language list (default included) MUST be the only source of URL
  languages; the storefront MUST NOT resolve a page language outside it.

**Request handling (storefront)**

- **FR-010**: A document request whose first path segment is a channel prefix MUST render in that
  language, whatever `?lang=`, the `lang` cookie or `Accept-Language` say (OR-4).
- **FR-011**: With the setting **on**, a document request with no channel prefix MUST be answered
  307 to the prefixed URL of the language chosen by `?lang=` (a channel language) → the `lang`
  cookie (a channel language) → `Accept-Language` (exact tag, then primary subtag, against channel
  languages) → channel default; `lang` MUST be removed from the target query and every other
  parameter preserved in order; the response MUST carry `Vary: Accept-Language, Cookie` and MUST
  NOT be stored by shared caches (OR-2, OR-11).
- **FR-012**: With the setting **off**, a document request with no channel prefix MUST render in the
  channel default language with no `Accept-Language` or cookie negotiation (OR-3), except that `?lang=` naming
  a channel language MUST be answered 308 to that language's URL with `lang` removed.
- **FR-013**: With the setting **off**, a request prefixed with the default language's prefix MUST be
  answered 308 to the unprefixed URL, query preserved (OR-3).
- **FR-014**: A prefix written in any other case MUST be answered 308 to the lower-case prefix.
- **FR-015**: A short prefix that no longer names one channel language but whose primary subtag
  matches several channel languages MUST be answered 307 to the variant chosen by
  the `lang` cookie, then `Accept-Language`, among them, else the first in channel order, with
  `Vary: Accept-Language, Cookie`.
- **FR-016**: Language-neutral paths (OR-8; the list in `contracts/url-shape.md` §4) MUST never be
  prefixed or redirected for language.
- **FR-017**: The outage gate (503) MUST run before any language redirect; the closed-store sign-in
  redirect MUST be issued in one hop to the prefixed sign-in URL with a prefixed `next`.
- **FR-018**: Language headers forwarded by the middleware to the render MUST be written or deleted
  on every request, so a client-supplied value is never trusted.
- **FR-019**: Without a known channel identity the middleware MUST NOT issue a language redirect.

**Rendering and navigation (storefront)**

- **FR-020**: Every internal link, form action, client navigation and server-side redirect the
  storefront produces MUST carry the current page's prefix (or none, for the unprefixed default
  under setting off), through one storefront helper; operator-authored internal links (CMS blocks,
  megamenu, footer) MUST be localized at render; already-prefixed and language-neutral paths MUST
  be left unchanged.
- **FR-021**: A static rule MUST fail the storefront lint on a new hand-written root-relative
  `href`, `redirect`, `permanentRedirect` or router navigation that bypasses the helper.
- **FR-022**: `<html lang>` and every content read sent to the backend MUST use the path language.
- **FR-023**: The language switcher MUST render one real link per channel language to the current
  page's URL in that language — for a product page the product's key in that language (OR-6) —
  and following one MUST also write the `lang` cookie (OR-11); it MUST be hidden for a
  single-language channel.
- **FR-024**: The product page MUST answer a key that is not a key of the path language, but is a
  current key of the same product in another channel language, with 307 to the product's URL in the
  path language when the product is available there, and not-found otherwise; the existing
  permanent redirect of a former key MUST keep answering, prefixed.

**SEO and emitters**

- **FR-030**: Every indexable page MUST declare its prefixed canonical URL and `hreflang` alternates
  for every channel language it is available in, plus `x-default` pointing at the unprefixed URL
  (OR-7). Products keep 163's availability rule for alternates.
- **FR-031**: The single product URL builder MUST compose prefixed paths and MUST stop appending
  `?lang=`; every caller MUST pass the channel's URL-language facts.
- **FR-032**: The `seo` sitemap and the storefront sitemap MUST list prefixed URLs per channel
  language for products (per-language key), categories, CMS pages and blog pages.
- **FR-033**: Product feed links MUST use the product's effective key in the feed's language and the
  prefixed product URL, with no `?lang=`.
- **FR-034**: Every backend emitter of a storefront page URL (inventory in `research.md` R-10)
  MUST compose it with the shared prefix helper, in the language the message is rendered in, else
  the channel default language.

**Reservation**

- **FR-040**: The CMS MUST refuse a page slug whose first segment equals a language prefix of any
  sales channel, with the existing `CMS_SLUG_RESERVED` refusal. A prefix of a platform language no
  channel serves MUST NOT be refused (OR-12).
- **FR-041**: The CMS page list MUST mark a page whose first slug segment is shadowed by a channel
  language prefix.
- **FR-042**: No storefront reserved top-level segment may be a valid prefix shape unless it is
  language-neutral; a test MUST fail when one is added.

**Cross-cutting**

- **FR-050**: The admin field's label and hint MUST exist in English and Polish; the storefront
  switcher's accessible name MUST come from the storefront message catalogue in both languages.
- **FR-051**: The upgrade note (which MUST say that existing channels stay unprefixed and how to
  switch the setting on, OR-10), the sales-channel user page and the developer page MUST describe
  the URL shapes, the setting and the helper, in English and Polish.
- **FR-052**: The contracts package change MUST ship with a changeset naming the changed exports
  and the old and new `productPath` call.

### Key Entities

- **Sales channel** (existing, kernel-owned): gains *prefix the default language* (boolean).
- **Channel URL language** (derived, never stored): language code, prefix, whether its URLs carry
  the prefix, whether it is the default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a two-language channel, 100% of the storefront's page routes render in the path
  language under each prefix, independent of cookie and `Accept-Language` (route-table-driven test).
- **SC-002**: Every URL in the regression list of pre-feature links (US2) reaches a 200 page in the
  expected language in at most two redirects, in both setting states.
- **SC-003**: Zero root-relative internal links without the current prefix in the rendered HTML of
  the home, category, product, search, CMS, blog, cart, checkout and account pages (crawl test).
- **SC-004**: Zero `?lang=` in any URL emitted by the platform (sitemaps, feeds, e-mails, canonical,
  alternates, admin previews).
- **SC-005**: The middleware's language handling adds no backend round-trip to a request (it reuses
  the cached channel identity read).

## Assumptions

- The cached channel identity read the middleware already makes (154) can carry the URL languages;
  its one-minute freshness window is acceptable for a setting changed at operator speed.
- Category, CMS page and blog slugs are per channel, not per language; only products have
  per-language keys (verified 2026-10-29). A category's URL in another language is the same path
  under another prefix.
- The `x-default` target is the unprefixed URL in both setting states.

## Out of Scope

- A domain or sub-domain per language.
- Per-language category, CMS or blog slugs.
- Translating route segments themselves (`/koszyk` for `/cart`).
- Using the `lang` cookie to pick the language of a rendered page (it only picks a 307 target,
  OR-11).

## Open Questions

None. OQ-1, OQ-2 and OQ-3 were answered by the owner on 2026-10-29 (OR-11, OR-12, OR-10).
