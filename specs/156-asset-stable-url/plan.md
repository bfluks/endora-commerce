# Implementation Plan: Stable asset URLs — replace an asset's file in place, and readable permalinks

**Branch**: `feat/156-asset-stable-url` (from `origin/master`) | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/156-asset-stable-url/spec.md` (clarified 2026-10-16;
owner rulings P1–P5 of 2026-10-18; issue #293). Re-scoped on `origin/master` at `194698a9e`, which
already ships the soft-delete retention reading of both delete paths and the strict content policy of
the file route.

## Summary

An admin replaces an asset's file in place, gives an asset a readable permalink, and restores the one
kept previous file. Every internal reference follows a replace because they all hold the asset
**id**; every external reference follows it because the URLs that leave the platform no longer
change. The approach, with evidence and the rejected alternatives in [research.md](./research.md):

- **The storage key is the stable thing** (R-1). An asset's `storage_locator` never changes after
  upload and always holds the current bytes, on every backend; a replace stages the new file beside
  it and copies it over the key **under a row lock**, after copying the old bytes to a private
  previous key. Every copy onto the stable key names its ACL explicitly, compensation included.
  Staging and previous keys carry 128 random bits and never appear in a URL.
- **One previous version as nine columns on `assets`** (R-2); restore is the same copy-under-lock
  swap and must name both the current and the previous version (R-3).
- **The kind rule is an integrity guard** (R-5): the current kind is the stored kind (an admin MIME
  override plays no part), and an image or PDF asset is replaced only by bytes recognised as one (an
  SVG counting as an image); a `certificate` stays `certificate`; restore does no kind check.
- **A per-version token, `content_version`, is the version marker** (R-7), carried as `?v=`, added in
  **one** service-layer function and reaching every embed site through the members those sites
  already read (R-8). `catalog`, `cms`, the storefront and the feeds change no code.
- **Caching per the owner's split** (R-9): bare URL and permalink `public, no-cache` + ETag;
  `?v=current` immutable for a year; `?v=stale` a `no-store` `302` whose `Location` is built from the
  stored identifier. Every response carries `nosniff`; non-`200`/`304` answers carry a fixed policy
  and `no-store`. **On S3/GCS a bucket cannot redirect**, so a stale marker there serves the current
  file (R-10); objects there are `inline` only for displayable non-SVG media (owner ruling P4).
- **Permalinks** are a case-insensitively unique column, validated by one pure function in
  `contracts`, served by the existing file route widened to a wildcard (R-12). The private-signature
  check is preserved and extended to the permalink, where a private asset without a valid signature
  answers `404` exactly as a missing one; on both forms the check precedes the `410`, so by id a
  private asset without a valid signature answers `403` whether live or soft-deleted (R-11, owner
  ruling P2). Taking a permalink whose last holder was a different asset needs confirmation and is
  audited; an asset taking back its own former permalink needs neither (R-22, P5).
- **Built in a `git worktree`** beside the primary checkout (tasks.md T000a), after an upstream drift
  check against `origin/master` (T000); the Linux-only gates receive the committed tip as a
  `git bundle`, because a worktree's `.git` is a pointer file a container cannot follow (T085, T087).
- **The four new writes are Commands** (R-6, Constitution XIII). Replace stages outside the Command
  and locks inside it.
- **Retention: read at sweep time, and a purge actually runs** (R-13, owner rulings P1 and P3). Master
  reads the setting at deletion; this feature derives every due date and reported date from the
  deletion time plus the setting read **now**, with a one-day minimum, and schedules an hourly BullMQ
  sweep — at most 500 rows per pass per tick, one log line per tick, every claim re-checked under its row lock — that
  purges expired previous versions, soft-deleted assets and orphaned objects.
- **No object is lost track of** (R-21): a cleanup ledger records staging, previous and superseded
  objects before they exist or stop being referenced, and the sweep retries their deletion.
- **Admin**: every control in the existing detail drawer, built from the kit's `AssetUploader` (one
  new optional prop) and `ModalDialog` (R-15); a palette landing entry "Assets library" (R-16).

No new runtime dependency, no new setting, no new permission code. One module migration: eleven
columns on `assets` and two small module-owned tables (`asset_permalink_releases`,
`asset_object_cleanups`).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, `@fastify/multipart`, MikroORM (PostgreSQL), Zod, ioredis, BullMQ, `@aws-sdk/client-s3`, `@google-cloud/storage`, `file-type` (backend, all existing); React 19 + Vite through `@endora-commerce/admin-kit` (admin) — **no new runtime dependency**
**Storage**: PostgreSQL — eleven nullable/backfilled columns, one partial unique expression index, two partial indexes and one check constraint on `assets`; two new tables `asset_permalink_releases` and `asset_object_cleanups` (all owned by `assets_library`, platform-global); object storage — one random-named previous object per replaced asset and short-lived random-named staging objects; Redis — one BullMQ queue and Job Scheduler (`assets_library.retention.sweep`)
**Testing**: Vitest — co-located module unit tests (`packages/modules/assets_library/src/**`), `packages/contracts` unit tests, `backend/test/{contract,integration}` for server-bound tests (one file per invocation, `[PG]` form), `admin/test/{kit,modules/assets_library}` in `<StrictMode>`, one `storefront/test` guard; cloud behaviour that needs a real bucket is a manual quickstart step (R-19)
**Target Platform**: Linux server (backend), evergreen browsers (admin, storefront)
**Project Type**: web application — monorepo with `backend/`, `admin/`, `storefront/`, `packages/`
**Performance Goals**: a replace holds a row lock only for two server-side copies; serving adds no query (the row read the route already does); embed URLs on local are immutable for a year; an idle sweep tick is one indexed query and one log line, a busy one at most 500 per-row claims per pass
**Constraints**: FR-005 bare URL unchanged on every backend; private bytes never reachable without authorisation (SC-004); master's content policy kept on every path; no change to `catalog`, `cms`, `storefront` rendering or `product_feeds` code; proxies unchanged (`/assets/file/` already routed)
**Scale/Scope**: 1 migration (11 columns, 2 tables), 4 admin routes, 1 widened public route, 4 Commands, 7 error codes, 1 SPI method × 3 adapters, 1 worker + scheduler, 1 port edge (`adminUserReadPort`), 1 kit prop, ~40 bundle keys × 2 languages, 1 docs page × 2 languages; 13 phases, 102 tasks

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design and after the 2026-10-18 re-scope — same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | Replace, versions, permalinks, caching, retention, the cleanup ledger and the permalink history are `assets_library`'s alone: columns and tables in its migration, its entities, routes, Commands, error codes, bundle, docs. Other modules keep reading by id through `assetReadPort` / `assetsLibraryPort`; the marker reaches them through members they already read (R-8). One new edge, `adminUserReadPort`, resolved with `lazyPort` and declared in `dependencies` (R-14). Two host files (`backend/src/composition.ts`, `backend/test/helpers/test-server.ts`) change the e-mail logo closure they already own. |
| **II. API-first** | Pass | Schemas, the permalink validator and the seven error codes land in `packages/contracts` first (Phase 1), with tests. Additive except where stated: new response members, new routes; `AssetSummary.url` keeps its type and meaning ("a URL that serves this asset"), now cache-busting; the restore body is new, so its two required fields break no caller. |
| **III. TDD (NN)** | Pass | Every implementation task follows its RED task; tasks.md § *Requirement → test* maps every FR, SC, owner ruling and research finding, and names the manual cloud checks. |
| **IV. YAGNI, minimal dependencies** | Pass | No dependency, setting, event, cache or permission. The two tables each answer something no existing structure can: a name's history that must outlive the asset that held it (R-22 — an audit lookup is capped and unindexed, a column dies with the row) and objects with no row to hang on (R-21 — the alternative is a `list` method on three adapters). Previous version as columns, not a table (R-2); no previous-version download (FR-024); no MinIO service (R-19). |
| **V. TypeScript everywhere** | Pass | Zod at every new HTTP boundary; module-internal SPI typed. |
| **VI. Naming (NN)** | Pass | Routes kebab-case (`…/previous-version/restore`), tables and columns snake_case, JSON camelCase, Command actions `asset.<verb>`, queue `assets_library.retention.sweep`, migration class from `migration:new`. |
| **VII. SEO, performance** | Pass | Storefront images stay direct URLs (no added hop on local or cloud); local embeds stay immutable, now correctly so. |
| **VIII. English (NN)** | Pass | Code, specs and docs in English; Polish only in bundles and the Polish docs tree. |
| **IX. UI reuse** | Pass | `AssetUploader` (one optional prop), `ModalDialog`, `Input`, `Button`, `Alert`, the `FeedLinkCard` copy pattern; nothing new in the kit. |
| **X. Queue consumers** | Pass | The retention sweep is a BullMQ Job Scheduler with a separable consumer attached through `ctx.worker`, idle ticks cheap, a bounded batch, rows claimed `skip locked` and re-checked under the lock, idempotent (R-13). Co-location with the API in a single-process instance is the low-volume case the principle permits — noted here as it requires. |
| **XI. Tenant isolation (NN)** | Pass | `Asset` and both new entities are `@GlobalEntity()`; no organization path exists or is added. A private asset is served only with a valid platform HMAC signature, on every backend and through every URL form (R-11). |
| **XII. Sales-channel scoping (NN)** | N/A | Assets and permalinks are channel-independent (A-1). |
| **XIII. Command Bus auditing (NN)** | Pass | The four new writes are Commands (R-6); the confirmed reuse of a permalink is recorded in its Command's audit row; no hand-placed audit call is added; the sweep's passes carry the module's existing `command-coverage-ignore` reasoning. |
| **XIV. Entity-agnostic extensibility** | N/A | No "add a field" requirement. |
| **XV. Untouched core / overlay** | N/A | No deployment overlay involved. |
| **XVI. Command palette** | Pass | The plan adds the landing entry "Assets library" (`/assets-library`, `assets.read`), round 3 Q2, FR-028. |
| **XVII. Operator-toggleable modules (NN)** | Pass | `assets_library` is `nonDeactivatable`; the worker is attached through `ctx.worker`, which applies the presence gate regardless. The new `admin_users` edge points at a module that is itself non-deactivatable. |

**Cross-cutting checklist**

- **Admin permission manifest** — no new code; the four routes use `assets.write`, reads `assets.read`
  (FR-026). `permission-inventory.test.ts` re-run (Phase 10 verification and T090).
- **Command palette** — one landing action, "Assets library" (R-16, contracts/admin-surfaces.md §5).
- **i18n (pl + en)** — seven error codes with sentences (one with five reason tokens) and ~40 admin
  keys in the module's own flat bundle (contracts/admin-surfaces.md §4).
- **Settings module** — no new setting; `assets.soft_delete_retention_days` gains a one-day floor and
  read-at-sweep semantics. No secret.
- **Auditing** — Command Bus (R-6).
- **Tenant scoping** — platform-global, unchanged (XI above).
- **Redis cache invalidation** — nothing caches asset URLs; no event and no pub/sub (R-17).

## Owner rulings

Round 3 (2026-10-16) and P1–P5 (2026-10-18) are recorded in spec.md's clarifications; every task they
gate is unconditional.

- **Round 3 Q1 — soft-delete purge: yes.** Master has since shipped the setting's reading for both
  delete paths with the deadline fixed at deletion (and closed #322); the scheduled purge is this
  feature's (R-13, Phase 6). The pull request closes #293.
- **Round 3 Q2 — palette entry: yes** (R-16, Phase 10).
- **Round 3 Q3 — stale marker on S3/GCS serves the current file** (R-10).
- **P1 — retention read at sweep time.** Due = deletion + the setting's current value; every reported
  date derived the same way; master's fixed-at-deletion report is superseded (R-13, R-20).
- **P2 — private asset by permalink without a valid signature → `404`**, identical to a missing one;
  the signature check precedes the `410` on both forms, so by id a soft-deleted private asset answers
  `403` without a valid signature and `410` only with one (R-11; spec FR-013).
- **P3 — bounded sweep** (FR-035): at most 500 rows per pass per tick, oldest deletion first, one structured log line per tick (idle ones included) with the counts and the
  retention used, a minimum effective retention of one day, and `deleted_at`/due and not-referenced
  re-checked under the row lock (R-13).
- **P4 — cloud disposition from `servingPolicyFor(mime).inline`**, SVG and non-inline types stored as
  `attachment` (R-10).
- **P5 — a freed permalink is immediately reusable; taking one whose last holder was a different
  asset needs confirmation and an audit entry**, recorded in `asset_permalink_releases` (R-22; spec
  FR-037). An asset taking back its own former permalink needs neither.

## Spec amendments for analyze (product owner)

Already encoded on 2026-10-16 and still expected: FR-012a (cloud stale marker serves the current
file), FR-020, FR-024, FR-028, FR-029 – FR-034 with User Story 4 and SC-007, A-4 withdrawn.

Encoded by the product owner in spec.md on 2026-10-18 (owner rulings P1 – P5 and B1 – B3); nothing here
edits spec.md, and the list is what analyze should find there:

- **FR-006** — the current kind is the stored kind (an admin MIME override plays no part); the new
  kind is derived from the file's recognised content — an image or a PDF only when the bytes are
  recognised as one, an SVG counting as an image, anything else `other`; a stored `certificate` stays
  `certificate`; a restore performs no kind check (R-5). This supersedes the 2026-10-16 reading
  ("satisfied by construction" as the whole rule).
- **FR-013 / FR-018** — the signature check precedes the deleted state on both identifier forms
  (R-11, P2), reversing master's order:
  - **by id**, a private asset without a valid signature answers `403 ASSET_ACCESS_DENIED` whether
    live or soft-deleted; a soft-deleted private asset answers `410` only to a valid signature;
  - **by permalink**, a private asset without a valid signature answers `404` identical to a missing
    one, live or soft-deleted; `410` only to a valid signature.
- **FR-019** — a changed or removed permalink answers `404` at once and is immediately free (unchanged).
- **FR-037** — released permalinks are remembered; taking one whose **last holder was a different
  asset** needs confirmation and is audited (R-22, P5); an asset taking back its own former permalink
  needs no confirmation and its audit entry carries no reuse member (US2-9, US2-10).
- **FR-022 / FR-029 / FR-030 / FR-035** — the effective retention is at least one day (P3); master's
  "a value of 0 makes an asset eligible on the next sweep" no longer holds; the period is read at
  sweep time (P1).
- **FR-023** — a restore carries `expectedContentVersion` **and** `expectedPreviousContentVersion`;
  either one stale answers `409 ASSET_REPLACE_CONFLICT` and changes nothing (R-3, US3-5).
- **Current state** — the measurements of master's retention reading and content policy (research
  preamble) replace the description at `e6b1494f7`.

## Project Structure

### Documentation (this feature)

```text
specs/156-asset-stable-url/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R-1 … R-22
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-api.md                # schemas, validator, routes, Commands, error codes
│   ├── file-serving.md             # public route, decision table, headers, URL forms
│   ├── storage-and-retention.md    # SPI copy, replace sequence, ledger, settings, sweep
│   └── admin-surfaces.md           # drawer, kit prop, bundle keys, palette
└── tasks.md
```

### Source code (repository root)

```text
packages/contracts/src/
├── assets-library.ts               # schemas, validateAssetPermalink, isAssetIdShaped, AssetRecord members
├── assets-library.test.ts          # NEW
└── errors.ts                       # + 7 codes

packages/modules/assets_library/
├── src/manifest.ts                 # + errorCodes ×7, + dependencies 'admin_users', + actions (palette)
├── src/migrations/<stamp>_assets_library_asset_versions_permalinks.ts   # NEW (scaffolded)
├── src/backend/entities/asset.entity.ts                 # + 11 properties, helpers
├── src/backend/entities/asset-permalink-release.entity.ts   # NEW
├── src/backend/entities/asset-object-cleanup.entity.ts      # NEW
├── src/backend/index.ts                                 # commandBus, adminUserReadPort, sweep start, entities
├── src/backend/retention-sweep-is-scheduled.test.ts     # NEW (beside index.ts, never manifest.ts)
├── src/backend/plugin.ts, routes.admin.ts, routes.public.ts, routes.public.test.ts
├── src/backend/services/
│   ├── assets-library.service.ts   # replace, restore, permalink, resolveEmbedUrl, list q, lock on visibility
│   ├── asset-replace.ts            # NEW — the replace/restore sequence, replacementKind (R-1, R-3, R-5)
│   ├── object-cleanup-ledger.ts    # NEW — record/clear/sweep (R-21)
│   ├── asset-urls.ts               # NEW — versionedAssetUrl, permalink URL, disposition builders (R-8, R-12a)
│   ├── file-response.ts            # NEW — decideFileResponse (R-9 – R-11)
│   ├── upload-pipeline.ts          # stage() extracted, mimeToKind exported
│   ├── asset-read-port.ts          # storageUrl versioned, purgeAfterAt derived, resolvePublicUrls versioned
│   ├── soft-delete-retention.test.ts   # superseded cases updated (R-20)
│   └── storage/{storage-adapter,local-fs-adapter,s3-adapter,gcs-adapter,locator,settings-view}.ts
├── src/backend/jobs/hard-delete-asset.job.ts            # read-at-sweep predicate, lock, re-checks, previous object
├── src/backend/jobs/purge-previous-versions.job.ts      # NEW
├── src/backend/workers/retention-sweep-worker.ts         # NEW
├── src/admin/api/assets-library-client.ts, components/AssetDetailDrawer.tsx, index.ts
├── i18n/{en,pl}.json
└── docs/assets-library/index.md

packages/admin-kit/src/components/asset-picker/AssetUploader.tsx   # + upload, accept props
backend/src/composition.ts, backend/test/helpers/test-server.ts     # e-mail logo → resolveEmbedUrl
backend/test/fixtures/error-code-routing/reference-ledgers.ts       # + 7 minted codes
backend/test/fixtures/openapi-baseline.json                         # regenerated
backend/test/{contract,integration}/assets_library/*                # new and updated
docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/assets-library/index.md (+ translation cache)
.changeset/156-*.md
```

Generated artefacts committed with their inputs: `backend/src/db/migrations-registry.generated.ts`
(`composer:generate`), the package manifest and lockfile if `manifests:generate` moves them, the
OpenAPI baseline, the module reference page.

## Phases (tasks.md)

| # | Phase | Tag | Tasks |
| --- | --- | --- | --- |
| 1 | Upstream drift check, worktree set-up, contracts — permalink rule, request shapes, seven error codes | [backend] | T000, T000a, T001 – T004 (6) |
| 2 | Migration, entities, new summary/record members | [backend] | T005 – T012, T007a, T014 (10) |
| 3 | Storage SPI `copy`, random sibling keys, object metadata on three adapters | [backend] | T015 – T022 (8) |
| 4 | Replace (US1): staging, kind guard, ledger, Command, lock, route | [backend] | T023 – T031, T026a, T028a (11) |
| 5 | Previous version and restore (US3); retention floor; `admin_users` edge | [backend] | T032 – T040 (9) |
| 6 | Retention sweep — read at sweep, bounded, re-checked; orphans | [backend] | T041 – T048, T041a, T042a (10) |
| 7 | Permalink management (US2, admin API), previously used names | [backend] | T049 – T053, T050a, T051a (7) |
| 8 | The file route — permalinks, caching, headers, private by form | [backend] | T054 – T060, T055a (8) |
| 9 | The version marker at every embed site | [backend] [storefront] | T061 – T068 (8) |
| 10 | Admin drawer, kit uploader prop, palette | [admin UI] | T069 – T077 (9) |
| 11 | Documentation en + pl | [docs] | T078 – T081 (4) |
| 12 | CI gate, part 1 — build, quality, static, release intent | [gate] | T082 – T086 (5) |
| 13 | CI gate, part 2 — Linux suites, Postgres suites, pack, boot, docs, DCO | [gate] | T087 – T093 (7) |

Phase 4 carries eleven tasks: the two suffixed RED tests (the inactive-backend replace and the
visibility lock) belong with the replace they pin, and splitting the phase would separate a RED from
the implementation that turns it green.

## Complexity Tracking

No entry. No new runtime dependency and no new module. The two new tables are justified in the
Constitution Check (IV) and research R-21/R-22; the one structural addition (a BullMQ consumer) is
required by Constitution X for a periodic job and copies an existing shape.

## Risks

- **Compensation can fail** (R-1): a crash or a storage error between the copy onto the stable key and
  the compensating copy leaves new bytes under the old row. Logged at `error` with both locators; the
  window is one transaction; the ledger keeps the objects findable.
- **The first sweeps** purge historical soft-deleted assets on every instance (FR-034), 500 per hour.
  Called out in the changeset and the documentation, with how to keep them.
- **Master's just-shipped retention semantics change again** (P1, P3): a repeated `DELETE` now reports
  the current period, and `0` means one day. The changeset's *Behaviour change* paragraph says so.
- **Pre-feature immutable caches** of bare local URLs cannot be recalled (R-9); stated in the docs.
- **Cloud behaviour** (R-10, R-19) relies on S3/GCS ignoring an unknown query parameter and on the ACL
  a copy names; verified by the quickstart's manual cloud step, not by CI.
- **Record sweep** — `AssetSummary`/`AssetDetail`/`AssetRecord` gain required members; every hand-built
  fake in other packages' tests must gain them (T012, T035).
- **Migration order** — the new `admin_users` edge moves `assets_library`'s *new* migration after
  `admin_users`' in the computed order; the frozen prefix is untouched (`module-migrations.md` item 3).
  `module-graph.test.ts` and `fk-dependency-drift.test.ts` (`test/unit/db`) are in Phase 5's
  verification.
- **Signature values stay out of logs** — no code this feature adds writes a `token`, an `exp` or any
  other signature value to a log line: the file route logs the status and the identifier form, the
  sweep logs counts and the retention used. The platform's HTTP layer owns request-line logging for
  every route; a platform-wide redaction there is a follow-up outside this feature (R-17).
