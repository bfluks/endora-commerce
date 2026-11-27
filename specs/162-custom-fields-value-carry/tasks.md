# Tasks: Custom-field value carry-over (`specs/162-custom-fields-value-carry/`)

**Input**: [spec.md](./spec.md) (clarified 2026-10-16; owner rulings C4 (a), C5 (c); issue #287),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/carry-api.md](./contracts/carry-api.md),
[contracts/admin-surfaces.md](./contracts/admin-surfaces.md), [quickstart.md](./quickstart.md).

**Organisation**: ten phases, **one builder spawn each**, each ≤ 10 tasks and **independently
committable** on `feat/162-custom-fields-value-carry`, built in its own `git worktree` (T000a;
`git commit -s`, English conventional message, no AI trailer). `162` is the number this directory
carries once it enters the branch — the first free number on `origin/master` above the floor
(T000); until then the directory and every `162` below are placeholders. Each phase ends
with a **Verification** block: one command per line, run serially, in order, **only the phase's
new or changed tests, the derived-artefact tests whose input the phase changed, and its `[PG]`
files** — the heavy suites run on the fork's CI in Phase 10 (standing rule 13). Phases are marked
**[backend]**, **[admin UI]**, **[docs]** or **[gate]**; admin UI phases may go to
`endora-commerce-designer`.

**Start condition** (T000): `feat/155-catalog-order-constraints` **and** the filters feature
(`specs/157-custom-fields-list-filters/`) have merged to `origin/master`. This plan reads
`origin/master` at `3d9ca98cd` plus feat/155 at `637c6a3a1`; every placement anchor is cited by
**symbol** because feat/155 rewrites that region.

**Owner questions** Q1–Q5 (plan.md) are answered by owner ruling 2026-10-19, each confirming the
planned recommendation (spec.md § Clarifications, Session 2026-10-19); tasks below implement the
rulings.

## Format

`- [ ] T### [P?] [US?] Description — path(s)`

- **[P]** — may be written in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[US1] [US2] [US3] [US4]** — the story served; none = shared.
- **RED** — the deliverable is a failing test. Run it and see it fail **for the reason named**
  before starting the task that turns it green (Constitution III).

## Standing rules for every task

1. **Rebuild what you edit.** Tests read each package's `dist`; `tsc` reads sources. After editing
   anything under `packages/`, run `pnpm --filter <package> run build` before a test that imports
   it (`@endora-commerce/contracts`, `@endora-commerce/mod-custom-fields`,
   `@endora-commerce/mod-orders`, `@endora-commerce/mod-quote-requests`, `@endora-commerce/mod-crm`).
   Import entities in backend test helpers from `backend/test/helpers/package-entities.ts`, never
   from a module's `src` (a second copy of an entity class).
2. **Admin component tests render inside `<StrictMode>`** — wrap the element passed to
   `renderWithI18n` (`admin/test/helpers/render-with-i18n.tsx` does not add it). Set an "alive" flag
   in the effect body and clear it in cleanup; mark an action done only once its response arrived.
3. **Never put a test next to a module's `src/manifest.ts`** — `manifests:check` rejects it. Module
   unit tests go under `src/backend/` beside their subject; admin tests under `admin/test/`;
   server-bound tests under `backend/test/{contract,integration}/`.
4. **Paths in `pnpm --filter backend …` commands resolve from `backend/`.** `check:*` scripts are
   `backend` scripts.
5. **Postgres-backed tests run one file per invocation**, from `backend/`, with the services
   environment **derived from the root `.env`, never hard-coded** — this repository is built on two
   machines whose published ports differ, both recorded in `.env` as `POSTGRES_PORT`, `REDIS_PORT`,
   `MEILISEARCH_PORT`. Nothing is exported (shells are reset between commands), so every
   server-bound command is written out in full in the **`[PG]` line form**:

   ```bash
   (cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run <one file>)
   ```

   It reads only those seven keys and needs the root `.env` present — T000a copies it into the
   worktree. A module unit test needs no services:
   `pnpm --filter <package> exec vitest run <path under src/>`; a backend unit test:
   `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <file>`.
6. **Fixtures are per run.** Every definition key a server-bound test creates is
   `` `cfc_${randomUUID().slice(0, 8)}_<name>` ``; every record title, note or mark carries the same
   suffix; assertions check membership by id, never a list's length. Definitions a test creates are
   deleted in `afterAll`. Buyers placing orders are assigned to the store they shop on (the
   sales-channel access rule on `origin/master` since feature 154 — reuse
   `backend/test/helpers/sales-channel-access.ts` / the seeded buyers, as current placement tests do).
7. **No permanent shared-state mutation.** A test that changes `crm.auto_create_from_orders`,
   `crm.auto_create_from_quote_requests` or a module's activation reads the stored value first and
   writes it back in `afterAll`. Extra admins get **their own** stub session ids in
   `backend/test/helpers/test-actors.ts` (`ADMIN_COOKIES`); their roles/users are created by the
   test file itself.
8. **A regenerated artefact is committed with its input** — `composer:generate` (migrations
   registry, module reference page, docs sidebar), `manifests:generate` + `pnpm install --lockfile-only`
   (package manifests, lockfile).
9. **A new error code lands in one commit with all four of its places**: `ERROR_CODES`, the
   `MINTED_ERROR_CODES` ledger, the owning manifest's `errorCodes` (with its tokens), and the
   sentences in both bundles.
10. **Deleting or moving a file?** `grep -rn` its name across `backend/test`, `admin/test`, `docs/`
    and `backend/scripts/ledgers` in the same commit (`AGENTS.md`, traps); ask what is **derived**
    from its location.
11. **Public repository**: English only in code, tests, specs, docs and commits (Polish only in
    `pl.json` and the Polish docs tree); no client names, ticket ids or private file references;
    neutral examples (`order_source`, `fair`, `web`) per `specs/conventions/commercial-data.md`.
12. **Every deliberately changed existing assertion is named in its task.** A red in an existing
    test that no task names is a defect, not something to update.
13. **Remote-CI rule.** Locally: filtered `typecheck` / `lint` of each workspace the phase touched,
    the phase's own tests, the derived-artefact tests its inputs feed, its `[PG]` files and the
    `check:*` scripts named. **Never** a local `pnpm -r …`, a whole admin module directory, the
    whole `test:unit:fast`, `test:frontend`, `pack-gate`, `boot-gate` or docs build: those run on
    the fork's CI on the pushed tip (Phase 10). Any command containing a pipe starts with
    `set -o pipefail;`.

---

## Phase 1: Drift check, worktree, contracts, minted error code **[backend]**

**Goal**: confirm both prerequisites landed and nothing else moved, stand the worktree up, then
every shape of [contracts/carry-api.md](./contracts/carry-api.md) §1, §2, §4–§6 in
`@endora-commerce/contracts` (research R-1 – R-5, R-8, R-11).

- [x] T000 **Upstream drift check — stop and report on any finding.** From the primary checkout,
  with `N` the first free number (replace `162` below). Each line is self-contained:
  ```bash
  git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master
  set -o pipefail; N=162; specs_on_master="$(git ls-tree --name-only origin/master specs/)" && { printf '%s\n' "$specs_on_master" | grep -E "^specs/${N}-" && echo "STOP: ${N} is taken on origin/master" || echo "${N} is free on origin/master"; }
  set -o pipefail; git show origin/master:specs/pre-migration-history/README.md | grep -F '| Last pre-migration feature |'
  set -o pipefail; N=162; remote_heads="$(git ls-remote --heads origin)" && { printf '%s\n' "$remote_heads" | grep -E "refs/heads/[a-z]+/${N}-" && echo "STOP: a remote branch carries ${N}" || echo "no remote branch carries ${N}"; }
  git grep -n "QuoteRequestSourceAssessment" origin/master -- packages/modules/orders/src/backend/services/order-service.ts
  git grep -n -E "DefinitionBehaviourFields|listFilter" origin/master -- packages/modules/custom_fields/src packages/contracts/src/custom-fields.ts
  git grep -n -E "carryTo|carry_to|customFieldCarryPort|CustomFieldCarry|system_note|systemNote|custom-field-carry-skipped" origin/master -- packages backend/test admin/test
  git log --oneline 3d9ca98cd..origin/master -- packages/modules/custom_fields packages/contracts/src/custom-fields.ts packages/modules/orders/src/backend/services/order-service.ts packages/modules/orders/src/backend/services/order-comment-service.ts packages/modules/orders/src/backend/entities/order-comment.entity.ts packages/modules/orders/src/admin/pages/OrderDetail.tsx packages/modules/quote_requests/src/backend/services/quote-request-read-port.ts packages/modules/quote_requests/src/backend/entities/quote-request-event.entity.ts packages/modules/quote_requests/src/backend/services/customer-projection.ts packages/modules/quote_requests/src/backend/services/history packages/modules/crm/src/backend/services/opportunity-service.ts packages/modules/crm/src/backend/services/opportunity-link-service.ts packages/modules/crm/src/backend/services/opportunity-auto-create-service.ts packages/modules/crm/src/backend/services/opportunity-origin-link-service.ts packages/modules/crm/src/admin/components/OpportunityHistory.tsx packages/modules/crm/src/admin/lib/history-fields.ts packages/modules/crm/src/manifest.ts
  ```
  **Stop and report** (do not start T001) when: `${N}` is taken on `origin/master` or by a remote
  branch, or is not above the floor the README prints; the first `git grep` prints nothing
  (feat/155 has not merged — research R-7); the second prints nothing (the filters feature has not
  merged — R-14; unless the coordinator decided to stack on the filters branch, then run it against
  that branch); the third prints anything (another change already introduced a carry or a system
  note); or the `git log` prints a commit that is **not** feat/155's or the filters feature's —
  then the plan's anchors in the files it names must be re-derived first. For feat/155's and the
  filters feature's commits: re-read `#vouchedQuoteRequestSource` / `#assessQuoteRequestSource`,
  `DefinitionBehaviourFields`'s props and `snapshotDefinition`, and correct any task text that
  names them before T001. Then **renumber sweep**: in this directory and in every `.changeset/162-*`
  path below replace `162` with `${N}`.
  **Result** (2026-10-20): `origin/master` at `842b66eb9`; `N` = 158, free on `origin/master` and on every
  remote branch, above the README floor `136`. **Renumbered 2026-10-21**: `origin/master` then held
  `specs/158-crm-opportunity-inline-editing/` and `specs/159-quote-request-item-groups/`, and a remote
  branch `feat/160-pricing-model-v2`; `161` was free on both, so the directory, the changesets and every
  reference became `161` (the feature worktree's path is unchanged). `QuoteRequestSourceAssessment` present (feat/155 merged);
  `listFilter` present (the filters feature merged); no carry or system-note symbol on master. `git log`:
  feat/155's and the filters feature's commits, the `0.107.0` release (changelog and version only), and
  `91df8b536` (`specs/154-sales-channel-access/`, basket channel attribution), which rewrites part of
  `order-service.ts` placement — the Phase 3 anchors in `order-service.ts` are re-derived at the start
  of Phase 3.
- [x] T000a Stand the worktree up (`AGENTS.md` § *Commands*; never a symlinked `node_modules`),
  from the directory holding the primary checkout, then copy the four untracked `.env` files
  (`<feature-worktree>` is the feature worktree's directory name):
  ```bash
  git -C endora-commerce worktree add ../<feature-worktree> -b feat/162-custom-fields-value-carry origin/master
  bash <feature-worktree>/scripts/setup-worktree.sh
  for f in .env backend/.env admin/.env storefront/.env; do cp -p "endora-commerce/$f" "<feature-worktree>/$f" || echo "MISSING: $f"; done
  git -C <feature-worktree> check-ignore -v .env backend/.env admin/.env storefront/.env
  (cd <feature-worktree> && pnpm run build:packages)
  ```
  Every `MISSING:` line is a stop; `check-ignore` must name an ignore rule for each file. Do not
  start a second service stack from the worktree — the copied `.env` points at the primary
  checkout's services.
- [x] T001 [P] **RED** New `packages/contracts/src/custom-fields.carry.test.ts` (FR-001, FR-003,
  FR-011): `customFieldCarryToSchema` accepts `[]`, `['order']`, `['order', 'opportunity']`; refuses
  a duplicate, three entries and `'invoice'`; `createCustomFieldDefinitionSchema.parse` without
  `carryTo` yields `[]`; `updateCustomFieldDefinitionSchema.parse({ labelDefault: 'x' })` carries no
  `carryTo` key (absent = unchanged — the erase-on-patch rule the schema's comment states);
  `customFieldDefinitionSchema` requires `carryTo`; `customFieldEntityTypeInfoSchema` defaults
  `carryTargets` to `[]`. `assessCustomFieldCarry`: `target null` → exactly
  `[{ reason: 'target_missing' }]`; `text`/`text`, both `internal` → `[]`; `select`→`multiselect`,
  `number`→`text`, `date`→`text` → `value_type_mismatch` naming both types and **no**
  `options_missing`; `select` source `a,b,c` vs target `c,a` (labels differ) →
  `[{ reason: 'options_missing', missingOptionValues: ['b'] }]`; target with extra options → `[]`;
  `internal`→`customer` → `audience_mismatch`; `customer`→`internal`, `customer`→`customer` → `[]`;
  options missing **and** audience → both, in that order. (The port interfaces are type-only and
  are compile-checked by T002's typecheck.) Fails: none of these exports exist
- [x] T002 Implement contract §1 and §4.1/§4.2 in `packages/contracts/src/custom-fields.ts`:
  `CUSTOM_FIELD_CARRY_MAX_TARGETS`, `customFieldCarryToSchema`, `carryTo` on the definition /
  create (default `[]`) / update (optional, re-declared without the default beside `audience` and
  `config`) schemas and on `CustomFieldDefinitionRecord`, `carryTargets` on the entity-type info
  schema, `CustomFieldCarryParty`, `CustomFieldCarryIncompatibility`, `assessCustomFieldCarry`,
  `customFieldCarrySkipReasonSchema` + `CustomFieldCarrySkip`, `CustomFieldCarryPlan`,
  `CustomFieldCarryPort`, `CustomFieldCarryReceipt`, `CustomFieldCarryReceiverPort` (each port with
  the "Container name / Owner / Owner off" doc block the file's other ports carry); confirm
  `packages/contracts/src/index.ts` re-exports them; T001 green
- [x] T003 [P] **RED** Extend `packages/contracts/src/orders.test.ts` and
  `packages/contracts/src/quote-requests.test.ts` (FR-010, FR-010a): `orderCommentSystemNoteSchema`
  parses contract §5's example, refuses `skipped: []` and an unknown `reason`;
  `orderCommentSchema` accepts `systemNote: null`, an absent `systemNote` and a valid note;
  `rfqEventTypeSchema` accepts `'custom-field-carry-skipped'`. Fails: unknown schema / enum member
- [x] T004 Implement contract §5 (`orderCommentSystemNoteSchema`, `orderCommentSchema.systemNote`)
  in `packages/contracts/src/orders.ts` and contract §6 (`rfqEventTypeSchema` member, the history
  entry DTO variant) in `packages/contracts/src/quote-requests.ts`; T003 green
- [x] T005 Mint `CUSTOM_FIELD_CARRY_INCOMPATIBLE` in **one commit** (standing rule 9; contract §2):
  `ERROR_CODES` in `packages/contracts/src/errors.ts`; a `MINTED_ERROR_CODES` entry in
  `backend/test/fixtures/error-code-routing/reference-ledgers.ts` (`to: 'custom_fields'`, reason:
  the noun is the custom-field definition and its carry option, decided by `custom_fields`' own
  Command); `{ code: 'CUSTOM_FIELD_CARRY_INCOMPATIBLE', tokens: ['target_missing',
  'value_type_mismatch', 'options_missing', 'audience_mismatch', 'pair_unsupported',
  'target_unavailable'] }` in `packages/modules/custom_fields/src/manifest.ts` `errorCodes` (update
  the doc block's count); `errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE` and one `.<token>` sentence per
  token in `packages/modules/custom_fields/i18n/{en,pl}.json` (contract §2's English; Polish
  translated, placeholders identical)
- [x] T006 Record sweep for the new required members (contract §1.3):
  `set -o pipefail; grep -rln "listFilter:" packages backend/test admin/test --include=*.ts --include=*.tsx | grep -v /dist/`
  lists every hand-built `CustomFieldDefinitionRecord` / `CustomFieldDefinitionDto` /
  entity-type fake (the filters feature added `listFilter` to exactly these); add `carryTo: []` or
  `carryTargets: []` where the type now requires it; typecheck each package the grep touched. Then
  the changeset `.changeset/162-contracts-custom-field-carry.md` —
  `'@endora-commerce/contracts': minor`: `carryTo`, `carryTargets`, `assessCustomFieldCarry`, the
  carry and receiver port types, the order comment system note, the
  `custom-field-carry-skipped` history event type, `CUSTOM_FIELD_CARRY_INCOMPATIBLE`
  (`specs/conventions/release-intent.md`)

**Phase 1 result** (2026-10-20):
- T000a's `build:packages` had left most packages without `dist`; re-run before T001.
- T002: also exports `customFieldCarrySkipSchema` (the Zod twin of `CustomFieldCarrySkip`), which
  `orders.ts` and `quote-requests.ts` import for §5 / §6.
- T003/T004: §6's history entry is kind `custom_field_carry_skipped` with a nullable optional
  `customFieldCarry: { source, skipped }` member. **Changed existing assertion** (rule 12):
  `quote-requests.test.ts` "parses every entry kind" — `toHaveLength(13)` → `14`.
- T006 sweep, beyond the planned fakes (`custom-fields.test.ts`, `CustomFieldsPage.editor.test.tsx`,
  `CustomFieldsPage.list-filter.test.tsx`, `one-definitions-cache.test.ts`,
  `attribute-definition-read-port.test.ts`): `custom_fields` source had to compile too —
  `carryTo: []` in `toCustomFieldDefinitionRecord` and `carryTargets: []` in the entity-types route
  (Phase 1 placeholders, replaced by T011/T012); `CustomFieldsPage.tsx` sends `carryTo: []` on create
  and its pre-API fallback types offer `carryTargets: []`. To keep `catalog` untouched, the apply
  seam takes a new `CustomFieldDefinitionApplyCreateInput` (`ports/index.ts`; the create request
  with `carryTo` optional — a host-managed type offers no carry target) in
  `custom-field-definition-apply.ts` and `custom-field-definition.service.ts`.
- Verification: contracts 113/113 (3 files); typecheck contracts, mod-custom-fields, mod-catalog,
  mod-crm, mod-orders, mod-quote-requests, admin, backend — clean; lint contracts and
  mod-custom-fields clean; `check:error-translations` 0 violations; `check:bundle-pairing` 0
  findings; `error-code-routing-equality` 23/23; `[PG]` `error-code-ownership` 11/11;
  `manifests:generate` moved nothing.

**Verification**:
```bash
pnpm --filter @endora-commerce/contracts exec vitest run src/custom-fields.carry.test.ts src/orders.test.ts src/quote-requests.test.ts
pnpm --filter @endora-commerce/contracts run typecheck
pnpm --filter @endora-commerce/contracts run lint
pnpm --filter @endora-commerce/contracts run build
pnpm --filter @endora-commerce/mod-custom-fields run typecheck
pnpm --filter @endora-commerce/mod-catalog run typecheck
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-quote-requests run typecheck
pnpm --filter admin run typecheck
pnpm --filter backend run typecheck
pnpm --filter backend run check:error-translations
pnpm --filter backend run check:bundle-pairing
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/error-code-routing-equality.test.ts
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/_i18n/error-code-ownership.test.ts)
```

---

## Phase 2: `custom_fields` — `carryTo`, configuration refusal, retention, the carry port **[backend]**

**Goal**: US4 on the server (FR-001 – FR-006, FR-011, FR-019 server half) and the compute port every
conversion uses (FR-007, FR-009, FR-010, FR-014; research R-1 – R-5, R-12).

- [x] T007 [P] **RED** Extend the co-located registry test
  `packages/modules/custom_fields/src/backend/services/custom-field-registry.test.ts` (created by
  the filters feature): exactly `quote_request` → `['order', 'opportunity']`, `order` →
  `['opportunity']`, `opportunity` → `['quote_request', 'order']` carry `carryTargets`; no other
  entry does; no entry lists itself. Fails: no marker
- [x] T008 [P] [US4] **RED** New `backend/test/integration/custom_fields/carry-options.test.ts`
  (own stub sessions: a `custom_fields:write` admin and a `custom_fields:read`-only one, standing
  rule 7). Per-run fields (standing rule 6). Cases, each asserting status, `error.code` and
  `error.details.code`: create a QR `select` field with `carryTo: ['order']` and no Order field →
  422 `target_missing`; Order field of type `multiselect` → `value_type_mismatch` (details name
  both types); Order `text` → `value_type_mismatch` (no widening, US4-3a); Order `select` lacking
  one option → `options_missing` naming it; QR `internal` + Order `customer` → `audience_mismatch`
  (US4-3b); Order field with `carryTo: ['quote_request']` → `pair_unsupported`; a Category field
  with any `carryTo` → `pair_unsupported`; a compatible pair → 201 echoing `carryTo` and the
  `custom_fields.definition.updated` audit entry's `before`/`after` carrying it (FR-002); PATCH
  without `carryTo` leaves it; FR-004 — a record holding a value is byte-identical before and after
  the toggle; **drift**: with the carry on, removing a target option (no record holds it), changing
  the target's audience to `customer`, deleting the target, and then PATCHing the source's label
  → each 200 (FR-019) and the source's `carryTo` still `['order']`; re-sending `carryTo:
  ['order']` on the drifted source → 200 (not re-judged); the read-only admin's PATCH → 403. Fails:
  `carryTo` unknown
- [x] T009 [P] [US4] **RED** Extend `backend/test/integration/custom_fields/entity-owner-presence.test.ts`
  (FR-005, R-12) for both owned types and both presence axes: while `crm` is off,
  `GET …/entity-types` omits `opportunity` from every `carryTargets`; a QR definition with
  `carryTo: ['order', 'opportunity']` is served with `['order']`; PATCHing its label **and** its
  `carryTo: ['order']` keeps `['order', 'opportunity']` in the row (read through the database
  helper, not the route); turning on `opportunity` from an Order field → 422 `target_unavailable`;
  after `crm` returns the field is served with both again. The same for `quote_requests` off and an
  Opportunity field carrying to `quote_request`. Fails: entries served while off
- [x] T010 Scaffold `pnpm --filter backend run migration:new -- --module custom_fields --name definition_carry_to`;
  write `up`/`down` per data-model §1 (never pick a timestamp);
  `pnpm --filter backend run composer:generate`; commit the regenerated
  `backend/src/db/migrations-registry.generated.ts`
- [x] T011 [US4] Implement the attribute (data-model §1, research R-1, R-2, R-4, R-12):
  `carryTo` on `CustomFieldDefinition` (+ `[OptionalProps]`); `carryTargets` markers in
  `custom-field-registry.ts`; `carry_incompatible` in `CustomFieldDefinitionError` with a `details`
  member (`custom-field-definition-apply.ts`); `applyCreateDefinition` / `applyUpdateDefinition`
  persist `carryTo`; the judgement of **added** targets inside `createDefinitionCommand` /
  `updateDefinitionCommand` on the Command's `em` (load the same-key target with its options,
  `assessCustomFieldCarry`, owner presence through `effectiveState.isPresent`) — the definition
  service passes nothing new; `snapshotDefinition` + `carryTo`; `toCustomFieldDefinitionRecord` +
  `carryTo`; T007 green
- [x] T012 [US4] Implement serving and retention in `packages/modules/custom_fields/src/backend/routes.admin.ts`:
  `serialize` strips absent-owner targets from `carryTo`; `entity-types` serves filtered
  `carryTargets`; `toHttp` maps `carry_incompatible` to 422 `CUSTOM_FIELD_CARRY_INCOMPATIBLE` with
  `details` (contract §2); the PATCH path merges hidden entries back
  (`custom-field-definition.service.ts` `update`, before the Command); T008, T009 green
- [x] T013 [P] **RED** New co-located `packages/modules/custom_fields/src/backend/services/custom-field-carry.service.test.ts`
  (pure; a stub `DefinitionSource` and a stub presence function), contract §4.1 / research R-5:
  carry off on the source → nothing; source value empty (`''`, `null`, `[]`) → nothing; source key
  dormant (no live source definition) → nothing; target already holds a non-empty value → kept,
  not in `carried`, not in `skipped` (FR-009, SC-003); no target definition → `target_missing`;
  types differ → `value_type_mismatch`; `internal` → `customer` → `audience_mismatch`; select value
  not among target options → `value_invalid`; a multiselect whose values all exist on a target that
  lacks another **source** option → carried (per-value judgement); a number string `'12'` →
  coerced `12`; an unrelated **required** empty target field never appears anywhere; the key
  `constructor` carries like any other; either owner absent → `{ values: target, carried: [],
  skipped: [] }`; the returned `values` never loses a target key. Fails: no service
- [x] T014 Implement `packages/modules/custom_fields/src/backend/services/custom-field-carry.service.ts`
  (`CustomFieldCarryService implements CustomFieldCarryPort`, over the same `DefinitionSource`, the
  value service's `coerce` and `isEmpty` exported from `custom-field-value.service.ts` with no
  behaviour change, presence through `effectiveState.isPresent` on the registry's
  `ownerModuleId`); register it in `packages/modules/custom_fields/src/backend/index.ts` with
  `ctx.di.providePort<CustomFieldCarryPort>('customFieldCarryPort', …)` built from
  `customFieldServices.definitionService`; T013 green
- [x] T015 [P] **RED → green** New `backend/test/integration/custom_fields/carry-port.test.ts`: the
  port resolved from the composed test server (`h.container` / the harness's port accessor, as
  `one-definitions-cache.test.ts` reaches the module) answers a real QR → Order plan; a definition
  change (option added to the target) is visible to the next `plan` call without waiting for the
  TTL (the Command's invalidation, R-5); `check:port-shape` accepts the port. Then the changeset
  `.changeset/162-custom-fields-carry-options.md` — `'@endora-commerce/mod-custom-fields': minor`:
  the carry options on definitions and entity types, the configuration refusal
  (`CUSTOM_FIELD_CARRY_INCOMPATIBLE`), retention while an owner is off, `customFieldCarryPort`

**Phase 2 result** (2026-10-20):
- Migration `20261020T110920_custom_fields_definition_carry_to`, registered in the module's
  `src/migrations/index.ts` barrel and the regenerated registry.
- T011: `assertCarryTargetsAccepted` (in `custom-field-definition-apply.ts`) is the judgement both
  definition Commands call on their `em`; the apply seam itself refuses only a pair the registry
  does not offer (a host names none). `carry_incompatible` joins contracts'
  `CUSTOM_FIELD_DEFINITION_ERROR_CODES`; `CustomFieldDefinitionError.details` widened to carry the
  `missingOptionValueList` array.
- T014: the service takes an injectable presence function (default `effectiveState.isPresent`)
  and also requires the pair to be in the registry's `carryTargets`.
- **Changed existing assertions** (rule 12): `entity-owner-presence.test.ts` — the two
  entity-type rows of "offers every owned type …" gain `carryTargets`, and "omits the owned type
  while its owner is …" compares the other rows with the absent type removed from their
  `carryTargets` (FR-005). `definition-read-by-id.test.ts` (a Phase 1 sweep miss: untyped fake,
  red on the fork CI) gains `carryTo` on its row and expected record. `toCustomFieldDefinitionRecord`
  reads `definition.carryTo ?? []`, like its `label`/`config` neighbours, so the partial rows of
  `definition-apply-seam.test.ts` stay unchanged.
- Fork CI on the Phase 1 tip: red on `check:port-shape` (the T006 type had split the
  `customFieldDefinitionService` doc block from its interface — moved above it; and
  `customFieldCarryPort` documented before T014 registered it) and on `definition-read-by-id`.
  All three fixed here.
- **For Phase 5**: `check:port-shape` parses only singular `Container name: \`x\`` lines, so the
  receiver port's "Container names:" block is not yet a publication. T031/T032 must rewrite it
  as two `Container name:` lines in the commit that registers both names.
- Verification: mod-custom-fields 4 files 52/52 (whole package 93/93); `[PG]` carry-options 10/10,
  entity-owner-presence 27/27, carry-port 3/3, host-managed 6/6; backend unit (5 files) 280/280;
  typecheck + lint clean; `check:command-coverage --strict` 0 blocking; `check:port-shape`
  0 violations; `check:port-dependencies` 0; `check:module-boundary` 0; `overlay:check` clean.

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter @endora-commerce/mod-custom-fields exec vitest run src/backend/services/custom-field-registry.test.ts src/backend/services/custom-field-carry.service.test.ts src/backend/services/value-validation.test.ts src/backend/services/value-audience.test.ts
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/carry-options.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/entity-owner-presence.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/carry-port.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/custom_fields/host-managed.test.ts)
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/custom_fields/no-entity-capability-logic.test.ts test/unit/custom_fields/definition-apply-seam.test.ts test/unit/db/migrations-registry.test.ts test/unit/db/migration-order.test.ts test/unit/db/migration-ownership.test.ts
pnpm --filter @endora-commerce/mod-custom-fields run typecheck
pnpm --filter @endora-commerce/mod-custom-fields run lint
pnpm --filter backend run check:command-coverage -- --strict
pnpm --filter backend run check:port-shape
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:module-boundary
pnpm --filter backend run overlay:check
```

---

## Phase 3: Orders — the system note and Quote Request → Order at placement **[backend]**

**Goal**: US1 on the server (FR-007 – FR-010a, FR-012 – FR-015 for the QR → Order pair; research
R-7, R-8).

- [x] T016 [US1] **RED** Extend `backend/test/contract/orders/comments.test.ts` (FR-010a, SC-006): a
  system-note row inserted through the test's database helper (author null ×2, not visible, not
  notifying, a `system_note` of contract §5's shape) is listed by
  `GET /api/v1/admin/orders/:id/comments` with `systemNote` equal to the stored shape and
  `authorAdminUserId: null`; **not** listed by the buyer's `GET /api/v1/orders/:id/comments`, even
  when its `is_customer_visible` is forced `true` in a second row (the `systemNote: null` filter);
  every existing admin/customer comment still has `systemNote: null` on the admin list. Fails: no
  column
- [x] T017 [US1] **RED** New `backend/test/integration/orders/place-order-custom-field-carry.test.ts`
  (buyer of Organization A assigned to the store, standing rule 6; the quote seeding as
  `backend/test/integration/orders/place-order-from-quote-request.test.ts` does; QR and Order
  `select` fields `order_source` (`fair`, `web`), QR → Order on). Cases: the approved request holds
  `fair` → the placed Order holds `fair` (US1-1, SC-001); carry off → no key (US1-2); the basket's
  source not vouched (already ordered / other Organization / a line changed) → no key (US1-3,
  FR-012); target option removed after configuration → placement 201, no key, **one** admin-listed
  comment with `systemNote.skipped = [{ key, reason: 'value_invalid' }]`, the buyer's comment list
  empty, no `order_comment` transactional e-mail or mailer call recorded (US1-4, SC-002, SC-004,
  SC-006); target audience drifted to `customer` → skipped `audience_mismatch` (SC-005); an
  unrelated **required** empty Order field does not fail placement or the carry (spec edge case);
  the request's value edited after conversion, before checkout → the edited value carried; an
  impersonated placement's `order.place_on_behalf` audit `stateAfter.carriedCustomFieldKeys` names
  the key (US1-5). Fails: nothing carried
- [x] T018 Scaffold `pnpm --filter backend run migration:new -- --module orders --name order_comment_system_note`;
  `up`/`down` per data-model §2; `composer:generate`; commit the registry
- [x] T019 [US1] Implement the note model: `OrderComment.systemNote` (+ `[OptionalProps]`) in
  `packages/modules/orders/src/backend/entities/order-comment.entity.ts`; `listForCustomer` filters
  `systemNote: null` (`order-comment-service.ts`); the admin `serializeComment` in
  `packages/modules/orders/src/backend/routes.ts` adds `systemNote` (customer serializer
  unchanged); a new `packages/modules/orders/src/backend/order-carry-note.ts` exporting
  `buildCarrySkipNote(em, { orderId, source, skipped })` that creates the row with the invariants
  of data-model §2 and the English fallback `body` (shared by placement and the receiver, Phase 5);
  T016 green
- [x] T020 [US1] Implement the carry in `OrderService.placeOrder`
  (`packages/modules/orders/src/backend/services/order-service.ts`): after the vouched assessment
  (`QuoteRequestSourceAssessment` from `#vouchedQuoteRequestSource`) and before
  `tx.create(Order, …)`, when `sourceQuoteRequestId !== null`, call
  `this.neighbours.customFieldCarry().plan({ sourceType: 'quote_request', targetType: 'order',
  sourceValues: quoteRequest.customFieldValues, targetValues: {} })`; pass `customFieldValues:
  plan.values` to `tx.create`; after the Order exists, `buildCarrySkipNote(tx, …)` when
  `plan.skipped` is non-empty (with a `command-coverage-ignore:` comment citing
  `order-comment-service.ts`'s reason); add `carriedCustomFieldKeys` to the impersonation audit's
  `stateAfter` when non-empty. No `validateAndMerge` on the carried bag; no `catch`; T017 green
- [x] T021 Wire `customFieldCarry: () => lazyPort<CustomFieldCarryPort>(ctx, 'customFieldCarryPort')`
  into `OrderServiceNeighbourPorts` in `packages/modules/orders/src/backend/index.ts`; run
  `pnpm --filter backend run check:port-dependencies` — if it reports the edge, add
  `custom_fields` to `dependencies` in `packages/modules/orders/src/manifest.ts` with a comment
  (non-deactivatable owner — no activation consequence) and say why in the commit; if it does not,
  change nothing. Update any `OrderServiceNeighbourPorts` stub in co-located or backend tests the
  type check names (standing rule 12: name each file in the commit)
- [x] T022 Changeset `.changeset/162-orders-custom-field-carry-placement.md` —
  `'@endora-commerce/mod-orders': minor`: an Order placed from a vouched Quote Request receives the
  request's carried custom-field values; a value that cannot be carried is recorded as an internal
  system note in the Order's comments (admin `systemNote` member; never listed to the buyer)

**Phase 3 result** (2026-10-20):
- **Anchors re-derived after `91df8b536`** (`order-service.ts`, by symbol): `QuoteRequestSourceAssessment`
  (interface beside `NO_QUOTE_REQUEST_SOURCE`) still carries `quoteRequest: QuoteRequestRecord | null`;
  `#vouchedQuoteRequestSource` is called in `placeOrder` before `assertBasketMeetsMinimums`;
  `#assessQuoteRequestSource` returns the record with `sourceQuoteRequestId` only when accepted;
  the carry sits after `const { sourceQuoteRequestId } = quoteSource;`, the Order's
  `customFieldValues` join `tx.create(Order, …)`, the note follows `tx.persistAndFlush(order)`, and
  `carriedCustomFieldKeys` joins the `order.place_on_behalf` `stateAfter`. No design conflict.
- T019: the note's reference is the request's `businessId`; `serializeCommentForCustomer` also
  deletes `systemNote`, so the buyer's reply shape is unchanged.
- T021: the accessor is threaded through `OrdersModuleOptions` (`plugin.ts`) as well as
  `index.ts`. `check:port-dependencies` reported no edge, so `orders`' manifest is unchanged.
  Stub updated (rule 12): `backend/test/helpers/orders-neighbour-ports.ts` gains a
  `customFieldCarry` that answers the target bag unchanged (its rigs never vouch a source).
- Verification: `[PG]` comments 5/5, place-order-custom-field-carry 9/9, place-order-from-quote-request
  16/16, admin-write-scope 10/10; migration unit tests 265/265; mod-orders typecheck clean, lint 0
  errors (1 pre-existing warning in an untouched admin file); `check:command-coverage --strict`
  0 blocking; `check:port-dependencies`, `check:port-catches`, `check:transaction-context`,
  `check:port-shape` 0 violations.

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-orders run build
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/orders/comments.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/orders/place-order-custom-field-carry.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/orders/place-order-from-quote-request.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/orders/admin-write-scope.test.ts)
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/migration-order.test.ts test/unit/db/migration-ownership.test.ts
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-orders run lint
pnpm --filter backend run check:command-coverage -- --strict
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:port-catches
pnpm --filter backend run check:transaction-context
```

---

## Phase 4: CRM — Order / Quote Request → Opportunity **[backend]**

**Goal**: US2 (FR-007 – FR-010, FR-012 – FR-015 for the two pairs into Opportunities; research R-9,
R-11).

- [x] T023 [US2] **RED** New `backend/test/integration/crm/custom-field-carry-into-opportunity.test.ts`
  (standing rule 7 for both auto-create settings; Order, QR and Opportunity `select` fields
  `order_source`; Order → Opportunity and QR → Opportunity on). Cases, each awaiting
  `OpportunityAutoCreateService.idle()` as `auto-create.test.ts` does: order placed with
  `crm.auto_create_from_orders` on → the created Opportunity holds the value and its
  `crm.opportunity.create` audit `after.customFieldValues` shows it (US2-1, FR-013 system actor);
  QR submitted with `crm.auto_create_from_quote_requests` on → same; an Order placed from a QR
  linked to an Opportunity **with** a value → kept (US2-2), the `link_add` entry has no
  `customFieldCarry`; **without** a value → filled (US2-3); Opportunity field deleted → Opportunity
  created, `after.customFieldCarry.skipped = [{ key, reason: 'target_missing' }]` on the creation
  entry and visible through `GET …/opportunities/:id/history` (US2-5); a QR field carrying to
  Opportunity with a drifted target → the skip is on the **Opportunity's** history and the QR's
  history has no entry (US2-6); the same `order.created.v1` handled twice → one carry, one entry
  (FR-008); two Orders joining one Opportunity with different values → the first value stays
  ("several documents"); an operator manually linking an existing Order and an existing QR, each
  holding a value, to an Opportunity with an empty field (`OpportunityLinkService.add`,
  `linkSource: 'manual'`) → the Opportunity stays empty and the `link_add` entry has no
  `customFieldCarry` (US3-5, FR-008, owner ruling 2026-10-19). Fails: nothing carried
- [x] T024 [P] [US2] **RED** New co-located `packages/modules/crm/src/backend/services/opportunity-custom-field-carry.test.ts`
  over a stub `CustomFieldCarryPort`: `carryIntoOpportunity({ sourceType, sourceValues },
  currentValues)` returns `{ values, after }` where `after` is `{}` when nothing was carried or
  skipped, else `{ customFieldCarry: { source, carried, skipped } }`; and extend
  `opportunity-auto-create-service.test.ts` (standing rule 12 — named here): `createForDocument`
  receives `carry: { sourceType: 'order', sourceValues }` for an Order and `'quote_request'` for a
  QR; `linkOrderPlacedFromQuoteRequest` receives the Order record unchanged. Fails: no helper / no
  `carry` member
- [x] T025 [US2] Implement `packages/modules/crm/src/backend/services/opportunity-custom-field-carry.ts`
  and its use: `AutomaticOpportunityInput.carry?` and `createForDocument` (plan before the Command;
  `customFieldValues` and the skip member into `#createCommand`'s input/options, merged into its
  `after`) in `opportunity-service.ts`; `AutomaticLink.carry?` and the `crm.opportunity.link_add`
  Command in `opportunity-link-service.ts` (plan against `parent.customFieldValues` after
  `loadOpportunity`; assign when `carried` is non-empty; `after` gains the member);
  `linkOrderPlacedFromQuoteRequest` passes `{ sourceType: 'order', sourceValues:
  order.customFieldValues }`; T024 green
- [x] T026 [US2] Pass the document's values from `opportunity-auto-create-service.ts`
  (`#placedOrder` → `order.customFieldValues`, `#submittedQuoteRequest` →
  `quoteRequest.record.customFieldValues`); origin links pass **no** `carry` (R-9); wire
  `lazyPort<CustomFieldCarryPort>(ctx, 'customFieldCarryPort')` in
  `packages/modules/crm/src/backend/index.ts` (resolved per call, never captured); T023 green
- [x] T027 Changeset `.changeset/162-crm-custom-field-carry.md` — `'@endora-commerce/mod-crm':
  minor`: Opportunities created for, or joined by, an Order or Quote Request receive carried
  custom-field values into empty fields; skipped keys are named in the creation or link history
  entry (extended in T035)

**Phase 4 result** (2026-10-20):
- T024/T025 deviation: `carryIntoOpportunity(port, { sourceType, recordId, sourceValues }, currentValues)`
  takes the port explicitly and the source's `recordId` (the audit member's `source.recordId`,
  data-model §4.3), and answers `{ values, carried, after }`. The link entry also gains
  `customFieldValues` when values were carried, as the creation entry's snapshot already shows them.
- T026: the port reaches both `OpportunityService` and `OpportunityLinkService` deps as
  `lazyPort<CustomFieldCarryPort>(ctx, 'customFieldCarryPort')` (the proxy resolves per call),
  beside the existing `customFields` port. Nothing else constructs either service.
- **Changed existing assertions** (rule 12): `opportunity-auto-create-service.test.ts` — the two
  `createForDocument` `toHaveBeenCalledWith` objects gain `carry`, the Order and Quote Request
  fixtures gain `customFieldValues`, and the Order case also asserts
  `linkOrderPlacedFromQuoteRequest` received the Order unchanged.
- The CRM integration test seeds Orders with `seedCrmOrder` + values and announces
  `order.created.v1` (as `auto-create.test.ts` does), and reads/restores both auto-create settings'
  value in force, `coalesce(global_value, default_value)`, failing on a missing row (rule 7;
  `check:fixture-substitution` refused the first version's `?? false`, red on the fork CI).
- **Block-end gap fix** (a Phase 1 consequence no phase's verification ran): the new
  `custom_field_carry_skipped` history entry kind reddened `quote_requests`'
  `history-bundle-coverage.test.ts` and `admin/test/modules/quote_requests/RfqDetail.history.test.tsx`.
  Added `rfq.detail.history.entry.custom_field_carry_skipped` (en + pl) to the core bundle
  `packages/modules/_i18n/i18n/`, beside `pdf_sent` (feature 153's precedent), and one entry of the
  kind to the admin test's `FULL` fixture. **Changed existing assertions** (rule 12):
  `history-bundle-coverage.test.ts` `ENTRY_KINDS` 13 → 14; `RfqDetail.history.test.tsx` "names
  every actor" system-actor count 2 → 3. T031 (bundle key) and T048/T051 (skip lines) start from here.
  mod-quote-requests 313/313, mod-orders 199/199, mod-crm `src/admin/index.test.ts` 18/18, admin
  RfqDetail.history + crm history 53/53.
- Verification: mod-crm 3 files 33/33; `[PG]` custom-field-carry-into-opportunity 9/9, auto-create
  12/12, history 6/6, custom-fields 10/10; typecheck + lint clean; `check:port-dependencies`,
  `check:port-catches`, `check:port-shape` 0 violations; `check:command-coverage --strict` 0 blocking.

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-crm run build
pnpm --filter @endora-commerce/mod-crm exec vitest run src/backend/services/opportunity-custom-field-carry.test.ts src/backend/services/opportunity-auto-create-service.test.ts src/backend/services/opportunity-history-service.test.ts
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/custom-field-carry-into-opportunity.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/auto-create.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/history.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/custom-fields.test.ts)
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-crm run lint
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:port-catches
pnpm --filter backend run check:command-coverage -- --strict
```

---

## Phase 5: Receivers and Opportunity → Order / Quote Request **[backend]**

**Goal**: US3 (FR-007 – FR-010a, FR-012 – FR-015 for the two pairs out of Opportunities; research
R-10, R-11, R-13).

- [x] T028 [P] [US3] **RED** New `backend/test/integration/quote_requests/custom-field-carry-receiver.test.ts`:
  `quoteRequestCustomFieldCarryPort.receiveCarriedValues` (resolved from the composed server) on a
  QR of Organization A with an empty compatible field → `applied`, value stored, one
  `quote_request.custom_fields.carry` audit entry with the system actor; a QR already holding a
  value → kept (US3-3), `skipAudit` (no entry, no event); an incompatible target → `applied`, no
  value, one `custom-field-carry-skipped` event whose payload names key and reason, listed in the
  admin history and **absent** from the buyer's request detail (Q5); `organizationId` of
  Organization B → `not-found` and nothing written (FR-012; same answer as a random id). Fails: no
  port
- [x] T029 [P] [US3] **RED** New `backend/test/integration/orders/custom-field-carry-receiver.test.ts`:
  the same four cases for `orderCustomFieldCarryPort` — the skip as one system note (Phase 3's
  builder), audit `order.custom_fields.carry`, the buyer's comment list unchanged, no notification.
  Fails: no port
- [x] T030 Scaffold `pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_event_carry_skipped`;
  `up`/`down` per data-model §3 (its `BEFORE` list = the pdf-sent migration's list plus
  `'pdf-sent'`); `composer:generate`; commit the registry
- [x] T031 [US3] Implement the QR receiver: `'custom-field-carry-skipped'` in
  `QuoteRequestEventType` (`quote-request-event.entity.ts`); `ADMIN_ONLY_EVENT_TYPES`
  (`customer-projection.ts`); the `history-projection.ts` case (and its co-located
  `history-projection.test.ts` / `customer-projection.test.ts` cases — standing rule 12, named
  here); new `packages/modules/quote_requests/src/backend/services/quote-request-custom-field-carry-receiver.ts`
  running one `commandBus.run` per call (contract §4.2; `lazyPort<CustomFieldCarryPort>`); published
  with `ctx.di.providePort<CustomFieldCarryReceiverPort>('quoteRequestCustomFieldCarryPort', …)` in
  `packages/modules/quote_requests/src/backend/index.ts`; the history bundle key for the new type in
  `packages/modules/quote_requests/i18n/{en,pl}.json` so `history-bundle-coverage.test.ts` stays
  green; T028 green
- [x] T032 [US3] Implement the order receiver: new
  `packages/modules/orders/src/backend/services/order-custom-field-carry-receiver.ts` (one Command,
  `order.custom_fields.carry`, `buildCarrySkipNote` on the Command's `em`), published as
  `orderCustomFieldCarryPort` in `packages/modules/orders/src/backend/index.ts`; T029 green
- [x] T033 [US3] **RED** New `backend/test/integration/crm/custom-field-carry-from-opportunity.test.ts`
  (an Opportunity of Organization A holding `order_source`; Opportunity → QR and Opportunity →
  Order on): an administrator creates a QR with `origin: { type: 'crm_opportunity', id }` → after
  `idle()` the QR holds the value (US3-1); an Order created through the admin create path with the
  same origin → same; an administrator who cannot reach Organization A → QR created, not linked,
  no value (US3-2); the Opportunity of another Organization → same; the event delivered twice →
  one carry (only on `linked`); an incompatible QR target → the skip on the **QR's** history; for
  the QR and the Order, the creation audit entry's actor is the creating administrator and the
  `quote_request.custom_fields.carry` / `order.custom_fields.carry` entry's actor is the system
  (US3-4, FR-013, owner ruling 2026-10-19).
  Extend `packages/modules/crm/src/backend/services/opportunity-origin-link-service.test.ts`
  (standing rule 12 — named here): the new `carryIntoDocument` dependency is called exactly once,
  on `linked`, never on `already-linked` / `refused` / `not-ours`. Fails: nothing carried
- [x] T034 [US3] Implement the push in `opportunity-origin-link-service.ts`: a dependency
  `carryIntoDocument(document, opportunity)` composed in `packages/modules/crm/src/backend/index.ts`
  that, for an Opportunity with values, calls `lazyPort<CustomFieldCarryReceiverPort>(ctx,
  'orderCustomFieldCarryPort')` for an Order, or — only when `quoteRequests.isPresent()` —
  `lazyPort<CustomFieldCarryReceiverPort>(ctx, 'quoteRequestCustomFieldCarryPort')` for a QR (a
  function at the composition site, as `createCrmQuoteRequests` is, so `check:port-catches` follows
  the value); add the `nonBindingDependencies` entry for `quoteRequestCustomFieldCarryPort`
  (`kind: 'degrades-without'`, `whenAbsent` per research R-16) to
  `packages/modules/crm/src/manifest.ts`; T033 green
- [x] T035 Changesets: `.changeset/162-quote-requests-custom-field-carry.md` —
  `'@endora-commerce/mod-quote-requests': minor` (`quoteRequestCustomFieldCarryPort`, the
  `custom-field-carry-skipped` history entry, admin-only); `.changeset/162-orders-custom-field-carry-receiver.md`
  — `'@endora-commerce/mod-orders': minor` (`orderCustomFieldCarryPort`); extend
  `.changeset/162-crm-custom-field-carry.md` with the Opportunity → document carry and the new
  non-binding edge

**Phase 5 result** (2026-10-20):
- Migration `20261021T164808_quote_requests_quote_request_event_carry_skipped`, registered in the
  module barrel and the regenerated registry.
- T031: the history bundle title was already added at the block 1 end (core `_i18n` bundle). The
  receiver writes the skip event with `actorRoleLabel: 'System'` (how the projection names a
  system actor, as the expiry worker and the completion reactor do) and bumps the request's
  `version` when it carries values. The projection reads the payload field by field
  (`customFieldCarryOf`). New unit cases in `history-projection.test.ts` and
  `customer-projection.test.ts` (rule 12: added, no existing assertion changed).
- Contract doc block: the receiver port's "Container names:" became two `Container name:` lines
  in this commit, which registers both names.
- T034: `carryIntoDocument` is `createCarryIntoDocument` in the new
  `crm/src/backend/services/opportunity-document-carry.ts`, composed in `index.ts`; it skips an
  Opportunity with no values and asks `isPresent()` before reaching the Quote Request receiver.
  The origin-link unit test's `service()` stub gains `carryIntoDocument` (rule 12). The manifest's
  new `degrades-without` entry regenerated `docs/docs/module-reference/crm.md`; the Polish cache
  entry and materialised page were re-pinned (`check:docs-translations` 0 findings).
- Verification: mod-quote-requests 3 files 80/80; mod-crm origin-link 18/18; `[PG]`
  quote_requests custom-field-carry-receiver 4/4, orders custom-field-carry-receiver 4/4,
  crm custom-field-carry-from-opportunity 6/6, quote_requests admin-create-origin 10/10, orders
  admin-create-origin 10/10, quote_requests history 12/12; migration + module-graph unit 273/273;
  typecheck + lint clean (quote-requests, orders, crm, contracts, backend); `check:port-shape`,
  `check:port-dependencies`, `check:port-catches`, `check:module-boundary` 0 violations;
  `check:command-coverage --strict` 0 blocking; `manifests:check`, `check:module-docs` pass.
  (Two `[PG]` files first ran beside a static batch and were skipped at setup; re-run alone, green.)

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-quote-requests run build
pnpm --filter @endora-commerce/mod-orders run build
pnpm --filter @endora-commerce/mod-crm run build
pnpm --filter @endora-commerce/mod-quote-requests exec vitest run src/backend/services/history/history-projection.test.ts src/backend/services/customer-projection.test.ts src/backend/history-bundle-coverage.test.ts
pnpm --filter @endora-commerce/mod-crm exec vitest run src/backend/services/opportunity-origin-link-service.test.ts
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/quote_requests/custom-field-carry-receiver.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/orders/custom-field-carry-receiver.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/custom-field-carry-from-opportunity.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/quote_requests/admin-create-origin.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/orders/admin-create-origin.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/quote_requests/history.test.ts)
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/migration-order.test.ts test/unit/db/migration-ownership.test.ts test/unit/db/module-graph.test.ts
pnpm --filter @endora-commerce/mod-quote-requests run typecheck
pnpm --filter @endora-commerce/mod-quote-requests run lint
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-orders run lint
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-crm run lint
pnpm --filter backend run check:port-shape
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:port-catches
pnpm --filter backend run check:command-coverage -- --strict
pnpm --filter backend run check:module-boundary
```

**Mid-delivery rebase** (2026-10-21, after Phases 7–8 joined from the UI stream): onto
`origin/master` at `aa6891d63` (backup `backup/161-pre-rebase-1`). Master had landed
`specs/158-crm-opportunity-inline-editing/` and `specs/159-quote-request-item-groups/`. Conflicts were
adjacent additions (contracts imports and tests, the minted-code ledger, the order placement audit
`stateAfter`, three modules' bundles, `OrderDetail.tsx`, `OpportunityHistory.tsx`), each kept on both
sides; the history-kind count test now reads 14 entry kinds and 13 change kinds. Master's newer
`orders` and `quote_requests` migrations (`20261020T172007`, `20261020T171341`) re-stamped ours to
`20261021T164807_orders_order_comment_system_note` and
`20261021T164808_quote_requests_quote_request_event_carry_skipped`. Registries regenerated; the crm
reference page's Polish cache still matches its English hash. The AGENTS.md appendix keeps three
Recent Changes lines, as `agents-router.test.ts` caps it.

---

## Phase 6: Off-state, audience and visibility proofs **[backend]**

**Goal**: FR-005, FR-014 on both owned types and both axes; SC-005, SC-006 on every target type
(research R-12, R-13).

- [x] T036 [P] **RED → green** Extend `backend/test/integration/crm/off-state.test.ts`: with `crm`
  off (deactivated while platform-available, and platform-unavailable) an order placed from a
  vouched QR still carries QR → Order; no Opportunity is created or joined and the order's
  values are untouched; switching `crm` back on creates nothing for that order (no replay, US2-4,
  FR-014); `GET …/custom-fields/entity-types` offers no `opportunity` carry target meanwhile
- [x] T037 [P] **RED → green** Extend `backend/test/integration/quote_requests/off-state.test.ts`
  (feat/155 also extended this file — append a separate `describe`): with `quote_requests` off, a
  basket seeded from a QR places an Order that carries nothing (no vouched source); Opportunity →
  QR is not attempted (CRM's `isPresent()` decision — no 503 in the log, the Opportunity's
  history unchanged); `quote_request` carry options are hidden and retained; after re-enabling,
  they are served again and nothing is replayed
- [x] T038 [P] **RED → green** New `backend/test/integration/custom_fields/carry-audience.test.ts`
  (SC-005), for each target type that has a non-admin reader — Order (buyer order detail
  `GET /api/v1/orders/:id`, API-key order read) and Quote Request (buyer request detail):
  (a) a `customer`→`customer` carry whose **source** is then made `internal` → the value is skipped
  `audience_mismatch` and appears in no buyer or API-key reply; (b) an `internal`→`internal` carry
  whose **target** is then made `customer` → skipped likewise; (c) a `customer`→`internal`
  carry → carried, and the value appears in admin replies only. The Opportunity has no non-admin
  reader; its case is covered by T013
- [x] T039 [P] **RED → green** New `backend/test/contract/orders/carry-system-note-visibility.test.ts`
  (SC-006): after a placement that writes a system note, the buyer's comments route, the buyer's
  order detail, the API-key order read and the transactional-email outbox contain nothing of it;
  the admin comments route does
- [x] T040 Run the off-state and presence ratchets and record the results under this task:
  `check:off-state-coverage`, `check:entry-presence`, `check:subscribe-seam`; if a ledger asks
  for an entry, add it with its reason in the same commit
  **Result** (2026-10-21): `off-state-coverage` switchable 39, proven 39, findings 0;
  `entry-presence` violations 0 (ledgered 2, stale 0); `subscribe-seam` 0 / 0; `port-catches`
  violations 0 (ledgered 4, stale 0); `fixture-substitution` violations 0. No ledger entry needed.

- **Phase 6 notes** (2026-10-21). T036–T039 are written; the Docker services were down on the
  workstation, so their `[PG]` files are verified on the fork's `ci-pg` run only. **Result**: the
  fork's service-backed run on `189da5071` — 15 files (Phase 5's six, Phase 6's five, the four the
  label snapshot or the re-stamped migrations touch), `failed=0`, 133 tests. T036 sets `crm.auto_create_from_orders` on and
  `crm.auto_create_from_quote_requests` off for its describe, after reading both values to write
  back. T037's carry-option retention while `quote_requests` is off is already
  `custom_fields/entity-owner-presence.test.ts`' (Phase 2) and is not repeated; Opportunity → Quote
  Request is proven by announcing `rfq.created_by_admin.v1` with an origin while the module is off
  (the module itself emits nothing then), with a positive control while on. No existing assertion
  changed.

**Verification**:
```bash
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/off-state.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/quote_requests/off-state.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/carry-audience.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/orders/carry-system-note-visibility.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/cross-tenant.test.ts)
pnpm --filter backend run check:off-state-coverage
pnpm --filter backend run check:entry-presence
pnpm --filter backend run check:subscribe-seam
pnpm --filter backend run check:port-catches
```

---

## Phase 7: `/custom-fields` — toggles, column, drift warnings **[admin UI]**

**Goal**: US4 in the admin (FR-001, FR-002, FR-003 rendering, FR-006, FR-016, FR-019, FR-020;
SC-007; contract `admin-surfaces.md` §1; research R-14). Extends the filters feature's editor by
additive props only.

- [x] T041 [P] [US4] **RED** New `admin/test/modules/custom_fields/carry-drift.test.ts` over
  `carryCounterpartsBrokenBy` (contract `admin-surfaces.md` §1.4): removing an option a carrying
  source holds → that source named (`role: 'source'`); removing an option no source holds → `[]`;
  adding an option to a source whose target lacks it → the target named; target audience →
  `customer` under an `internal` source → the source named; source audience → `internal` under a
  `customer` target → the target named; deleting a target → every carrying source; deleting a
  source → its targets; an already-incompatible carry is not re-reported by a non-delete change;
  key `constructor` handled. Fails: no helper
- [x] T042 [P] [US4] **RED** New `admin/test/modules/custom_fields/CustomFieldsPage.carry.test.tsx`
  (StrictMode; `AuthProvider` with `custom_fields:read` + `:write`; the module client mocked as the
  filters feature's editor test does): the create form and the editor offer one *Carry value to …*
  checkbox per `carryTargets` entry and none for Category (US4-4); an Order field offers no *Quote
  request*; *Save* sends `carryTo` only when changed; a 422 with `details.code: 'options_missing'`
  keeps the dialog open with a sentence naming the missing values, and `target_missing` names the
  key and the type (US4-2, US4-3); the *Carries to* column shows translated chips in `en` and in
  `pl` (US4-5); a chip whose target lacks a source option shows *Incompatible* with the reason, and
  the mark disappears when the list re-reads compatible (US4-7). Fails: no toggles
- [x] T043 [P] [US4] **RED** New `admin/test/modules/custom_fields/CustomFieldsPage.carry-drift.test.tsx`
  (StrictMode): removing a target option, adding a source option, changing an audience in the table
  and deleting a definition that is part of an enabled carry each open an in-page confirmation
  listing "<type> · <key>" before any request; *Cancel* sends nothing; *Proceed* sends exactly the
  request the action sent before (US4-6, US4-8, SC-007); a change that breaks nothing asks nothing
- [x] T044 [P] Add the keys of contract `admin-surfaces.md` §1.5 to
  `packages/modules/custom_fields/i18n/en.json` and `pl.json`
- [x] T045 [US4] Implement `packages/modules/custom_fields/src/admin/lib/carry-drift.ts`
  (prototype-free lookups); T041 green
- [x] T046 [US4] Implement in `DefinitionBehaviourFields.tsx`, `DefinitionEditorDialog.tsx`,
  `DefinitionOptionsEditor.tsx` and `CustomFieldsPage.tsx`
  (`packages/modules/custom_fields/src/admin/`): the toggles (additive `value.carryTo` /
  `onChange`), the refusal sentence from `details`, the *Carries to* column and the mark
  (`assessCustomFieldCarry` over the loaded list), and the confirmation step at the four sites of
  §1.4 (kit `ModalDialog`, no `window.confirm`); `custom-fields-client.ts` types; T042, T043 green;
  `i18n:hardcoded` adds no finding. Then the changeset `.changeset/162-custom-fields-carry-ui.md` —
  `'@endora-commerce/mod-custom-fields': minor`

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter admin exec vitest run test/modules/custom_fields/carry-drift.test.ts test/modules/custom_fields/CustomFieldsPage.carry.test.tsx test/modules/custom_fields/CustomFieldsPage.carry-drift.test.tsx test/modules/custom_fields/CustomFieldsPage.editor.test.tsx test/modules/custom_fields/CustomFieldsPage.audience.test.tsx
pnpm --filter @endora-commerce/mod-custom-fields run typecheck
pnpm --filter @endora-commerce/mod-custom-fields run lint
pnpm --filter admin run typecheck
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend run check:bundle-pairing
pnpm --filter backend run check:admin-surface
```

- **Phase 7 notes.** The page reads a second, unfiltered definitions list, only once some type
  offers a carry target, for the *Incompatible* mark and the drift warnings (the per-type list
  shows only one type). The refusal sentence reuses the Phase 1 keys
  `errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.<token>` with the type and value-type names translated,
  rather than minting six `customFields.carry.refusal.*` copies. Inside the editor the warning takes
  the dialog's place (the editor stays mounted, hidden) instead of a second modal, which would also
  answer Escape and trap focus; on the table it is its own `ModalDialog`. A removal or deletion that
  breaks a carry asks once, in the warning, instead of the in-row confirmation. `value.carryTo` is
  passed only where the type offers targets, so the existing editor test's `toEqual` on `value`
  holds. Verification: 5 files 71/71; typecheck, lint, `i18n:hardcoded` (regressions 0),
  `check:bundle-pairing`, `check:admin-surface` clean.

---

## Phase 8: History renderers — Order note, Quote Request, Opportunity **[admin UI]**

**Goal**: the skip entries readable in the admin (FR-010, FR-010a, FR-016; US1-4, US2-5, US2-6;
contract `admin-surfaces.md` §2 – §4).

- [x] T047 [P] [US1] **RED** New `admin/test/modules/orders/OrderDetail.system-note.test.tsx`
  (StrictMode; `apiClient` mocked as the existing order detail tests do): a comment with
  `systemNote` renders author *System*, the *Internal* marker and one line per skipped key with the
  translated reason, in `en` and `pl`; the field's label is used when the Order definition is
  known, the key otherwise (truncated at 64); a comment without `systemNote` renders as before.
  Fails: renders the fallback body under no author
- [x] T048 [P] [US3] **RED** Extend `admin/test/modules/quote_requests/RfqDetail.history.test.tsx`:
  a `custom-field-carry-skipped` entry renders its title with the Opportunity's reference and one
  line per key and reason in `en` and `pl`. Fails: unknown type
- [x] T049 [P] [US2] **RED** Extend `admin/test/modules/crm/history.test.tsx`: a
  `crm.opportunity.create` and a `crm.opportunity.link_add` entry whose `after.customFieldCarry`
  has skipped keys render "Not carried from …" with one line per key and reason; for a reader
  without `custom_fields:read` the lines are not shown (the existing `canSeeCustomFields` gate).
  Fails: raw key rendered
- [x] T050 [US1] Implement in `packages/modules/orders/src/admin/pages/OrderDetail.tsx` and add the
  keys to `packages/modules/orders/i18n/{en,pl}.json`; T047 green
- [x] T051 [US3] Implement in `packages/modules/quote_requests/src/admin/pages/RfqHistory.tsx`
  (keys in `packages/modules/quote_requests/i18n/{en,pl}.json`); T048 green
- [x] T052 [US2] Implement in `packages/modules/crm/src/admin/components/OpportunityHistory.tsx`,
  add `customFieldCarry` to `LABELLED_HISTORY_FIELDS` in
  `packages/modules/crm/src/admin/lib/history-fields.ts` and its keys to
  `packages/modules/crm/i18n/{en,pl}.json`; `packages/modules/crm/src/admin/index.test.ts` green;
  T049 green
- [x] T053 Changesets `.changeset/162-orders-carry-note-ui.md` (`mod-orders`: patch),
  `.changeset/162-quote-requests-carry-history-ui.md` (`mod-quote-requests`: patch),
  `.changeset/162-crm-carry-history-ui.md` (`mod-crm`: patch)

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-orders run build
pnpm --filter @endora-commerce/mod-quote-requests run build
pnpm --filter @endora-commerce/mod-crm run build
pnpm --filter admin exec vitest run test/modules/orders/OrderDetail.system-note.test.tsx test/modules/quote_requests/RfqDetail.history.test.tsx test/modules/crm/history.test.tsx
pnpm --filter @endora-commerce/mod-crm exec vitest run src/admin/index.test.ts
pnpm --filter @endora-commerce/mod-quote-requests exec vitest run src/backend/history-bundle-coverage.test.ts
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-quote-requests run typecheck
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-orders run lint
pnpm --filter @endora-commerce/mod-quote-requests run lint
pnpm --filter @endora-commerce/mod-crm run lint
pnpm --filter admin run typecheck
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend run check:bundle-pairing
```

- **Phase 8 notes.** Order note keys in `orders/i18n` read through a second translator
  (`OrderDetail` reads `core`); the source sentence is one key per source type
  (`orderDetail.comments.systemNote.customFieldCarrySkipped.{quote_request,opportunity}`) so Polish
  can decline it. The Quote Request entry keeps `core`'s `entry.custom_field_carry_skipped` title
  (the existing "every kind has a title" assertion) and adds `history.carrySource` plus the lines
  from `quote_requests/i18n`, instead of a title-with-reference key. CRM `index.test.ts` gains two
  composed families (`history.customFieldCarry.from.`, `history.carryReason.` from
  `customFieldCarrySkipReasonSchema`) — additions, no changed assertion. The `OrderDetail` lint
  warning at the `handleAddComment` `useCallback` predates this phase. Verification: admin 3 files
  (system-note 12, RfqDetail.history 32, crm history 29) green; crm `index.test.ts` 18/18;
  `history-bundle-coverage` 49/49; typecheck and lint clean (one pre-existing warning);
  `i18n:hardcoded` regressions 0; `check:bundle-pairing` 0.

---

## Phase 8a: Owner rulings 2026-10-21 (V1–V3) **[backend]** + **[admin UI]**

**Goal**: the three rulings of `spec.md` § Clarifications, Session 2026-10-21. V3's contract and backend
half is the builder's; V1, V2 and V3's admin half go to `endora-commerce-designer` in the UI worktree, on a
branch from the commit that lands V3's backend half, which they depend on.

- [x] T063 [V3] **RED** — the label snapshot, contract and writers:
  `packages/contracts/src/custom-fields.carry.test.ts` §1.3 (a skip keeps `label: { labelDefault, labels }`;
  a skip without one still parses and gains no key; a malformed label is refused;
  `customFieldCarrySkipRecord` copies the label and drops anything else);
  `custom-field-carry.service.test.ts` (every skip names the **source** definition's label, never the
  target's, and hands out a copy of the cached map); `opportunity-custom-field-carry.test.ts` (the audit
  `after.customFieldCarry.skipped` keeps the label, and a skip without one stays without);
  `history-projection.test.ts` (the `custom_field_carry_skipped` entry passes the label through);
  `[PG]` `test/integration/quote_requests/custom-field-carry-receiver.test.ts` (the receipt, the stored
  event payload and the admin history entry carry the Opportunity definition's label, distinct from the
  request's). **Deliberately changed existing assertions** (standing rule 12) — each `toEqual` over a skip
  gains `label`: `custom-field-carry.service.test.ts` (`target_missing`, `value_type_mismatch`,
  `audience_mismatch`, `value_invalid`, "never loses a target key"); `[PG]`
  `test/integration/custom_fields/carry-port.test.ts` (`value_invalid`);
  `test/integration/orders/custom-field-carry-receiver.test.ts` (the receipt);
  `test/integration/orders/place-order-custom-field-carry.test.ts` (SC-005 note);
  `test/integration/crm/custom-field-carry-into-opportunity.test.ts` (US2-5 and the audience skip);
  `test/integration/crm/custom-field-carry-from-opportunity.test.ts` (the Quote Request history entry).
- [x] T064 [V3] Implement: `customFieldCarrySkipLabelSchema` and an optional `label` on
  `customFieldCarrySkipSchema` / `CustomFieldCarrySkip`, plus `customFieldCarrySkipRecord`
  (`@endora-commerce/contracts`); the carry port fills `label` from the source definition on every skip;
  the Order system note, both receivers, the Opportunity carry and the Quote Request history projection
  store or project skips through `customFieldCarrySkipRecord` instead of re-mapping to `{ key, reason }`.
  Contract `carry-api.md` §4.1, §5, §6 and `data-model.md` §2, §4.1; changesets
  `162-contracts-custom-field-carry.md` (amended) and `162-carry-skip-label.md`.
- [x] T065 [V1] [admin UI] Drift-warning proceed buttons name the action ("Remove option anyway",
  "Delete field anyway", "Save anyway"; pl "Usuń opcję mimo to", "Usuń pole mimo to", "Zapisz mimo to"),
  destructive-styled for removals and deletions. One mapping, `carryDriftProceed(kind)` in
  `custom_fields/src/admin/lib/carry-drift.ts`, read by the page's `CarryDriftDialog` (`action` replaces
  `proceedVariant`) and the editor's in-place warning (`CarryDriftGuard.confirm` takes `{ action }` instead
  of `{ destructive }`); `customFields.carry.warning.proceed` is replaced by `.proceedRemoveOption`,
  `.proceedDeleteField`, `.proceedSave`. **Deliberately changed existing assertions** (standing rule 12):
  `CustomFieldsPage.carry-drift.test.tsx` — the four "… on Proceed" tests click the action's own label
  instead of the removed `PROCEED` constant; new suite "the proceed button names the action" (en + pl,
  label and style per action). *Superseded in part by owner ruling W1 (2026-10-21, review fix R10):
  `.proceedSave` / "Save anyway" no longer exists — the add-option and audience buttons read "Add option
  anyway" and "Change audience anyway".*
- [x] T066 [V2] [admin UI] One help line per carry checkbox in the definition editor; one shared help line
  for the group in the narrow create-form row. `DefinitionBehaviourFields` `layout="row"`: the checkboxes
  lose their own `aria-describedby`, the `role="group"` gains one pointing at
  `customFields.carry.helpGroup`. **Deliberately changed existing assertion**:
  `CustomFieldsPage.carry.test.tsx` "offers one carry checkbox per carry target in the create form…" — the
  create-form checkbox now has no accessible description of its own (it asserted the per-target help);
  new suite "carry help lines" (en + pl, both layouts).
- [x] T067 [V3] [admin UI] The Order note, the Quote Request entry and the Opportunity change history name a
  skipped field by its stored `label` (the reader's locale, then `labelDefault`), falling back to the
  field's key for a skip without one — no lookup of the current definition (coordinator ruling
  2026-10-21); the CRM skip lines are shown to every reader
  of the record, while custom-field values stay behind `custom_fields:read`. The Order note no longer needs
  `GET /custom-fields/definitions?entityType=order` for a labelled skip.
  **Built as the coordinator's brief states it**: stored label (`labels[lang]`, then `labelDefault`), then
  the key — no current-definition fallback for an unlabelled skip on any of the three surfaces, so the
  Order note makes no definitions read at all and an old entry reads the same to every reader. The CRM
  definitions read is back to `customFieldValues` only. **Deliberately changed existing assertions**:
  `OrderDetail.system-note.test.tsx` — the line-list test (labels now come from the skip; en and pl render
  in their own provider language; no definitions read), "names every field by its key without
  custom_fields:read" became "…by its stored label…", "names a field by its key when the definitions
  cannot be read" deleted (no such read remains), and the suite mocks `CustomFieldValuesPanel`, whose own
  definitions read would otherwise mask the proof; `crm/history.test.tsx` — "shows the entry without the
  field lines to a reader who may not read the fields" now asserts the lines are shown, and the
  `CREATED_WITH_SKIPS` / `JOINED_WITH_SKIPS` fixtures carry stored labels. New: crm "keeps the values row
  behind its own gate while the skip lines show" and the Polish fallback test; `RfqDetail.history` "names a
  skipped field by the label stored with the skip" (en + pl). Contract `admin-surfaces.md` §1.1, §1.4,
  §1.5, §2, §3, §4 updated.
  Verification (T065–T067): carry-drift 20, carry 19, system-note 11, RfqDetail.history 38, crm history 32;
  the Phase 7/8 admin batch 8 files 164/164; crm `index.test.ts` 18/18; `history-bundle-coverage` 56/56;
  typecheck clean (admin and the four modules), lint clean bar the pre-existing `OrderDetail.tsx` warning;
  `i18n:hardcoded` regressions 0, `check:bundle-pairing` 0, `check:admin-surface` 0.

**Verification** (T063–T064):
```bash
pnpm --filter @endora-commerce/contracts run build
pnpm --filter @endora-commerce/contracts exec vitest run src/custom-fields.carry.test.ts
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter @endora-commerce/mod-custom-fields exec vitest run src/backend/services/custom-field-carry.service.test.ts
pnpm --filter @endora-commerce/mod-crm exec vitest run src/backend/services/opportunity-custom-field-carry.test.ts
pnpm --filter @endora-commerce/mod-quote-requests exec vitest run src/backend/services/history/history-projection.test.ts
```
plus the `[PG]` files named in T063, on the fork's `ci-pg` run.

---

## Phase 9: Documentation, en + pl **[docs]**

**Goal**: FR-018 (`specs/conventions/module-documentation.md`, `docs/docs/contributing/documentation-i18n.md`).

- [x] T054 [P] `packages/modules/custom_fields/docs/custom_fields.md` (created by the filters
  feature) gains *Carrying values between Quote Requests, Orders and Sales Opportunities*: the five
  pairs, fill-empty, the compatibility rule, the configuration refusal and its reasons, the
  audience rule, the drift warning and the *Incompatible* mark, skip-and-record; and
  `docs/docs/architecture/custom-fields.md` gains the carry port and receiver ports (who computes,
  who writes, R-5/R-6)
- [x] T055 [P] `packages/modules/orders/docs/orders.md` (the carried values at placement, the
  system note), `packages/modules/quote_requests/docs/quote_requests.md` (the
  `custom-field-carry-skipped` history entry, admin-only), `packages/modules/crm/docs/crm.md` (the
  carry on creation, joining and from an Opportunity; the history member; system attribution; no
  carry on manual links)
- [x] T056 The Polish pages under `docs/i18n/pl/docusaurus-plugin-content-docs/current/`
  (`architecture/custom-fields.md`, `modules/{custom_fields,orders,quote_requests,crm}.md`) and the
  translation cache entries in `docs/translation-cache/pl/` per the manual workflow
- [x] T057 `pnpm --filter backend run composer:generate` (module reference pages, sidebar); commit
  any regenerated artefact; `pnpm --filter backend run check:docs-translations`

**Verification**:
```bash
pnpm --filter backend run composer:generate
git status --porcelain
pnpm --filter backend run check:docs-translations
```

(`git status` must list nothing after the commit. `check:naming` / `check:language` and the docs
build run on the fork's CI in Phase 10 — on macOS they need Linux tools.)

- **Phase 9 notes.** The pages describe the owner rulings of 2026-10-21 as ruled, ahead of the admin
  half of Phase 8a: the proceed buttons named by action (V1; the add-option and audience warnings
  read *Save anyway*), one help line per carry checkbox in the editor and one shared line in the
  create row (V2), and the skip lines named by the stored source label and shown to every reader of
  the record, values still behind `custom_fields:read` (V3). On this tip the bundles still read
  *Continue anyway* / *Kontynuuj mimo to* and the CRM lines are still gated — T065–T067 close that.
  Amended rather than appended: the architecture page's "`listFilter` is the one interpreted
  attribute", `crm.md`'s "an opportunity created automatically has no custom values", and the
  orders Comments bullet; a stray two-line fragment in `crm.md` § Opportunities created
  automatically (en and pl), which said the quote-conversion join was "not effective yet", is
  removed. The `custom_fields` description changed, so the module map (en, regenerated) and its
  Polish mirror moved with it; no module reference page moved. Six Polish cache entries re-pinned
  through `hashSourceBody` / `writeCacheEntry`. Verification: `composer:generate` (module map only),
  `check:module-docs` findings 0, `check:docs-translations` findings 0.

---

## Phase 10: Gate — final rebase, local cheap checks, fork CI, service-backed run **[gate]**

**Goal**: every job a pull request runs, on the tip **after the final rebase onto
`origin/master`**, under the remote-CI rule (standing rule 13). Record each result (tip, base,
host or CI run) under its task.

- [x] T058 Final rebase onto `origin/master` (backup branch first); re-run T000's `git log` and
  `git grep` lines against the new base; regenerate and confirm nothing moves:
  ```bash
  pnpm install --frozen-lockfile
  pnpm run build:packages
  pnpm --filter backend run composer:generate
  pnpm --filter backend run manifests:generate
  pnpm install --lockfile-only
  git status --porcelain
  ```
  (`git status` must print nothing. If a migration's stamp now sorts before a newer one of the same
  module, leave it — order inside a module is by stamp and the three are independent.)
- [x] T059 Local cheap checks:
  ```bash
  pnpm --filter backend run check:release-intent -- --since origin/master
  node backend/scripts/dco-signoff.ts origin/master HEAD
  pnpm --filter backend run check:error-translations
  pnpm --filter backend run check:port-dependencies
  pnpm --filter backend run check:module-boundary
  ```
- [x] T060 Push the branch to the fork and open the draft pull request; record the CI result of
  every job on the pushed tip — `quality` (whole-workspace `typecheck`, `lint` and the workflow's
  check list), `quality:static` (naming, language), `test:backend:unit`, `test:frontend` (the
  packages' co-located suites included), `release:changeset`, `pack-gate`, `boot-gate`,
  `build:docs`, `dco`. A red job is fixed on the branch with a new signed commit and re-pushed.
- [x] T061 Service-backed run on the fork: build the throwaway `ci-pg/<branch>` branch from the
  tip plus the fork-only workflow commit and a `ci-pg-files.txt` listing, relative to `backend/`,
  every server-bound file this feature adds or changes —
  `test/integration/custom_fields/{carry-options,entity-owner-presence,carry-port,carry-audience,cross-tenant,carry-refusal-atomicity,one-definitions-cache}.test.ts`,
  `test/contract/custom_fields/host-managed.test.ts`,
  `test/contract/orders/{comments,carry-system-note-visibility}.test.ts`, `test/contract/crm/history.contract.test.ts`,
  `test/integration/orders/{place-order-custom-field-carry,place-order-from-quote-request,custom-field-carry-receiver,admin-write-scope,admin-create-origin}.test.ts`,
  `test/integration/quote_requests/{custom-field-carry-receiver,off-state,history,admin-create-origin}.test.ts`,
  `test/integration/crm/{custom-field-carry-into-opportunity,custom-field-carry-from-opportunity,custom-field-carry-quote-version,auto-create,history,custom-fields,off-state}.test.ts`,
  `test/integration/_i18n/error-code-ownership.test.ts`, `test/contract/kernel/openapi-baseline.test.ts`,
  `test/contract/kernel/harness-parity.test.ts` — push it, record the per-file table, delete the
  branch. A red file is fixed on the feature branch (never on `ci-pg/…`) and the run repeated.
- [x] T062 Record T058 – T061 (tip and base hashes, CI run links, any known-flake re-run with its
  evidence) in this file as a `tasks.md`-only commit; the pull request body says `Closes #287`,
  lists the owner answers to Q1–Q5, and follows the repository's pull-request template

**Gate record** (2026-10-21; T062). CI results are described here without fork run links.

- **T058.** `origin/master` re-fetched at `aa6891d63` — the base of the mid-delivery rebase, with no
  commit since — so the rebase was a no-op (backup `backup/161-pre-rebase-2`). T000's lines against it:
  `161` free on `origin/master`; README floor `136`; `QuoteRequestSourceAssessment` and `listFilter`
  present; no carry or system-note symbol on master; the `git log` prints only commits already
  integrated at the mid-delivery rebase. **New**: a remote branch `feat/161-price-book-editor`
  (`specs/161-price-book-editor/`, first commit 2026-10-21 18:43, not on master) now also carries
  `161`; left to the coordinator (AGENTS.md: cite the slug). Regenerate sequence: `git status
  --porcelain` empty. `AGENTS.md` appendix re-run from master's file, tag corrected to
  `161-custom-fields-value-carry`: byte-identical to the branch's. `check:docs-translations` 0
  findings, so no re-pin at rebase time; master gained no migration, so no re-stamp.
- **Acceptance fixes after T058** (product owner's conditions, coordinator rulings): S6 = R9, S3 = the
  doc half of R12 (Polish cache re-pinned), S2 (spec), S5 (contracts), S4 = R10 – R14, S1 (T061's
  list), N1, N2; and R15 below, found by T060.
- **T059** on `2699dd16c` (R15 after it touches one admin page; `dco` re-judged by CI on `24072b4a0`): `check:release-intent --since origin/master` 0 violations;
  `dco-signoff.ts origin/master HEAD` 0 findings; `check:error-translations`,
  `check:port-dependencies`, `check:module-boundary` 0 violations; `check:docs-translations`,
  `check:module-docs` 0 findings.
- **T060** on `24072b4a0` (base `aa6891d63`): `quality`, `quality:static`, `test:backend:unit`,
  `test:frontend`, `release:changeset`, `pack-gate`, `boot-gate`, `build:docs`, `dco` all green; no
  flake re-run. The tip before it, `2699dd16c`, was red in `test:frontend` only (R15).
- **T061** on `2699dd16c` plus the fork-only workflow: 30 files, 296 tests, 29 green. The red one is
  `test/contract/kernel/openapi-baseline.test.ts`, whose only difference is `POST
  /api/v1/admin/feedback` — a route master's `admin_feedback` module (`53e88c7da`) registers while
  master's `backend/test/fixtures/openapi-baseline.json` does not list it. The branch touches neither,
  and the diff names no route of this feature, which is what the file was listed to prove: master
  drift, not fixed here. RED proof for R9: the order receiver file alone on the test commit, 1 of 5
  red for the lost value. `git diff --name-only 2699dd16c..24072b4a0` is
  `packages/modules/orders/src/admin/pages/OrderDetail.tsx` only, so the service-backed run stands for
  the final code tip. The `ci-pg` branch and its worktree are deleted.
- The pull request body is the coordinator's; the upstream pull request is not opened here.
- **Renumbered 161 → 162** (2026-10-22, owner ruling D1 = a): the remote branch
  `feat/161-price-book-editor` (`specs/161-price-book-editor/`) claimed `161` minutes before this
  feature's earlier renumber commit. `162` was free on `origin/master`, on every remote branch and in
  every open upstream pull request. Commit `6b95c5e63` (backup `backup/162-pre-renumber` at
  `3e82a4626`) moves this directory and the sixteen `.changeset/161-*` files to `162`, and rewrites
  every reference to this feature in code comments, test names, specs and the `AGENTS.md` appendix
  (re-run from master's file, tag corrected to `162-custom-fields-value-carry`). The dated records
  above that say `161` — the 2026-10-21 renumber, the backup refs `backup/161-pre-rebase-1` and `-2`,
  T058 and R5 — are left as written; `issue #161`, `D-161`, `T161` and the 161-character name limits
  are other subjects and unchanged. No docs page named the number, so no Polish cache was re-pinned.
  Branch renamed to `feat/162-custom-fields-value-carry`. Local: `check:release-intent --since
  origin/master` 0 violations, `check:docs-translations` and `check:module-docs` 0 findings,
  `dco-signoff.ts` 0 findings, `test/unit/docs/agents-router.test.ts` 28/28, `composer:generate`
  leaves `git status --porcelain` empty. Fork CI on `6b95c5e63`: `quality`, `quality:static`,
  `test:backend:unit`, `test:frontend`, `release:changeset`, `pack-gate`, `boot-gate`, `build:docs`,
  `dco` all green; no flake re-run.

---

## Review fixes (2026-10-21)

Code review and security review of the pushed tip `b375f9ee5`, with the owner's rulings P1–P4 and
W1 and the coordinator's label-fallback ruling.

- [x] **R1 [should] Quote Request receiver without the row lock.** `quote-request-custom-field-carry-receiver.ts`
  now reads the request `for update` (`LockMode.PESSIMISTIC_WRITE`) inside its Command's transaction and
  plans over the bag it re-reads under the lock. Not `underRowLock`: the system caller read no version, and
  its 409 would lose the carry with nobody to retry it. An admin PATCH that holds the row is waited for and
  its value kept; one that read before the carry is refused on the version the carry bumped. Owner ruling
  P1 = c keeps the bump. `[PG]` `integration/quote_requests/custom-field-carry-receiver.test.ts` "waits for a
  write that holds the row…": a raw transaction holds the row and changes another key; the carry is still
  pending after 300 ms; after the commit the bag holds both keys and `version` is +2. The discriminating
  assertion is the final bag, which does not depend on timing. The QA pin
  `integration/crm/custom-field-carry-quote-version.test.ts` is unchanged.
- [x] **R2 [should] A carry that throws after the link.** `opportunity-origin-link-service.ts` catches around
  `carryIntoDocument` and warns with `opportunityId`, `documentKind`, `documentId` and the error, message naming
  "custom-field carry"; never rethrows. Unit: `opportunity-origin-link-service.test.ts` "keeps the link when the
  carry throws…".
- [x] **R3 Owner ruling P2 = a — CRM history strips values.** `OpportunityHistoryService` takes
  `mayReadCustomFields` (`crmOwnerReadChecks.customFields`, `custom_fields:read`, a new member of
  `OwnerReadChecks`) and leaves `customFieldValues` out of every entry's `before`/`after` for a caller without it,
  asked once per page; `customFieldCarry` stays. Unit: `opportunity-history-service.test.ts` (3 new). `[PG]`
  contract: `contract/crm/history.contract.test.ts` "custom-field values need custom_fields:read" (full admin gets
  the values; a `crm:read` + `orders:read` role gets none, the rest of each entry intact). Order and Quote
  Request audit logs are out of scope. Changeset: `crm` patch.
- [x] **R4 Nits.** `custom-field-carry.service.ts`: the dead `options_missing → value_invalid` mapping is gone —
  the branch skips only on the three reasons that can arise. `customFieldCarrySkipLabelSchema`: every string
  `.max(200)` (`CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX`), contract test in `custom-fields.carry.test.ts`; since a
  definition's per-locale labels are not capped, `labelOf` cuts the snapshot to 200 UTF-16 code units (what
  `.max` counts), never inside a surrogate pair, so a skip written now always parses (unit: "cuts a label
  snapshot…", "cuts by what the schema counts…"). Consumers re-run: `history-projection.test.ts` 30/30,
  `opportunity-custom-field-carry.test.ts` 5/5, the `mod-orders` package suite 219/219. `customFieldCarrySkipRecord` documents that it
  strips every other field.
- [x] **R5 `AGENTS.md` appendix.** `origin/master`'s file re-run through `update-agent-context.sh` with
  `SPECIFY_FEATURE_DIRECTORY=specs/161-custom-fields-value-carry`, tag corrected from
  `feat/161-custom-fields-value-carry` to `161-custom-fields-value-carry`. The result is byte-identical to the
  branch's file: the script keeps the newest three Recent Changes, so `156-asset-stable-url` drops by its own
  rule. `test/unit/docs/agents-router.test.ts` 28/28.
- [x] **R6 Docs (en + pl).** `quote_requests.md` and `crm.md`: the version bump after a create from an
  Opportunity and the `409 VERSION_CONFLICT` re-read (P1). `custom_fields.md`: an Opportunity field's audience
  is about the target document (P3); the drift-warning buttons are *Add option anyway* / *Dodaj opcję mimo to*
  and *Change audience anyway* / *Zmień widoczność mimo to* (W1; *Save anyway* gone); an unlabelled skip names
  the key, no definition lookup. `crm.md`: history values need `custom_fields:read` (P2), and the Admin UI
  sentence that listed values under codes for such readers now says none are listed. The pages do not quote
  the create-row help text, so P4's wording is not quoted. Polish caches re-pinned;
  `check:docs-translations` and `check:module-docs` 0 findings.
- [x] **R7 Phase 7 mutation check — `carry-drift.ts` `applied()`.** Code review found that RED had never been observed for the drift helper. Each branch of
  `applied()` in `packages/modules/custom_fields/src/admin/lib/carry-drift.ts` was broken on its
  own (the change made a no-op, or `delete` answering the definition instead of `null`), both suites
  were run against `src` (`admin/test/modules/custom_fields/carry-drift.test.ts` and
  `CustomFieldsPage.carry-drift.test.tsx`), and the branch was restored before the next one. Base:
  `bb3e76345` (W1, after the rebase onto `8cd00c718`) plus the admin fixes of this round.

  | Branch broken | `carry-drift.test.ts` | `CustomFieldsPage.carry-drift.test.tsx` |
  | --- | --- | --- |
  | `remove-option` → `return definition` | RED, 2 of 17 | RED, 8 of 23 |
  | `add-option` → `: definition` | RED, 1 of 17 | RED, 4 of 23 |
  | `audience` → `return definition` | RED, 2 of 17 | RED, 4 of 23 |
  | `delete` → `return definition` | RED, 2 of 17 | RED, 5 of 23 |

  No mutation survived, so no test was added for it. All 17 + 23 tests are green with the source
  restored.
- [x] **R8 [admin UI] CRM history for a reader without `custom_fields:read` (follows R3).**
  `OpportunityHistory.tsx` drops a `customFieldValues` change for that reader even if a response
  carries one (client gate; no definitions read), and a `crm.opportunity.update` entry left with
  nothing to show says `history.customFieldValuesHidden` — "Custom field values changed. Your role
  does not give access to them." / „Zmieniono wartości pól niestandardowych. Twoja rola nie daje do
  nich dostępu.". `admin/test/modules/crm/history.test.tsx`: fixtures for that reader now pass
  through `servedWithoutCustomFields` (the stripped response); new tests for the placeholder (en +
  pl), its absence for a permitted reader and for an edit showing another field, and the client
  gate against a response that still carries values. RED observed: with the drop and the
  placeholder removed, 3 of 38 fail. Changeset `162-crm-history-hidden-values-ui.md` (`crm` patch).

- [x] **R9 [should] Order receiver without the row lock** (coordinator ruling S6, consistent with owner
  ruling P1). `order-custom-field-carry-receiver.ts` now reads the Order `for update`
  (`LockMode.PESSIMISTIC_WRITE`) inside its Command's transaction and plans over the bag it re-reads under
  the lock, as R1 does for the Quote Request. An Order has no `version`, so nothing is bumped. `[PG]`
  `integration/orders/custom-field-carry-receiver.test.ts` "waits for a write that holds the row…": a raw
  transaction holds the Order's row and writes another key; the carry is still pending after 300 ms; after
  the commit the bag holds both keys. The discriminating assertion is the final bag. RED observed on the
  fork's service-backed run against the test commit alone: the bag held only the carried key, the other
  writer's value lost; 4 of 5 green. Changeset: a bullet in
  `162-orders-custom-field-carry-receiver.md`. *Known residue*: the admin `PATCH
  /api/v1/admin/orders/:id/custom-fields` reads without a lock and writes the whole bag, so an
  administrator's write that read before a carry and commits after it can still drop the carried value;
  Orders have no version to refuse it with — left for the coordinator.
- [x] **R10 W1 — the add-option and audience drift buttons** (owner ruling W1, 2026-10-21, supersedes V1's
  "Save anyway"). `carryDriftProceed` maps `add-option` → `.warning.proceedAddOption` ("Add option
  anyway" / "Dodaj opcję mimo to") and `audience` → `.warning.proceedChangeAudience` ("Change audience
  anyway" / "Zmień widoczność mimo to"), both default-styled; `.proceedSave` is gone and
  `CustomFieldsPage.carry-drift.test.tsx` asserts it (and the older `.proceed`) is absent from the bundle.
  Tests: `carry-drift.test.ts` (the mapping per kind), `CustomFieldsPage.carry-drift.test.tsx` (label and
  style per action, en + pl). Changeset: `162-custom-fields-carry-ui.md`. Commit `bb3e76345`.
- [x] **R11 P4 — help wording and quoted type names.** `customFields.carry.help` / `.helpGroup` read the
  owner's wording ("When a record of type “{entityType}” is created from a record with this field, the
  new record's empty field with the same key receives this field's value." / "… of a selected type …");
  the six `errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.<token>` sentences and the four
  `customFields.carry.reason.*` sentences quote the type names (and the value types). Deliberately
  changed existing assertion (standing rule 12): `integration/custom_fields/carry-options.test.ts`
  "refuses a target with no same-key field" now expects `exists on “order”`. Commits `b899df45c`,
  `95fee6e92`.
- [x] **R12 The drift warning is announced, the reason is text, and unavailable checks say so.**
  `CarryDriftWarning` / `DefinitionEditorDialog`: the dialog is described by the warning
  (`aria-describedby`) and a `role="status"` live region says the warning appeared; the *Incompatible*
  reason is visible small muted text under the chip at every width (no `title`, no screen-reader-only
  copy); when every type's definitions read fails, the table card shows a warning `Alert`
  (`customFields.carry.checksUnavailable` with *Retry*, `customFields.carry.retry`). Tests:
  `CustomFieldsPage.carry-drift.test.tsx`, `CustomFieldsPage.carry.test.tsx`. Docs (S3): the
  `custom_fields` page no longer says the reason shows "on hover" (en + pl, Polish cache re-pinned).
  Commits `8fd3303f1`, `63f197d46`, `3dbb4b9f6`.
- [x] **R13 admin-kit `ModalDialog` takes `aria-describedby`** (needed by R12). Optional; set on the panel
  beside `aria-labelledby`, absent when not passed. Test: `admin/test/components/ModalDialog.test.tsx`.
  Changeset: `162-admin-kit-modal-dialog-described-by.md` (`admin-kit` patch). Commit `172597cd7`.
- [x] **R14 `carryReasonUnknown` fallback.** The Quote Request and Sales Opportunity history renderers
  read a skip reason they do not know as `history.carryReasonUnknown` ("the value could not be carried" /
  Polish in both bundles), never the code; the Sales Opportunity is named "sales opportunity" alike in
  both modules' reason sentences. Tests: `admin/test/modules/crm/history.test.tsx`,
  `admin/test/modules/quote_requests/RfqDetail.history.test.tsx`. Commit `7f0a9aacb`.

- [x] **R15 The order page names no contributor** (found by T060). `admin/test/modules/orders/OrderDetail.after-zone.test.tsx`
  "leaves the host naming no contributor" (master's, present since the mid-delivery rebase) was red:
  `OrderDetail.tsx` spelled `'opportunity'` in the set of note sources it can render. The set is now read
  from `orderCommentSystemNoteSchema`'s `source.entityType` options, so the page names no module; no
  behaviour changes. It had not surfaced before because the earlier tips' `quality` runs were cancelled.
  Locally `admin/test/modules/orders` was run as a directory (25 files, 159 tests green) — an
  exception to standing rule 13.
- [x] **R16 The carry refusal is said where it is fixed** (owner test finding 1.3, 2026-10-22). The editor
  dialog showed a `CUSTOM_FIELD_CARRY_INCOMPATIBLE` refusal at the top of the dialog, scrolled out of sight
  of *Save* and of the carry options. The sentence (still `refusalSentence`, built from `details`) is now
  rendered inside the carry group, describing it and every ticked box (`aria-describedby`,
  `aria-invalid`), and takes the focus; the footer adds `customFields.carry.refusalSummary` beside
  *Save*. The dialog's other save failures moved from the top to the same footer slot (`role="alert"`),
  so the dialog has one error place. The create form's carry refusal likewise left the page-top alert
  for a line under the form's carry group, focused; the page alert keeps the load and table-action
  errors. Changing the boxes (or the record type) withdraws the refusal. `isCarryRefusal` in
  `carry-labels.ts` tells the two apart. Test: `CustomFieldsPage.carry.test.tsx` (US4-3, US4-2 cases).

## Dependencies and order

```text
P1 ─► P2 ─┬─► P3 ─┐
          ├─► P4 ─┼─► P5 ─► P6 ─┐
          └─► P7 ─────────────── ├─► P9 ─► P10
               P3,P4,P5 ─► P8 ──┘
```

- P1 blocks everything (shapes, error code).
- P2 blocks every conversion (the port) and P7 (the attribute).
- P3 and P4 are independent once P2 has landed; P5 needs P3's note builder and P4's CRM services.
- P7 needs the filters feature's editor on the base (T000).
- P8 needs the backend shapes of P3–P5.

## Parallel examples

- Phase 1: T001 ∥ T003 (two test files); T005 after T002.
- Phase 2: T007 ∥ T008 ∥ T009 ∥ T013 (four RED files), then T010 → T011 → T012, T014.
- Phase 5: T028 ∥ T029 (two RED files in two modules), then T030 → T031, T032; T033 → T034.
- Phase 8: T047 ∥ T048 ∥ T049, then T050 ∥ T051 ∥ T052 (three modules).

## Implementation strategy

MVP = Phases 1–3 + the custom_fields part of Phase 7: an operator can configure Quote Request →
Order and see it work at checkout (US4 + US1, both P1). Phases 4–5 add the Opportunity pairs (US2,
US3, P2). Phase 6 proves the cross-cutting rules; 8–9 make the skip entries readable and
documented; 10 is the gate. Each phase is committable on its own; the branch is not opened as a pull
request before Phase 10.

## Requirement → test

| Req | Test(s) |
| --- | --- |
| FR-001 | T001, T007, T008 (`pair_unsupported`), T042 (offered toggles) |
| FR-002 | T008 (create/patch, audit), T042 (editor) |
| FR-003 | T001 (rule), T008 (each refusal), T042 (sentence) |
| FR-004 | T008 (stored values unchanged; no back-fill) |
| FR-005 | T009, T036, T037 |
| FR-006 | T042 (column, en + pl) |
| FR-007 | T013, T017, T023, T033 |
| FR-008 | T017 (placement only), T023 (re-delivery once; manual link carries nothing), T033 (`linked` only) |
| FR-009 | T013, T023 (join keeps), T028 (QR keeps), T029 |
| FR-010 | T013, T017, T023, T028, T029, T033 |
| FR-010a | T003, T016, T017, T029, T039, T047 |
| FR-011 | T001, T008 (`audience_mismatch`), T013, T038 |
| FR-012 | T017 (other Organization not vouched), T028/T029 (`not-found`), T033 |
| FR-013 | T017 (impersonation audit), T023 (system actor in create/link), T028/T029 (receiver Command actor), T033 (operator on creation, system on carry) |
| FR-014 | T013 (owner absent), T036, T037 |
| FR-015 | `check:module-boundary`, `check:port-dependencies` (P2–P5) |
| FR-016 | T005, T042, T047 – T049, `check:bundle-pairing` |
| FR-017 | no permission change — `check:action-route-permissions` unaffected (P10 CI) |
| FR-018 | T054 – T057 |
| FR-019 | T008 (server allows drift), T041, T043 |
| FR-020 | T042 (mark appears and clears) |
| P1 (owner ruling 2026-10-21) | R1 (`[PG]` `integration/quote_requests/custom-field-carry-receiver.test.ts` "waits for a write that holds the row…"), `[PG]` `integration/crm/custom-field-carry-quote-version.test.ts`, R9 (`[PG]` `integration/orders/custom-field-carry-receiver.test.ts` "waits for a write that holds the row…") |
| P2 (owner ruling 2026-10-21) | R3 (`opportunity-history-service.test.ts`, `[PG]` `contract/crm/history.contract.test.ts` "custom-field values need custom_fields:read"), R8 (`admin/test/modules/crm/history.test.tsx`) |
| V3 (owner ruling 2026-10-21) | T063, T064 (label snapshot, contract and writers), T067 (the three renderers name the field without `custom_fields:read`), R4 (label cut to 200) |
| SC-001 | T017, T023, T033 |
| SC-002 | T017, T023, T029, T036, T037 |
| SC-003 | T013, T023, T028 |
| SC-004 | T017, T023, T028, T029 (exactly one entry each) |
| SC-005 | T008, T013, T017, T038 |
| SC-006 | T016, T017, T028 (QR entry absent for the buyer), T029, T039 |
| SC-007 | T043 |
