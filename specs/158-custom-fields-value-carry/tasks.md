# Tasks: Custom-field value carry-over (`specs/158-custom-fields-value-carry/`)

**Input**: [spec.md](./spec.md) (clarified 2026-10-16; owner rulings C4 (a), C5 (c); issue #287),
[plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/carry-api.md](./contracts/carry-api.md),
[contracts/admin-surfaces.md](./contracts/admin-surfaces.md), [quickstart.md](./quickstart.md).

**Organisation**: ten phases, **one builder spawn each**, each ≤ 10 tasks and **independently
committable** on `feat/158-custom-fields-value-carry`, built in its own `git worktree` (T000a;
`git commit -s`, English conventional message, no AI trailer). `158` is the number this directory
carries once it enters the branch — the first free number on `origin/master` above the floor
(T000); until then the directory and every `158` / `158` below are placeholders. Each phase ends
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
  with `N` the first free number (replace `158` below). Each line is self-contained:
  ```bash
  git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master
  set -o pipefail; N=158; specs_on_master="$(git ls-tree --name-only origin/master specs/)" && { printf '%s\n' "$specs_on_master" | grep -E "^specs/${N}-" && echo "STOP: ${N} is taken on origin/master" || echo "${N} is free on origin/master"; }
  set -o pipefail; git show origin/master:specs/pre-migration-history/README.md | grep -F '| Last pre-migration feature |'
  set -o pipefail; N=158; remote_heads="$(git ls-remote --heads origin)" && { printf '%s\n' "$remote_heads" | grep -E "refs/heads/[a-z]+/${N}-" && echo "STOP: a remote branch carries ${N}" || echo "no remote branch carries ${N}"; }
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
  names them before T001. Then **renumber sweep**: in this directory and in every `.changeset/158-*`
  path below replace `158` / `158` with `${N}`.
  **Result** (2026-10-20): `origin/master` at `842b66eb9`; `N` = 158, free on `origin/master` and on every
  remote branch, above the README floor `136`. `QuoteRequestSourceAssessment` present (feat/155 merged);
  `listFilter` present (the filters feature merged); no carry or system-note symbol on master. `git log`:
  feat/155's and the filters feature's commits, the `0.107.0` release (changelog and version only), and
  `91df8b536` (`specs/154-sales-channel-access/`, basket channel attribution), which rewrites part of
  `order-service.ts` placement — the Phase 3 anchors in `order-service.ts` are re-derived at the start
  of Phase 3.
- [x] T000a Stand the worktree up (`AGENTS.md` § *Commands*; never a symlinked `node_modules`),
  from the directory holding the primary checkout, then copy the four untracked `.env` files:
  ```bash
  git -C endora-commerce worktree add ../endora-commerce-wt-158 -b feat/158-custom-fields-value-carry origin/master
  bash endora-commerce-wt-158/scripts/setup-worktree.sh
  for f in .env backend/.env admin/.env storefront/.env; do cp -p "endora-commerce/$f" "endora-commerce-wt-158/$f" || echo "MISSING: $f"; done
  git -C endora-commerce-wt-158 check-ignore -v .env backend/.env admin/.env storefront/.env
  (cd endora-commerce-wt-158 && pnpm run build:packages)
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
  the changeset `.changeset/158-contracts-custom-field-carry.md` —
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
  `.changeset/158-custom-fields-carry-options.md` — `'@endora-commerce/mod-custom-fields': minor`:
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
- [x] T022 Changeset `.changeset/158-orders-custom-field-carry-placement.md` —
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
- [x] T027 Changeset `.changeset/158-crm-custom-field-carry.md` — `'@endora-commerce/mod-crm':
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
- [x] T035 Changesets: `.changeset/158-quote-requests-custom-field-carry.md` —
  `'@endora-commerce/mod-quote-requests': minor` (`quoteRequestCustomFieldCarryPort`, the
  `custom-field-carry-skipped` history entry, admin-only); `.changeset/158-orders-custom-field-carry-receiver.md`
  — `'@endora-commerce/mod-orders': minor` (`orderCustomFieldCarryPort`); extend
  `.changeset/158-crm-custom-field-carry.md` with the Opportunity → document carry and the new
  non-binding edge

**Phase 5 result** (2026-10-20):
- Migration `20261020T130555_quote_requests_quote_request_event_carry_skipped`, registered in the
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

---

## Phase 6: Off-state, audience and visibility proofs **[backend]**

**Goal**: FR-005, FR-014 on both owned types and both axes; SC-005, SC-006 on every target type
(research R-12, R-13).

- [ ] T036 [P] **RED → green** Extend `backend/test/integration/crm/off-state.test.ts`: with `crm`
  off (deactivated while platform-available, and platform-unavailable) an order placed from a
  vouched QR still carries QR → Order; no Opportunity is created or joined and the order's
  values are untouched; switching `crm` back on creates nothing for that order (no replay, US2-4,
  FR-014); `GET …/custom-fields/entity-types` offers no `opportunity` carry target meanwhile
- [ ] T037 [P] **RED → green** Extend `backend/test/integration/quote_requests/off-state.test.ts`
  (feat/155 also extended this file — append a separate `describe`): with `quote_requests` off, a
  basket seeded from a QR places an Order that carries nothing (no vouched source); Opportunity →
  QR is not attempted (CRM's `isPresent()` decision — no 503 in the log, the Opportunity's
  history unchanged); `quote_request` carry options are hidden and retained; after re-enabling,
  they are served again and nothing is replayed
- [ ] T038 [P] **RED → green** New `backend/test/integration/custom_fields/carry-audience.test.ts`
  (SC-005), for each target type that has a non-admin reader — Order (buyer order detail
  `GET /api/v1/orders/:id`, API-key order read) and Quote Request (buyer request detail):
  (a) a `customer`→`customer` carry whose **source** is then made `internal` → the value is skipped
  `audience_mismatch` and appears in no buyer or API-key reply; (b) an `internal`→`internal` carry
  whose **target** is then made `customer` → skipped likewise; (c) a `customer`→`internal`
  carry → carried, and the value appears in admin replies only. The Opportunity has no non-admin
  reader; its case is covered by T013
- [ ] T039 [P] **RED → green** New `backend/test/contract/orders/carry-system-note-visibility.test.ts`
  (SC-006): after a placement that writes a system note, the buyer's comments route, the buyer's
  order detail, the API-key order read and the transactional-email outbox contain nothing of it;
  the admin comments route does
- [ ] T040 Run the off-state and presence ratchets and record the results under this task:
  `check:off-state-coverage`, `check:entry-presence`, `check:subscribe-seam`; if a ledger asks
  for an entry, add it with its reason in the same commit

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
  `i18n:hardcoded` adds no finding. Then the changeset `.changeset/158-custom-fields-carry-ui.md` —
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

- [ ] T047 [P] [US1] **RED** New `admin/test/modules/orders/OrderDetail.system-note.test.tsx`
  (StrictMode; `apiClient` mocked as the existing order detail tests do): a comment with
  `systemNote` renders author *System*, the *Internal* marker and one line per skipped key with the
  translated reason, in `en` and `pl`; the field's label is used when the Order definition is
  known, the key otherwise (truncated at 64); a comment without `systemNote` renders as before.
  Fails: renders the fallback body under no author
- [ ] T048 [P] [US3] **RED** Extend `admin/test/modules/quote_requests/RfqDetail.history.test.tsx`:
  a `custom-field-carry-skipped` entry renders its title with the Opportunity's reference and one
  line per key and reason in `en` and `pl`. Fails: unknown type
- [ ] T049 [P] [US2] **RED** Extend `admin/test/modules/crm/history.test.tsx`: a
  `crm.opportunity.create` and a `crm.opportunity.link_add` entry whose `after.customFieldCarry`
  has skipped keys render "Not carried from …" with one line per key and reason; for a reader
  without `custom_fields:read` the lines are not shown (the existing `canSeeCustomFields` gate).
  Fails: raw key rendered
- [ ] T050 [US1] Implement in `packages/modules/orders/src/admin/pages/OrderDetail.tsx` and add the
  keys to `packages/modules/orders/i18n/{en,pl}.json`; T047 green
- [ ] T051 [US3] Implement in `packages/modules/quote_requests/src/admin/pages/RfqHistory.tsx`
  (keys in `packages/modules/quote_requests/i18n/{en,pl}.json`); T048 green
- [ ] T052 [US2] Implement in `packages/modules/crm/src/admin/components/OpportunityHistory.tsx`,
  add `customFieldCarry` to `LABELLED_HISTORY_FIELDS` in
  `packages/modules/crm/src/admin/lib/history-fields.ts` and its keys to
  `packages/modules/crm/i18n/{en,pl}.json`; `packages/modules/crm/src/admin/index.test.ts` green;
  T049 green
- [ ] T053 Changesets `.changeset/158-orders-carry-note-ui.md` (`mod-orders`: patch),
  `.changeset/158-quote-requests-carry-history-ui.md` (`mod-quote-requests`: patch),
  `.changeset/158-crm-carry-history-ui.md` (`mod-crm`: patch)

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

---

## Phase 9: Documentation, en + pl **[docs]**

**Goal**: FR-018 (`specs/conventions/module-documentation.md`, `docs/docs/contributing/documentation-i18n.md`).

- [ ] T054 [P] `packages/modules/custom_fields/docs/custom_fields.md` (created by the filters
  feature) gains *Carrying values between Quote Requests, Orders and Sales Opportunities*: the five
  pairs, fill-empty, the compatibility rule, the configuration refusal and its reasons, the
  audience rule, the drift warning and the *Incompatible* mark, skip-and-record; and
  `docs/docs/architecture/custom-fields.md` gains the carry port and receiver ports (who computes,
  who writes, R-5/R-6)
- [ ] T055 [P] `packages/modules/orders/docs/orders.md` (the carried values at placement, the
  system note), `packages/modules/quote_requests/docs/quote_requests.md` (the
  `custom-field-carry-skipped` history entry, admin-only), `packages/modules/crm/docs/crm.md` (the
  carry on creation, joining and from an Opportunity; the history member; system attribution; no
  carry on manual links)
- [ ] T056 The Polish pages under `docs/i18n/pl/docusaurus-plugin-content-docs/current/`
  (`architecture/custom-fields.md`, `modules/{custom_fields,orders,quote_requests,crm}.md`) and the
  translation cache entries in `docs/translation-cache/pl/` per the manual workflow
- [ ] T057 `pnpm --filter backend run composer:generate` (module reference pages, sidebar); commit
  any regenerated artefact; `pnpm --filter backend run check:docs-translations`

**Verification**:
```bash
pnpm --filter backend run composer:generate
git status --porcelain
pnpm --filter backend run check:docs-translations
```

(`git status` must list nothing after the commit. `check:naming` / `check:language` and the docs
build run on the fork's CI in Phase 10 — on macOS they need Linux tools.)

---

## Phase 10: Gate — final rebase, local cheap checks, fork CI, service-backed run **[gate]**

**Goal**: every job a pull request runs, on the tip **after the final rebase onto
`origin/master`**, under the remote-CI rule (standing rule 13). Record each result (tip, base,
host or CI run) under its task.

- [ ] T058 Final rebase onto `origin/master` (backup branch first); re-run T000's `git log` and
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
- [ ] T059 Local cheap checks:
  ```bash
  pnpm --filter backend run check:release-intent -- --since origin/master
  node backend/scripts/dco-signoff.ts origin/master HEAD
  pnpm --filter backend run check:error-translations
  pnpm --filter backend run check:port-dependencies
  pnpm --filter backend run check:module-boundary
  ```
- [ ] T060 Push the branch to the fork and open the draft pull request; record the CI result of
  every job on the pushed tip — `quality` (whole-workspace `typecheck`, `lint` and the workflow's
  check list), `quality:static` (naming, language), `test:backend:unit`, `test:frontend` (the
  packages' co-located suites included), `release:changeset`, `pack-gate`, `boot-gate`,
  `build:docs`, `dco`. A red job is fixed on the branch with a new signed commit and re-pushed.
- [ ] T061 Service-backed run on the fork: build the throwaway `ci-pg/<branch>` branch from the
  tip plus the fork-only workflow commit and a `ci-pg-files.txt` listing, relative to `backend/`,
  every server-bound file this feature adds or changes —
  `test/integration/custom_fields/{carry-options,entity-owner-presence,carry-port,carry-audience,cross-tenant}.test.ts`,
  `test/contract/custom_fields/host-managed.test.ts`,
  `test/contract/orders/{comments,carry-system-note-visibility}.test.ts`,
  `test/integration/orders/{place-order-custom-field-carry,place-order-from-quote-request,custom-field-carry-receiver,admin-write-scope,admin-create-origin}.test.ts`,
  `test/integration/quote_requests/{custom-field-carry-receiver,off-state,history,admin-create-origin}.test.ts`,
  `test/integration/crm/{custom-field-carry-into-opportunity,custom-field-carry-from-opportunity,auto-create,history,custom-fields,off-state}.test.ts`,
  `test/integration/_i18n/error-code-ownership.test.ts`, `test/contract/kernel/openapi-baseline.test.ts`,
  `test/contract/kernel/harness-parity.test.ts` — push it, record the per-file table, delete the
  branch. A red file is fixed on the feature branch (never on `ci-pg/…`) and the run repeated.
- [ ] T062 Record T058 – T061 (tip and base hashes, CI run links, any known-flake re-run with its
  evidence) in this file as a `tasks.md`-only commit; the pull request body says `Closes #287`,
  lists the owner answers to Q1–Q5, and follows the repository's pull-request template

---

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
| SC-001 | T017, T023, T033 |
| SC-002 | T017, T023, T029, T036, T037 |
| SC-003 | T013, T023, T028 |
| SC-004 | T017, T023, T028, T029 (exactly one entry each) |
| SC-005 | T008, T013, T017, T038 |
| SC-006 | T016, T017, T028 (QR entry absent for the buyer), T029, T039 |
| SC-007 | T043 |
