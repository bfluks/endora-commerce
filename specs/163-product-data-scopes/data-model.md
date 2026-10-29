# Data model: product data scopes

**Feature**: `specs/163-product-data-scopes/` | Decisions: `research.md` (R#). Every table here is
**platform-global** (`@GlobalEntity()`), as `products` and `product_value_overrides` are (FR-083,
Constitution XI): catalogue data, with audience evaluated at read time against the buyer's organization.

Migrations are **scaffolded, never numbered** (`pnpm --filter backend run migration:new -- --module <id>
--name <slug>`); the names below are the `--name` slugs. Ownership decides the module; nothing here writes
another module's table (`check:module-boundary` R2).

| Migration (`--module`, `--name`) | Owner | Story | Tables / columns |
| --- | --- | --- | --- |
| `catalog`, `product_scopes` | catalog | US1–US3, US10 | `product_channel_scopes`, `product_channel_language_scopes`, `products.publish_from`, `products.publish_until` |
| `catalog`, `product_url_keys` | catalog | US7 | `product_url_keys`, `product_url_redirects` |
| `seo`, `meta_override_channel_scope` | seo | US8 | `seo_meta_overrides.sales_channel_id`, `locale` nullable, uniques |
| `catalog`, `product_media_scopes` | catalog | US9 | `gallery_item_channel_labels`, `gallery_item_channel_hidden`, `gallery_items.alt_text` |
| `catalog`, `product_status_drop_draft` (suggested; §13 — the architect may fold the scope-table half into `product_scopes`; decided: not folded, one new migration, research R30.1) | catalog | Q1 block | `products.status` data + default; `CHECK`s of `product_channel_scopes`, `product_channel_language_scopes` |
| `catalog`, `attachment_packaging_translations` | catalog | US9 | `product_attachments.name_translations`, `.description_translations`, `product_attachment_channel_hidden`, `product_packaging_units.name_translations` |

Foreign keys to `sales_channels` (a kernel table) need no manifest edge beyond the `sales_channels`
dependency catalog already declares (`packages/modules/catalog/src/manifest.ts`); `seo`'s manifest is
checked by `test/unit/db/fk-dependency-drift.test.ts` in its phase. **No backfill anywhere** (R21) —
**except** the `draft` → `inactive` conversion and the `archived_at` backfill of today's `inactive` rows,
§13 (Session 2026-10-25, Q1-b, O-4).

---

## 1. `product_channel_scopes` (catalog) — R1, R3, R4

One row per (product, channel) holding the channel overrides of the channel-scoped scalar fields.

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `product_id` | uuid | no | PK part; FK `products(id)` on delete cascade |
| `sales_channel_id` | uuid | no | PK part; FK `sales_channels(id)` on delete cascade |
| `status` | varchar(16) | yes | `NULL` = inherit global; else `active`/`inactive` (`CHECK (status in ('active','inactive'))`, §13) |
| `window_overridden` | boolean | no, default false | the window pair below replaces the global pair |
| `publish_from` | timestamptz | yes | inclusive; meaningful only when `window_overridden` |
| `publish_until` | timestamptz | yes | inclusive; meaningful only when `window_overridden` |
| `visibility` | varchar(32) | yes | `NULL` = inherit the whole global audience rule; else `public`/`logged_in_only`/`organization_restricted` |
| `allowed_organization_ids` | jsonb | yes | non-null exactly when `visibility` is non-null (`CHECK`); array of uuids, may name non-members (C4) |
| `min_order_quantity` | integer | yes | `NULL` = inherit; 1…1 000 000 (`CHECK`); `1` = "no minimum here" |
| `returnable` | boolean | yes | `NULL` = inherit |
| `created_at`, `updated_at` | timestamptz | no | |

Constraints: `CHECK (publish_from is null or publish_until is null or publish_from < publish_until)`;
`CHECK (window_overridden or (publish_from is null and publish_until is null))` — bounds exist only on an
overridden window, while an overridden fully-open window (flag true, both `NULL`) is a legitimate value. Index
`(sales_channel_id, status)`. Invariant kept by the write service: a row whose every field inherits is
deleted (FR-012).

## 2. `product_channel_language_scopes` (catalog) — R2

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `product_id` | uuid | no | PK part; FK `products` cascade |
| `sales_channel_id` | uuid | no | PK part; FK `sales_channels` cascade |
| `language_code` | varchar(16) | no | PK part; a code of `sales_channels.languages` at write time (FR-014) |
| `status` | varchar(16) | no | `active`/`inactive` (`CHECK (status in ('active','inactive'))`, §13) |
| `created_at`, `updated_at` | timestamptz | no | |

"Use inherited" deletes the row. Rows for a language later removed from the channel are retained and
ignored (FR-015); the overview lists them as orphaned.

No index beyond the primary key: every reader — the availability predicate's keyed sub-select (R2,
`coalesce(cl.status, c.status, p.status)`), the scopes read, the write — seeks by product first, which the
PK `(product_id, sales_channel_id, language_code)` serves. A `(sales_channel_id, language_code, status)`
index had no reader and was dropped before the migration merged (163 Block A review).

## 3. `products` additions (catalog)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `publish_from` | timestamptz | yes | global window start, inclusive |
| `publish_until` | timestamptz | yes | global window end, inclusive; `CHECK (from < until)` |

`status`, `visibility`, `allowed_organization_ids`, `min_order_quantity`, `returnable`, `slug` keep their
meaning as the **global** values. `products.status` holds `active`/`inactive` only, default `inactive`
(§13). `archived_at` is set and cleared **only** by the Archive / Restore Commands (§14, FR-019) — no status
write at any scope touches it.

## 4. Effective values (the rule, `packages/contracts/src/product-scopes.ts`) — R5

```text
effectiveStatus(p, C, L)   = cl(p,C,L).status ?? c(p,C).status ?? p.status
on(p, C, L)                = effectiveStatus(p, C, L) = 'active'
window(p, C)               = c(p,C).window_overridden ? (c.from, c.until) : (p.from, p.until)
inWindow(w, now)           = (w.from is null or w.from <= now) and (w.until is null or now <= w.until)
audienceRule(p, C)         = c(p,C).visibility != null ? (c.visibility, c.allowed) : (p.visibility, p.allowed)
admits(rule, buyer)        = isProductVisibleTo(rule, buyer)          -- unchanged predicate
available(p, C, L, buyer, now) =
    p.deleted_at is null and p.archived_at is null
    and member(p, C)                                   -- kernel membership accessor
    and L ∈ C.languages
    and on(p, C, L) and inWindow(window(p, C), now) and admits(audienceRule(p, C), buyer)
moq(p, C)                  = c(p,C).min_order_quantity ?? p.min_order_quantity
returnable(p, C)           = c(p,C).returnable ?? p.returnable
```

Orphans (FR-015) are ignored because `member(p, C)` and `L ∈ C.languages` are evaluated against the
present membership and channel languages — rows are never consulted for a pair that fails them.

`resolveScopeLanguage(channel, tag)`: exact (case-insensitive) match in `channel.languages`, else the first
entry sharing the base language, else `channel.defaultLanguage` (R7).

## 5. `product_url_keys` and `product_url_redirects` (catalog) — R11, R12

`product_url_keys`

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `product_id` | uuid | no | FK `products` cascade |
| `language_code` | varchar(16) | no | the key's language |
| `sales_channel_id` | uuid | yes | `NULL` = the language key; else the C×L override; FK `sales_channels` cascade |
| `key` | varchar(160) | no | same format as `products.slug` (lower-case slug grammar) |

Partial uniques: `(product_id, language_code) where sales_channel_id is null`;
`(product_id, sales_channel_id, language_code) where sales_channel_id is not null`. Index
`(language_code, key)`.

`product_url_redirects`

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `product_id` | uuid | no | the product the old key redirects to; FK `products` cascade (FR-072 "removed when the product is deleted" — soft delete also removes them in the delete Command) |
| `language_code` | varchar(16) | yes | the key's language; `NULL` = a former global key, which redirects in **every** language of every channel (H1 — never conditional on the product's language keys, so it never expires) |
| `key` | varchar(160) | no | the old key |
| `created_at` | timestamptz | no | |

Partial uniques: `(language_code, key) where language_code is not null`; `(key) where language_code is null`.

**Resolution order for key `k` at (C, L)** (R12): a current key of L (a `product_url_keys` row of L, or a
global slug of a product with no L key) **always wins** over a redirect with the same key; then a redirect
row of L; then a redirect with `language_code NULL` — in any L, whatever language keys its product holds.
The write rules below guarantee that a current key and a redirect of **another** product never share a key
in one language, so "wins" only ever arbitrates between a product's own current key and its own
`NULL`-language redirect (which keeps serving the other languages).

**Keys of product P in language L** (FR-070): `product_url_keys` rows of P with `language_code = L`
(any channel, orphans included) ∪ { `P.slug` if P has no language key for L }.
**Effective key at (C, L)**: P's row for (C, L) → P's language key for L → `P.slug`.

**Write rules** (all inside one Command, after `pg_advisory_xact_lock(hashtextextended('catalog.url-key:'
|| key, 0))` per touched key in sorted order — the lock idiom of
`catalog/src/backend/services/product-list-view-service.ts:190`):

| Writing key `k` for P in language L | Outcome |
| --- | --- |
| `k` is another product's key in L (language key, C×L key of any channel incl. orphans, or global slug where it has no L key) | refused `URL_KEY_TAKEN`, names the holder |
| `k` is another product Q's redirect in L, or **any** global (`NULL`-language) redirect of Q (H1: no "while Q has no L key" condition) | `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` naming Q, unless the request carries `confirmTakeover: [k]` (operator only) → Q's redirect row deleted, key saved. Taking over Q's `NULL`-language redirect removes it in every language, and the confirmation says so |
| `k` is P's own redirect in L (`language_code = L`) | that redirect row deleted (no self-redirect), key saved |
| `k` is P's own `NULL`-language redirect, written as an L or C×L key | the redirect row is **kept** (it still serves every other language); in L the current key wins (resolution order) |
| P's previous key at that scope was `k0 ≠ k` | redirect `(L, k0) → P` inserted (if not already P's current key in L) |
| P gets its **first** language key for L | redirect `(L, P.slug) → P` inserted (FR-072 consequence 1) |
| P's language key for L is removed ("use inherited") | While some channel offers L, `P.slug` becomes P's key in L again, so it is checked in L like a write of `P.slug`: another product's current key in L → refused `URL_KEY_TAKEN` naming the holder (the operator gives P another L key instead); another product's L redirect → takeover required. Removing an **orphaned** language key (no channel offers L) is always allowed (FR-015) and skips this check — a collision it leaves is between orphans, which SC-008 already tolerates. Otherwise the removed key becomes redirect `(L, k)` and a redirect `(L, P.slug)` of P is deleted (slug is current again) |
| Writing a **global** key (`products.slug`) | checked against every language: any other product's key in any L → refused; another product's redirect with that key in any language → takeover required (confirmation names every losing product). The old slug `old` becomes a redirect **only where it is free** (below) |
| … the old slug's redirect, when the global key changes from `old` | `old` is **free in L** when no other product holds it in L as a current key (language key, C×L key of any channel incl. orphans) or as a redirect (`(L, old)`). If `old` is free in every language of every channel → one redirect `(NULL, old) → P`. Otherwise → **no** `NULL` row; a redirect `(L, old) → P` for every language L of any channel in which `old` is free and is not already P's own current key or own `(L, old)` redirect, and **none** where it is taken (that language's holder keeps it). Rationale below the table |
| Writing P's own `NULL`-language redirect `k` back as P's global key | the `NULL` row is deleted and replaced by a redirect `(L, k) → P` for every language L in which P holds a language or C×L key (there the slug is not P's key, so without it `k` would stop resolving in L — H1) |
| Writing P's own per-language redirects `(L, k)` (the fallback rows above) back as P's global key | rows of languages where P has no language key are deleted (the slug is current there again — no self-redirect); rows of languages where P holds a language or C×L key are kept |

**Why the old global slug is conditional (re-analyze HIGH-2, 2026-10-22).** A language or C×L key `k0` that
P gives up was P's current key in its language, so uniqueness guarantees no other product holds it there and
`(L, k0)` is always free. The global slug is different: it counts as P's key only in languages where P has
**no** language key, so in a language L where P has one, another product Q may legally take `old` as its L
key. Sequence: P holds a key in L → Q takes P's slug `k` as its L key → P changes its slug. An unconditional
`(NULL, k) → P` would then share `k` in L with Q's current key — exactly the state the resolution order
promises cannot arise between two products — and would sit in the `(key) where language_code is null`
unique, blocking Q from ever releasing `k` as an `(L, k)` redirect of its own. The per-language fallback
keeps `old` redirecting to P everywhere it can and never in a language where it belongs to someone else.
Languages are those of the channels that exist at write time; a language added later gets no row in the
fallback case — `old` never resolved there, so nothing expires (FR-072). The same reasoning makes removing
P's language key a write of `P.slug` in L (the row above).

Import / connector writes take the same checks and **never** take over: the refused key is reported and
the previous key kept (FR-093).

## 6. `seo_meta_overrides` changes (seo) — R13

| Change | Detail |
| --- | --- |
| add `sales_channel_id uuid null` | FK `sales_channels` on delete cascade |
| `locale` becomes nullable | `CHECK (locale is not null or sales_channel_id is not null)` |
| drop `uniq_seo_meta_overrides_entity_locale` | replaced by three partial uniques: `(entity_type, entity_id, locale) where sales_channel_id is null`; `(entity_type, entity_id, sales_channel_id) where locale is null`; `(entity_type, entity_id, sales_channel_id, locale) where both not null` |

Scope of a row: `locale` only = L; channel only = C; both = C×L. Resolution per field (title,
description, ogTitle, ogDescription, ogImageUrl): C×L → C → L → the PDP's derived fallback (FR-075).

Writes (R13, analyze C1): Commands `seo_meta_override.upsert` / `seo_meta_override.delete` with the full
row projection as `before` / `after`; a row is addressed by (entity, channel?, locale?) — neither given keeps
today's `locale = 'en-US'`.

## 7. Media (catalog) — R14, R15

`gallery_item_channel_labels`: `product_id` (FK cascade), `sales_channel_id` (FK cascade), `label`
(`base_image`/`small_image`/`thumbnail`), `gallery_item_id` (FK `gallery_items` cascade). PK
`(product_id, sales_channel_id, label)`.

`gallery_item_channel_hidden`: `gallery_item_id` (FK cascade), `sales_channel_id` (FK cascade),
`product_id`. PK `(gallery_item_id, sales_channel_id)`; index `(product_id, sales_channel_id)`.

`gallery_items.alt_text jsonb not null default '{}'` — `{ "<lang>": "<text>" }`.

Effective in C: items = global items minus hidden-in-C; role R = channel row for R ?? global row for R,
then `none` if that item is hidden in C. Alt at L = `item.alt_text[L]` ?? asset alt (existing pick).

## 8. Attachments and packaging units (catalog) — R16

`product_attachments.name_translations jsonb not null default '{}'`,
`product_attachments.description_translations jsonb not null default '{}'`,
`product_packaging_units.name_translations jsonb not null default '{}'`.
`product_attachment_channel_hidden`: `attachment_id` (FK `product_attachments` cascade),
`sales_channel_id` (FK cascade), `product_id`; PK `(attachment_id, sales_channel_id)`.

Effective name at L = `name_translations[L]` (non-empty) ?? `name`. Snapshots (`cart_items.packaging_unit_name`,
`quote_request_items.packaging_unit_name`, then the order line) take the effective name at the snapshot's
scope language (N2) and are never re-resolved.

## 9. Setting (catalog) — R18

| Key | Type | Default | Labels |
| --- | --- | --- | --- |
| `catalog.scope_completeness_gate` | string enum `warn` \| `refuse` | `warn` | `settingLabels.catalog.scope_completeness_gate.{name,description}` in `catalog/i18n/{en,pl}.json` |

## 10. Bulk operation payload — R20

`BulkUpdateProductsRequest.fields.scopedStatus?: { channelId: uuid; languageCode: string | null; value:
'active' | 'inactive' | 'inherit' }`; result reasons gain `scope_invalid`, `completeness_gate`. A `draft`
or `archived` value in `fields.status` or `fields.scopedStatus` is refused by the schema (FR-112, O-1). Bulk Archive / Restore
(FR-053) run on the same path; their payload shape was the architect's (§14) —
decided 2026-10-25: `fields.archived: boolean` (`true` Archive, `false` Restore), alone in its request, on the
existing `product_bulk_update` kind rather than a kind of its own (research R30.3).
Revert records store the per-product before-state of the one scope row touched.

## 11. Search document (search) — R8

`IndexedDocument` gains `liveLanguages: string[]`, `publishFromMs: number`, `publishUntilMs: number`,
`allowedOrganizationIds: string[]` (channel-effective; `visibility` becomes channel-effective too) and
`localizedNames: Record<string, string>` (effective name per channel language). `liveLanguages`,
`publishFromMs`, `publishUntilMs` are added to the index's filterable attributes; `localizedNames.*` to its
searchable attributes.

## 12. State transitions

| Transition | Effect |
| --- | --- |
| global `status` → `inactive` | plain off: `archived_at` **untouched**, no `product.archived.v1`; `product.updated.v1` `['status']` (FR-010) |
| global `status` → `active` on an archived product | status changes; product **stays archived** (FR-019); a status write, so the completeness gate runs on the pairs whose effective status turns `active` (FR-060) |
| Archive (not archived → archived) | `archived_at = now()`, `product.updated.v1` and `product.archived.v1` once; status unchanged at every scope; one audit entry (FR-019) |
| Archive on an archived product | no change, no event |
| Restore (archived → not archived) | `archived_at = null`, `product.updated.v1`; status unchanged; one audit entry; no completeness gate (FR-019, FR-060) |
| scope `status` set/changed/removed | row upsert/delete; `product.updated.v1` `changedFields: ['scopedStatus']`; one audit entry per product per command |
| window bound crossed (no write) | sweep emits `product.updated.v1` `['publicationWindow']` (R9) |
| product leaves channel / channel drops a language | rows retained, ignored, listed as orphaned (FR-015); C×L URL keys keep reserving (FR-070) |
| channel deleted | rows removed by cascade |
| product soft-deleted | redirects removed in the delete Command (FR-072); scope rows retained with the product row |
| product gets its first language key for L | redirect `(L, slug)` inserted; any `NULL`-language redirect of P keeps resolving in L (H1) |

## 13. Status value set migration (catalog) — Session 2026-10-25, Q1-b / Q1-c / Q1-d

`draft` is removed; status is `active` | `inactive` at every scope (FR-010, FR-110, FR-112).

| Target | Rule |
| --- | --- |
| `products.status` | `update products set status = 'inactive' where status = 'draft'` — `archived_at` **not** written (no `draft` product becomes archived) |
| `product_channel_scopes.status` | `draft` → `inactive`; `NULL` (inherit) untouched |
| `product_channel_language_scopes.status` | `draft` → `inactive` |
| `products.status` rows already `inactive` | status unchanged and the row stays archived (Q1-c): a set `archived_at` is kept; where `archived_at` is null it is set to the row's `updated_at` (owner O-4, 2026-10-25) — `update products set archived_at = updated_at where status = 'inactive' and archived_at is null`, run **before** the `draft` conversion so converted rows are never caught |
| `products.status` default | `inactive` (entity default and column default); a duplicate is always `inactive` with `archived_at` cleared (Q1-d) |
| `CHECK` on both scope tables | `status in ('active','inactive')` (`product_channel_scopes` admits `NULL` as inherit) |
| `CHECK` on `products.status` | if the column carries one, rewritten to `('active','inactive')`; else the value set is enforced by `productStatusSchema` alone (architect to confirm) — **confirmed 2026-10-25: none exists; `products_status_check (status in ('active','inactive'))` is added after the conversion** (research R30.2; accepted by the coordinator 2026-10-25 — a pre-163 process writing `draft` during a rolling deploy is refused rather than stored, so SC-009 holds after deployment, not only at its instant) |

Order inside the migration: backfill `archived_at` on today's `inactive` rows, then convert `draft`, then
replace the scope `CHECK`s and add `products_status_check`, then set the default to `inactive`, so no
converted row is archived and no row violates the new constraints. The `down` direction cannot tell a
converted `draft` from an original `inactive` or a backfilled `archived_at` from an original one; it
restores the three-value scope `CHECK`s, drops `products_status_check`, sets the default back to `draft`,
and leaves the data as it is (research R30.1).

**Architect decision (open when this section was written; decided below):** the scope tables' `CHECK`s were created by
`packages/modules/catalog/src/migrations/20261022T035133_catalog_product_scopes.ts` (lines 43 and 71), which
is part of this unreleased feature branch. The architect decides whether to amend that migration in place
(narrowing its `CHECK`s; only the data conversion of `products.status` then needs a new migration) or to
add one new migration that converts the data and replaces the `CHECK`s on all three tables. Either way the
`products.status` conversion is a new, scaffolded `catalog` migration (suggested `--name`
`product_status_drop_draft`), since `products` predates this feature.
**Decided 2026-10-25 (research R30.1):** one new migration does all of it; `20261022T035133` is not amended,
because a database that already ran it would never re-run an edited body.

## 14. Archive / Restore (catalog) — FR-019, FR-053

No new column: the action reads and writes the existing `products.archived_at`.

| Command | Effect | Gate | Audit |
| --- | --- | --- | --- |
| Archive one product | not archived → `archived_at = now()`; emit `product.updated.v1` and `product.archived.v1` once; already archived → no-op, no event | `catalog:write` | one entry, before / after `archived_at` |
| Restore one product | archived → `archived_at = null`; emit `product.updated.v1`; not archived → no-op | `catalog:write` | one entry, before / after `archived_at` |
| Bulk Archive / Restore | the single Commands per product on the durable bulk-operation path; revert records hold each product's before `archived_at`; undo as a whole, emitting `product.updated.v1` per reverted product (and `product.archived.v1` where it re-archives) after commit — the undo emits for every reverted field, not only `archivedAt` (R30.3, accepted 2026-10-25) | `catalog:write` | one entry per product |

Neither Command reads or writes any status column, and neither fires the completeness gate. Route shape,
Command names and the `changedFields` value of `product.updated.v1` are the architect's — **decided
2026-10-25 (research R30.3)**: `POST /api/v1/admin/catalog/products/:id/archive` and `…/restore`, Commands
`product.archive` / `product.restore`, `changedFields: ['archivedAt']`.
