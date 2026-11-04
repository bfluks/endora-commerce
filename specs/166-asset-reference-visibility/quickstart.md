# Quickstart: proving asset reference visibility

## Preconditions

```bash
pnpm run build:packages
pnpm run dev:infra:test            # Postgres, Redis, Meilisearch for integration tests
pnpm run setup                     # db:fresh, then module:install --all
```

**Fixture readers** (each integration file builds its own; nothing is shared):

| Reader | How it is built |
| --- | --- |
| **A** | An admin with `tasks:*`, `projects:*`, `crm:*` and `assets.*`. Creates the private Task and the draft, is a Member of Project P1 and reaches Organization O1. |
| **B** | An admin with `tasks:read/write`, `projects:read/write`, `crm:read/write` and `assets.read/write`, **without** `tasks:see_private` or `projects:see_all`. Not a Member of P1. Admin tenant scope restricted to Organization O2. |
| **S** | B's role plus `tasks:see_private`. |
| **W** | A role holding `*` (the Platform administrator). |
| **N** | An admin with `assets.read/write` only. |

## 1. The failing test that opens each story (Constitution III)

| Story | First failing test | What it proves |
| --- | --- | --- |
| Foundational | `packages/modules/assets_library/src/backend/services/reference-registry.test.ts` (new) | `findReferencesMany([x, y])` attributes each hit to its asset. An untagged descriptor is asked per asset. **Fails today** (research F-8). |
| Foundational | `packages/modules/assets_library/src/backend/services/asset-visibility.test.ts` (new) | Fake descriptors:<br>- the four caller classes;<br>- FR-001 a and b;<br>- rescue by an unrestricted reference;<br>- an absent owner hides and is never asked `visibleEntityIds`;<br>- the wildcard skips everything;<br>- `exclusionFor` asks each descriptor once. |
| Foundational | `packages/modules/{tasks,projects,crm}/src/backend/services/*-asset-references.test.ts` (new) | `assetIdsWithHiddenReferences()` is the exact complement of `visibleEntityIds` over seeded rows, including Tasks' rows with a NULL `context_id`. |
| Foundational | `packages/modules/assets_library/src/backend/routes.admin.guard.test.ts` (new) | Every admin route with an `:id` asset parameter carries `requireVisibleAsset`. |
| US1 | `backend/test/integration/assets_library/reference-visibility.test.ts` (new) | A's private Task holds file F. As B, F is absent from `GET /assets` (root folder, `q=` its name, `includeDeleted`) and from the picker's query. Every by-id route of `admin-api.md` §1 answers for F exactly as for a random uuid: status, `code`, `message`, body. Move-many skips F. The same for:<br>- A's draft (S does not see it either);<br>- a Task in Project P1's context (B is not a Member);<br>- a P1 attachment;<br>- an Opportunity of O1 (B reaches O2 only);<br>- N, who reads no Task, Project or Opportunity.<br>A, S (for the private Task) and W see F. |
| US1 (FR-006) | `backend/test/integration/{tasks,projects,crm}/attachments.test.ts` (extended) | As B, attaching F to B's own Task, Project or Opportunity is refused with the missing-file answer (422, same sentence). This holds when F is held by **another** module's hidden record, and when F is **public** (the refusal precedes the private-file check). |
| US2 | `reference-visibility.test.ts`, block *unrestricted kinds* | Product gallery, category, CMS, blog and megamenu images and an unused upload: B's and W's lists, `nextCursor` and details are equal. F used by A's private Task **and** a product is visible to B. F used by a Task B sees and one B does not is visible to B. |
| US3 | `reference-visibility.test.ts`, block *used by* | F used by a product and A's private Task: B's detail lists the product only; A's and W's list both. |
| US4 | `backend/test/integration/assets_library/folder-delete-references.test.ts` (new); `backend/test/contract/assets_library/admin-soft-delete.contract.test.ts` (extended) | As B, deleting F (product + private Task) gives a 409 naming one record, count 1. Deleting a hidden file gives 404. `deleteRecursively` of a folder holding a referenced file refuses (**fails today**, F-8). A folder holding only hidden files deletes under `cancel`, and the files are in the parent afterwards. The permalink count excludes hidden files. |
| US5 | `backend/test/integration/assets_library/reference-visibility-owner-off.test.ts` (new) | `withModuleOff('tasks')`: F is absent for B and S, present for W, and `DELETE` is refused for everyone, W included. Switched back on: B's, S's and W's lists equal the ones taken before. Repeated for `projects` and `crm`. |
| SC-004 | `backend/test/perf/assets_library/reference-visibility.perf.test.ts` (new, `PERF_RUN=true`) | 50 root assets × 3 references of different kinds, plus 2 000 hidden Task attachments. `GET /assets?limit=50` p95 for B < 1 000 ms and ≤ 1.2 × W's p95. Also records the missing-versus-hidden by-id latency. |

## 2. Manual walk (browser, demo shop)

1. As **A**, create a private Task and attach a new PDF, *contract.pdf*. Attach an existing
   product image, *chair.jpg*, to the same Task.
2. As **B**, open *Assets library*:
   - *contract.pdf* is not listed, and searching for "contract" finds nothing;
   - *chair.jpg* is listed, and its *Used by* shows the product only;
   - *Delete* on *chair.jpg* is disabled.
3. As **B**, call `GET /api/v1/admin/assets/<contract.pdf's id>` from the browser's devtools: the
   answer is the one a made-up id gets.
4. As **B**, open a product's gallery picker: *contract.pdf* is not offered.
5. As **A**, the library shows both files, and *chair.jpg*'s *Used by* lists the product and the
   Task.
6. Switch *Tasks* off on `/platform/modules`:
   - **B** still does not see *contract.pdf*;
   - the Platform administrator does, and cannot delete it.

   Switch *Tasks* back on: nothing changed for anyone.
7. As **B**, create a folder, move *chair.jpg* into it, then delete the folder with *delete
   everything*: refused, naming *chair.jpg*'s id.

## 3. Verification set before the merge request

```bash
pnpm run build:packages
pnpm -r run typecheck && pnpm -r run lint
pnpm --filter backend run test:unit:fast
pnpm --filter backend exec vitest run test/integration/assets_library test/contract/assets_library \
  test/integration/tasks test/integration/projects test/integration/crm \
  test/integration/cms test/integration/blog
pnpm --filter '!backend' run test          # contracts, the modules' co-located tests, admin-kit
PERF_RUN=true pnpm --filter backend exec vitest run test/perf/assets_library
pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches \
  && pnpm --filter backend run check:port-shape && pnpm --filter backend run check:entry-presence \
  && pnpm --filter backend run check:module-boundary && pnpm --filter backend run check:command-coverage
pnpm run check:naming && pnpm run check:language
pnpm --filter backend run manifests:generate && pnpm install --lockfile-only   # assets_library's dependencies changed
git status   # the regenerated package manifest is committed
```

Before finishing:
- Grep `backend/test/**` for `findReferencesMany` and `__assetId`; the repair may change an
  assertion that encoded the empty answer.
- Write the changesets listed in `plan.md`.
- Run the Polish docs workflow for the assets-library page.
