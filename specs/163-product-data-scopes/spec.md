# Feature Specification: Product data scopes per sales channel and language

**Feature Branch**: `feat/163-product-data-scopes`
**Created**: 2026-10-20
**Status**: Draft — clarify rounds 1–4 recorded 2026-10-21, the owner's answers to the plan and analyze
questions (Q-A, Q-B, Q-C, Q-D, M3) recorded 2026-10-22, and the owner's final status decision (Q1, re-asked
before acceptance) recorded 2026-10-25: the status value set is `active` / `inactive` at every scope and
archiving is its own global action (FR-010, FR-019). D-1 is moot as a result. The consequences of that
decision (O-1 to O-6) and the W5 confirmations were answered the same day; no open question remains
**Issues**: #385 (source), depends on #384; adjacent to #377 and #241
**Input**: Issue #385 — *Catalog: Magento-style scopes for product data — status, visibility, URL, SEO,
media per sales channel and language.* An operator cannot set a product's status or visibility per sales
channel or per language: a product cannot be active in the B2B channel and off in B2C, nor published
in Polish but held back in German until it is translated. Everything on a product other than name,
description and flagged user attributes is global. The issue is explicitly a **starting proposal**; this
spec records the owner's binding decisions so far and leaves the rest open for clarify.

**Owner decisions recorded before specification (binding)**

1. **Scope model** follows Magento 2 (Global / Website / Store View) as closely as possible, mapped onto
   Endora's two axes: **Global**; **Sales channel** (≈ Website); **Sales channel × language** (≈ Store
   View); plus **Language only** — a value written once per language for every channel and overridable per
   channel — as an improvement over Magento.
2. **Status is a scoped value like every other**: a global value plus optional overrides per channel and
   per channel × language, with inheritance; "use inherited" removes the override. With no per-scope
   value, the single global switch turns the product on or off in every scope.
3. The product editor **does not warn** that some scopes override the global status when the global
   switch is changed.
4. Every field in the issue's "Proposed scope per field" table is in scope for this feature, subject to
   analysis; the improvements over Magento listed in the issue are welcome. *(Narrowed in clarify round 2,
   2026-10-21: display visibility and price display mode per channel are dropped from this feature.)*
5. #384 (the storefront ignores the channel overrides that already exist) is a separate bug, fixed on its
   own branch; this spec assumes it lands first.

## Clarifications

### Session 2026-10-21

- Q: Which value set does the scoped status hold — keep `draft` / `active` / `inactive` (with `inactive` =
  archived), or enabled / disabled per scope with archiving as its own global action? → A: Keep `draft` /
  `active` / `inactive` for now (option A). The owner may switch to enabled / disabled per scope plus a
  separate global archive action (option B); the coordinator re-asks this at the end of the feature, before
  acceptance. What `inactive` means when set below the global scope was decided in round 2, N1 (FR-010).
  *(Superseded on 2026-10-25, Session 2026-10-25 Q1: option B — `draft` is removed, status is `active` /
  `inactive` at every scope, and archiving is a separate global action.)*
- Q: How does the completeness gate behave — warn and save, refuse the save, or a setting choosing between
  them? → A: A platform-level setting choosing *warn* or *refuse*, default *warn* (option C). Assumption A-6
  is confirmed: the gate does not apply to imports or PIM synchronisation (FR-060, FR-061).
- Q: Within which space must a URL key be unique? → A: Per (channel, language) (option A; FR-070).
  *(Superseded in round 3: unique per language across all channels, option B.)*
- Q: How long does an old URL key keep redirecting? → A: Forever; the operator can delete individual
  redirects (option C; FR-072).
- Q: May a new URL key equal another product's old, redirecting key? → A: Yes, but only after a confirmation
  that names the product that loses the redirect (option C; FR-072). *(Still binding; since round 3 it is
  evaluated per language across all channels.)*
- Q: (D-2) Which fields need channel × language rather than channel only? → A: Status and display
  visibility at channel × language (and channel); audience and publication window at channel only — the
  table in FR-009 as written (option A).
- Q: (D-4) Does the bulk edit cover the other channel-scoped fields? → A: No — status and display
  visibility only in this feature; the other channel-scoped fields are a follow-up (option A; FR-050,
  *Out of Scope*).
- Q: (D-6) May the image set itself differ per channel? → A: No — per channel only image roles and hidden
  images; the image set stays global; per-variant galleries stay with #377 (option A; FR-076).
- Q: (owner decision on the #384 follow-ups) Which storefront consumers must use the effective
  (channel, language) value of scoped fields? → A: Every one, including those that still read the baseline
  after #384: quick search (consumer `quick_order`), listing free-text search, attribute filters, filter
  option counts and name sort, comparisons, and line names snapshotted into baskets and quote requests.
  Search-result card names are fixed under #384 itself (FR-017, FR-004, A-1).
- Q: (round 2) Should the new Magento-style **display visibility** (not visible individually / catalog /
  search / catalog and search) be introduced? → A: No — dropped. "Keep the visibility options we had until
  now": the only visibility concept stays the existing **audience** `visibility` (`public` /
  `logged_in_only` / `organization_restricted`) with `allowedOrganizationIds`, made settable per channel
  (FR-030). This supersedes the display-visibility halves of the D-2 and D-4 answers above and, for display
  visibility, pre-specification owner decision 4. Recorded facts: variants are not separate products today
  (`product_variants` rows under a `configurable` parent, never listed and never given a page of their own),
  so Magento's main use of "not visible individually" does not arise; grouped and bundle children are real
  products and stay governed by status, channel membership and audience, as today. D-3 is moot. "Hide from
  listing and search but sell by direct link or quick order" moves to *Out of Scope* as a possible follow-up.
  FR-003, FR-020, FR-021, FR-022 are removed; FR-050 covers status only.
- Q: (round 2, D-5) Where does a product × channel price display mode sit in the display-mode chain? → A:
  Removed from this feature — price display mode per channel is out of scope (a possible future issue). This
  supersedes pre-specification owner decision 4 for price display mode. FR-101 is removed; minimum order
  quantity and "returnable" per channel stay (FR-100).
- Q: (round 2, A-9) Does the "no warning about overrides when the global value changes" rule cover only
  status or every scoped field? → A: Every scoped field (option A; FR-013, A-9).
- Q: (round 2, N1) What does `inactive` mean when set as an override at channel or channel × language? → A:
  Plain "off" in that scope — identical in effect to `draft` there (not-found); archiving (`archivedAt`,
  `product.archived.v1`, "gone") stays global-only (option a; FR-010). *(Extended on 2026-10-25, Session
  2026-10-25 Q1-a: `inactive` is plain "off" at **every** scope, global included; archiving is the separate
  global Archive action of FR-019.)*
- Q: (round 2, N2) In which language are product names snapshotted into basket and quote-request lines? →
  A: The request language at snapshot time, falling back to the channel's default language; documents
  created by an operator in the admin use the channel's default language (option a; FR-017).
- Q: (round 2, N3) In *refuse* mode, what happens to an edit that turns the product on in several
  (channel, language) pairs when only some fail the gate? → A: A single-product edit — including a change of
  the global switch — is refused as a whole if any pair fails; bulk edit skips and reports the failing
  products, as FR-051 does (option a; FR-060, FR-061).
- Q: (round 2, N4) How is URL-key uniqueness kept when a product joins a channel or a channel gains a
  language? → A: Joining a channel where another product already has the same effective key at some
  (channel, language) is refused, naming the clash. A channel adding a language that creates a clash is
  allowed; the clashing key is marked orphaned (FR-015) and shown in the scope overview with a warning
  (FR-070, FR-015). *(Superseded in round 3: under per-language uniqueness neither situation can produce a
  clash; the refusal and the orphaned-by-clash key are removed.)*
- Q: (round 2, N5) Must quote requests respect effective availability? → A: Quote requests created by a
  buyer refuse lines whose product is not effectively available at the quote request's channel and
  language; quote requests created by an operator only warn (option a; FR-018).
- Q: (round 3, Q3a re-opened by the owner) Within which space must a URL key be unique? → A: **Per language
  across all channels** (option B), replacing the round-1 answer "per (channel, language)". A product's
  language key, and every channel × language override key, MUST be unique within that language across all
  channels and against every other product's key in that language, so a clash can never arise from channel
  membership or from a channel gaining a language. Uniqueness is checked when a key is written (refused,
  naming the product holding it). The redirect-takeover rule (confirmation naming the product that loses the
  redirect) stays, now evaluated per language across all channels. This **supersedes N4** (clash on joining
  a channel or on a channel gaining a language) and **C2** (clash handling on the membership write paths):
  those situations cannot occur, and their requirements, scenarios (former US7 #7–8), edge cases and the
  orphaned-by-clash key (FR-015, FR-041, SC-008) are removed. **C1 is moot** — resolved by this change.
  (FR-070, FR-072, SC-008.)
- Q: (round 3, C3) Is the publication window a pair of dates or of date-times, and in which time zone? → A:
  Date-time instants, entered and shown in the operator's local time and stored as absolute instants (UTC);
  no new time-zone setting (option A; Terms, US2, FR-023, A-10).
- Q: (round 3, C4) How does a per-channel audience override combine with the global rule, and may its
  organization list name organizations that are not members of that channel? → A: (a) The channel override
  replaces the whole rule — mode and organization list — as one value; nothing is merged with the global
  list. (b) The list may name organizations that are not members of the channel: the save is allowed and
  the editor shows a warning naming them (recommended option; FR-030, US3).
- Q: (round 4, Q3a consequences) Are the three consequences derived from per-language uniqueness
  confirmed? → A: Yes, all three: (1) a product's global key counts as its key in every language where it
  has no language key; (2) an orphaned channel × language key override keeps reserving its key in that
  language; (3) a redirecting (old) key belongs to at most one product per language and may not equal any
  product's current key in that language (FR-070, FR-072, FR-015).
- Q: (round 4, K1) What does a request at (C, L) for a key that is the same product's key in another
  language answer? → A: Not-found — cross-language redirects are dropped (option C). At (C, L) only keys of
  L resolve: a product's current keys in L and its redirecting keys in L (FR-071, US7).
- Q: (round 4, K2) What happens when an import or a PIM connector writes a URL key that is already taken in
  that language? → A: The record's key is refused and reported in the run's issue list; an import or
  connector never takes over another product's redirecting key — the confirmation of FR-072 is an operator
  action only (option A; FR-093, A-11).
- Q: (round 4, K3) Does the completeness gate's "URL key" item require a key in the language itself? → A:
  No — the global key satisfies it, so no warning or refusal is raised for a missing language key
  (option A; FR-060, US6). Name and required language-scoped attributes are unaffected.
- Q: (round 4, K4) Is the publication window's end inclusive? → A: Yes — the product is live while
  start ≤ now ≤ end (option B). Rationale: it matches the existing commerce windows in the codebase — price
  lists expire only when `ends_at < now`
  (`packages/modules/price_lists/src/backend/services/price-list-status-worker.ts:67`) and promotions stop
  when `now > validUntil` (`packages/modules/promotions/src/backend/services/promotion-service.ts:412`);
  both are date-time instants entered via `datetime-local` in the admin (FR-023, US2, Terms).

### Session 2026-10-22

Owner answers to the questions raised by `plan.md` and `/speckit.analyze`. Q-A, Q-B and Q-C were decided on
2026-10-21 and are recorded here.

- Q: (Q-A) Existing per-language SEO overrides are stored but not served on product pages today. Serve them
  once they become the language-scope values? → A: **Serve** (decided 2026-10-21). Those products' metadata
  changes to the values operators entered; this is a listed exception to deployment parity (US8 #2, FR-075,
  SC-001).
- Q: (Q-B) A key is valid only in its language (K1). How does a link reach the right language — a language
  prefix in the storefront path, cross-language rendering, or a separate issue? → A: **Option C, a separate
  issue (#396, language path prefix)** (decided 2026-10-21). This feature keeps the interim: every product
  URL the platform emits carries `?lang=<L>` when L is not the channel's default language, and accepts the
  residual not-found gap described in FR-071 until #396 lands (FR-071, FR-074).
- Q: (Q-C) With `seo` off, is the product editor's redirect list hidden or shown read-only? → A: **Hide**
  (decided 2026-10-21). Redirect data persists in the catalogue and keeps reserving keys; the takeover
  confirmation still appears and names the product losing the redirect (FR-111, US7).
- Q: (M3) Which events fire the completeness gate — only a status write, or also anything else that makes a
  product live at (C, L)? → A: **Option A — only a status write** that turns the product on at a (channel,
  language): a global or scoped status change, including bulk status. The gate does **not** fire when a
  product becomes live at (C, L) by joining a channel, by a channel gaining a language, by a publication
  window opening, or by an audience change; missing values in those cases are visible in the scope overview
  (FR-060, FR-061, FR-041, US6). *(Restated after Session 2026-10-25: "turns the product on" means a status
  write that changes the effective status at (C, L) to `active`; Archive and Restore (FR-019) are not
  status writes and never fire the gate.)*
- Q: (Q-D) Must a single scoped write have a one-click undo, or is restoring it from its audit before-state
  enough? → A: **Option A — no single-write undo.** Bulk scoped writes are reversible as a whole with the
  existing bulk-operation undo (`bulk-operation.service.ts`,
  `POST /api/v1/admin/catalog/bulk-operations/:id/undo`); a single scoped write is an audited Command whose
  audit entry holds the complete before-state, so re-applying it restores the previous value — the
  repository's convention (e.g. the `delivery_methods` commands). A generic single-Command undo is out of
  scope (a possible future issue) (FR-081, US1 #8, SC-006).

### Session 2026-10-25

The owner's final answer to Q1, re-asked before acceptance as the 2026-10-21 answer required (task T156).
It replaces the 2026-10-21 Q1 answer and extends N1.

- Q: (Q1, final) Which value set does the status hold at each scope? → A: **`active` | `inactive` at every
  scope**; `draft` is removed (option B) (FR-010, Terms).
- Q: (Q1-a) What becomes of archiving, which today is the global `inactive`? → A: A **separate, global,
  product-wide action, "Archive" / "Restore"**, that keeps today's effects: Archive sets `archivedAt` and
  emits `product.archived.v1` once per transition; the product page answers "gone" (410) under the rules
  already in this spec — the backend's product read and key resolve answer `410`, and the storefront's page
  renders that as its not-found page (HTTP 404; owner decision B4, 2026-10-28) (only to a caller who could otherwise see it, else not-found); Restore clears
  `archivedAt`. `inactive` at **any** scope, global included, means plain "off" (not-found) and never
  archives. Archived state is independent of status (FR-010, FR-019, FR-005).
- Q: (Q1-b) What happens to existing `draft` values? → A: A migration converts every `draft` to
  `inactive`, without archiving — in `products.status` and in every scoped override row
  (`product_channel_scopes`, `product_channel_language_scopes`) (FR-110, `data-model.md`).
- Q: (Q1-c) What happens to products that are `inactive` today? → A: They were archived by that status.
  They stay `inactive` and keep their `archivedAt`, so they remain archived and keep answering "gone" where
  they did (FR-110, SC-001).
- Q: (Q1-d) What status does a new or duplicated product get? → A: `inactive` (FR-010).
- Q: (Q1-e) Is `draft` kept as an accepted alias for a while? → A: No. `draft` is removed from the API
  outright: `productStatusSchema` becomes `active | inactive`; the admin API, bulk status, import / export
  and the admin product-list filter reject `draft` with a validation error; there is no alias period. This
  is a breaking change and ships with a major-bump changeset note (FR-092, FR-112, *Compatibility and
  release*). *(Recorded at bump level `minor` with a body marked BREAKING: `specs/conventions/release-intent.md`
  (D-225) refuses `major` while a package is in `0.x`, and `@endora-commerce/contracts` is `0.108.0` —
  coordinator, 2026-10-25; research R30.6.)*
- Q: (Q1-f) Where is the work done? → A: Inside this feature, as a block before acceptance.
- D-1 (whether a never-published `draft` product stays reachable by direct link as a preview) is **moot**:
  no status marks a product as "never published" any more. A product that is not live is `inactive`, which
  is plain "off" and answers not-found by FR-005, whether it was never published or switched off later. A
  preview link for unpublished products, if wanted, would be a separate feature; it is not deferred here.
- Q: (O-1) What becomes of the legacy `archived` status write alias (feature 032), which coerces a write of
  `status: 'archived'` to `inactive` and which, after Q1, would switch the product off instead of archiving
  it? → A: **Option A — remove it.** A write carrying status `archived` is refused with a validation error,
  exactly as `draft` is: `coerceProductStatusWrite` in `packages/contracts/src/catalog.ts` and the
  `status=archived` mapping of the admin product list in
  `packages/modules/catalog/src/backend/routes.admin.ts` go (FR-112, *Compatibility and release*).
- Q: (O-2) How does the admin product list treat archived and `inactive` products? → A: **Option A** —
  "Archived" is a separate list filter based on `archivedAt`; a non-archived `inactive` product is listed
  like any other product; archived products are hidden by default, with the existing way to include them
  (FR-113).
- Q: (O-3) When does an archived product answer "gone" rather than not-found? → A: **Option A** —
  availability is evaluated as if the product were not archived and its **global** status were `active`,
  with every channel and channel × language status override, membership, channel languages, publication
  window and audience still applying; "gone" where that answers available, not-found elsewhere (FR-005).
- Q: (O-4) What about products that are `inactive` today without an `archivedAt` (a product created as
  `inactive` does not set it)? → A: **Option A** — the migration sets their `archivedAt` to their
  last-update timestamp (`updated_at`). Every product that is `inactive` today therefore stays archived and
  keeps answering as it does today; SC-001 needs no exception for them (FR-110, `data-model.md` §13).
- Q: (O-5) Does setting `active` on an archived product restore it, as moving away from `inactive` does
  today? → A: **Option A — no.** Only Restore clears `archivedAt` (FR-019). Operators are told that every
  product archived before this feature, including every product `inactive` today, needs an explicit Restore
  to come back (*Compatibility and release*).
- Q: (O-6) Confirm the remaining Archive / Restore details. → A: **Confirmed**: bulk Archive / Restore exists
  (FR-053); archiving an archived product or restoring a non-archived one changes nothing and emits
  nothing; Archive emits `product.updated.v1` and `product.archived.v1`, Restore emits `product.updated.v1`
  (FR-019, FR-082).
- Q: (W5-a) What does the external bulk-price probe (API key) answer for a product not effectively
  available at the key's channel? → A: **Option A** — no price, with the reason `sku_not_in_assortment`,
  as for an unknown SKU (FR-004; `contracts/consumers.md`).
- Q: (W5-b) How does external order intake (API key) decide whether a product may be ordered? → A:
  **Option A** — by effective availability (FR-001) at the API key's channel, in that channel's default
  language, for the request's audience — not by the global `active` filter. An unavailable product answers
  `404 PRODUCT_NOT_FOUND`, exactly as a product hidden from the bound organization does (FR-004;
  `contracts/consumers.md`).

### Session 2026-10-26

- Q: (L-1) On the storefront product page, which wins — the visitor's `lang` cookie or the link's
  `?lang=<L>`? Until now the cookie did, so a visitor with cookie `pl` opening `/p/schuh?lang=de` got the
  Polish page, where the German key `schuh` does not resolve, and the link answered not-found. → A:
  **L-1 = A (owner, 2026-10-26)** — on the product page an explicit `?lang=` that names an active language
  beats the cookie; a `?lang=` that is not an active language is ignored and the usual order decides
  (cookie, then `Accept-Language`, then the channel default). Product page only, as the interim until the
  language path prefix (#396). Opening such a link does not rewrite the cookie: a GET does not change the
  visitor's stored preference; only the header language switcher does (FR-071).
- Q: (OV-1) Does the scope overview offer "reset to inherited" for a product's own per-language text
  (name, description, a language-scoped attribute at the language level)? → A: **OV-1 = A (owner,
  2026-10-26)** — no. The overview offers "reset to inherited" only for sales channel and sales channel ×
  language overrides; a product's own text in a language is edited in the product editor and has no reset
  in the overview (FR-041, US4 #2).
- Q: (N2, packaging unit) When an operator names the channel on a customer's behalf and a basket line is
  ordered by a packaging unit, in which language is the unit's name snapshotted? Until now: the global
  name, while the product name beside it is at the channel's default language. → B: **N2 = B (owner,
  2026-10-26)** — at the named channel's **default language** (its translation there, else the global
  name), consistent with the product name beside it (FR-079). The channel is read through the kernel's
  channel accessor, and only when a unit is named. A buyer's basket keeps the request language.
- Q: (CMP-1) What does a reader who is not a comparison's owner see for a column whose product is not
  available at their (channel, language)? Until now: the column with its name, SKU, price, image and
  values, marked unavailable. → A: **CMP-1 = A (owner, 2026-10-26)** — for any reader who is not the
  owner (a share-link recipient), such a column collapses to the existing `(removed product)` column
  shape: no name, SKU, slug, price, attributes or image. A removed product and an unavailable one must
  not be distinguishable to that reader, and no count may reveal the difference. The owner keeps seeing
  their own history with `available: false` (FR-002, FR-004; `contracts/consumers.md` row 12). *(Narrowed
  on 2026-10-27, SEC-2: for an audience reason the owner sees the `(removed product)` column too.)*
- Q: (P-1) May the admin assistant archive and restore products? → A: **P-1 = A (owner, 2026-10-26)** — yes,
  through two tools of their own, `catalog.archive_product` and `catalog.restore_product` (`catalog:write`,
  planned with a preview and run only after the operator confirms), which run the same audited Archive /
  Restore Commands as the admin screens with the confirming admin as actor. `catalog.set_product_status`
  keeps switching products on or off and never archives or restores; `catalog.search_products` includes
  archived products and says which are archived, so one can be found to restore it (FR-114).
- Q: (P-2) A saved product-list view that stored `status: 'draft'` — which tab does it open on? → A: **P-2 =
  A (owner, 2026-10-26)** — on *All*, with a one-time note that the view used the removed Draft status
  (FR-112, FR-113).
- Q: (P-3) Do quote requests and price lists accept an archived product? → A: **P-3 = A (owner,
  2026-10-26)** — quote requests refuse it on every path; price lists are unchanged (an archived product may
  still be priced) (FR-115). **P-3a = A (owner-confirmed 2026-10-26):** converting an approved quote whose
  product was archived since answers `409` before the basket is touched. **P-3b = A (owner, 2026-10-26):** the
  operator's create and edit answer `409 PRODUCT_ARCHIVED` naming the archived products in
  `details.productIds`, while a buyer's paths keep the absent product's `404 PRODUCT_NOT_FOUND`.
- Q: (RFQ-c) How do the operator's quote-request product pickers show an archived product? → A: **RFQ-c = B
  (owner, 2026-10-26)** — as the order screen's do: the quick search lists it disabled with the reason
  "archived"; the product browser has no Archived tab and its *All* leaves archived products out (FR-115).
- Q: (P-4) What does the product list's bulk bar offer on the Archived tab? → A: **P-4 = B (owner,
  2026-10-26)** — **Restore** (primary, behind the existing confirmation), Bulk edit and Delete; Edit price is
  not offered there (FR-053).
- Q: (PAL-1) Is "Archived products" reachable from the command palette? → A: **PAL-1 = B (owner,
  2026-10-26)** — yes, as an action of its own that opens a dedicated route, `/catalog/products/archived`,
  the product list on its Archived tab (FR-116).
- Q: (I1) Does Restore fire the completeness gate or show a gate message? → A: **I1 = B (owner,
  2026-10-26)** — no: Restore stays ungated and shows no gate message, also in *refuse* mode (FR-019, FR-060).
- Q: (MED-1) Do product feeds and comparisons follow a gallery image hidden in a channel? → A: **MED-1 = A
  (owner, 2026-10-26)** — yes: a feed reads the gallery in its own channel and a comparison column in the
  viewer's channel, so a hidden image reaches neither (FR-076).
- Q: (SEO-1) Which channels does the SEO meta editor offer for a product? → A: **SEO-1 = A (owner,
  2026-10-26)** — the product's member channels only (FR-075).
- Q: (SEO stub) What becomes of the product editor's "Page title (preview)" input, which saved nothing? →
  A: **A (owner, 2026-10-26)** — it is removed and replaced by a link to the SEO screen, which `seo`
  contributes to the product editor's SEO tab (admin zone `product.editor.seo.after`), shown while `seo` is
  on and the admin holds `catalog:write` (FR-075, Constitution XVII).
- Q: (UX-1 … UX-4) Admin UI details. → A: **all A (owner, 2026-10-26)**. **UX-1:** in the scope overview, a
  reset of a text value and the deletion of an orphaned override ask for confirmation in a dialog; channel
  values sit in a "Whole channel" column and language values in an "Every channel" row (FR-041). **UX-2:**
  while gallery edits are staged, adding or removing an image waits for Save (FR-076). **UX-3:** one
  vocabulary across the overview, the URL-keys panel, the scope controls and bulk edit — "Use inherited" /
  "Użyj dziedziczonego" and "No longer applies" / "Nie obowiązuje już" (FR-012, FR-043). **UX-4:** the SEO
  screen opens on a product from `?entityType=product&entityId=<id>`, which the product editor's link uses
  (FR-075).
- Q: (G-1) Does the API-key upsert (`PUT /api/v1/catalog/products/by-sku/:sku`) go through the completeness
  gate? → A: **G-1 = A (owner, 2026-10-26)** — no: like imports and PIM synchronisation, it is exempt
  (FR-061).
- Q: (G-2) How does the single-product status write report completeness warnings? → A: **G-2 = A (owner,
  2026-10-26)** — `PATCH /api/v1/admin/catalog/products/:id` answers `{ data, warnings }`, and the editor
  shows the warnings in place of "Saved." (FR-060).
- Q: (F-1) With `seo` off, does a request for one of a product's **other current keys** in L (its language
  or global key where a (C, L) override exists, or another channel's override) still redirect to its (C, L)
  URL? → A: **F-1 = A (owner, 2026-10-26)** — yes. Those are current keys, resolved by `catalog`, and
  FR-071 applies whatever `seo`'s state; only the redirecting keys of FR-072 are `seo`'s and answer
  not-found while it is off (FR-071, FR-111).

### Session 2026-10-27

- Q: (T144) The deploy-parity test found two storefront answers that change beyond the listed intended
  behaviour changes — the archived product's 410 narrowed to callers who could otherwise see it, and an
  archived product refused at basket add. Intended, or defects? → A: **intended (owner, 2026-10-27)** —
  both are recorded as `plan.md` *Intended behaviour changes* 7 and 8 (FR-005, FR-110).
- Q: (SEC-1) External order intake (`POST /api/v1/external/orders`) answers an unknown SKU, or one outside
  the key's channel, with the per-line `422` (`SKU_NOT_IN_ASSORTMENT`), and an existing product that is not
  available there with `404 PRODUCT_NOT_FOUND`. Is that difference an acceptable oracle? → A: **SEC-1 = A
  (owner, 2026-10-27)** — yes, W5-b stands as decided. The key is bound to one organization and one channel
  (the client's own integration), and SKUs are generally public; the `404` is what a product hidden from
  that organization has answered since feature 155 (FR-004; `contracts/consumers.md` row 23).
- Q: (SEC-2) Does a comparison's **owner** keep seeing the details of a product they can no longer see for
  an **audience** reason (a channel audience override, or their organization leaving the channel's
  allow-list)? → A: **SEC-2 = A (owner, 2026-10-27)** — no. Such a column shows as `(removed product)` for
  the owner too. The owner keeps the history column, marked unavailable, only for lifecycle reasons: the
  product is off at the scope, archived, outside its publication window, or not a member of the channel
  (FR-002, FR-004; refines CMP-1; `contracts/consumers.md` row 12).
- Q: (R2, QA) The edge case said concurrent edits at one scope are "last write wins". What did ship? → A:
  **recorded as built (2026-10-27)** — scope writes on one product are serialised by a row lock on the
  product, so each write applies to the state the previous one left and is audited with that true
  before-state; the later write's value stands. A residual race the lock cannot order (two first writes
  creating the same override row) answers `409 VERSION_CONFLICT` ("reload and try again") and writes
  nothing; in a bulk edit that product is reported failed with the reason `concurrent_modification` and the
  others proceed (edge case *Concurrent edits*).
- Q: (L7, QA) US4 said an operator jumps from an overview cell to the field. Is that built? → A: **not
  built; deferred (2026-10-27)**. The overview shows each cell's sources, resets and orphans; a field is
  edited on the editor's own tabs (Scopes, Details, Attributes, SEO, Media). US4's story text says what was
  built; a cell-to-field link is a follow-up (*Out of Scope*).

## Current state (origin/master cde5563ea)

Paths are relative to the repository root. Behaviour below is read from the code, not observed at
runtime, unless stated.

### Product record

- `products.status` is `draft` | `active` | `inactive`, default `draft`
  (`packages/modules/catalog/src/backend/entities/product.entity.ts:55`). Setting `inactive` **is**
  archiving: it sets `archivedAt` and emits `product.archived.v1` once per transition; moving away clears
  `archivedAt` (`packages/modules/catalog/src/backend/services/catalog-admin.service.ts:448-488`, `:608-615`).
- Audience `visibility` is `public` | `logged_in_only` | `organization_restricted`, plus
  `allowedOrganizationIds` (`product.entity.ts:68`, `:108`) — one value for every channel.
- `slug` is a single, globally unique value (`product.entity.ts:48`). There is no URL-redirect mechanism
  anywhere in the catalogue or `seo` module today.
- `minOrderQuantity` and `returnable` (feature 155) are global (`product.entity.ts:203`, `:211`).

### Where status is honoured

- Storefront product list: only `status = 'active'`
  (`packages/modules/catalog/src/backend/services/catalog-query.service.ts:639`); filter facets likewise
  (`:1817`).
- Product page: rejects **only** `inactive` with 410 (`catalog-query.service.ts:1273-1275`), then channel
  membership and audience (404). **A `draft` product that is a member of the channel is therefore
  reachable by its URL** (code reading; not verified at runtime).
- Search indexer: `active` and not deleted and not archived
  (`packages/modules/search/src/backend/services/search-indexer.ts:787`). Comparisons
  (`packages/modules/comparisons/src/backend/services/comparison-service.ts:613`), quick order
  (`packages/modules/quick_order/src/backend/routes.ts:106`), sitemap
  (`packages/modules/seo/src/backend/services/sitemap-generator.service.ts:122`) and product feeds
  (`packages/modules/product_feeds/src/backend/services/product-selection.service.ts`) each apply their own
  `active` predicate.
- Baskets: feature 155 introduced a `product_unavailable` line state that blocks placement
  (`packages/modules/carts/src/backend/services/cart-minimums.ts:197`, `:390-393`).

### Existing scoped content

- `product_value_overrides` (productId, attributeKey, channelId, languageCode nullable, value `{ v }`)
  holds channel and channel × language slots
  (`packages/modules/catalog/src/backend/entities/product-value-override.entity.ts`); the language-only
  slot is the per-language baseline on the product itself (`products.name` / `products.description` are
  per-locale values).
- The fallback chain is **channel × language → channel → global × language → global**, implemented once in
  `packages/contracts/src/product-value-resolver.ts` and used by both backend and admin. (The entity's doc
  comment still points at a `services/product-value-resolver.ts` in catalog that no longer exists.)
  Override rows left orphaned by a scope-flag change are skipped silently.
- System attributes with a scope: `name`, `description` (`SYSTEM_ATTRIBUTE_SCOPES`,
  `packages/contracts/src/catalog.ts:2649`); user attributes carry `channelScoped` / `languageScoped`.
- Admin editor: `packages/modules/catalog/src/admin/components/ProductScopeEditor.tsx`.
- Places that still read the **baseline** rather than the effective (C, L) value after #384 (owner decision
  2026-10-21; FR-017): quick search returns the baseline `name`
  (`packages/modules/catalog/src/backend/services/catalog-quick-search.service.ts:153`, consumer
  `quick_order`); the storefront listing's free-text search, attribute filters, filter option counts and
  name sort run over the baseline JSONB (`catalog-query.service.ts`); comparisons read the baseline name and
  attribute values (`packages/modules/comparisons/src/backend/services/comparison-service.ts:607`, `:623`);
  basket batch-add outcomes name the product from the baseline
  (`packages/modules/carts/src/backend/services/cart-service.ts:1251`); quote-request lines snapshot the
  baseline name in any locale (`packages/modules/quote_requests/src/backend/services/rfq-service.ts:462`,
  `:629`).

### Other product data

- SEO overrides: one per (entity, locale), unique on (entityType, entityId, locale) — no channel
  (`packages/modules/seo/src/backend/entities/seo-meta-override.entity.ts:12`).
- Gallery: `gallery_items` and `gallery_item_labels` (roles base / small / thumbnail, unique per product)
  are global (`packages/modules/catalog/src/backend/entities/gallery-item*.entity.ts`). Attachment names
  and packaging-unit names are plain strings.
- Channel membership `sales_channel_products` is a bare yes/no, read and written only through the platform
  membership service (`packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts`);
  admin zone `packages/modules/sales_channels/src/admin/zones/ProductChannelMembership.tsx`.
- A sales channel has an ordered `languages[]` and a `defaultLanguage`
  (`packages/platform/src/kernel/sales-channels/sales-channel.entity.ts:64-69`).

## Terms used in this spec

- **Scope** — one of: *Global*; *Language* (L, for every channel); *Channel* (C, every language);
  *Channel × language* (C×L). A scope is **valid for a product** only for channels the product is a member
  of and languages that channel offers.
- **Scoped value** — a field whose value may be set at more than one scope. Its global value always
  exists; a value at any narrower scope exists only where an operator set one (an **override**).
- **Inheritance** — the effective value at a scope is the nearest override along the existing fallback
  chain (C×L → C → L → Global), restricted to the scopes the field supports.
- **Use inherited** — removes the override at that scope; it does not store an empty value.
- **Status** — `active` / `inactive` at a scope (FR-010); the product is switched **on** at a scope when
  its effective status there is `active`, and **off** when it is `inactive`. Status never archives.
- **Archived** — a global, product-wide state set by the Archive action and cleared by Restore (FR-019),
  recorded as `archivedAt`; independent of status at every scope. An archived product is unavailable
  everywhere (FR-001) and its page answers "gone" under FR-005.
- **Audience visibility** — who may see a product: public / logged-in only / organization-restricted with an
  organization list. It is the only visibility concept in this spec (clarify round 2 dropped a separate
  display visibility).
- **Publication window** — an optional from / to period per channel inside which the product may be live;
  both bounds are date-time instants, entered and shown in the operator's local time, and both are
  inclusive: live while start ≤ now ≤ end (FR-023).
- **Effectively available** at (channel, language, buyer, now) — see FR-001.

## User Scenarios & Testing *(mandatory)*

Stories follow the issue's phase list (phase 1 is #384, a dependency). Each is independently shippable on
top of the stories before it of higher priority.

### User Story 1 - Operator switches a product on or off per channel and per channel × language (Priority: P1)

An operator has a product live in "B2B" and "B2C". In the product editor they set its status to off for
B2C only, and off for B2B × German only, because the German text is not ready. B2B buyers in Polish and
English still see it; B2B buyers in German and every B2C buyer do not. Later the operator chooses "use
inherited" on B2C and the product returns there, following the global switch.

**Why this priority**: The core of #385 and the smallest slice that delivers it; every other story builds
on the per-scope availability defined here.

**Independent Test**: Seed one product in two channels, each with two languages. Set overrides at C and
C×L, then query the storefront list, product page and search in all four (channel, language) pairs and
compare against the expected matrix; then remove one override and repeat.

**Acceptance Scenarios**:

1. **Given** a product with global status on and no overrides, a member of channels A and B, **When** a
   buyer lists the catalogue in any language of A or B, **Then** the product appears.
2. **Given** the same product, **When** the operator sets status off at channel B, **Then** it disappears
   from B's listing, search and product page (in every language of B) and remains in A.
3. **Given** status off at channel B, **When** the operator sets status on at B × English, **Then** the
   product is live in B only in English (the narrower override wins).
4. **Given** an override at B, **When** the operator chooses "use inherited" at B, **Then** the override no
   longer exists and B follows the global status again.
5. **Given** overrides at several scopes, **When** the operator changes the global switch, **Then** the
   change is saved with **no** warning about those overrides (owner decision 3), and scopes without an
   override follow the new global value while overridden scopes keep theirs.
6. **Given** a product whose effective status is off at (C, L), **When** a buyer requests its page at
   (C, L) by URL, **Then** the answer is the same as for a product that does not exist in that channel.
7. **Given** the existing product base, **When** this story is deployed, **Then** every product is live in
   exactly the same (channel, language) pairs and lists as before deployment.
8. **Given** a per-scope status change, **When** an auditor opens the audit log, **Then** one entry
   records the actor, the product, the scope and the before / after value, and the before-state can be
   restored (FR-081).
9. **Given** a product whose effective status is off at (C, L), **When** a buyer raises a quote request at
   (C, L) containing it, **Then** that line is refused; **when** an operator creates a quote request at
   (C, L) containing it in the admin, **Then** the line is accepted with a warning (FR-018).
10. **Given** a live product that is not archived, **When** the operator sets its **global** status to
    `inactive`, **Then** it is off at every (C, L) without an `active` override, its page answers as for a
    product that does not exist (not "gone"), `archivedAt` stays empty and no `product.archived.v1` is
    emitted (FR-010; Session 2026-10-25, Q1-a).
11. **Given** a product live at (A, pl) and off at (B, pl), **When** the operator archives it, **Then**
    `archivedAt` is set, `product.archived.v1` is emitted once, one audit entry records the action, no
    status value changes, and its page answers "gone" at (A, pl) and not-found at (B, pl); archiving it
    again changes nothing and emits nothing (FR-019, FR-005).
12. **Given** an archived product, **When** the operator sets its global status to `active`, **Then** it
    stays archived; **when** the operator then restores it, **Then** `archivedAt` is cleared, it is live
    wherever FR-001 says so, and the restore is audited (FR-019).
13. **Given** a request — admin product create or update, bulk status, import file or admin list filter —
    that carries the status `draft` or the legacy `archived`, **Then** it is refused with a validation error
    and nothing is saved (O-1);
    **given** a create request naming no status, or a duplicate, **Then** the new product is `inactive`
    (FR-010, FR-112).
14. **Given** a product base containing `draft` products, `draft` scope overrides, `inactive` products with
    an `archivedAt` and `inactive` products without one, **When** this feature is deployed, **Then** every
    `draft` value is `inactive`, no `draft` product became archived, every formerly `inactive` product is
    archived — keeping its `archivedAt`, or getting its `updated_at` where it had none (O-4) — and keeps its
    "gone" answer, and every product is live in exactly the same (channel, language) pairs as
    before (FR-110, SC-009).

---

### User Story 2 - Publication window per channel (Priority: P2)

For a seasonal product an operator sets a publication window in B2C from 1 December 08:00 to 31 December
23:59, in their own local time; outside it the product is not live there, without anybody having to switch
it on and off.

**Why this priority**: Completes "when is it live" — the second half of phase 2 — and replaces manual on/off
toggling for scheduled launches. (Clarify round 2 dropped the display-visibility half of this story.)

**Independent Test**: Seed one product with a window in the past, one in the present and one in the future
in one channel; assert listing, search results and product page per case at a controlled "now", and that
other channels are unaffected.

**Acceptance Scenarios**:

1. **Given** a publication window whose start is in the future, **When** a buyer browses at a time before
   the start, **Then** the product is not live in that channel; **at** the start it becomes live without
   any operator action.
2. **Given** a window that has ended, **Then** the product is no longer live in that channel and its status
   value is unchanged.
3. **Given** no window, **Then** the product is not time-limited.
4. **Given** an operator in UTC+1 who enters a start of 1 December 08:00, **When** a second operator in
   UTC+2 opens the editor, **Then** they see 09:00, and the product becomes live at 07:00 UTC for every
   buyer (FR-023).
5. **Given** a window whose end is 31 December 23:59:00, **When** a buyer browses at exactly that instant,
   **Then** the product is still live; one instant later it is not (end inclusive, FR-023).

---

### User Story 3 - Audience visibility per channel (Priority: P3)

An operator sells a product publicly in B2C but restricts it to two contract organizations in B2B. They set
the audience rule (public / logged-in only / organization-restricted with an organization list) for the B2B
channel only; B2C keeps the global rule.

**Why this priority**: Required by the issue's table but rarer than status; it reuses the audience rule
already enforced on reads (#227) and only adds a channel scope to it.

**Independent Test**: One product, global audience public, B2B override organization-restricted to org X;
assert listing and product page for an anonymous buyer, a buyer of org X and a buyer of org Y in each
channel.

**Acceptance Scenarios**:

1. **Given** the B2B override above, **When** a buyer of organization Y opens the product in B2B, **Then**
   it is indistinguishable from a non-existent product; in B2C the same buyer sees it.
2. **Given** "use inherited" on the B2B audience, **Then** B2B follows the global audience rule.
3. **Given** a global rule organization-restricted to orgs X and Y and a B2B override
   organization-restricted to org Z, **When** a buyer of org X opens the product in B2B, **Then** it is
   indistinguishable from a non-existent product — the override replaces the whole rule and is not merged
   with the global list (FR-030).
4. **Given** a B2B override whose organization list names org W, which is not a member of B2B, **When** the
   operator saves it, **Then** the save succeeds and the editor shows a warning naming W (FR-030).

---

### User Story 4 - Scope overview matrix in the product editor (Priority: P4)

In the product editor an operator opens one overview showing channels × languages for the product. Each
cell shows the effective status and marks every field overridden at that cell (and at the channel row and
the language column), plus any orphaned override with a warning (FR-015). From the overview they
"use inherited" for any channel or channel × language override, or delete an orphaned one; the fields
themselves are edited on the editor's own tabs. *(Amended 2026-10-27, L7: the story first said the
operator jumps from a cell to the field; that link is not built and is deferred — Out of Scope. The
overview does not reset a product's own per-language text, OV-1.)*

**Why this priority**: The main UX improvement over Magento's per-field "Use Default Value" checkbox;
without it, operators cannot see why a product is or is not live somewhere.

**Independent Test**: Seed overrides at C, L and C×L for several fields; open the overview and assert each
cell's markers and effective values; reset one and assert the cell and the storefront update.

**Acceptance Scenarios**:

1. **Given** overrides at C×L, C and L, **When** the operator opens the overview, **Then** each cell names
   the overridden fields and where the effective value comes from (this cell, channel, language, global).
2. **Given** a cell with a channel or channel × language override, **When** the operator chooses "Use
   inherited" for one field (a text value after confirming in a dialog, UX-1), **Then** only that override
   is removed and the cell shows the inherited value. A product's own text in a language has no reset in
   the overview (OV-1).
3. **Given** the operator lacks the product-edit permission, **Then** the overview is read-only.
4. **Given** a product that is a member of no channel, **Then** the overview says so and offers only the
   global and language scopes.

---

### User Story 5 - Bulk edit status per scope (Priority: P5)

From the product list an operator selects 300 products and sets status off for B2C × German, or resets that
override to inherited, in one action.

**Why this priority**: Launches and withdrawals happen per market for many products at once; doing it one
product at a time defeats the feature.

**Independent Test**: Select N products, run the bulk action at one scope, assert each product's override
at that scope and no other, the audit entries, and undo.

**Acceptance Scenarios**:

1. **Given** a selection and a chosen scope, **When** the bulk action runs, **Then** only that scope's
   override changes on each selected product.
2. **Given** a completed bulk action, **Then** every product's change is audited with its scope, and the
   operation can be undone as a whole with a per-product conflict report (Constitution XIII).
3. **Given** a selected product that is not a member of the chosen channel, **Then** it is skipped and
   reported, not silently added to the channel.
4. **Given** a selection, **When** the operator runs bulk Archive, **Then** each selected product is
   archived as by FR-019 (one audit entry per product, `product.archived.v1` once per product that was not
   yet archived, no status changed), and the operation can be undone as a whole; bulk Restore clears
   `archivedAt` the same way (FR-053).
5. **Given** a selection, **When** the operator sets the global status to `inactive` in bulk, **Then** the
   products are switched off and **none** is archived (FR-053).

---

### User Story 6 - Completeness gate when enabling a product for a scope (Priority: P6)

When an operator switches a product on for (C, L) — directly, in bulk, or by changing the global switch so
that (C, L) becomes live — the system checks that the values required to sell there exist in L: name, URL
key and every required language-scoped attribute. Missing values are listed. Only a status write triggers
the check: a product that becomes live at (C, L) by joining a channel, by the channel gaining a language, by
its publication window opening or by an audience change is not checked, and its missing values are shown in
the scope overview instead (clarify 2026-10-22, M3). The URL key is satisfied by
the product's global key when it has no key in L (clarify round 4, K3); the name is not — a missing German
name is exactly what the gate is for.

**Why this priority**: Prevents half-translated products going live in a market — the motivating example of
#385 — but the feature works without it.

**Independent Test**: A product lacking a German name; enable it at B2C × German; assert the gate's
response per FR-060.

**Acceptance Scenarios**:

1. **Given** a missing German name, **When** the operator enables the product at (B2C, de), **Then** the
   missing field is named, and the outcome follows FR-060.
2. **Given** all required values present, **Then** no gate message is shown.
3. **Given** the gate setting is *refuse* and a product with no overrides that lacks a German name, **When**
   the operator turns the global switch on so that the product would become live in (B2C, pl), (B2C, de)
   and (B2B, pl), **Then** the whole change is refused, nothing is saved, and the missing German name at
   (B2C, de) is named (FR-060).
4. **Given** the gate setting is *refuse* and a bulk selection in which some products fail the gate,
   **When** the bulk action runs, **Then** the passing products are changed and the failing ones are
   skipped and reported per product (FR-061, FR-051).
5. **Given** a product with a German name, a global URL key and no German URL key, **When** the operator
   enables it at (B2C, de), **Then** the gate reports nothing for the URL key (FR-060).
6. **Given** the gate setting is *refuse* and a product whose status is on everywhere but which lacks a
   German name, **When** the operator adds it to a channel offering German, or adds German to one of its
   channels, **Then** the change is saved without a gate message, and the scope overview shows the missing
   German name for the affected (channel, de) cell (FR-060, FR-041; clarify 2026-10-22, M3).

---

### User Story 7 - URL key per language, overridable per channel, with redirects (Priority: P7)

An operator gives a product the URL key `wiertarka-udarowa` in Polish and `impact-drill` in English, and in
the B2B channel overrides the English key to `impact-drill-pro`. When they later change a key, the old URL
answers with a permanent redirect to the new one.

**Why this priority**: Localised URLs matter for SEO in multilingual channels (Constitution VII) but are a
separate phase (3) that the availability work does not need.

**Independent Test**: Set keys at L and C×L; resolve each URL per (C, L); try to give a second product a key
already held in the same language in any channel and assert the refusal; request a key of another language
and assert not-found; change one key and assert the old URL redirects permanently to the new one at every
(C, L) of that language.

**Acceptance Scenarios**:

1. **Given** keys per language, **When** a buyer requests the product page by the key of (C, L), **Then**
   the product is found; **when** the buyer requests at (C, pl) the product's English-only key
   `impact-drill`, **Then** the answer is not-found — no cross-language redirect (FR-071).
2. **Given** a key that is another product's key in the same language — its language key, its global key
   where it has no language key, or a channel × language override in **any** channel, whether or not the
   two products share a channel (FR-070) — **When** the operator saves it, **Then** the save is refused
   naming the product that holds it.
3. **Given** a changed key, **When** a buyer requests the old URL at any (C, L) of the key's language
   where the product is available, **Then** they receive a permanent redirect to the current URL for that (C, L).
4. **Given** a key changed twice, **Then** both old URLs redirect directly to the current one (no chain).
5. **Given** a key that is another product's old, redirecting key in the same language (in any channel),
   **When** the operator saves it, **Then** they are asked to confirm, the confirmation names the product
   that loses the redirect, and only on confirmation is the key saved and that redirect removed (FR-072).
6. **Given** an existing redirect, **When** the operator deletes it, **Then** the old URL answers not-found
   and the product's current URL is unchanged.
7. **Given** product P in channel A with key `drill` in Polish, **When** the operator gives product Q — a
   member of channel B only — the Polish key `drill` or a (B, pl) override `drill`, **Then** the save is
   refused naming P; consequently adding Q to A later, or adding Polish to a channel that offers neither,
   can never produce two products resolving to `drill` in Polish (FR-070, SC-008).
8. **Given** a product with only the global key `drill` and no Polish key, **When** the operator gives it
   the Polish key `wiertarka`, **Then** at every (C, pl) `drill` redirects permanently to `wiertarka`, and in
   every other language without a language key `drill` still serves the page (FR-072).
9. **Given** a PIM synchronisation or an import whose record carries a Polish key that is another product's
   current or redirecting key in Polish, **When** the run applies the record, **Then** that key is not
   written, the run's issue list names the record and the product holding the key, and no redirect is taken
   over (FR-093).
10. **Given** `seo` is off, **When** the operator opens the product editor, **Then** no redirect list is
   shown; redirect data persists and keeps reserving keys, and a key equal to another product's redirecting
   key still asks for the takeover confirmation naming that product (FR-111; clarify 2026-10-22, Q-C).
11. **Given** product Q whose former global key `bohr` is a language-less redirect, **When** the operator
   gives product P the Polish key `bohr`, **Then** the confirmation names Q and says that the redirect is
   removed in every language; on confirmation `bohr` serves P at every (C, pl) and answers not-found in every
   other language. **Given** instead that `bohr` is P's **own** language-less redirect, **Then** no
   confirmation is asked and `bohr` keeps redirecting to P in every other language (FR-072).

---

### User Story 8 - SEO metadata per channel × language (Priority: P8)

An operator sets a different meta title and description for B2B × Polish than for B2C × Polish; channels
without an override fall back to the language value, then the global one.

**Why this priority**: Phase 4; extends the existing per-language SEO override with a channel dimension.

**Independent Test**: Set SEO at L and at C×L; render product page metadata per (C, L) and assert the
source.

**Acceptance Scenarios**:

1. **Given** an SEO override at (B2B, pl) and one at (pl), **Then** B2B × Polish shows the first and B2C ×
   Polish the second.
2. **Given** existing per-language SEO overrides, **When** this story is deployed, **Then** they become the
   language-scope values unchanged and, for the first time, are served on product pages; those products'
   metadata changes to the values operators entered (owner, 2026-10-21; clarify 2026-10-22, Q-A).

---

### User Story 9 - Media, attachments and packaging units per scope (Priority: P9)

An operator chooses a different base image for B2B, hides one lifestyle image in B2B, gives each image an
alt text per language, translates attachment names and descriptions and hides one attachment in B2C, and
translates packaging-unit names ("karton" / "carton").

**Why this priority**: Phase 5; content polish rather than availability.

**Independent Test**: Seed role, hide, label and translation overrides; render the product page per
(C, L) and assert gallery order / roles / alt text, attachments and unit names.

**Acceptance Scenarios**:

1. **Given** a base-image override for B2B, **Then** B2B listings and the page use that image and other
   channels use the global one.
2. **Given** an image hidden in B2B, **Then** B2B never shows it; other channels do.
3. **Given** alt text in Polish only, **When** rendering in English, **Then** the global alt text is used.
4. **Given** an attachment hidden in B2C, **Then** B2C neither lists nor serves it from the product page.
5. **Given** packaging-unit names per language, **Then** product page, basket and order lines show the
   name in the buyer's language, and order lines keep the name they were placed with.

---

### User Story 10 - Order constraints per channel (Priority: P10)

An operator sets minimum order quantity 10 in B2B and 1 in B2C, and makes the product returnable only in
B2C. (Price display mode per channel was removed from this feature in clarify round 2; *Out of Scope*.)

**Why this priority**: Phase 6; extends feature 155 with a channel step.

**Independent Test**: Seed overrides per channel; add to basket and place orders in each channel and assert
the minimum and the return eligibility.

**Acceptance Scenarios**:

1. **Given** MOQ 10 in B2B, **When** a B2B buyer adds 5, **Then** the basket refuses as feature 155 does;
   in B2C the same quantity is accepted.
2. **Given** returnable only in B2C, **Then** a return is offered on B2C orders and not on B2B orders.

---

### Edge Cases

- **Product goes offline in a basket.** A product whose effective availability becomes false in the
  basket's (channel, language) while it sits in a basket: the line is kept and shown as unavailable and
  blocks placement, using the existing `product_unavailable` state from feature 155 (FR-006).
- **Window boundary during checkout.** The window ends between "add to basket" and "place order": placement
  re-evaluates availability at placement time and treats the line as unavailable.
- **Language removed from a channel** while C×L overrides exist for it: the overrides are retained but
  ignored (no error), reappear if the language is re-added, and are shown as orphaned in the overview.
- **Product removed from a channel**: its channel-scoped values are retained but ignored; re-adding restores
  them. (Membership removal is not deletion.)
- **Channel deleted**: its scoped values are removed with it.
- **Global archive vs per-scope enable**: an archived (or deleted) product is unavailable everywhere,
  whatever its status at any scope. Archive and Restore change no status value, and no status write
  archives or restores (FR-010, FR-019): setting `active` on an archived product leaves it archived until it
  is restored, and restoring an `inactive` product leaves it off. Setting `active` on an archived product is
  still a status write and fires the completeness gate (FR-060); Restore never does.
- **Variants and grouped / bundle children**: a variant is a `product_variants` row of its `configurable`
  parent, not a product; it has no status, page or listing of its own and follows the parent. A grouped or
  bundle child is a real product governed by its own status, channel membership and audience, as today: a
  child whose effective status is off at (C, L) is not purchasable there even via the parent.
- **Parent off, child on**: the child does not make the parent reachable.
- **Unresolved channel** (no header, no host mapping and no default): no scoped value matches and no
  product is live — fail closed (Constitution XII).
- **URL key collision with a redirect**: a new key equal to another product's *old* (redirecting) key in
  the same language, in any channel, is saved only after a confirmation naming the product that loses the
  redirect (FR-072).
- **Channel membership or channel languages change**: cannot create a URL-key clash — keys are unique per
  language across all channels, whatever the membership (FR-070). A channel × language key override left
  orphaned by a product leaving a channel keeps holding its key in that language, so re-joining cannot
  clash either.
- **Redirect to a product that is now unavailable** at (C, L): the redirect target answers as unavailable
  (not-found), the redirect does not leak that the product exists. An old key of an **archived** product
  answers as the product's current URL does — "gone" (FR-005) — since archiving is already disclosed there.
- **Key of another language**: a request at (C, L) for a key that the product holds only in another
  language answers not-found; no cross-language redirect is made (FR-071). A language-less redirect (a
  former global key) is not a key of another language: it resolves in every language (FR-072).
- **Import or PIM writes a taken key**: the key is refused and listed in the run's issue list; the run never
  takes over another product's redirecting key (FR-093).
- **Attribute scope flag changed** after values exist (e.g. a language-scoped attribute made global):
  defined by FR-090.
- **Module off**: with `seo` off, redirects and SEO overrides are not served and the product editor shows
  no redirect list, but the data persists and keeps reserving keys (FR-111).
- **Audience override naming non-member organizations**: the save is allowed and the editor shows a warning
  naming them; the list is not pruned, so the entry applies if the organization later joins the channel
  (FR-030).
- **Publication window across a daylight-saving change**: the bounds are absolute instants, so a window
  entered before a clock change takes effect at the same instant after it (FR-023).
- **`inactive` at any scope, global included**: plain "off" there, not-found; it never archives (FR-010).
  Archiving is the separate Archive action (FR-019).
- **A request still carrying `draft` or the legacy `archived`** (admin API, bulk status, import file, admin
  list filter): refused with a validation error; there is no alias (FR-112).
- **Concurrent edits** at the same scope by two operators: writes on one product are serialised (a row
  lock on the product), so each applies to the state the previous one left and is audited with that
  before-state — the later write's value stands. A residual race the lock cannot order (two first writes
  creating the same override row) answers `409 VERSION_CONFLICT` ("reload and try again") and writes
  nothing; a bulk edit reports that product failed with the reason `concurrent_modification` and changes
  the others (Session 2026-10-27, R2).

## Requirements *(mandatory)*

### Functional Requirements

#### Effective availability (shared by every consumer)

- **FR-001**: A product MUST be **effectively available** at (channel C, language L, buyer, now) if and only
  if all hold: it is not deleted and not archived; it is a member of C; L is a language of C; its effective
  status at (C, L) is "on"; now is inside its effective publication window for C (if any); and its effective
  audience rule for C admits the buyer.
- **FR-002**: Effective availability MUST be computed by one shared definition that every consumer below
  uses; no consumer may apply its own status predicate.
- **FR-003**: *Removed — clarify 2026-10-21 round 2 (display visibility dropped).*
- **FR-004**: The following consumers MUST honour FR-001 for their (C, L): storefront product list and
  filter facets; product page (including links, related products and bundle configuration); search indexing
  and search results; sitemap; product feeds; quick order; comparisons; CMS product blocks; basket add and
  order placement; quote-request line creation (FR-018); and, through an API key, the external bulk-price
  probe and external order intake, evaluated at the key's channel in that channel's default language for the
  request's audience — an unavailable product gets no price (reason `sku_not_in_assortment`) from the probe
  and `404 PRODUCT_NOT_FOUND` from intake, as a product hidden from the organization does (Session
  2026-10-25, W5-a, W5-b). Every one of them, and in addition quick search,
  the listing's free-text search, attribute filters, filter option counts and name sort, basket line names
  and quote-request line names, MUST read scoped field values at their effective (C, L) value (FR-017).
- **FR-005**: A product page request at (C, L) for a product not effectively available there MUST answer
  exactly as for a product that does not exist (no status-specific response that reveals existence),
  except for the archived case (FR-019), which MUST keep its "gone" answer — but only to a caller who could
  otherwise see the product: an archived product answers "gone" at (C, L) only where it would be
  effectively available to that buyer if it were not archived; everywhere else it answers as a product that
  does not exist (Session 2026-10-25, Q1-a). In that test the archive is taken away and the **global**
  status is read as `active`, while every channel and channel × language status override, membership, the
  channel's languages, the publication window and the audience still apply — so products archived by
  today's global `inactive` (Q1-c, O-4) keep answering "gone" where they did (Session 2026-10-25, O-3). An `inactive` product that is not archived answers not-found at every
  scope. "Gone" is the API's answer — `410 PRODUCT_ARCHIVED` from the product read and the key resolve; the
  storefront's product page shows its ordinary not-found page for it (HTTP 404), as for a product that does
  not exist (owner decision B4, 2026-10-28: an App Router page cannot answer 410 without a per-request
  middleware round trip); this also closes the gap noted in *Current state*, where a `draft` member product is reachable by
  its URL (D-1 is moot, Session 2026-10-25). Note: product handles stored by CMS product blocks (global slugs) MUST keep resolving — the product lookup
  `GET :idOrSlug` answers an id, then a current key at (C, L), then the global slug, and never a redirect.
  It is an API handle, not a storefront URL, so FR-071 does not govern it (`research.md` R28).
- **FR-006**: A basket line whose product is no longer effectively available at the basket's (C, L) MUST be
  shown as unavailable and MUST block placement, reusing the existing unavailable-line behaviour.
- **FR-007**: An unresolved request channel MUST NOT match any scoped value or any product (fail closed,
  Constitution XII); channel membership MUST be read only through the sanctioned membership service.
- **FR-018** *(numbered after FR-017; added in clarify round 2)*: A quote request created by a **buyer**
  MUST refuse every line whose product is not effectively available (FR-001) at the quote request's channel
  and language, with an answer that does not reveal the product's existence beyond what FR-005 allows. A
  quote request created by an **operator** in the admin MUST accept such a line and show a warning naming
  it. *(An archived product is the exception, FR-115.)* The channel of an operator's quote request MUST be
  one of the Organization's active channels, else `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` before anything is
  written (security review M1) — the channel the operator names, **and, when none is named, the channel the
  admin request resolved** (the system default, or `X-Sales-Channel`); a request with no channel at all is
  refused the same way (owner decision 2026-10-29 "A": the server is the sole enforcer, so omitting the id
  is no way around the check). The create screen sends nothing while the Organization's channels are
  unread or cannot be read, and offers a retry for the latter.
- **FR-115** *(numbered after FR-114; added in Session 2026-10-26, P-3)*: A quote request MUST NOT hold an
  archived product, on any path: a buyer's create, draft edit and resubmit (and so every conversion into a
  quote request) MUST refuse it with the answer an absent product gets (`404 PRODUCT_NOT_FOUND`, FR-018); an
  operator's create and edit MUST refuse it with `409 PRODUCT_ARCHIVED` naming the archived products in
  `details.productIds` and write nothing (P-3b); converting an approved quote whose product was archived
  since MUST answer `409` before the basket is touched (P-3a). The operator's product pickers MUST list an
  archived product disabled with the reason "archived" in the quick search and leave it out of the
  browser's *All* (RFQ-c). Price lists are unchanged: an archived product may still be priced.
- **FR-019** *(numbered after FR-018; added in Session 2026-10-25, Q1-a)*: Archiving MUST be a separate,
  **global, product-wide** action, offered as **Archive** and **Restore**, and never a status value or a
  per-scope state.
  - **Archive** MUST set `archivedAt` and emit `product.archived.v1` exactly once per transition from
    not-archived to archived; archiving an already-archived product MUST change nothing and emit nothing
    (Session 2026-10-25, O-6).
    From then on the product is unavailable everywhere (FR-001) and its page answers "gone" under FR-005.
  - **Restore** MUST clear `archivedAt`; restoring a product that is not archived MUST change nothing. After
    Restore the product is available wherever FR-001 says so for its current status values.
  - Archive and Restore MUST NOT change the status at any scope, and no status write at any scope MUST set
    or clear `archivedAt`: setting `active` on an archived product leaves it archived, and restoring an
    `inactive` product leaves it off (edge case *Global archive vs per-scope enable*; Session 2026-10-25,
    O-5). Only Restore brings an archived product back.
  - Each MUST run as an audited Command through `CommandBus.run` (Constitution XIII) with one audit entry
    per product carrying the before / after `archivedAt` (FR-080), and MUST be gated by the existing catalog
    write permission `catalog:write` (FR-084); no new permission code is introduced.
  - Archive and Restore MUST be offered for a single product in the product editor and, because a bulk
    status action exists (FR-050), as a bulk action on the product list on the existing durable
    bulk-operation path, audited per product and reversible as a whole with the bulk-operation undo
    (FR-052, FR-081). This replaces today's way of bulk-archiving — a bulk global status change to
    `inactive` — which after this feature only switches products off.
  - Archive and Restore MUST NOT fire the completeness gate (FR-060): they are not status writes.
  - New operator-facing labels and messages MUST exist in Polish and English (FR-043).

#### Scope model and inheritance

- **FR-008**: Every scoped field MUST resolve through the existing fallback chain (C×L → C → L → Global),
  restricted to the scopes that field supports (table in FR-009); a second fallback chain MUST NOT be
  introduced.
- **FR-009**: Supported scopes per field (the issue's table, confirmed in clarify 2026-10-21, D-2):

  | Field | Global | Language | Channel | Channel × language |
  | --- | --- | --- | --- | --- |
  | Name, description | yes | yes | yes | yes (unchanged) |
  | User attributes | per attribute flags (unchanged) | | | |
  | Status | yes | — | yes | yes |
  | Audience visibility | yes | — | yes | — |
  | Publication window | yes | — | yes | — |
  | URL key | yes | yes | — | yes |
  | SEO meta title / description / OG | yes | yes | yes | yes |
  | Gallery: image roles, hide image | yes | — | yes | — |
  | Gallery: label / alt text | yes | yes | — | — |
  | Attachment name, description | yes | yes | — | — |
  | Attachment hidden | — (shown) | — | yes | — |
  | Packaging-unit name | yes | yes | — | — |
  | Minimum order quantity, returnable | yes | — | yes | — |

  Clarify round 2 removed the display-visibility and price-display-mode rows. SKU, type, attribute set,
  stock flags, fulfilment strategy, product links, bundle / grouped / variant structure, prices, price
  display mode, promotions and warehouses MUST remain as they are.
- **FR-010**: Status MUST hold exactly one of `active` / `inactive` at every scope it supports (FR-009),
  global included; `draft` is not a status value (Session 2026-10-25, Q1). The product is "on" at (C, L)
  exactly when its effective status there is `active`. `inactive` at **any** scope — global, C or C×L —
  MUST mean plain "off" there (not-found, FR-005) and MUST NOT set or clear `archivedAt`, emit
  `product.archived.v1` or answer "gone" (clarify round 2, N1, extended to the global scope by Q1-a).
  Archiving is the separate global Archive / Restore action of FR-019 and MUST stay a global, product-wide
  state (FR-001), independent of status. A newly created product MUST get the global status `inactive` when
  the request names none, and a duplicated product MUST always get the global status `inactive` with
  `archivedAt` cleared, as it gets `draft` today (Q1-d).
- **FR-011**: Every scoped field MUST have a global value; an override MUST exist only at a scope where an
  operator (or an integration) set one.
- **FR-012**: "Use inherited" MUST remove the override at that scope; the effective value MUST then be the
  inherited one. Storing an empty value MUST NOT be the way to inherit.
- **FR-013**: Changing a global value MUST NOT alter or remove any override, and the product editor MUST
  NOT warn about existing overrides when the global value of **any** scoped field is changed — status
  (owner decision 3) and every other field of FR-009 (A-9, confirmed in clarify 2026-10-21 round 2).
- **FR-014**: An override MUST be accepted only for a scope valid for the product (FR-009 and *Terms*); an
  override for a channel the product is not a member of, or a language the channel does not offer, MUST be
  refused with a validation error naming the scope.
- **FR-015**: Overrides made invalid later (product leaves a channel, a language leaves a channel, an
  attribute's scope flags change) MUST be retained and ignored by resolution, and MUST be listed as orphaned
  in the scope overview with a way to delete them. An orphaned channel × language URL-key override keeps
  holding its key in that language for uniqueness (FR-070) until it is deleted.
- **FR-016**: Effective status (and therefore effective availability) MUST be filterable when listing, searching and generating
  sitemaps and feeds, without resolving every product's overrides one by one (performance target SC-004).
- **FR-017**: Every storefront and buyer-facing consumer MUST use the **effective (C, L) value** of every
  scoped field (FR-008) — never the baseline — wherever it matches, filters, counts, sorts, displays or
  snapshots that field (owner decision 2026-10-21 on the #384 follow-ups). This explicitly covers:
  (a) quick search, matching and returning names, and its consumer quick order;
  (b) the storefront listing's free-text search, attribute filters, filter option counts and name sort;
  (c) comparisons — product names and compared attribute values;
  (d) basket line names and batch-add outcome messages;
  (e) product names snapshotted into quote-request lines.
  A snapshot MUST keep the value it was taken with. A snapshot taken for a buyer MUST use the request
  language at snapshot time, falling back to the channel's default language when the request language is
  not one the channel offers (A-3); a document created by an operator in the admin MUST use the channel's
  default language (clarify 2026-10-21 round 2, N2). The same holds for every field of FR-009 as its story
  lands. Search-result card names are fixed under #384 (A-1). Matching, filtering, counting and sorting on
  effective values MUST meet SC-004.

#### Publication window

- **FR-020**, **FR-021**, **FR-022**: *Removed — clarify 2026-10-21 round 2 (display visibility dropped;
  D-3 moot).*
- **FR-023**: A publication window MUST be an optional start, an optional end, or both, per channel; each
  bound MUST be a date-time instant, entered and shown in the admin in the operator's local time, and the
  start MUST be before the end. No time-zone setting is introduced; every buyer and every consumer of
  FR-004 sees the window open and close at the same instant (clarify 2026-10-21 round 3, C3). Both bounds
  MUST be inclusive: the product is inside the window while start ≤ now ≤ end (clarify 2026-10-21 round 4,
  K4 — the convention of the existing price-list and promotion windows). Outside the window the product MUST
  NOT be effectively available in that channel, and the transition MUST take effect without operator action and within the time stated in
  SC-005.
- **FR-024**: Entering or leaving a window MUST update every consumer of FR-004 (search, sitemap, feeds)
  the same way a status change does.

#### Audience visibility per channel

- **FR-030**: The audience rule (public / logged-in only / organization-restricted with its organization
  list) MUST be settable per channel, inheriting the global rule; evaluation MUST stay the existing read-time
  rule, and an out-of-audience answer MUST be indistinguishable from "does not exist". A channel override
  MUST replace the whole rule — mode and organization list — as one value; it MUST NOT be merged with the
  global list, and "use inherited" removes both together. The override's organization list MAY name
  organizations that are not members of that channel: the save MUST NOT be refused, and the editor MUST show
  a warning naming them (clarify 2026-10-21 round 3, C4). This differs from FR-014, which still refuses an
  override for a channel the product itself is not a member of.

#### Product editor

- **FR-040**: The product editor MUST offer, for every scoped field, a way to set it at each supported scope
  and to "use inherited", and MUST show the source of the effective value.
- **FR-041**: The editor MUST offer a scope overview: channels × languages for the product's channels, with
  the channel and language levels, marking per cell the overridden fields, the effective status, any
  orphaned override (FR-015) and every value the completeness gate would report missing at that cell
  (FR-060) — so that a product made live by a change that does not fire the gate shows what it lacks — and
  offering "Use inherited" per field per cell for sales channel and channel × language overrides only, not
  for a product's own text in a language (Session 2026-10-26, OV-1, UX-1, UX-3).
- **FR-042**: The overview and scope controls MUST be read-only for an operator without the product-edit
  permission, and MUST be reachable from the product editor and discoverable in the command palette
  (Constitution XVI) as part of the product editor.
- **FR-043**: Every new operator-facing label and message MUST exist in Polish and English.

#### Bulk edit

- **FR-050**: The product list MUST offer a bulk action that sets, or resets to inherited, **status** at one
  chosen scope for the selected products. It covers status only; bulk edit of the other channel-scoped
  fields is a follow-up (clarify 2026-10-21, D-4, narrowed to status by round 2; *Out of Scope*).
- **FR-051**: Products not valid for the chosen scope MUST be skipped and reported per product.
- **FR-052**: The bulk action MUST run on the existing durable bulk-operation path and be audited per product
  and reversible as a whole (FR-080, FR-081).
- **FR-053** *(added in Session 2026-10-25, Q1-a)*: The product list MUST also offer bulk **Archive** and
  bulk **Restore** (FR-019) for the selected products, on the same durable bulk-operation path, audited per
  product and reversible as a whole. A bulk status value — global or scoped — MUST be `active`, `inactive`
  or, for a scope, "inherit"; a bulk status change MUST NOT archive or restore, and a bulk request carrying
  `draft` or `archived` MUST be refused with a validation error (FR-112).
- **FR-114** *(numbered after FR-113; added in Session 2026-10-26, P-1)*: The admin assistant MUST offer
  Archive and Restore as tools of their own, `catalog.archive_product` and `catalog.restore_product`, gated
  by `catalog:write`, planned with a preview and run only after the operator confirms. Each product MUST run
  the same audited Archive / Restore Command as the admin screens (FR-019), with the confirming admin as
  actor; a selection larger than the assistant's inline limit MUST run as the bulk Archive / Restore of
  FR-053. The status tool `catalog.set_product_status` MUST NOT archive or restore, and the assistant's
  product search MUST include archived products and say which are archived.

#### Completeness gate

- **FR-060**: When an operator's **status write** — the global status, a channel or channel × language
  status override, or a bulk status change — turns a product on at (C, L), that is, changes its effective
  status there to `active` (clarify 2026-10-22, M3, restated in Session 2026-10-25), the system MUST check that name, URL key and every required language-scoped attribute resolve to a non-empty value at
  (C, L), and MUST name every missing field. What follows is decided by one **platform-level setting**
  (one value for the whole platform, not per channel) with two values: *warn* — the change is saved and the
  missing fields are shown — and *refuse* — the change is not saved. The default MUST be *warn*. The setting
  MUST have Polish and English labels (FR-043). In *refuse* mode, a single-product edit that would turn the
  product on in several (channel, language) pairs — a change of the global switch, or a channel-level
  override that turns on every language of that channel — MUST be refused **as a whole** if any one pair
  fails, naming every missing field per pair; no pair is turned on partially (clarify 2026-10-21 round 2,
  N3). The "URL key" item MUST be satisfied by the product's effective key at (C, L) as defined in FR-070,
  so a global key satisfies it where the product has no key in L, and no warning or refusal is raised for a
  missing language key (clarify 2026-10-21 round 4, K3). This does not extend to the name or to required
  language-scoped attributes: for them a value counts only if it is set at (C, L), at C, or for L itself —
  the resolver's cross-language fallback (see *Current state*) to the primary language's or any other
  language's value MUST NOT satisfy the gate, otherwise a
  missing German name would pass as the Polish one (US6, scenario 1). The gate MUST NOT fire when a product
  becomes live at (C, L) by any other change — joining a channel, a channel gaining a language, a
  publication window opening, an audience change, or a Restore (FR-019); missing values in those cases MUST be visible in the
  scope overview (FR-041) (clarify 2026-10-22, M3, option A; US6 #6). The gate reads **status only**, never
  the archive: a status write that changes the effective status at (C, L) to `active` on an **archived**
  product fires the gate (and, in *refuse* mode, is refused as above) although the product stays archived
  and does not become available (FR-019) (coordinator, 2026-10-25).
- **FR-061**: The gate MUST apply equally to single status edits, bulk status edits and changes of the
  global switch that turn on scopes without overrides, MUST NOT apply to the non-status changes listed in
  FR-060, and MUST NOT apply to imports, PIM synchronisation (A-6, confirmed in clarify 2026-10-21) or the
  API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` (Session 2026-10-26, G-1). In *refuse* mode a bulk edit MUST change the products that pass and skip and report
  per product those that fail, as FR-051 does for invalid scopes.

#### URL key and redirects

- **FR-070**: The URL key MUST be settable per language (for every channel) and overridable per
  channel × language, and it MUST be **unique per language across all channels** (clarify 2026-10-21
  round 3, superseding the per-(channel, language) rule). A product's **keys in language L** are: its
  language key for L — or, where it has none, its global key; and every channel × language override key it
  has for L in any channel, including overrides orphaned under FR-015. No key MAY be among the keys in L of
  two different products, whether or not they share a channel. Uniqueness MUST be checked when a key is
  written, and a write that would break it MUST be refused naming the product that holds the key. A global
  key therefore MUST NOT equal any other product's key in any language. The same key MAY be used by
  different products in different languages, and by one product in several channels of the same language.
  Because the rule does not depend on channel membership or on a channel's languages, adding a product to a
  channel, removing it, or adding or removing a channel language MUST NOT be checked or refused for URL
  keys, and can never produce two products resolving to the same key at one (C, L) (SC-008).
  The three consequences of this rule — the global key counts as the key in every language without a
  language key; an orphaned channel × language override keeps reserving its key; a redirecting key belongs
  to at most one product per language and never equals a current key there — were confirmed in clarify
  round 4. A product's **effective key at (C, L)** is its channel × language override for (C, L), else its
  language key for L, else its global key.
- **FR-071**: At (C, L) only **keys of L** MUST resolve (clarify 2026-10-21 round 4, K1, option C): a
  request for a product's effective key at (C, L) serves the product; a request for one of that product's
  other current keys in L (its language or global key where a (C, L) override exists, or an override of
  another channel) or for one of its redirecting keys in L (FR-072) MUST redirect permanently to its
  (C, L) URL. A key that the product holds only in another language MUST answer not-found — there are no
  cross-language redirects — and so MUST a key of no product. A language-less redirect (a former global
  key, FR-072) is not a key of another language: it resolves in every language. Availability (FR-001,
  FR-005) is evaluated for the product the key resolves to. This governs storefront URLs; the product
  lookup by handle is FR-005's note.
  Every product URL the platform emits (canonical, alternate-language links, sitemap, redirect targets,
  admin preview) MUST carry `?lang=<L>` when L is not the channel's default language. A key MUST NOT be
  rendered in another language. Known and accepted until the language-path-prefix issue (#396): a link
  without `?lang` opened by a browser whose language resolves to another channel language answers not-found
  once the product has its own key in that language. A language prefix in the path is out of scope
  (clarify 2026-10-22, Q-B).
- **FR-072**: Changing a URL key MUST keep the previous key as a permanent redirect, in its language, at
  every (C, L) of that language, to the product's current URL in that (C, L) — availability is evaluated
  when the redirect is resolved (FR-071), not when the key changed; redirects MUST never
  chain (an old URL always points directly at the current one), MUST have no expiry (they last until
  deleted), and MUST be removed when the product is deleted. The operator MUST be able to delete an
  individual redirect. An old, redirecting key MUST belong to at most one product per language across all
  channels, and MUST NOT equal any product's current key in that language. A new key equal to **another**
  product's old, redirecting key in the same language — in any channel — MUST be accepted only after an
  explicit confirmation that names the product losing the redirect; on confirmation that redirect is removed
  and the key is saved (clarify 2026-10-21, takeover rule evaluated per language since round 3). A change
  of the effective key at (C, L) counts as a change for this requirement, including giving a product its
  first language key for L: its global key then becomes a redirecting key **in L only**, and keeps serving
  the page in every language where the product still has no language key (consequence 1, round 4). Only an
  operator may confirm a takeover; imports and connectors never do (FR-093). Changing the **global** key
  keeps the previous global key as a language-less redirect, which resolves in every language of every
  channel (Key Entities). Taking over another product's language-less (former global) redirect removes it
  in every language, and the confirmation says so. A product giving itself a language key never makes its
  own earlier redirects stop resolving.
- **FR-073**: Existing slugs MUST become the global URL key at deployment, so every existing URL keeps
  resolving unchanged (SC-001).
- **FR-074**: The sitemap and every canonical and alternate-language link MUST use the effective key per
  (C, L), with the `?lang` rule of FR-071.

#### SEO, media, attachments, packaging units

- **FR-075**: SEO meta title, description and OG fields MUST be settable per channel × language with the
  chain of FR-008; existing per-language overrides MUST become language-scope values without change, and
  are served on product pages from then on (clarify 2026-10-22, Q-A; US8 #2).
- **FR-076**: Gallery image roles (base, small, thumbnail) and "hide image" MUST be settable per channel;
  a hidden image MUST NOT be served in that channel; role uniqueness MUST hold per channel. The set of
  images itself MUST stay global — a channel cannot add an image of its own (clarify 2026-10-21, D-6).
- **FR-077**: Gallery label / alt text MUST be translatable per language.
- **FR-078**: Attachment name and description MUST be translatable per language, and an attachment MUST be
  hideable per channel; a hidden attachment MUST NOT be listed or downloadable from the product page in
  that channel.
- **FR-079**: Packaging-unit names MUST be translatable per language; order lines MUST keep the name in the
  language they were placed in.

#### Auditing, tenancy, activation, integrations

- **FR-080**: Every write of a scoped value (set, change, use inherited) MUST run as an audited Command
  carrying the product, the field, the scope and the before / after value (Constitution XIII), with exactly
  one audit entry per product per command. Deleting a URL redirect and taking over another product's
  redirecting key (FR-072) are admin writes and MUST run the same way, and so MUST Archive and Restore
  (FR-019), single and bulk.
- **FR-081**: Bulk scoped writes MUST be reversible as a whole with the bulk-operation undo (all-or-nothing
  per product, conflict report). A single scoped write's audit entry MUST hold the complete before-state, so
  that re-applying it restores the previous value. A generic one-click undo of a single Command is out of
  scope (clarify 2026-10-22, Q-D, option A).
- **FR-082**: Status, window, audience and URL-key changes MUST emit domain events so
  that search, sitemap, feeds and webhooks update. Archive and Restore (FR-019) MUST emit
  `product.updated.v1` as a status change to or from `inactive` does today, and Archive MUST additionally
  emit the existing `product.archived.v1`, once per transition. A status change to `inactive` MUST NOT emit
  `product.archived.v1` any more; the event's meaning changes from "status moved to `inactive`" to "the
  product was archived" (*Compatibility and release*).
- **FR-083**: The new scoped data is catalogue data and MUST be classified as platform-global, as product
  value overrides are today (Constitution XI); audience evaluation stays at read time against the buyer's
  organization.
- **FR-084**: Admin permission codes for these writes MUST reuse the existing product-edit permission unless
  the plan justifies a new one; any new code MUST appear on `/admin-roles` with Polish and English labels.
  Archive and Restore (FR-019, FR-053) reuse `catalog:write`, as setting the global status to `inactive`
  does today.
- **FR-090**: Changing a user attribute's scope flags after values exist MUST follow a defined, previewable
  migration: narrowing (e.g. channel-scoped → global) MUST tell the operator how many overrides become
  orphaned and retain them (FR-015); widening MUST create no values. The admin attribute editor MUST
  expose the scope flags of user-defined attributes and show the preview before saving a narrowing.
- **FR-091**: PIM connectors (Ergonode, Akeneo, Pimcore, UnoPim) and catalogue import / export MUST each
  state which scope they read and write for every field of FR-009; a connector that writes only global
  values MUST NOT remove overrides set by operators.
- **FR-092**: Import / export MUST be able to round-trip status per scope, with the values `active` and
  `inactive` only; an imported status of `draft` or `archived`, at any scope, MUST be refused with a validation error and
  reported by the run's existing per-record rules (FR-112). Status import never archives or restores.
- **FR-093** *(added in clarify round 4, K2)*: When a catalogue import or a PIM connector writes a URL key
  that FR-070 or FR-072 forbids — another product's current key or redirecting key in that language — that
  key MUST NOT be written, the product MUST keep its previous key at that scope, and the record MUST be
  reported in the run's issue list naming the record, the language and the product holding the key. An
  import or connector MUST NOT take over a redirecting key and MUST NOT ask for the FR-072 confirmation.
  The rest of the record's fields are applied or refused by the run's existing per-record rules (A-11).

#### Order constraints

- **FR-100**: Minimum order quantity and "returnable" MUST be settable per channel, inheriting the global
  value, and every feature-155 check MUST use the value of the basket's or order's channel.
- **FR-101**: *Removed — clarify 2026-10-21 round 2 (price display mode per channel out of scope, D-5).*

#### Deployment and module activation

- **FR-110**: Deployment migration MUST make every existing product's effective availability and listing
  identical to before deployment: existing status becomes the global status, no windows, existing audience
  rule becomes the global audience rule. In addition (Session 2026-10-25, Q1-b, Q1-c):
  - every `draft` MUST become `inactive` — in `products.status` and in every channel and channel × language
    status override row — **without** archiving: `archivedAt` is not set by the migration;
  - every product that is `inactive` before the migration MUST stay `inactive` and stay archived: a set
    `archivedAt` is kept unchanged, and a product that is `inactive` **without** an `archivedAt` MUST get
    `archivedAt` = its last-update timestamp (`updated_at`) (Session 2026-10-25, O-4). Every product
    `inactive` today therefore stays archived and keeps answering "gone" where it does today (FR-005);
  - `archivedAt` MUST NOT be written by the migration for any other row — no `draft` or `active` product
    becomes archived;
  - after the migration no stored status, at any scope, holds a value other than `active` or `inactive`,
    and the stored default for a new product is `inactive` (FR-010).
  Because a `draft` product was never live (only `active` was listed, searched, indexed or fed) and an
  `inactive` one is off, this conversion changes no product's listing; the URL and basket changes are the
  exceptions SC-001 lists.
- **FR-112** *(added in Session 2026-10-25, Q1-e)*: `draft` MUST be removed from the API outright, with no
  alias period: the shared status schema (`productStatusSchema`, and the scope status constant derived from
  the same value set) MUST be `active | inactive`; the admin product API (create, update, duplicate), bulk
  status (global and scoped), catalogue import / export and the admin product-list status filter MUST refuse
  `draft` with a validation error naming the field. Every typed consumer of the status (including
  `storefront/lib/api/quick-order.ts` and `packages/admin-kit/src/components/product-browser/types.ts`)
  MUST drop `draft`. The legacy `archived` status write alias (feature 032) MUST be removed the same way: a
  write or filter carrying status `archived` MUST be refused with a validation error — the alias coercion
  `coerceProductStatusWrite` (`packages/contracts/src/catalog.ts`) and the admin list's `status=archived`
  mapping (`packages/modules/catalog/src/backend/routes.admin.ts`) go; archiving is FR-019 (Session
  2026-10-25, O-1). This is a breaking change (*Compatibility and release*).
- **FR-113** *(added in Session 2026-10-25)*: The admin product list MUST filter and count by status
  `active` / `inactive` and, separately, by archived state (`archivedAt`), not by treating `inactive` as
  archived: a product that is `inactive` and not archived MUST be listed like any other product, and the
  list MUST keep hiding archived products by default with the existing way to include them; "Archived" is
  a filter of its own, based on `archivedAt` (Session 2026-10-25, O-2).
- **FR-116** *(numbered after FR-115; added in Session 2026-10-26, PAL-1)*: The Archived filter MUST have
  an admin route of its own, `/catalog/products/archived` (`catalog:read`), which opens the product list on
  its Archived tab and to which a reload and the browser's Back return, and a command-palette action
  "Archived products" opening it, found by English and Polish keywords ("archived", "archiwum")
  (Constitution XVI).
- **FR-111**: When `seo` is off, redirects and SEO overrides MUST NOT be served and their data MUST persist;
  scoped catalogue data MUST persist across any
  module being turned off and on (Constitution XVII). "Redirects" are the redirecting keys of FR-072; a
  request for one of a product's other **current** keys in L (FR-071) MUST still redirect to its (C, L)
  URL while `seo` is off (Session 2026-10-26, F-1). While `seo` is off the product editor MUST show no
  redirect list. Redirect data persists in the catalogue and keeps reserving keys, and the takeover
  confirmation still appears and names the product losing the redirect (clarify 2026-10-22, Q-C; US7 #10).
  Archive and Restore (FR-019) belong to `catalog`, which is not deactivatable, so they have no off state of
  their own; a consumer module that is off ignores the archive event as it ignores every other.

### Compatibility and release

Added in Session 2026-10-25 (Q1-e). Everything else in this feature is additive; the status change is not.

- **Breaking**: `productStatusSchema` and the scope status value set narrow from
  `draft | active | inactive` to `active | inactive` (FR-010, FR-112). `@endora-commerce/contracts` MUST
  ship a changeset marked **BREAKING**, at bump level **`minor`** — `specs/conventions/release-intent.md`
  (D-225) refuses `major` while a package is in `0.x` (`contracts` is `0.108.0`), and in a `0.x` series
  `minor` already takes every caret dependent out of range (coordinator, 2026-10-25; research R30.6) —
  whose note says: `draft` is removed with no alias; the legacy `archived` write
  alias is removed too and `archived` is refused like `draft` (FR-112, O-1); existing `draft` data is
  migrated to `inactive` (FR-110); every product `inactive` today stays archived, products without an
  `archivedAt` getting their last-update time (FR-110, O-4); a status of `inactive` no longer archives — archiving is the Archive /
  Restore action (FR-019); new and duplicated products default to `inactive`; `product.archived.v1` now
  means "archived by the Archive action", not "status moved to `inactive`" (FR-082). The catalogue module's
  changeset MUST carry the same note, marked BREAKING at the bump level D-225 allows (`minor` in `0.x`): an
  admin API that now refuses a previously valid value is a breaking change for its callers. Any other
  published package that types the status (the admin kit's product browser types) follows the same rule.
- **Stored criteria not migrated**: product-feed criteria rules stored with `status = draft` (rows owned by
  `product_feeds`) are not rewritten — a `catalog` migration does not write another module's table — and
  match nothing after the migration, as they effectively matched nothing before (the feed floor already
  required `active`); SC-009 counts product and scope rows only, so it needs no exception for them
  (coordinator, 2026-10-25; research R30.5).
- **Behaviour changes an operator sees**: a product set `inactive` is off but not archived (no "gone"
  answer, still listed in the admin by default, FR-113); archiving is an explicit action; "Archived" is a
  list filter of its own; former `draft` products appear as `inactive`. **Setting a product `active` never
  restores it** — only Restore does (FR-019, O-5): every product archived before this feature, which
  includes every product `inactive` today, needs an explicit Restore to come back, and setting it `active`
  alone leaves it archived.
- **Documentation**: the catalogue's module documentation page and its Polish mirror MUST describe the two
  status values, what "off" means at each scope, the Archive / Restore action (single and bulk), its
  permission (`catalog:write`) and the 410 rule of FR-005, MUST state for operators that a product archived
  before this feature needs an explicit Restore (setting `active` does not restore it), and MUST drop every
  mention of `draft` and of `archived` as a product status.

### Key Entities

- **Product (scoped values)** — the product's global values plus the set of overrides per scope for status,
  publication window, audience, URL key, SEO, media roles / hidden flags, translated labels, minimum order
  quantity and returnable. Status is `active` / `inactive` at every scope; the archived state
  (`archivedAt`) is a separate, global field set and cleared only by Archive / Restore (FR-019).
- **Scope** — Global, Language, Channel, or Channel × language; valid only for the product's channels and
  their languages.
- **Override** — a value of one field at one scope; absent means inherit.
- **URL redirect** — an old URL key, held by one product, that permanently points at that product's
  current URL in the requesting (C, L). A redirect has a language (a former language or channel × language
  key), and then resolves only in that language, or has no language (a former global key), and then
  resolves in every language of every channel. Redirects never expire and never chain, and a current key
  always wins over a redirect with the same key (FR-071, FR-072).
- **Channel membership** — unchanged yes / no bridge; a precondition for every channel-scoped value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After deployment, for every channel and language, the set of products listed, searchable,
  reachable by URL (all existing URLs) and in the sitemap and feeds is identical to the set before
  deployment, except: products that are off and not archived — today's `draft` products, `inactive` after
  the migration (FR-110) — are no longer reachable by URL and answer not-found (FR-005, FR-010; D-1 moot,
  Session 2026-10-25); they are no longer addable to a basket — basket add honours FR-001 (FR-004), where today it checks no status at all
  (`research.md` R0 F1); the listing's name sort follows the effective name rather than the slug (FR-017);
  and existing per-language SEO overrides are served (FR-075, US8 #2).
- **SC-002**: An operator can take a product live in one market and offline in another in under one minute
  from the product editor, without touching other markets.
- **SC-003**: For any product, an operator can tell from one screen why it is or is not live in every
  (channel, language) pair, without opening other screens.
- **SC-004**: Storefront listing and search response times at the catalogue sizes of the performance targets
  do not regress by more than 10% with overrides present on 20% of products.
- **SC-005**: A publication-window start or end is reflected on the storefront within 5 minutes and in search
  within 15 minutes.
- **SC-006**: 100% of scoped writes (single and bulk) appear in the audit log with their scope, and a bulk
  change of 1 000 products can be undone in one action.
- **SC-007**: Zero products reachable at a (channel, language) where their effective status is off, measured
  by automated tests across all FR-004 consumers.
- **SC-008**: Zero languages in which one URL key — current or redirecting — belongs to two products, and
  therefore zero (channel, language) pairs in which two products resolve to the same key, after any sequence
  of key edits, channel-membership changes and channel-language changes (FR-070, FR-072), measured by
  automated tests that exercise each of those changes.
- **SC-009** *(added in Session 2026-10-25)*: After deployment, zero stored status values — global or at
  any scope — other than `active` / `inactive`; zero products whose page answer ("gone", not-found or
  served) at any (channel, language) differs from before deployment other than by the SC-001 exceptions,
  and zero formerly `inactive` products without an `archivedAt` (FR-110, O-4); zero status writes that set or clear `archivedAt`; and 100% of Archive / Restore
  actions, single and bulk, appear in the audit log — each measured by automated tests.

## Assumptions

- **A-1**: #384 lands first; the storefront already resolves name / description overrides per (C, L) on
  the surfaces #384 covers, including search-result card names. The places #384 leaves on the baseline (see
  *Current state*) are this spec's FR-017.
- **A-2**: The language-only scope for fields that already have one (name, description, language-scoped
  attributes) is the existing per-language baseline; no new storage is implied by this spec.
- **A-3**: A buyer's language at (C, L) is the request language resolved today; an unsupported language
  falls back to the channel's default language before any scope resolution.
- **A-4**: The publication window does not change the stored status; it is a separate condition.
- **A-5**: Prices, promotions and warehouses are already channel-aware and are untouched.
- **A-6**: The completeness gate (US6) applies to operator actions in the admin, not to imports or PIM
  synchronisation (confirmed in clarify 2026-10-21).
- **A-7**: Scoped values are edited by operators with the existing product-edit permission (FR-084).
- **A-8**: Out-of-audience and out-of-channel answers keep their current not-found semantics (#227).
- **A-9**: Owner decision 3 (no warning about overrides on a global change) is extended from status to
  every scoped field — confirmed in clarify 2026-10-21 round 2 (FR-013).
- **A-10**: Publication-window bounds are stored as absolute instants (UTC) and converted to and from the
  operator's local time only in the admin (clarify 2026-10-21 round 3, C3; FR-023).
- **A-11**: FR-093 refuses only the key, not the record: a key is a single field of the record, and
  whether the other fields of a record with a refused key are applied follows each run's existing rules
  (the catalogue CSV import rejects a whole file on any row error before writing,
  `packages/modules/catalog/src/backend/services/catalog-bulk-import.service.ts:155-159`; connectors report
  through the shared run / issue vocabulary of `pim_connector`, `packages/modules/pim_connector/src/manifest.ts:14`). A product **created** by a connector gets its global key the way a product
  created today does — derived and suffixed until free (`allocateUniqueSlug`,
  `packages/modules/catalog/src/backend/services/catalog-admin.service.ts:1075`) — with "free" now meaning
  not a current or redirecting key of another product in any language (FR-070, FR-072); so a created
  product never lacks a global key (FR-011). The CSV import creates no products today (same file, `:152-154`).

### Deferred to `/speckit.clarify` (not decided; interim reading only)

No deferred item remains. D-2, D-4 and D-6 were decided on 2026-10-21 in round 1, D-3 became moot and D-5
was removed from the feature in round 2 (see *Clarifications*). **D-1** (whether a never-published `draft`
product stays reachable by direct link as a preview) became **moot** on 2026-10-25: `draft` no longer
exists, so no status distinguishes a never-published product from one switched off later; both are
`inactive` and answer not-found (FR-005, FR-010; Session 2026-10-25).

### Resolved after Session 2026-10-25

The consequences of the Q1 decision previously listed here as O-1 to O-5, and the confirmations collected
as O-6, were answered by the owner on 2026-10-25 (all option A) and are recorded in *Clarifications*, Session
2026-10-25. No open question remains.

## Out of Scope

- #384 (storefront honouring existing overrides) — separate fix, a dependency.
- Per-variant galleries (#377), beyond not contradicting them; channel-specific image sets (the image set
  stays global, FR-076).
- Bulk edit of scoped fields other than status — publication window, audience, minimum order quantity,
  returnable — a follow-up (FR-050).
- A Magento-style **display visibility** (not visible individually / catalog / search / catalog and search)
  — dropped in clarify round 2; the audience visibility is the only visibility concept. A follow-up may add
  "hide from listing and search but keep selling by direct link or quick order" if a need appears.
- **Price display mode per channel** (a product × channel step in the net / gross display-mode chain) —
  removed in clarify round 2 (D-5); a possible future issue. The existing chain is unchanged.
- Making catalogue bulk writes other than those of US5 audited (#241).
- Per-channel prices, promotions, warehouses, stock, SKU, product type or structure.
- A Magento-style "store view" entity; the two existing axes are kept.
- Per-deployment overlays for any of this (Constitution XV).
- A language prefix in the storefront product path (`/en/p/<key>`) — issue #396 (clarify 2026-10-22, Q-B);
  this feature emits `?lang=<L>` instead (FR-071).
- A link from a scope-overview cell to the field it marks; the overview names the field and its source,
  and the field is edited on the editor's own tab (Session 2026-10-27, L7) — a possible follow-up.
- A generic one-click undo of a single Command; single scoped writes are restored from their audit
  before-state (FR-081; clarify 2026-10-22, Q-D) — a possible future issue.

## Constitution constraints

- **I / XVII** — catalogue owns the scoped product data; `seo`, `search`, `product_feeds`, `quick_order`,
  `comparisons`, `cms`, `carts`, `quote_requests` consume effective availability through catalogue's exported surface; each
  consumer's surface disappears when its module is off, the data persists.
- **XI** — new data platform-global; audience evaluated at read time; out-of-scope answers indistinguishable
  from not-found.
- **XII** — every scoped read resolves a concrete channel and fails closed; membership via the sanctioned
  service only; cross-channel tests for every FR-004 consumer.
- **XIII** — every scoped write and bulk write is a Command, audited per scope, and so are Archive and
  Restore (FR-019), single and bulk; bulk writes are reversible
  with the bulk-operation undo, single writes are restorable from the audit before-state (FR-081).
- **VII** — localised URLs, permanent redirects, correct alternate-language links.
- **XVI** — the scope overview and bulk action are reachable from the command palette with the product
  editor and product list.
