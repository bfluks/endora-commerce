# Research: product data scopes per sales channel and language

**Feature**: `specs/163-product-data-scopes/` | **Spec**: `spec.md` (clarify rounds 1–4, Session 2026-10-25) | **Measured on**:
`origin/master` `aa6891d63` (2026-10-21), with #384 read from `fork/fix/storefront-channel-value-overrides`
`f855ffc8a`.

Every decision is written **decision → rationale → alternatives rejected**. Paths are relative to the
repository root. "R#" numbers are cited by `plan.md`, `data-model.md`, `contracts/` and `tasks.md`.

---

## R0 — What the tree says today (re-verified after the rebase)

The spec's *Current state* was written against `cde5563ea`; 79 commits later the references still hold,
with these line moves and three findings the spec did not record:

| Spec claim | On `aa6891d63` |
| --- | --- |
| PDP rejects only `inactive` with 410 | `catalog-query.service.ts:1296` (was `:1273`) — confirmed; a member `draft` is reachable by slug |
| Listing filters `status: 'active'` | `catalog-query.service.ts:661`; facets `:1840` |
| Quick search filters `p.status = 'active'` | `catalog-quick-search.service.ts:118` |
| Comparisons check status in memory | `comparison-service.ts:617` |
| Search indexer `isPublishable` | `search-indexer.ts:787` |
| Sitemap `activeOnly` + anonymous audience | `sitemap-generator.service.ts:122-140` |
| Archive transition | `catalog-admin.service.ts:448-488` (`product.archived.v1` emitted at `:462`) |
| `allocateUniqueSlug` | `catalog-admin.service.ts:1075` area (called at `:324`, `:1063`) |

**Finding F1 — basket add checks no status at all.** `cart-service.ts:782-819` applies
`isProductVisibleTo` and `outOfRequestChannel` and never reads `status`, so a `draft` member product can
be put in a basket today. Placement treats only a *missing* record as `product_unavailable`
(`packages/contracts/src/order-minimums.ts:143`). FR-004/FR-006 close this; the deploy-parity statement
(FR-110, SC-001) must therefore list it as a second intended change beside the `draft`-by-URL one.

**Finding F2 — product SEO overrides never reach the storefront.** `seo_meta_overrides` is read by
`MetaTagResolverService.resolve`, whose only caller is the admin preview route
(`packages/modules/seo/src/backend/routes.ts:347`). The PDP's `seo` block is built from the product's
name and description (`catalog-query.service.ts:1437`). US8 therefore is not "add a channel column" but
"start serving overrides, with a channel column" — see R13 and the product question in `plan.md`.

**Finding F3 — the storefront URL carries no language.** Language comes from `?lang=` → `Accept-Language`
→ the configured default (`storefront/lib/i18n/locale.ts:12-37`); the backend sees it as the first
`Accept-Language` tag (`catalog/src/backend/routes.public.ts:428`). K1 ("only keys of L resolve at
(C, L)") therefore makes a shared link to a Polish key answer not-found for a reader whose browser asks
for English. The design keeps K1 and makes every URL the platform *emits* (sitemap, alternates,
canonical) carry `?lang=` whenever L is not the channel default (R12). Recorded as a risk.

**Finding F4 — the four PIM connectors named by FR-091 are not in this repository.** `ls packages/modules`
holds `pim_connector` (the shared run/issue vocabulary) and `import_export`; `pim_ergonode`, `pim_akeneo`,
`pim_pimcore`, `pim_unopim` are paid packages (`README.md` § Overview, `specs/conventions/commercial-data.md`
N4). This feature can only publish the catalogue-side write contract they call (R17); their adoption is
their own repositories' work.

**Finding F5 — alt text is already per language, but per asset.** `assets.alt_text` is a per-language
JSONB (`packages/modules/assets_library/src/backend/entities/asset.entity.ts:85`) and the PDP picks it
per language (`catalog-query.service.ts:1423`). It is shared by every product that uses the asset (R15).

---

## R1 — Storage for the channel-scoped scalars (status, window, audience, MOQ, returnable)

**Decision.** One typed table owned by `catalog`, **`product_channel_scopes`**, one row per
(product, sales channel) holding nullable columns, where `NULL` (or, for the paired values, a false
`*_overridden` flag) means *inherit*: `status`, `window_overridden` + `publish_from` + `publish_until`,
`visibility` + `allowed_organization_ids` (a pair), `min_order_quantity`, `returnable`. A row with every
column inheriting is deleted, so "use inherited" (FR-012) never stores an empty value. Foreign keys:
`products(id) on delete cascade` and `sales_channels(id) on delete cascade` (edge case *Channel deleted*).
The global values stay where they are on `products`, plus two new columns `publish_from` /
`publish_until` for the global window (FR-009 lists *Global* for the window).

**Rationale.** FR-016 requires effective status to be filterable without resolving overrides one by one.
Typed columns are indexable, constrainable (`CHECK` on the status value set, on `publish_from <
publish_until`, on the MOQ range 1…1 000 000 already used by feature 155) and readable as plain SQL in the
listing statement (R5). One row per (product, channel) is exactly the shape of every channel-only field in
FR-009's table, and the channel row is what the scope overview (US4) reads per channel.

**Alternatives rejected.**
- *Rows in `product_value_overrides` with `attributeKey = 'status'`* — the issue's own objection: the
  `{ v }` JSONB wrapper is untyped, so a listing filter would be `value->>'v' = 'active'` over a
  string-keyed table with no `CHECK`, and every field would need a reserved pseudo-attribute that
  `SYSTEM_ATTRIBUTE_SCOPES` (`packages/contracts/src/catalog.ts:2692`) and the admin scope editor then
  treat as an attribute. The resolver walk is reused in *semantics* (FR-008), not in storage.
- *Columns on `sales_channel_products`* — the bridge belongs to the kernel's membership service, which is
  its only writer (Constitution XII; `sales-channel-membership.service.ts`), and removing a membership
  deletes the row — the edge case *Product removed from a channel* requires the values to survive.
- *A materialised `product_availability` projection* (product × channel × language → live) — would make
  the listing filter a single join, but must be recomputed on every status, window, membership and
  channel-language change, two of which are kernel events catalog would have to subscribe to, and a window
  boundary would need a sweep to flip rows. Correctness then depends on a projection not lagging; the
  computed predicate cannot lag. Kept as the fallback if SC-004's benchmark (T-perf in tasks) fails.

## R2 — Storage for the channel × language status

**Decision.** A second table, **`product_channel_language_scopes`** (product, channel, language_code,
`status` not null), unique on the triple, cascading like R1.

**Rationale.** Only status is scoped at C×L among the typed fields (FR-009), and a separate table keeps R1's
row free of a nullable language key (no partial unique indexes, no "which row is the channel row"). The
SQL is two keyed sub-selects: `coalesce(cl.status, c.status, p.status) = 'active'`.

**Alternatives rejected.** *One table with a nullable `language_code`* (the `product_value_overrides`
shape) — the channel-only columns would be meaningless on C×L rows, and every reader would need the
partial-index discipline that `product_value_overrides` documents for itself. *A JSONB map
`language_status` on the R1 row* — not indexable for the listing filter.

## R3 — Status semantics: two values, and archiving apart from them

**Decision (revised after the owner's final Q1, spec Session 2026-10-25).** The value set is
`active | inactive` at every scope, global included, and is declared once, as `productStatusSchema` in
`packages/contracts/src/catalog.ts`, from which `PRODUCT_SCOPE_STATUSES` in
`packages/contracts/src/product-scopes.ts` is derived (one list; the import direction recorded under T008).
`inactive` at **any** scope is plain off (N1, extended to the global scope by Q1-a): it never sets or
clears `archivedAt` and never emits `product.archived.v1`. **Every predicate still tests `= 'active'` and
never enumerates the off values.** Archiving is a separate, global state on `products.archived_at`, set and
cleared only by the Archive / Restore Commands of R30 (FR-019). The completeness gate compares effective
**status** only (`pairsTurningOn` / `statusOnAt`): the archived state is not an input to it, so setting
`active` on an archived product gates exactly as on any other product, and Restore never gates (FR-060).

**Rationale.** The 2026-10-21 design kept option B cheap by never naming an off value in a predicate; that
held — the change is the value set, the scope tables' `CHECK`s, one data migration, the global status write
path and the admin controls (R30), and no predicate, port signature or resolution function. What the
earlier design did name was archiving-as-`inactive` in four places outside the predicates (the global
status write path, the PDP's 410 condition, the bulk undo's revert keys and the gate's `statusOnAt`), plus
three consumers that read `status === 'inactive'` as "archived" (quick order import, shopping-list
conversion, reorder); R30 lists them and Phase 9a–9c of `tasks.md` remove them.

**Alternatives rejected.** *A boolean `enabled` column at scope level* — the owner chose the existing
`active` / `inactive` vocabulary at every scope, so a second spelling would only add a mapping. *Keeping
`draft` as an accepted alias for a period* — refused by the owner (Q1-e): no alias, a validation error.

## R4 — The publication window

**Decision.** Bounds are `timestamptz`, inclusive at both ends (`start ≤ now ≤ end`, K4); either may be
`NULL` (open). A channel override replaces **the pair** as one value (`window_overridden = true`, with
either bound possibly `NULL` meaning "open on that side for this channel"); otherwise the global pair
applies. The admin edits in the operator's local time with `datetime-local` and sends ISO instants (A-10),
the convention of price lists and promotions.

**Rationale.** A pair inherits as a pair because "B2C: open-ended from 1 December" must be expressible
while the global window has an end; per-bound inheritance would silently import the global end.

**Alternatives rejected.** *Per-bound inheritance* (two nullable columns, no flag) — cannot express "open
here though bounded globally". *Dates without time* — superseded by C3.

## R5 — One definition of effective availability (FR-001, FR-002, FR-016)

**Decision.** Two restatements held equal by a parity test, the pattern the audience rule already uses
(`isProductVisibleTo` vs `#audienceCondition`, `catalog-query.service.ts:860-873`, and
`backend/test/integration/catalog/quick-search-audience-parity.test.ts`):

1. **The rule** — pure, synchronous, in `packages/contracts/src/product-scopes.ts`:
   `effectiveStatus`, `isInsideWindow`, `effectiveAudience`, and
   `isProductEffectivelyAvailable(product, scopes, { channel, languageCode, audience, now, isMember })`.
2. **The SQL** — `availabilityCondition({ channelId, languageCode, audience, now })` in
   `packages/modules/catalog/src/backend/services/product-availability.sql.ts`, returning a
   *description* `{ sql: (alias) => string, params }` exactly like `#listingNarrowing`'s conditions
   (no `raw()` fragment is created there — the file's own rule). It composes the kernel membership
   subquery (`entityIdsInChannelSubquery`), `deleted_at is null and archived_at is null`,
   `coalesce(cl.status, c.status, p.status) = 'active'`, the window with the pair coalesced, and the
   audience `case` with the pair coalesced (`case when c.visibility is not null then c.… else p.… end`).

The parity test generates a grid (status at G/C/C×L × window states incl. both inclusive edges × audience
override present/absent × buyer kinds) and asserts that the SQL selects exactly the products the rule
admits.

**Rationale.** FR-002 forbids a consumer predicate; the two places that genuinely need different forms
(a statement a page is cut from, and an in-memory check on records already held) both exist today for
the audience, and the parity test is what made that safe (issue #151's lesson: narrowing must be in the
statement, not after the cut).

**Alternatives rejected.** *SQL only, consumers query catalog per product* — N+1 at every acquisition
seam. *Rule only, filter after fetch* — re-creates issue #151 (short and empty pages).

## R6 — How other modules ask (the consumer seam)

**Decision.** `catalog` publishes **`catalogProductAvailabilityPort`** (contract in
`packages/contracts/src/product-scopes.ts`; registered with `ctx.di.providePort`):

- `filterAvailable(productIds, { channelId, languageCode, audience, now? }): Promise<Set<string>>` — the
  acquisition seams (basket add/placement, quote lines, comparisons, shopping lists, quick order, links,
  bundle configuration, CMS product blocks).
- `describeChannelAvailability(productIds, channelId): Promise<Map<id, ChannelAvailability>>` — per
  product: the channel languages where effective status is on, the effective window, the effective
  audience rule. Used where a whole channel is projected at once (search documents, sitemap, feeds).
- `resolveScopeLanguage(channelId, requestedTag)` convenience (R7).

Each acquisition seam replaces its `outOfRequestChannel` / `productIdsInRequestChannel` call **and** its
`isProductVisibleTo` call **and** any own status test with one `filterAvailable` call, keeping its
existing single not-found answer. The 2026-08-21 ruling (`isProductVisibleTo` stays pure and does not
learn about channels, `packages/contracts/src/catalog.ts:2040-2086`) is respected: the port *composes*
the two existing filters plus status and window; `isProductVisibleTo` itself is unchanged and stays the
global-rule evaluator that `effectiveAudience` feeds.

The **exempt seams keep their exemption** (same ruling): `orders`' reorder and `quote_requests`'
`convertToOrder` rebuild from commitments; `RfqAdminService.createOnBehalf` and `quick_order`'s
`'unrestricted'` arm are operator surfaces. FR-018 adds one operator behaviour: an operator-created quote
request **warns** per unavailable line instead of refusing.

**Rationale.** `catalog` is `nonDeactivatable` (`packages/modules/catalog/src/manifest.ts`), so the port
gate never fires and the edge costs consumers nothing at presence level; every consumer already declares
`catalog`. One port keeps the rule in one owner (FR-002).

**Alternatives rejected.** *Fold status into the kernel's `productIdsInRequestChannel`* — the kernel may
not import a module (D-52/D-53) and does not own product status. *Each consumer reads the scope tables* —
`check:module-boundary` would refuse the raw reach, and FR-002 forbids it in substance.

## R7 — Which language is "L" (content language ≠ prose language)

**Decision.** A pure helper `resolveScopeLanguage(channel: { languages, defaultLanguage }, requestedTag)`
in `packages/contracts/src/product-scopes.ts`: exact match of the request's first `Accept-Language` tag
against `channel.languages` (case-insensitive), then base-language match (`pl` ↔ `pl-PL`), else
`channel.defaultLanguage` (A-3). Snapshots for an operator use `channel.defaultLanguage` (N2). An
unresolved channel never reaches it — the seams fail closed before (FR-007).

**Rationale.** `createRequestLanguageResolver` (`packages/platform/src/kernel/i18n/request-language.ts:164`)
normalises to `SUPPORTED_LANGUAGES` — the platform's *prose* languages — while channel content languages
are free BCP-47 codes in `sales_channels.languages`. Reusing it would map `de-DE` to `en`.

**Alternatives rejected.** *A kernel helper reading `currentSalesChannel()`* — the rule is pure over the
channel record and the tag; contracts is the shared home of the other pure scope rules (#384's
`overrideLanguages` lives there), and the admin needs it too.

## R8 — Search with per-language status and a window

**Decision.** One Meilisearch index per channel and one document per product stay. A document is indexed
for every channel member that is not deleted or archived and is on in **at least one** language of the
channel. It carries `liveLanguages: string[]`, `publishFromMs: number` (0 when open), `publishUntilMs:
number` (`Number.MAX_SAFE_INTEGER` when open), and the **channel-effective** `visibility` +
`allowedOrganizationIds`. The query adds, in the index filter (never only at hydrate),
`(liveLanguages = "<L>" OR liveLanguages NOT EXISTS) AND publishFromMs <= <now> AND publishUntilMs >= <now>`
(`NOT EXISTS` covers documents indexed before the deploy, which were all `active` — FR-110). Effective
names per language are indexed as `localizedNames.<L>` and searched with `attributesToSearchOn`
(FR-017 (b)). Hydrate keeps its row-level audience check, now through `filterAvailable`.

**Rationale.** C×L status cannot drop a whole document, and filtering after the hit list is cut is
issue #151's defect. A window evaluated at query time is exact, so search meets SC-005 without waiting
for a reindex.

**Alternatives rejected.** *One index per (channel, language)* — multiplies index count and reindex cost
by the language count for one filterable field. *Hydrate-only filtering* — short pages.

## R9 — Window transitions reaching consumers that are not queries (FR-024, SC-005)

**Decision.** A BullMQ Job Scheduler in `catalog`, `catalog.publication-window.sweep`, every 5 minutes
(the `price-list-status-worker.ts` shape, `packages/modules/price_lists/src/backend/services/`), finds
products whose global or channel window **bound** lies in `(lastSweep, now]`, and emits
`product.updated.v1` with `changedFields: ['publicationWindow']` for each (batched). `lastSweep` is a Redis
key owned by catalog; a missing key means `now − 2 × interval`. Registered through `ctx.worker`
(gated; catalog is non-deactivatable so it always runs).

**Rationale.** Storefront reads and search compute the window at read time (R5, R8), so they are exact.
What does not read at request time — webhook subscribers, feed token caches (`feed-cache-invalidator.ts`),
search document freshness — learns of a transition the way it learns of a status change (FR-024). The
sitemap (6 h staleness, `sitemap-generator.service.ts:50`) and feeds (their schedule) evaluate the window
at generation time, the same freshness a status change has today.

**Alternatives rejected.** *No sweep* — FR-024 would be unmet for webhooks. *Sweep that rewrites status*
— A-4 forbids touching the stored status.

## R10 — Events (FR-082)

**Decision.** Reuse **`product.updated.v1`** with `changedFields` naming what moved:
`scopedStatus`, `publicationWindow`, `audience`, `urlKeys`, `orderRules`, `media`, `attachments`,
`packagingUnits`; Archive and Restore (R30) emit `changedFields: ['archivedAt']`. `product.archived.v1`
is emitted by the Archive Command only, once per transition; a status change to `inactive` no longer emits
it (FR-082, spec Session 2026-10-25).

**Rationale.** `search` (`packages/modules/search/src/backend/index.ts:218`), `webhooks` and
`product_feeds` already subscribe to it; a new event type would need a new subscription in each and a new
webhook registry entry.

**Alternatives rejected.** *`product.availability_changed.v1`* — duplicates a subscription everyone has.

## R11 — URL keys: storage and uniqueness (FR-070, FR-072, SC-008)

**Decision.**
- `products.slug` **is** the global key (FR-073 needs no backfill). Kept as a column — connectors and
  `allocateUniqueSlug` write it.
- **`product_url_keys`** (catalog): `product_id`, `language_code` (not null), `sales_channel_id`
  (nullable; `NULL` = the language key), `key`. Unique per (product, language) where channel is null and
  per (product, channel, language) otherwise.
- **`product_url_redirects`** (catalog): `product_id`, `language_code` (nullable; `NULL` = a former
  *global* key that was free in every language when it was released), `key`. Partial
  unique `(language_code, key)` where not null and `(key)` where null. A `NULL`-language redirect resolves
  in **every** language of every channel (analyze H1, 2026-10-21): conditioning it on "where the product has
  no L key" made a former global key stop resolving in L the day the product got its first L key — an
  expiry FR-072 forbids. In resolution a current key ranks above a redirect with the same key, but the write
  rules (data-model §5) never let a current key and **another** product's redirect share a key in one
  language, so that ranking only ever decides between a product's own current key and its own redirect.
- **Uniqueness is enforced in the write service, inside the Command, under
  `pg_advisory_xact_lock(hashtextextended('catalog.url-key:' || key, 0))`** taken for every key the write
  touches, in sorted order (no deadlock). The check is the closed list of FR-070/072: another product's
  global slug, language key, any-channel C×L key (orphans included), or redirect in the same language
  (and for a global key: in any language). The indexes above and `products.slug`'s unique index are
  backstops for the expressible half.
- Changing a key writes the old key as a redirect **in its language** (a language or C×L key — always free
  there, it was the product's current key) or, for the global key, with `language_code NULL` **only if the
  old slug is free in every language**; otherwise as `(L, old)` rows for the languages where it is free and
  none where another product holds it (re-analyze HIGH-2, 2026-10-22: a global slug is the product's key
  only where it has no language key, so another product may hold it as an L key; an unconditional `NULL`
  row would then share the key in L with that product's current key). Removing a language key makes the
  slug the product's key in L again and is checked as a write of the slug in L; giving a product its first L key inserts a redirect `(L, slug)`
  (FR-072 consequence 1); a key written back that is the product's own redirect deletes that redirect (no
  chain, no self-redirect). Redirect rows store the *product*, never a target URL, so they never chain
  (FR-072): the target is resolved at request time.
- `allocateUniqueSlug` widens "free" to "not a current or redirecting key of another product in any
  language" (A-11).

**Rationale.** "Unique per language across all channels, with a global key counting in every language
where the product has no language key" spans `products.slug` and two tables; no set of unique indexes
expresses it. An advisory lock per key serialises exactly the writes that can collide and nothing else.

**Alternatives rejected.** *A claims table keyed (language, key)* — the global key would need a claim row
per platform language and re-claiming whenever a language is added or a language key set/removed; the
lock is simpler and has no projection to keep. *Serialisable isolation* — retries for the whole product
save on unrelated conflicts.

## R12 — URL resolution at (C, L), redirects, and `seo` off (FR-071, FR-111)

**Decision.** `catalog` owns the redirect data (R11) and the resolution; `seo` owns whether redirects
are **served**. Resolution of key `k` at (C, L): (1) a `product_url_keys` row of L or a global slug of a
product with no L key → that product; serve if `k` is its effective key at (C, L), else 301 to it;
(2) else a redirect row of L, else a global redirect (`language_code NULL`) of any product — regardless of
the language keys that product holds (H1) — → 301 to the product's effective key at (C, L), **only if `seo`
is effectively present**; (3) else not-found. Step (1) never hides another product's redirect: the write
rules (R11, data-model §5) keep a current key and another product's redirect from sharing a key in one
language — including a released global slug, which becomes a `NULL` row only where that holds everywhere.
Availability (FR-001) is then evaluated for the product the key resolved to (FR-071) — an unavailable
target answers not-found, an archived one answers "gone" (edge cases). The public route answers a redirect
as `{ data: { redirect: { key, language } } }` with HTTP 200 on a dedicated resolve endpoint (contract
`url-keys-and-redirects.md`); the storefront calls `permanentRedirect()`. Every emitted URL (sitemap,
canonical, `hreflang` alternates, the redirect target, the admin preview URL) is `/p/<effective key>` plus
`?lang=<L>` when L ≠ channel default (F3), produced by **one** pure helper, `productPath({ key,
languageCode, channelDefaultLanguage })` in `packages/contracts/src/product-url-keys.ts`, called only on the
backend — `seo`'s sitemap generator, catalog's admin `effective[].url`, the resolve answer's `path` and the
PDP response's `paths` (canonical + alternates). The storefront receives ready paths: it does not know the
channel's default language (`storefront/lib/api/client.ts` `RequestContext` carries a locale and a channel
code; `i18n/config` answers the platform default). So the later language-path-prefix change (owner, Q-B →
C, a separate issue) edits one function for every emitted URL. In-page links (32 `/p/` sites in 23
storefront and `cms-components` files today) stay `/p/<effective key>` without `?lang` — the clicking
browser is already in L — and are the prefix issue's to change.

**Q-B decided (owner, 2026-10-21): option C, out of scope for 163.** A language prefix in the storefront
path (`/en/p/drill`) is a separate issue. For 163 the interim stands: `?lang=<L>` on every URL the
platform emits when L is not the channel default, and **no** cross-language rendering (option B rejected).
**Accepted residual gap until the path-prefix issue lands:** a link to a language key without `?lang` —
typically a default-language link — opened by a browser whose `Accept-Language` resolves to another channel
language answers not-found under K1, once the product holds a key of its own in that other language
(before any language key exists the global key serves every language, so nothing changes at deploy).

**Q-C decided (owner, 2026-10-21): hide.** With `seo` off the redirect list is not part of any admin
surface: `GET …/url-keys` omits `redirects` when `seo` is not effectively present (the admin renders the
section only when the field is present, so the server's probe is the only one), consistent with
Constitution XVII. The data stays in catalog and keeps reserving keys; the takeover confirmation belongs to
the catalog URL-key editor and keeps working with `seo` off, naming the product that loses the redirect.
`DELETE …/url-redirects/:id` stays catalog's write and is not gated (writes never are), but nothing in the
admin reaches it while `seo` is off.

The `seo` presence decision is a declared edge: catalog resolves `seoProductMetaPort` (R13) and lists it
in `nonBindingDependencies` as **`degrades-without`**, `whenAbsent`: "product pages show metadata derived
from the name and description, and old URL keys answer not-found". Presence is probed in front of both
uses (`effectiveState.isPresent('seo')`), the pattern `inventoryAvailabilityPort` uses in the same
manifest. Writes are never gated: keys, redirects, takeovers and deletions keep working and keep the
invariant while `seo` is off, so turning it back on serves exactly what is stored (FR-111 "data persists").

**Rationale.** FR-070/072/080 make redirects part of the URL-key invariant and of the same audited
Command (a takeover deletes another product's redirect in the transaction that saves the key). Putting the
table in `seo` would split one invariant over two modules' transactions and make key edits impossible
while `seo` is off (a `refuses-without` edge). Gating only the *serving* satisfies FR-111 literally.

**Alternatives rejected.** *`seo` owns `product_url_redirects`* — see above. *Cross-language redirect*
— ruled out by K1. *Answer the redirect inside `GET /catalog/products/:idOrSlug` as a 301* — the
storefront's server fetch follows redirects silently and would render the target under the old URL.

## R13 — SEO metadata per channel × language (FR-075, US8)

**Decision.** `seo` adds a nullable `sales_channel_id` to `seo_meta_overrides` and makes `locale`
nullable, with a `CHECK (locale is not null or sales_channel_id is not null)`; the unique
`(entity_type, entity_id, locale)` becomes three partial uniques (L rows, C rows, C×L rows). Existing rows
are the L scope unchanged (US8 #2). `seo` publishes **`seoProductMetaPort.resolveForProduct({ productId,
channelId, languageCode, fallback })`** walking C×L → C → L → fallback per field, and catalog's PDP builds
its `seo` block through it (degrade: today's name/description derivation). The admin SEO panel gains the
channel dimension.

**Writes become Commands (analyze C1, Constitution XIII).** Today
`meta-tag-resolver.service.ts:57-152` audits by hand through `recordAuditFromContext` with
`stateBefore: null` on update, and `routes.ts:410-425` deletes by `locale` alone, defaulting to `en-US`.
Before the channel dimension lands, `seo` gains `src/backend/commands/seo-meta-override.commands.ts`
(the `delivery_methods/src/backend/commands/delivery-method.commands.ts` shape): `makeUpsertSeoMetaOverrideCommand`
and `makeDeleteSeoMetaOverrideCommand`, actions kept as `seo_meta_override.upsert` / `.delete`
(audit history stays continuous; no label references them), `objectType: 'seo_meta_override'`,
`objectId` = the existing row id or a fresh uuid (`existingId` pattern, so a row appearing in between is
refused rather than duplicated); `before` = the full row projection (entity type/id, channel, locale, the
five fields) or `null` on create, `after` = the full projection or `null` on delete. `MetaTagResolverService`
receives `commandBus` instead of `auditLog` and loses `#audit` **in the same change** (no hand audit left;
`check:command-coverage` keeps `seo` in its converted list). A row is addressed by (entity, channel?,
locale?): PUT carries `channelId?` in the body, GET and DELETE in the query; at least one of the two is
required, except that a request naming **neither** keeps today's meaning (`locale = 'en-US'`) so no existing
caller breaks (Principle II). Undo: per R29.

**Rationale.** F2: overrides were never served, so wiring the read is required for US8 #1 to be
observable at all. The port keeps `seo_meta_overrides` `seo`'s alone.

**Q-A decided (owner, 2026-10-21): serve.** Serving overrides changes the metadata of every product that
**already** has a per-language override; this is an intended behaviour change, recorded beside SC-001's
others in `plan.md` § Intended behaviour changes. US8 #2 reads as "stored values are preserved unchanged
as the language scope".

## R14 — Gallery roles and hiding per channel (FR-076)

**Decision.** Two catalog tables: `gallery_item_channel_labels` (product, channel, label, gallery_item)
with primary key (product, channel, label) — role uniqueness per channel by construction — and
`gallery_item_channel_hidden` (gallery_item, channel, product). Effective role R in C: the channel row for
R, else the global `gallery_item_labels` row, **unless the resolved item is hidden in C**, in which case
the role resolves to none and the existing fallback (`primaryAssetUrl`) applies. A hidden item is dropped
from every C read (PDP gallery, listing card image, OG image). The image set stays global (D-6).

**Alternatives rejected.** *A `channel_id` column on `gallery_item_labels`* — its primary key
(gallery_item, label) would have to change shape, rewriting every reader of a global table.

## R15 — Alt text per language (FR-077, US9 #3)

**Decision.** `gallery_items.alt_text jsonb not null default '{}'` — a per-language map **specific to the
product's use of the image**. Effective alt at L: `item.alt_text[L]`, else the asset's alt text through the
existing pick (`catalog-query.service.ts:1423`), which is what "the global alt text" means in US9 #3.

**Rationale.** F5: the asset's alt text is shared by every product using the asset, so writing a
product-specific translation there would change other products, and the write would cross into
`assets_library`. A catalog column keeps the write in catalog's Command.

**Alternatives rejected.** *Edit the asset's alt from the product editor* — cross-module write, shared
side effects. *No change, document the asset library path* — US9 asks for it in the product context.

## R16 — Attachments and packaging-unit names (FR-078, FR-079)

**Decision.** Additive columns: `product_attachments.name_translations jsonb not null default '{}'`,
`product_attachments.description_translations jsonb not null default '{}'`,
`product_packaging_units.name_translations jsonb not null default '{}'`; the existing `name` /
`description` columns stay the global value. Hiding: `product_attachment_channel_hidden`
(attachment, channel, product). A hidden attachment is neither listed nor downloadable from the product
page in that channel (the PDP stops emitting its asset reference; the asset URL itself is the asset
library's and stays as stable as feature 156 makes it). Basket lines already snapshot
`packaging_unit_name` (`cart_items`, `quote_request_items`); the snapshot is taken in the buyer's scope
language (N2) and orders copy it, so placed lines keep their name (FR-079).

**Alternatives rejected.** *Convert `name` to JSONB* — breaks `unique(product_id, name)` on packaging
units (`product-packaging-unit.entity.ts`) and every connector writing a string (Principle II: additive).

## R17 — Integrations: imports and connectors (FR-091, FR-092, FR-093)

**Decision.** A new port **`catalogProductScopeWritePort`** (owner `catalog`) for connectors:
`applyScopes(productId, { status?, window?, audience?, orderRules?, urlKeys? }, { source })` where every
URL-key write that FR-070/072 forbids is **not written** and comes back as a per-key issue
`{ languageCode, channelId, key, heldByProductId, kind: 'current' | 'redirect' }`; it never takes over a
redirect and never asks for confirmation (FR-093). It writes only the scopes named, so a connector that
writes global values removes no operator override (FR-091). The completeness gate does not run (A-6).
Catalogue CSV import/export (`catalog-bulk-import.service.ts`, `import_export`) gains `status@<channel>`
and `status@<channel>/<lang>` columns for FR-092's round-trip; the CSV import's whole-file rejection rule
(`catalog-bulk-import.service.ts:155-159`) is unchanged.

**Rationale.** F4: the connectors live elsewhere; the catalogue contract is what this repository owns.

## R18 — Completeness gate (FR-060, FR-061, US6)

**Decision.** A catalog-owned Setting `catalog.scope_completeness_gate`, string enum `warn` | `refuse`,
default `warn`, in a new `settings` block in `packages/modules/catalog/src/manifest.ts` (the shape `seo`'s
manifest uses). A pure `pairsTurningOn(before, after, channels)` computes the (C, L) pairs whose effective
status goes from off to on for an edit (global switch, channel row, C×L row, bulk); `checkCompleteness`
asserts for each pair: name set at (C, L), at C… (name is language-scoped, so: C×L override or `name[L]`
on the baseline — **never** the resolver's cross-language fallback), every required (`isRequired`)
language-scoped attribute likewise, and the URL key by its effective key at (C, L) (global satisfies it,
K3). `warn`: save and return `warnings: [{ channelId, languageCode, missing: [...] }]`; `refuse`: 422
`SCOPE_INCOMPLETE` with the same details, nothing saved (N3). Bulk: per-product skip with reason
`completeness_gate` (FR-061). Ports and imports never call it.

**M3 decided (owner, 2026-10-22): option A — only a status write fires the gate.** `pairsTurningOn`
compares `isOn(effectiveStatus)` alone: window and audience are not inputs, and one `channels` list serves
both snapshots, so a scopes PATCH that changes only the window, the audience or order rules returns no pair,
and membership (`PUT /api/v1/admin/sales-channels/:code/:entityType/:entityId`) and channel-language
(`PATCH /api/v1/admin/sales-channels/:code`) writes — owned by `sales_channels` — never reach it. What such a
change leaves missing is surfaced instead by the scope overview: every evaluable cell carries
`missing: ScopeMissingValue[]` from the same `checkCompleteness` (FR-041, `admin-scopes-api.md` §3), whatever
its status. *Rejected (option B):* gating membership and channel-language writes would put a catalog rule
into `sales_channels`' write path (a call back into catalog from the module whose membership port catalog
consumes) and refuse a channel edit for one product's missing translation.

## R19 — Effective names everywhere (FR-017)

**Decision.**
- **Listing (Postgres path):** a SQL builder `effectiveTextSql(alias, attributeKey, { channelId,
  languages })` in `catalog/src/backend/services/effective-value.sql.ts` restating #384's walk
  (`channelOverrideFor`: for each L in the language chain, the (C, L) override, else stop where the
  baseline answers; then the channel-only slot) as nested `coalesce` over two keyed sub-selects. Free-text
  search, attribute filters, facet counts (`:1840`'s path) and the name sort use it. The name sort's
  keyset becomes `(effective name, id)`. A parity test holds it equal to `channelOverrideFor`.
- **Quick search** (`catalog-quick-search.service.ts`) matches and returns the effective name.
- **Comparisons**: names and compared values through `listValueOverridesByProductIds(ids, { channelId })`
  and #384's `effectiveSystemText` / `effectiveAttributeValues`.
- **Basket names / batch-add outcomes and quote-request line snapshots:** a new port method
  `catalogProductAvailabilityPort.effectiveNames(productIds, { channelId, languageCode })`; the language is
  `resolveScopeLanguage` for a buyer and `channel.defaultLanguage` for an operator (N2).

**Rationale.** #384 fixed the product page, listing cards and search cards with the shared walk; this
finishes the consumers it left, reusing the walk rather than adding a second chain (FR-008).

**Alternatives rejected.** *Denormalised effective-name columns* — per (C, L) explosion, a projection to
keep fresh. *Filtering effective names after fetch* — issue #151 again.

## R20 — Bulk scoped status (FR-050–FR-052, US5)

**Decision.** Extend the existing bulk update (`bulkUpdateProductsRequestSchema`,
`packages/contracts/src/catalog.ts:791`) with an optional `scopedStatus: { channelId, languageCode |
null, value: 'active' | 'inactive' | 'inherit' }` (`draft` removed, spec Session 2026-10-25; bulk
Archive / Restore is the separate `fields.archived` of R30). It rides the existing inline/queued paths
(`BULK_ASYNC_THRESHOLD`, `BulkOperationService`), the per-product Command audit and the bulk undo
(`bulk-operation-undo.contract.test.ts`), so FR-052 needs no new machinery. New per-product reasons:
`scope_invalid` (not a member / language not offered, FR-051) and `completeness_gate` (FR-061). It may not
be combined with the global `status` field in one request (one meaning per action).

## R21 — Deployment and backfill (FR-110, SC-001)

**Decision.** **No data backfill of the new tables.** Every new table starts empty, which is "inherit
everywhere"; the global values already hold today's status, audience, MOQ and returnable; `products.slug`
is the global key; existing SEO rows become the L scope by having a `NULL` channel. **The one data
conversion is the status value set (R30, data-model §13)**: `archived_at = updated_at` on today's
`inactive` rows that lack it, then `draft` → `inactive` in `products` and both scope tables, without
archiving. The intended behaviour changes at deploy (`plan.md` § Intended behaviour changes) are written
into SC-001's test: a product that is off and not archived (today's `draft`, `inactive` after the
migration) is no longer reachable by URL (FR-005) and no longer addable to a basket (F1);
listing name sort follows the effective name, not the slug (D6); existing per-language SEO overrides are
served (Q-A). Search documents gain fields; documents without
them are treated as before (R8), and the release note asks for one `search_reindex` per channel (the
existing bulk operation), which the window filter needs to become exact.

## R22 — Caching and invalidation

**Decision.** **No new cache.** Availability, keys and scoped values are computed at read time against
indexed tables; catalog holds no Redis cache today (no `redis`/LRU in `catalog/src/backend/services`), and
the sitemap's own staleness cache behaves as for a status change. The one Redis key added is the sweep
watermark (R9), which is not a cache. Consequently no lifecycle pub/sub invalidation is designed; if
SC-004 forces a cache, it must follow the `PricingGeneration` pub/sub pattern (D-287) and is a plan change.

## R23 — Permissions, palette, i18n, docs

- **Permissions**: every write reuses `catalog:write`, every read `catalog:read` (FR-084, A-7) — no new
  code, nothing new on `/admin-roles`. Redirect deletion is a catalog write (R12).
- **Command palette**: the scope overview and the scope controls are tabs/panels of the product editor and
  the bulk action is in the product list; both are reached by the existing `open-products` action
  (`catalog/src/manifest.ts:593`). A palette `targetRoute` cannot carry a product id, so no new action is
  added (FR-042 satisfied as "part of the product editor"). Keywords of `open-products` gain "scope",
  "zakres", "visibility per channel" so ⌘K finds it.
- **i18n**: every new admin string in `packages/modules/catalog/i18n/{en,pl}.json` (and `seo`'s for its
  panel), flat keys; error codes per the one-commit rule; the storefront's catalogue is total by type.
- **Docs**: extend `packages/modules/catalog/docs/catalog/per-channel-per-language-overrides.md` (also
  edited by #384 — sequence after it) and add `packages/modules/catalog/docs/catalog/url-keys-and-redirects.md`;
  `seo`'s page for per-channel SEO; Polish cache + materialised pages in the same commits.

## R24 — Dependency on #384 and branch strategy

**Decision.** This branch stays based on `origin/master`. Phases that do not touch #384's files run now
(contracts, schema, scope write service, URL-key storage). Phases editing
`catalog-query.service.ts`, `search-query.service.ts`, `product-value-resolver.service.ts`,
`storefront-value-overrides.ts`, `catalog-product-read.service.ts` or the overrides docs page start only
after #384 merges and the branch is rebased onto it. If the coordinator prefers not to wait, the
alternative is to stack on `fork/fix/storefront-channel-value-overrides` and rebase onto `master` once it
merges; the gating phases are marked in `tasks.md` either way.

## R25 — No new runtime dependency

Postgres advisory locks, BullMQ Job Schedulers, Meilisearch `attributesToSearchOn` and Next.js
`permanentRedirect` are all in the existing stack. **No new runtime, dev or workspace dependency.**

## R26 — Channel-effective MOQ and returnable in the feature-155 seams (FR-100, US10)

**Decision.** `CatalogProductRecord.minOrderQuantity` / `returnable` keep meaning **global**; the seams
that judge a basket, an order or a quote line in a channel ask
`catalogProductAvailabilityPort.effectiveOrderRules(productIds, channelId)` and feed those values to the
unchanged pure rule `evaluateOrderMinimums` (`packages/contracts/src/order-minimums.ts`). Placement stamps
`order_items.returnable_at_purchase` from the channel-effective value, so `returns` needs no change.

**Rationale.** Overlaying channel values onto a record whose other readers (PIM, admin, feeds) mean the
global value would make one field mean two things depending on an option.

**Alternatives rejected.** *`findByIds(ids, { effectiveIn: { channelId } })` overlay* — see rationale.

## R27 — Attribute scope-flag changes (FR-090)

**Decision.** A read-only preview endpoint counts the `product_value_overrides` rows a narrowing would
orphan (by channel); the existing attribute update is unchanged and already retains rows (orphans are
skipped by the resolver, `spec.md` *Current state*). Widening creates nothing. The overview lists such rows
as orphaned with a delete action (FR-015).

**Admin (analyze H2).** No admin surface edits `channelScoped` / `languageScoped` today
(`catalog/src/admin/pages/AttributesManager.tsx` toggles only the eight search/filter flags), so the preview
needs a home: the attribute edit form gains the two scope flags for user-defined attributes (system
attributes stay pinned and read-only, `getAttributeScope`), and a save that narrows either flag first calls
the preview and asks the operator to confirm, showing how many overrides become orphaned per channel /
language; widening saves without asking.

## R28 — URL keys for whole-channel readers

**Decision.** `catalog` publishes `catalogProductUrlKeyReadPort.effectiveKeys(productIds, channelId):
Map<productId, Map<languageCode, key>>` for `seo`'s sitemap generator (and any later reader); catalog's own
listing summary sets `ProductSummary.slug` to the effective key at (C, L), which carries every storefront
link and `storefront/app/sitemap.ts` without a storefront change beyond the PDP.

**Stable handle for API lookups (analyze M1 follow-through).** CMS product blocks store product slugs
(`packages/cms-components/src/utils/catalog-block-data.ts` `products-by-slugs`) and fetch them through
`GET /api/v1/catalog/products/:idOrSlug` (`storefront/lib/page-builder/catalog-block-data.ts`). Once a
product holds a key of L, its global slug is no longer one of its keys in L, so "current keys at (C, L)
only" would empty those blocks. The JSON lookup therefore answers, in order: an id; a current key at
(C, L); else a product's **global key** (`products.slug`, unique platform-wide) — an API handle, not a URL, so
K1 (which governs the PDP route through `resolve`) is untouched. It never answers a redirect.

## R29 — What "undo" means for a single scoped write (analyze C1 follow-through)

**Finding.** The only reversible surface in the tree is the bulk operation: `RevertRecord[]` on
`catalog_bulk_operations` and `POST /api/v1/admin/catalog/bulk-operations/:id/undo`
(`bulk-operation.service.ts:584`, `docs/docs/architecture/command-bus.md` § Reversibility & undo). Nothing
undoes a single Command; `delivery_methods/src/backend/commands/delivery-method.commands.ts` documents the
convention — a single-row Command is not `reversible`, and its audit `stateBefore` is what an operator
restores from by re-sending it. This plan's earlier "undo handler registered for `product.scopes.update`"
named machinery that does not exist.

**Decision (owner, Q-D → A, 2026-10-22).** Bulk scoped writes are undone by the existing bulk-operation undo
(all-or-nothing per product, conflict report — T073). Single scoped writes (`product.scopes.update`,
`product.url_keys.update`, `product.url_redirect.delete`, `product.media.update`, the attachment and
packaging-unit updates, `seo_meta_override.upsert/.delete`) are Commands whose `before` / `after` are the
**complete** projection of every row touched, so re-applying `before` through the same route restores it;
tests assert that projection, not an undo endpoint. No new machinery, and no single-write undo (FR-081).

**Alternative rejected (Q-D option B).** A generic single-Command undo (revert records on the audit row or a
new table, a generic undo route, conflict detection per object type) is platform work owned by
`audit_logs`/the platform, a new phase, and a Complexity Tracking entry. The owner placed it out of scope;
it is a possible future issue, not part of 163.

## R30 — The status model after the owner's final Q1: migration, Archive / Restore, inventory (2026-10-25)

Spec Session 2026-10-25 (Q1, Q1-a…f, O-1…O-6) removes `draft`, makes `inactive` plain off at every scope,
and turns archiving into a separate global Archive / Restore action. `data-model.md` §13–§14 and
`contracts/admin-scopes-api.md` §2 left three things to the architect; they are decided here, followed by
the inventory of what still assumes the old model. Measured on S1's tip `829ce2995`.

### R30.1 — One new migration; `20261022T035133_catalog_product_scopes.ts` is not amended

**Decision.** One new `catalog` migration, scaffolded with
`pnpm --filter backend run migration:new -- --module catalog --name product_status_drop_draft`, does the
whole transition in the order data-model §13 fixes:

1. `update products set archived_at = updated_at where status = 'inactive' and archived_at is null` (O-4);
2. `draft` → `inactive` in `products`, `product_channel_scopes` and `product_channel_language_scopes`, without
   writing `archived_at` (Q1-b);
3. `alter table … drop constraint if exists product_channel_scopes_status_check` /
   `…product_channel_language_scopes_status_check`, re-added as `("status" is null or "status" in
   ('active','inactive'))` and `("status" in ('active','inactive'))`; `products_status_check` added (R30.2);
4. `alter table products alter column status set default 'inactive'` (Q1-d).

`down` restores the three-value scope `CHECK`s, drops `products_status_check` and sets the default back to
`draft`; it cannot tell a converted `draft` or a backfilled `archived_at` from an original one and leaves
the data as it is (data-model §13). The migration file under `20261022T035133` keeps its three-value
`CHECK`s as history.

**Rationale.** `mikro_orm_migrations` records the class name, so a database that already ran
`20261022T035133` never re-runs an amended body (`specs/conventions/module-migrations.md` item 5 states the
same for a rename). Test templates would rebuild — `backend/test/template-identity.ts` digests every
migration source — but every developer database built by `pnpm run setup` in the four 163 worktrees, and any
long-lived database the fork's environments keep, would silently retain the three-value `CHECK` and any
`draft` scope rows. `products` needs a new migration anyway (it predates this feature), and the backfill
must precede the conversion; one file keeps that order in one place. `drop constraint if exists` makes the
same file correct on a fresh database and on one that ran the old body. Catalog's own migrations order by
timestamp, so the new one runs after `20261022T035133`.

**Alternatives rejected.** *Amend `20261022T035133` in place* — leaves every already-migrated database wrong
without a signal. *Amend in place and add a migration for `products` only* — splits one ordered transition
across two files and still leaves the already-migrated scope tables wrong. *Rename `20261022T035133`* —
costs every developer database a rebuild (`module-migrations.md` item 5) to buy nothing the new migration
does not.

### R30.2 — `products.status` has no `CHECK`; one is added

**Finding.** `products` is created by `packages/platform/src/migrations/20260424T165847_core_foundation_init.ts`
(`"status" varchar(16) not null default 'draft'`, no `CHECK`, an index `products_status_index`);
`20260526T124736_catalog_product_status_inactive.ts` only updates rows. Nothing exists to rewrite.

**Decision.** Add `products_status_check (status in ('active','inactive'))` in the same migration, after the
conversion. Catalog migrations already write `products` (`catalog_product_status_inactive`,
`catalog_order_rules`, `catalog_product_scopes`), so `check:module-boundary` R2 holds.

**Rationale.** SC-009 asks for zero stored values other than `active` / `inactive` **after** deployment, not
only at its instant. A process still running pre-163 code during a rolling deploy creates products with the
old entity default `draft` after the conversion has run; without a `CHECK` that row persists silently and
breaks the admin list's status filter (which now refuses `draft`), with one the stale write fails loudly. The
two scope tables already enforce the same set; the global column would otherwise be the only place where it
is not. Cost: one validating scan of `products` inside the migration, which the `update` of step 2 already
pays for.

**Alternative rejected.** *The application enum alone* — the precedent is `productTypeSchema` (feature 002
R-1), which keeps the type set open for new types; the status set is closed by owner decision, so the
precedent's reason does not carry.

### R30.3 — Archive / Restore: routes, Commands, events (FR-019, FR-053, FR-080, FR-082)

**Decision — single product.**

| | Archive | Restore |
| --- | --- | --- |
| Route | `POST /api/v1/admin/catalog/products/:id/archive` | `POST /api/v1/admin/catalog/products/:id/restore` |
| Body | none | none |
| Gate | `requireAdmin('catalog:write')` as `preHandler` (401/403 first) | same |
| Answer | `200 { data: AdminProduct }` (`serializeAdminProduct`, carries `archivedAt`) — also on a no-op | same |
| Refusals | `404 PRODUCT_NOT_FOUND` for an unknown, soft-deleted or non-UUID id | same |
| Command | `product.archive`, `objectType: 'product'` | `product.restore`, `objectType: 'product'` |
| Audit | `before` / `after` = `{ archivedAt }`; no-op → `skipAudit`, no event | same |
| Events | `product.updated.v1` `changedFields: ['archivedAt']`, then `product.archived.v1`, in one event scope (the ordering `updateProductAudited` uses today, `catalog-admin.service.ts` ~490–506) | `product.updated.v1` `changedFields: ['archivedAt']` |
| Service | `CatalogAdminService.archiveProduct(id)` — the deprecated method is reimplemented, no longer calls `updateProduct` | `restoreProduct(id)` |

Neither reads or writes a status column at any scope, neither fires the completeness gate. `changedFields`
names the property that moved, as `status` and `sku` do (R10), and is the same key the audit projection and
the bulk revert record carry.

**Decision — bulk.** `fields.archived: boolean` on the existing `POST /api/v1/admin/catalog/products/bulk-update`
(`true` = Archive, `false` = Restore), refused with `400 VALIDATION_FAILED` when combined with **any** other
field (one meaning per action, as R20 does for `scopedStatus` and `status`). Per product it runs the single
Command above — not `updateProduct` — so each product gets one `product.archive` / `product.restore` audit
entry. Outcome per product: `succeeded` with `changedFields: ['archivedAt']`; a product already in the
requested state is `succeeded` with `changedFields: []`, no audit entry and no event (O-6); no new reason
code. Inline and queued paths, the `product_bulk_update` kind, the per-run summary audit and the undo are
unchanged in shape: `revertibleFieldKeys` maps `archived` → `archivedAt`, and **drops** its
`status` → `archivedAt` addition (`bulk-operation.service.ts:675-676`), so a bulk status undo restores status
only. The collection selection (`POST …/products/resolve-ids`) gains the list's `archived` mode (R30.4) so
"select every archived product → Restore" works from the Archived filter.

**Decision — undo emits.** `product.bulk_update.undo` restores columns with `em.assign` and emits nothing
today, for every field (a status or visibility undo leaves search, feeds and webhooks stale until the next
write). Undoing a bulk Archive is a restore and FR-082 requires that to be announced, so the undo emits, after
commit, `product.updated.v1` per reverted product with `changedFields` = the restored keys, and
`product.archived.v1` where it moves `archivedAt` from null to set. The emission is for every reverted
field, which also closes the pre-existing gap.

**Alternatives rejected.** *`PATCH /products/:id { archived: true }`* — puts archiving back on the general
update path FR-019 separates it from, and gives `product.update` two meanings (with and without
`product.archived.v1`), the shape that produced the problem. *`DELETE /products/:id`* — taken by the soft
delete. *Action names `product.archived` / `product.unarchive`* — the tree's actions are imperative verbs
(`product.update`, `product.duplicate`, `product.delete`). *New `BULK_OPERATION_TYPES` kinds with their own
endpoints* — the queued consumer, the revert capture (`revertibleFieldKeys`, `#snapshotProductFields`,
`touchedFieldsOf`) and the undo are all keyed on `payload.fields`; a new kind needs its own copy of each for
one column. data-model §10's "kinds of their own" is met by the field's exclusivity and the per-product
Command names.

### R30.4 — Admin list and selection (FR-112, FR-113)

**Decision.** `GET /api/v1/admin/catalog/products`:

- `status` ∈ `active` | `inactive`; any other value — `draft`, `archived` included — answers
  `400 VALIDATION_FAILED` with `details.field = 'status'` (today an unknown value is silently ignored and
  `archived` maps to `inactive`, `routes.admin.ts:560-566`).
- A new `archived` query parameter, `exclude` (default) | `include` | `only`, filters on `archived_at`,
  independently of `status`. The legacy `includeArchived=1|true` stays as the existing way to include them
  and means `include`; when both are sent, `archived` wins.
- `counts` becomes `{ all, active, inactive, archived }`: `all`, `active`, `inactive` over non-archived,
  non-deleted rows; `archived` over archived, non-deleted rows. The `draft` key goes.
- `POST …/products/resolve-ids` takes the same `archived` mode beside `includeArchived` (its default stays
  `include`, as today).

The admin page sends `includeArchived=1` on every request today (`ProductsList.tsx:141`), so archived rows
show under "All". After the change the page offers *All · Active · Inactive · Archived*, the first three
non-archived, which is what FR-113's "hidden by default" requires of the screen as well as of the API. A
saved view holding `status: 'draft'` falls back to "All" on the client (`isStatusFilter`) and is never sent;
saved views are not migrated.

**Alternative rejected.** *An "Archived" pseudo-status in the status filter* — the very conflation O-2 removed.

### R30.5 — Inventory: what still assumes `draft` or "inactive archives"

| Area | Site (S1 tip `829ce2995`) | Change | Task |
| --- | --- | --- | --- |
| contracts | `catalog.ts:38` `productStatusSchema`; `:49-58` `coerceProductStatusWrite`, `productStatusWriteSchema`; `:664`, `:793` writes; `:821` scoped bulk value; `:3602` `product.archived.v1` doc | two values; alias and write schema removed; `fields.archived`; doc "archived by the Archive action" | T156a, T156e |
| contracts | `product-scopes.ts:227` `statusOnAt` treats `archivedAt` as off, and its docstring `:196-208` | status only (FR-060) | T156a, T156e |
| contracts | `prompt-actions.ts:257`, `quick-order.ts:193` | drop `draft` | T156e |
| catalog | `product.entity.ts:57` type + default | `active` / `inactive`, default `inactive` | T156f |
| catalog | `catalog-admin.service.ts:347`, `:891` (+ doc `:837`) | create / duplicate → `inactive` | T156g |
| catalog | `catalog-admin.service.ts:629-636` and the `archived` outcome plumbing `:445-530` | status write never touches `archivedAt`; `product.archived.v1` only from Archive | T156g |
| catalog | `catalog-admin.service.ts:1186-1191` deprecated `archiveProduct()` | reimplemented as the Archive Command | T156g |
| catalog | `catalog-admin.service.ts:1369-1525` list / counts / resolve; `routes.admin.ts:560-566` | R30.4 | T156h |
| catalog | `bulk-operation.service.ts:675-676`; `catalog-bulk-update.service.ts` | R30.3 bulk | T156m |
| catalog | `catalog-query.service.ts:1816` 410 on `archivedAt \|\| status === 'inactive'`, message "Product is inactive." | `archivedAt` only | T156t |
| catalog | `prompt-tools.ts:332`, `admin-search-provider.ts:28` (+ bundle key), `catalog-admin-search.service.ts:14` | drop `draft` | T156o |
| catalog | `i18n/{en,pl}.json` `errors.PRODUCT_ARCHIVED` = "Product is inactive." | "Product is archived." / "Produkt jest zarchiwizowany." | T156i |
| consumers | `quick_order/…/import-pipeline.ts:143`, `shopping_lists/…/shopping-list-service.ts:512`, `orders/…/order-reorder-service.ts:93` | "archived" read from `archivedAt`, never from `status` | T156n |
| import | `import_export/…/adapters/products.adapter.ts:3`, `:80` | `productStatusSchema`; `draft` / `archived` refused per record (FR-092) | T156e, T156l |
| storefront | `lib/api/quick-order.ts:88` | drop `draft` | T156o |
| admin UI | catalog `ProductEditor.tsx` (`:60`, `:67`, `:130`, `:201`, `:413`, `:915`, `:2015`), `ProductsList.tsx` (`:41`, `:48`, `:79`, `:82`, `:107`, `:141`, `:429-432`, `:823`), `ProductsBulkEditDialog.tsx:30`, `:380`, `lib/resolve-product-selection.ts:4` | two values; Archive / Restore; Archived filter | T156w |
| admin UI | admin-kit `product-browser/{types.ts,ProductBrowserDialog.tsx:84-145,product-browser-api.ts:7,:21}`, `product-picker/ProductPicker.tsx:114`; `page-builder-admin/src/chrome/CatalogPickers.tsx:155`, `:236`; `blog/…/RelatedProductsPicker.tsx:10`; `orders/…/OrderCreatePage.tsx:71`; `product_feeds/…/FeedCriteriaPanel.tsx:178-180` | drop `draft`; archived via `archivedAt` | T156x |
| connectors | none in this repository maps or emits `draft`: `erp_connector` and `pim_connector` write no product status, and the PIM sync packages live outside it (plan D5). External writers reach the status through the API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` (`routes.api-key.ts`) and the import | release note only: `draft` / `archived` → 400; `inactive` no longer archives; a create without status is `inactive` | T156q |
| data | `product_feeds` criteria rules holding `status = draft` (`product_feeds`' rows) | not rewritten — a `catalog` migration may not write another module's table (R2); such a rule matches nothing after the migration, as it effectively did before (the feed floor already required `active`, consumers row 11) | — |
| docs | `catalog/docs/catalog.md:32`, `:36`, `:223-254`, `:527`; `catalog/per-channel-per-language-overrides.md`; `quick_order/docs/quick_order.md:28`; Polish mirrors | spec *Compatibility and release* § Documentation | T156p |

Tests asserting the old model are listed under T156j (backend) and T156z (admin).

### R30.6 — Release: breaking, recorded as `minor` (D-225)

**Decision.** Every changeset of this change is written as **breaking** — the body headed so, naming each
removed symbol with the old call and the new one — at bump level **`minor`**: `productStatusSchema`
narrowed; `coerceProductStatusWrite` and `productStatusWriteSchema` removed (use `productStatusSchema`);
`status: 'draft'` → `'inactive'`; archiving by `status: 'inactive'` or `'archived'` → `POST
…/products/:id/archive` or bulk `fields.archived: true`; list `counts.draft` → `counts.archived`;
`status=archived` list filter → `archived=only`; `product.archived.v1` now means "archived by the Archive
action". Packages: `@endora-commerce/contracts`, `@endora-commerce/mod-catalog`,
`@endora-commerce/admin-kit` (Phase 15a), plus `patch` notes for the import, quick-order, shopping-list and orders
behaviour fixes.

**Rationale.** `specs/conventions/release-intent.md` (D-225): `major` is **refused** while a package is in
`0.x` — `@endora-commerce/contracts` is `0.107.0` — and `check:release-intent`'s
`major-bump-in-a-zero-series` has no override, so a `major` changeset reds the final gate (T153). In a `0.x`
series `minor` already takes every caret dependent out of range, which is the whole consumer-facing meaning
of a break.

**Alternative rejected.** *`major`, as spec *Compatibility and release* first worded it* — mechanically
refused. Settled by the coordinator on 2026-10-25: the spec now requires a changeset marked BREAKING at the
bump level D-225 allows (`minor` in `0.x`).

### R30.7 — Sequencing against the streams in flight

- `catalog-query.service.ts:1816` sits in `getProductByIdOrSlug`, which S2's Phase 17 (T110) is editing now
  and Phase 18 (T118) edits again. The one-condition fix is therefore its own Phase 9c, run on S1 after
  P17–P18 are applied — or, if the coordinator prefers, handed to S2 as a line of P17. **Decided 2026-10-25
  (coordinator): S2 does it inside P17** (T156s–T156t), beside T110's edit of the same method. Until it lands, a
  non-archived `inactive` member that would be available with global `active` answers 410 instead of 404;
  no test asserts either answer in between (Phase 9a removes the `draft` case from T031's matrix, 9c adds the
  new one).
- `import_export/…/products.adapter.ts` is edited by Phase 9a (its import of the removed
  `productStatusWriteSchema`) and by S2's Phase 19 (T123, scoped columns); 9a goes first and S2 rebases onto
  it.
- The contracts narrowing of Phase 9a stops `pnpm --filter @endora-commerce/admin-kit run typecheck` where
  a `Record<ProductStatus, …>` names `draft` (`ProductBrowserDialog.tsx:84-98`); 9a removes the `draft`
  literals a type-check refuses — also in S3-owned catalog admin files, as one compile-only commit (T156e) —
  and the screens change in S3's Phase 15a.
- S2's uncommitted handover touches `packages/contracts/src/catalog.ts` (the PDP `paths` field); 9a rewrites
  the status region of the same file. Different regions, but the coordinator applies S2's handover on S1
  before 9a's contracts commit, or 9a rebases over it.
- If S1 has already started Phase 10 after ticking Phase 9, it stops and takes 9a–9b first: T073–T076 build
  on the narrowed enum and on `revertibleFieldKeys` without the `status` → `archivedAt` coupling.
- `prompt_actions`' `catalog.set_product_status` was, in effect, the assistant's way to archive (`inactive`).
  After 9a it only switches products off and no assistant tool archives; adding `catalog.archive_products`
  is not planned (YAGNI) and is the owner's call.
