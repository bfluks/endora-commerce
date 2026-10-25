# Quickstart: validating product data scopes by hand

For the reviewer and the human tester. The automated proof of each step is named in `tasks.md`.

## 0. Prepare

```bash
pnpm install --frozen-lockfile && pnpm run build:packages
pnpm run dev:infra && pnpm run setup          # db:fresh + module:install --all
pnpm run dev
```

Create two sales channels, **B2B** (languages `pl-PL`, `en-US`, `de-DE`, default `pl-PL`) and **B2C**
(`pl-PL`, `de-DE`, default `pl-PL`). Create product **P** (`active`, global slug `wiertarka`), a member of
both, with a Polish and an English name and **no German name**. Run one `search_reindex` per channel
(Bulk actions page) after deploying over an existing database (research R21).

## 1. US1 — status per channel and per channel × language

1. Product editor → *Scopes* → B2C: status **inactive**. Storefront B2C (any language): P is absent from
   the listing, search and `/p/wiertarka` answers not-found (not "gone" — `inactive` never archives). B2B
   still lists it. The status selectors offer `active` and `inactive` only.
2. B2C × `pl-PL`: status **active**. B2C in Polish lists P; B2C in German does not.
3. B2C: *Use inherited* on the channel row. B2C follows the global status again; the C×L row still wins
   in Polish.
4. Audit log: one entry per change naming the scope with before/after; re-applying the before-state restores
   it (`research.md` R29; owner Q-D → A: no single-write undo — the audit before-state is the restore path).
5. As a buyer of B2C in German, try to add P to a basket by id (API) → `404 PRODUCT_NOT_FOUND`; raise a quote
   request containing P → refused; as an operator create a quote request for a B2C customer → accepted with
   a warning naming P.

## 2. US2 — publication window

Set B2C window from *now + 2 min* to *now + 4 min* in local time. Before the start P is absent from B2C;
at the start it appears without any action; after the end it disappears; the stored status is unchanged.
Open the editor from a browser in another time zone: the same instant is shown in that zone.

## 3. US3 — audience per channel

B2B audience: *organization-restricted* to org X. Anonymous and org-Y buyers in B2B: not-found; in B2C:
visible. Add org W (not a B2B member) to the list → saved, warning names W.

## 4. US4 — overview

*Scope overview* shows B2B/B2C × languages: effective status and source per cell, overridden fields
marked at cell / channel row / language column, orphans after removing `de-DE` from B2C, *Reset to
inherited* per field. A `catalog:read`-only admin sees it read-only.

## 5. US5 — bulk

Product list → select products (incl. one not in B2C) → *Set status in scope* → B2C × `de-DE` → inactive.
Result: the non-member is skipped and reported; Bulk actions page shows the operation; *Undo* reverts it.

## 5a. Archive / Restore (FR-019, FR-053, FR-113)

- Editor → **Archive** P → confirm. Storefront: `/p/wiertarka` answers 410 in B2B and B2C wherever P was
  available; the editor still shows P's status as `active` at every scope. P has left the product list's
  default view and appears under *Archived*. Audit log: one `product.archive` entry with `archivedAt`
  before / after.
- Set P's global status to `inactive` and back to `active` → P stays archived (setting `active` never
  restores). **Restore** → P is back wherever its status allows, without any gate message even with the gate
  on **refuse** (§6).
- Archive again, then switch P off in B2C (C override `inactive`): B2C answers not-found, B2B "gone".
- Bulk: select several products → **Archive** → per-product result; *Undo* on the Bulk actions page brings
  them back; a product already archived is reported as unchanged.
- An API call with `status: 'draft'` or `status: 'archived'` (admin `PATCH …/products/:id`, the API-key
  upsert, a CSV import row) is refused with a validation error; a new or duplicated product starts
  `inactive`.

## 6. US6 — completeness gate

Settings → Catalog → *Completeness gate* = **refuse**. Enable P at B2C × `de-DE` → refused, naming the
missing German name. Switch to **warn** → saved with the warning. With a global key and no German key, the
URL key is not reported. Still on **refuse**, with P active everywhere and no German name: add `de-DE` to a
channel P belongs to → saved, no gate message (M3 → A); the scope overview's (channel, `de-DE`) cell lists
the missing name. Change only P's B2C publication window or audience → saved, no gate message.

## 7. US7 — URL keys

Give P the Polish key `wiertarka-udarowa` and English `impact-drill`; B2B × English override
`impact-drill-pro`. Then:
- `/p/wiertarka` in Polish → 308/301 to `/p/wiertarka-udarowa` (old global key, now redirect in pl).
- `/p/impact-drill` with `Accept-Language: pl` → not-found (K1).
- Give product Q the Polish key `wiertarka-udarowa` → refused naming P.
- Give Q the Polish key `wiertarka` (P's redirect) → confirmation naming P; on confirm P loses it.
- Turn `seo` off on `/platform/modules` → old keys answer not-found and the product editor shows no redirect
  list (a key clash with another product's redirect still asks for takeover confirmation naming it); turn it
  on → they redirect again and the list is back.

## 8. US8–US10

- SEO: set a B2B × Polish meta title and a Polish one; view source on both channels in Polish.
- Media: base image override for B2B; hide one image in B2B; Polish alt only → English page shows the
  asset's alt.
- Attachments hidden in B2C; packaging unit "karton"/"carton" in the basket per language; placed order
  keeps the name.
- MOQ 10 in B2B, 1 in B2C; returnable only in B2C → return offered only on B2C orders.

## 9. Deploy parity (SC-001)

On a copy of a production-like database: before/after deploy, the listed, searchable, sitemap and feed
sets per channel × language are identical, except products that are off and not archived — `inactive`
after the migration, formerly not `active` and not archived — which are no longer reachable by URL and no
longer addable to a basket. After the migration no product or scope row holds a status other than `active`
/ `inactive`; every product that was `inactive` before has an `archivedAt` and still answers 410 where it
did (SC-009, FR-110). Release note for operators: a product archived before this feature returns only
through **Restore**.
