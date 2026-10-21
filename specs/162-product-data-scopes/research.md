# Research: product data scopes per sales channel and language

**Feature**: `specs/162-product-data-scopes/` | **Spec**: `spec.md` (clarify rounds 1–4) | **Measured on**:
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

## R3 — Status semantics, and keeping the owner's option B cheap

**Decision.** The value set stays `draft | active | inactive` (FR-010, clarify Q1 option A) and is
declared once, as `PRODUCT_SCOPE_STATUSES` in `packages/contracts/src/product-scopes.ts`. **Every
predicate tests `= 'active'` and never enumerates the off values.** Below global scope, `inactive` is
plain off (N1) and never archives; the archive transition in `catalog-admin.service.ts:448-488` is left
untouched and keeps reading only the global column.

**Rationale.** If the owner chooses option B at acceptance (enabled/disabled per scope + a global archive
action), the change is: the scope tables' `CHECK` and the contract constant, a data migration mapping
scope `draft`/`inactive` → `disabled` and `active` → `enabled`, and the admin control's options. No
predicate, port signature or resolution function changes, because none of them names an off value.

**Alternatives rejected.** *A boolean `enabled` column at scope level now* — decides the owner's open
question for them.

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
`packagingUnits`. Global archive keeps `product.archived.v1` exactly as today.

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
  *global* key, redirecting in every language where the product has no language key), `key`. Partial
  unique `(language_code, key)` where not null and `(key)` where null. A `NULL`-language redirect resolves
  in **every** language of every channel (analyze H1, 2026-10-21): conditioning it on "where the product has
  no L key" made a former global key stop resolving in L the day the product got its first L key — an
  expiry FR-072 forbids. A current key always wins over a redirect with the same key.
- **Uniqueness is enforced in the write service, inside the Command, under
  `pg_advisory_xact_lock(hashtextextended('catalog.url-key:' || key, 0))`** taken for every key the write
  touches, in sorted order (no deadlock). The check is the closed list of FR-070/072: another product's
  global slug, language key, any-channel C×L key (orphans included), or redirect in the same language
  (and for a global key: in any language). The indexes above and `products.slug`'s unique index are
  backstops for the expressible half.
- Changing a key writes the old key as a redirect **in its language** (a language or C×L key) or with
  `language_code NULL` (the global key); giving a product its first L key inserts a redirect `(L, slug)`
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
is effectively present**; (3) else not-found.
Availability (FR-001) is then evaluated for the product the key resolved to (FR-071) — an unavailable
target answers not-found, an archived one answers "gone" (edge cases). The public route answers a redirect
as `{ data: { redirect: { key, language } } }` with HTTP 200 on a dedicated resolve endpoint (contract
`url-keys-and-redirects.md`); the storefront calls `permanentRedirect()`. Every emitted URL (sitemap,
canonical, `hreflang` alternates, the redirect target, the admin preview URL) is `/p/<effective key>` plus
`?lang=<L>` when L ≠ channel default (F3), produced by **one** pure helper, `productPath({ key,
languageCode, channelDefaultLanguage })` in `packages/contracts/src/product-url-keys.ts`, which the
storefront, `seo`'s sitemap generator and catalog's admin/resolve responses all import — so the later
language-path-prefix change (owner, Q-B → C, a separate issue) edits one seam.

**Q-B decided (owner, 2026-10-21): option C, out of scope for 162.** A language prefix in the storefront
path (`/en/p/drill`) is a separate issue. For 162 the interim stands: `?lang=<L>` on every URL the
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
null, value: 'draft' | 'active' | 'inactive' | 'inherit' }`. It rides the existing inline/queued paths
(`BULK_ASYNC_THRESHOLD`, `BulkOperationService`), the per-product Command audit and the bulk undo
(`bulk-operation-undo.contract.test.ts`), so FR-052 needs no new machinery. New per-product reasons:
`scope_invalid` (not a member / language not offered, FR-051) and `completeness_gate` (FR-061). It may not
be combined with the global `status` field in one request (one meaning per action).

## R21 — Deployment and backfill (FR-110, SC-001)

**Decision.** **No data backfill.** Every new table starts empty, which is "inherit everywhere"; the
global values already hold today's status, audience, MOQ and returnable; `products.slug` is the global key;
existing SEO rows become the L scope by having a `NULL` channel. The intended behaviour changes at deploy
(`plan.md` § Intended behaviour changes) are written into SC-001's test: a `draft` (or member,
non-`active`) product is no longer reachable by URL (FR-005) and no longer addable to a basket (F1);
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

**Decision (interim, `plan.md` Q-D).** Bulk scoped writes are undone by the existing bulk-operation undo
(all-or-nothing per product, conflict report — T073). Single scoped writes (`product.scopes.update`,
`product.url_keys.update`, `product.url_redirect.delete`, `product.media.update`, the attachment and
packaging-unit updates, `seo_meta_override.upsert/.delete`) are Commands whose `before` / `after` are the
**complete** projection of every row touched, so re-applying `before` through the same route restores it;
tests assert that projection, not an undo endpoint. No new machinery.

**Alternative rejected (for now).** A generic single-Command undo (revert records on the audit row or a
new table, a generic undo route, conflict detection per object type) is platform work owned by
`audit_logs`/the platform, a new phase, and a Complexity Tracking entry. It becomes the plan only if the
owner answers Q-D that one-click undo of a single scoped write is required.
