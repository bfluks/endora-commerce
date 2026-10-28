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
6. Storefront language on the product page (L-1): give P the German key `bohrmaschine` (URL keys panel, §7).
   With the `lang` cookie set to `pl`, open `/p/bohrmaschine?lang=de-DE` in B2B → the German page (`?lang`
   names an active language and beats the cookie). Open `/p/bohrmaschine?lang=xx` → `?lang` is ignored, the
   cookie decides (Polish) and the German key answers not-found. After both, the cookie still says `pl`:
   only the header language switcher rewrites it.

## 2. US2 — publication window

Set B2C window from *now + 2 min* to *now + 4 min* in local time. Before the start P is absent from B2C;
at the start it appears without any action; after the end it disappears; the stored status is unchanged.
Open the editor from a browser in another time zone: the same instant is shown in that zone.

## 3. US3 — audience per channel

B2B audience: *organization-restricted* to org X. Anonymous and org-Y buyers in B2B: not-found; in B2C:
visible. Add org W (not a B2B member) to the list → saved, warning names W.

## 4. US4 — overview

*Scope overview* shows B2B/B2C × languages: effective status and source per cell; a channel's own values in
its **Whole channel** column and a language's own values in the **Every channel** row; orphans after
removing `de-DE` from B2C. **Use inherited** is offered beside channel and channel × language overrides only
— not beside a product's own text in a language, which is edited on Details / Attributes (OV-1). Resetting a
text value and deleting an orphan each ask for confirmation in a dialog first (UX-1). A cell does not link
to its field (deferred, spec *Out of Scope*). A `catalog:read`-only admin sees it read-only.

## 5. US5 — bulk

Product list → select products (incl. one not in B2C) → **Bulk edit** → **Set status in one channel** →
sales channel **B2C**, language **de-DE** (or **All languages of the channel**) → **inactive**. The section
has no default value: nothing is set until a status is picked. Result: the non-member is skipped and
reported (each row names the product and links to its Scopes tab); Bulk actions page shows the operation;
*Undo* reverts it.

## 5a. Archive / Restore (FR-019, FR-053, FR-113–FR-116)

- Editor → **Archive** P → confirm. Storefront: `/p/wiertarka` shows the not-found page (HTTP 404; the backend's resolve answers
  `410 PRODUCT_ARCHIVED`, which the storefront renders as not-found — T155 finding B4) in B2B and B2C
  wherever P was available; the editor still shows P's status as `active` at every scope. P has left the product list's
  default view and appears under *Archived*. Audit log: one `product.archive` entry with `archivedAt`
  before / after.
- Set P's global status to `inactive` and back to `active` → P stays archived (setting `active` never
  restores). **Restore** → P is back wherever its status allows, without any gate message even with the gate
  on **refuse** (§6).
- Archive again, then switch P off in B2C (C override `inactive`): B2C answers not-found, B2B "gone" at the API (`410`) and the not-found page on the storefront.
- Bulk: select several products → **Archive** → per-product result; *Undo* on the Bulk actions page brings
  them back; a product already archived is reported as unchanged.
- Command palette (⌘K / CTRL+K): type "archived" or "archiwum" → **Archived products** opens
  `/catalog/products/archived`, the list on its Archived tab; a reload and the browser's Back return there
  (PAL-1). Clicking another tab does not change the address.
- On the Archived tab, select products → the bulk bar offers **Restore** (primary), **Bulk edit** and
  **Delete**; Restore asks for confirmation, then shows the per-product result (P-4). With the gate on
  **refuse** (§6) and a product lacking its German name, Restore succeeds and shows no gate message (I1).
- Admin assistant: "archive product P" → the plan shows a preview naming P → confirm → P is archived; the
  audit log has one `product.archive` entry with you as actor, and P's status is unchanged at every scope.
  "restore product P" brings it back the same way. "Switch P off" uses the status tool and never archives
  (P-1).
- Quote requests (P-3, RFQ-c): on *Create quote request*, the quick search lists an archived product
  disabled with the reason "archived"; the product browser has no Archived tab and its *All* leaves it out.
  Through the API, `POST` or `PATCH /api/v1/admin/quote-requests…` with an archived product answers
  `409 PRODUCT_ARCHIVED` with `details.productIds` and writes nothing; a buyer's create answers
  `404 PRODUCT_NOT_FOUND`, as for an absent id. Archive the product of an approved quote, then convert it →
  `409`, the basket untouched.
- A saved product-list view that held `status: 'draft'` (seed one through the API) opens on **All**, with a
  one-time note that the Draft status was removed (P-2).
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
- Turn `seo` off on `/platform/modules` → old (redirecting) keys answer not-found and the product editor
  shows no redirect list (a key clash with another product's redirect still asks for takeover confirmation
  naming it). P's other **current** keys still redirect: in B2B × English, `/p/impact-drill?lang=en-US`
  still answers 308/301 to `/p/impact-drill-pro?lang=en-US` (F-1). Turn `seo` on → the old keys redirect
  again and the list is back.

## 8. US8–US10

- SEO: in the product editor's SEO tab, **Edit SEO meta per channel →** opens the SEO screen at
  `/seo?entityType=product&entityId=<P's id>` with P selected (UX-4); its channel list offers only P's
  member channels (SEO-1). Set a B2B × Polish meta title and a Polish one; view source on both channels in
  Polish. With `seo` off the link is not shown.
- Media: base image override for B2B; hide one image in B2B; Polish alt only → English page shows the
  asset's alt. The hidden image does not reach a B2B product feed's file nor a comparison column viewed in
  B2B (MED-1). Hiding is presentation: the asset's stable URL still fetches the file.
- Comparisons (CMP-1, SEC-2): compare P and another product as a B2C buyer, share the link, then switch P
  off in B2C × Polish. The recipient (another B2C buyer, Polish) sees P's column as **(removed product)** —
  no name, SKU, price or image; you, the owner, still see P's details marked unavailable. Restrict P's B2C
  audience to an organization you are not in → you see the `(removed product)` column too
  (SEC-2; testable once S1's SEC-2 change is on the branch).
- Attachments hidden in B2C; packaging unit "karton"/"carton" in the basket per language; placed order
  keeps the name. A basket line added by a caller that names the channel itself (an operator surface,
  `CartWritePort.addItem` with `salesChannelId` = B2C) snapshots the unit's name in B2C's default language,
  Polish, beside the product name in the same language (N2; automated proof
  `backend/test/integration/carts/packaging-unit-name-snapshot.test.ts`).
- MOQ 10 in B2B, 1 in B2C; returnable only in B2C → return offered only on B2C orders. The admin order
  create screen and the admin quote-request create screen apply the minimum of the chosen channel.

## 9. Deploy parity (SC-001)

On a copy of a production-like database: before/after deploy, the listed, searchable, sitemap and feed
sets per channel × language are identical, except products that are off and not archived — `inactive`
after the migration, formerly not `active` and not archived — which are no longer reachable by URL and no
longer addable to a basket — and, as `plan.md` *Intended behaviour changes* 7 and 8 record, an archived
product's 410 now answers only a caller who could see it were it not archived (anyone else gets the absent
product's 404), and an archived product is refused at basket add. After the migration no product or scope row holds a status other than `active`
/ `inactive`; every product that was `inactive` before has an `archivedAt` and still answers 410 where it
did (SC-009, FR-110). Release note for operators: a product archived before this feature returns only
through **Restore**.
