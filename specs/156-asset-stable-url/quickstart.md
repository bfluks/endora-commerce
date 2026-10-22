# Quickstart: Stable asset URLs — the owner's manual test

Local stack as usual (`pnpm run dev:infra`, `pnpm run setup` — or `migration:up` on an existing
dev database — then backend, admin and storefront `dev`).

**From the feature's worktree** (tasks.md T000a): it has no `.env` files of its own until they are
copied from the primary checkout — `.env`, `backend/.env`, `admin/.env` and `storefront/.env`, from
the directory holding both checkouts:
`for f in .env backend/.env admin/.env storefront/.env; do cp -p "endora-commerce/$f" "endora-commerce-wt-156/$f"; done`.
Do **not** run `pnpm run dev:infra` there: the copied root `.env` points at the services the primary
checkout already runs. Run `migration:up` (not `pnpm run setup`, which recreates the database the other
checkout is using) and stop the primary checkout's `dev` first — both bind the same ports. Sign in to the admin as an operator
holding `assets.write`. `<api>` is the backend's public origin (`PUBLIC_API_BASE_URL`).

## 1. Replace a file (US1)

1. **Assets library** → upload `certificate.pdf` (public). Attach it to a product
   (**Products → a product → Attachments**) and embed it in a CMS page as a link.
2. Open the asset's drawer. Copy the **Shareable link** — `<api>/assets/file/<id>` (no `?v=`).
3. `curl -sI <api>/assets/file/<id>` → `200`, `Cache-Control: public, no-cache`, an `ETag`.
4. **Replace file** → choose `certificate-2026.pdf` → the dialog names both files → **Replace**.
5. The drawer shows the new filename and size; the id, folder, label and visibility are unchanged.
6. `curl -s <api>/assets/file/<id> | md5` equals the new file's checksum; repeat with
   `-H 'If-None-Match: <old ETag>'` → `200` (not `304`).
7. Open the product on the storefront and the CMS page: the attachment link and the embed point at
   `…/assets/file/<id>?v=<new>` and download the new PDF.
8. Try to replace it with a `.docx` → refused: *"This asset holds a PDF and can only be replaced
   with a PDF…"*. Replace an image asset's `.jpg` with a `.png` → accepted; the shareable link is
   unchanged.

## 2. Permalink (US2)

1. In the drawer type `docs/iso-9001.pdf` → **Save permalink**. The shareable link becomes
   `<api>/assets/file/docs/iso-9001.pdf`; **Copy** says *Copied*.
2. Open it in a private browser window → the current PDF. Replace the file again → the same link
   serves the newest file.
3. On a second asset try `DOCS/ISO-9001.pdf` → *"already used by another asset"*. Try
   `../x`, `a//b`, and a UUID → each refused with its own sentence. Switch the admin to Polish and
   repeat one → Polish sentence.
4. Change the permalink to `docs/iso.pdf` → a warning dialog first; afterwards the old link answers
   `404`. On the second asset type `docs/iso-9001.pdf` → a dialog says it was used before by another
   file; **Use it anyway** → saved, and the audit log's `asset.permalink_set` entry records the reuse.
   Then change the first asset's permalink to `docs/a.pdf` and back to `docs/iso.pdf` → no reuse
   dialog (it takes back its own former name), and its audit entry has no reuse record.
5. Make the asset **private** → the permalink answers `404` in the private window, exactly as an
   unused name does, while `<api>/assets/file/<id>` answers `403`; the drawer says the link is not
   publicly reachable. Soft-delete it while private → `<api>/assets/file/<id>` still answers `403`
   without a signature, and `410` with the signed URL from the drawer. Restore it and make it public
   again.
6. Soft-delete the asset → the dialog names the permalink; the link answers `410`. Restore it →
   `200` again.

## 3. Previous version (US3)

1. The drawer's **Previous version** shows the file replaced in §2, when, by whom, and until when it
   can be restored.
2. **Restore previous version** → confirm → the file URL serves the previous bytes; the section now
   shows the file you just demoted. Restore again → back. In a second tab replace the file, then click
   **Restore** in the first (stale) tab → refused with *"Someone else changed this asset's file…"*; the
   file and the previous version are unchanged.
3. Replace once more → only one previous version is shown.

## 4. Caching and the stale marker

1. Note an embed URL `…?v=<a>` from §1.7. After a replace, `curl -sI '<api>/assets/file/<id>?v=<a>'`
   → `302`, `Location: …?v=<b>`, `Cache-Control: no-store`; `curl -sI '<api>/assets/file/<id>?v=<b>'`
   → `200`, `Cache-Control: public, max-age=31536000, immutable`.
2. `curl -sI '<api>/assets/file/<id>?v=<a>&token=x&exp=1&foo=bar'` → the `Location` carries `v` only
   (and `download=1` when asked), never `token`, `exp` or `foo`. Every answer carries
   `X-Content-Type-Options: nosniff`; the `302`, a `404` and a `410` carry `Cache-Control: no-store`.

## 5. Retention and purge

The effective retention is at least one day, so rows are made due by back-dating them in the dev
database rather than with a zero setting. The worker process (`BACKEND_ROLE=worker`) runs the sweep
hourly; trigger the `assets_library.retention.sweep` scheduler from the BullMQ dashboard when one is
available, or wait for the tick.

1. Replace a file (§1) and soft-delete another asset and a folder holding assets, with the retention
   at `30`: the delete answer's `purgeAfterAt` is 30 days on. Set the retention to `7` and delete the
   same asset again: the answer now says 7 days on (the period is read now). Set `0`: it says 1 day.
   Set `7` again.
2. Back-date them: `update assets set previous_replaced_at = now() - interval '8 days' where id = '<replaced id>';`
   and `update assets set deleted_at = now() - interval '8 days' where deleted_at is not null and id in (…);`.
   After the next tick the previous version disappears from the drawer, the soft-deleted assets
   disappear from **Show deleted**, their file URLs and permalinks answer `404`, and the worker log has
   one `assets_library.retention.sweep` line with the counts and `retentionDays: 7`.
3. Soft-delete an asset, restore it, back-date nothing, and let a tick pass: it stays (FR-033).
4. Set the retention back to `30`.

## 6. Cloud backends (manual — not run in CI)

S3 and GCS are covered by unit tests over mocked SDKs (research R-19). These checks need a real bucket
and an operator with credentials; they are the manual half of SC-002, FR-005 and FR-012a:

1. Switch the active adapter to S3, upload an image, note its bucket URL, replace it, and confirm the
   same bucket URL serves the new image with `Cache-Control: no-cache` and
   `Content-Disposition: inline; …` (FR-005, SC-002).
2. `<bucket URL>?v=<the old marker>` serves the new image too (FR-012a, cloud half).
3. Upload an SVG: its object carries `Content-Disposition: attachment; …` (owner ruling P4).
4. Make the asset private: the bucket URL answers `403`; the previous object
   (`<id>.prev-<random>.<ext>`) answers `403` at the bucket at all times; `<api>/assets/file/<id>`
   answers `403` without a valid signature and `302` to a time-limited URL with one.
5. Repeat 1 and 4 on GCS.
