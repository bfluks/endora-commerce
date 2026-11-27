# Acceptance — spec 193, review checkpoint 2 (UI block)

Product owner, 2026-11-27, tip 052a7957e (feat/193-product-visibility-rules). Scope: US1 (not US1-9, -13, -14, -20),
US2, US4 (not US4-10, -12, -13), FR-074, FR-076. Phases 9a/9b out of scope.

**Verdict: ACCEPTED WITH CONDITIONS.** No blocking spec drift. Conditions C1–C4 below.

## Evidence run by me
- `pnpm --filter admin exec vitest run test/modules/product_visibility_rules`: 5 files, 92 tests, green (the 123/123 figure includes the extra
  paths of T103's verification line; I did not re-run those).
- CI on 052a7957e (`gh pr checks 25`): all green except `dco` and `test:frontend`.
  - `test:frontend`: one failure, `packages/cli test/dev-all.test.ts > superviseDev … an interrupt stops every layer` (10 s timing
    test). Not a spec 193 file; looks like a flake. Re-run before merge.
  - `dco`: exit 2 in CI, but `node backend/scripts/dco-signoff.ts origin/master HEAD` run locally reports 183 commits, 0 findings, and every
    commit on the branch carries a Signed-off-by. Cause unknown (CI log shows no detail). Needs a developer look (C1).
- I did not re-run backend integration suites (need Postgres/Redis); I read the tests named below and relied on the reported green runs.

## Per-scenario verdicts
| Item | Verdict | Evidence |
|---|---|---|
| US1-1, US1-2 | accepted | walked; `catalogue-price-flags.test.ts` "4 × 5 matrix" (SC-001) |
| US1-3 (A=0) | accepted | `catalogue-price-flags.test.ts` "zero vs none"; manager total 5 in walk |
| US1-4 (30/12 paging) | accepted | `catalog/visibility-list.test.ts` US1-4, SC-002 |
| US1-5, -6, -7, -8 | accepted | `visibility-list.test.ts` (US1-6, FR-036 no-store, SC-003), `visibility-cross-references.test.ts`, `other-admin-reads.test.ts`; walk: URL 404, search 0, no-store |
| US1-10, -11, -12 | accepted | `price_lists/book-lines-visibility.test.ts`, `visibility-list.test.ts` (US1-11, -12); walk: variants |
| US1-15 | accepted with note | walk: rep-unrestricted unrestricted; backed by `configuration.test.ts` mapping cases (not read line by line) |
| US1-16, -17, -18, -19 | accepted | `visibility-cross-references`, `visibility-assistant-tools`, `visibility-error-details`, `other-admin-reads` (inventory), `url-key-takeover-visibility` |
| US2-1 – US2-4 | accepted | walked, incl. API-only `DESIGNATION_INVALID`, draft "not in force", `ROLE_NOT_MAPPABLE` 409 |
| US2-5 (audit) | accepted | `configuration-audit.test.ts` |
| US2-6 – US2-8, -10, -11 | accepted | `configuration.test.ts`, `configuration-audit.test.ts`, `RolesSection`/`DesignationsSection` UI tests |
| US2-9 (first enable) | accepted with note | activation text exists (FR-076 only requires the control to "say"); no confirm step, see C3 |
| US2-12, -13, -14, -15 | accepted | `configuration.test.ts`, `off-state.config.test.ts`, `catalogue-price-flags.test.ts` swap case |
| US4-1, -3, -5, -7 | accepted | walked; `website-rule.test.ts`, `admission.test.ts`, `website-rule-timing.test.ts` |
| US4-2 | accepted with note | walk: DB membership only; storefront listing not walked. `website-rule-timing.test.ts` plus `admission.test.ts` ("never on the channel before admission") cover it. Manual storefront glance recommended (C4) |
| US4-4 (no attribute value), US4-6 (new product) | accepted | `pending-admission-values.test.ts` (connector `applyScopes`, on admission appears with values, US4-6); `admission.test.ts` (US4-6, SC-005) |
| US4-8, -9, -11 | accepted | `website-rule-governor.test.ts`, `pending-admission-*.test.ts`, `website-rule-timing.test.ts` (US4-11) |
| FR-053 / T103 rule read + edit | accepted | `website-rule.test.ts` T103 block, `WebsiteRulesPage.test.tsx` (46 tests); not browser-walked after T103 (C4) |
| FR-094 | accepted | `price_lists/book-export-visibility.test.ts` (export, replace, dry-run, header counts) |
| FR-074 (pl+en) | accepted | `i18n/pl.json`, `en.json`; `gte_zero` = owner wording, verified at pl.json:115 and en.json:115; admin registered-bundles test per T103 verification |
| FR-076 (ships off) | accepted | walk: Off state, 503 `MODULE_DISABLED`, switching on restores; `off-state.*.test.ts` (6 files) |

Quickstart steps not walked:
- Step 3, 60 s: `flags-change-feed.test.ts` asserts under 60 000 ms (FR-062). Accepted.
- Step 4, end date in the past: `configuration.test.ts:290` and `admin-visibility-scope.test.ts` (`outside_schedule` drops the currency) accepted by tests. Only the future-start case is asserted at integration level; no integration test with a past `endsAt` (warn, not block).
- Step 5, 150 s swap: `catalogue-price-flags.test.ts` "a designation change swaps generations" plus races (1)–(6). I did not find an assertion of the 150 s bound itself; behaviour is covered, bound is by design. Accepted.
- US4-4 connector `applyScopes`: accepted by tests (`pending-admission-values.test.ts`, `admission.test.ts` FR-093 cases).
- US4-6 zero-channel: `sales-channel-membership.governor.test.ts` (floor waived, "connector create naming only its governed channel ends on no channel"). Accepted. No manual check required.

## Conditions
- **C1 (block merge, not acceptance):** `dco` check failing in CI although local run is clean: developer to find the cause. Re-run `test:frontend` (cli flake).
- **C2:** walk-through fixes in progress (roles table at 390 px, 55 currencies, role-editor panel below Save) land and get a re-check by the designer. None changes a requirement; I do not reject on them.
- **C3:** module activation has no confirm step. FR-076 is met as written (text says FR-023 applies at once). Owner to decide whether a confirm is wanted; if yes, add it to FR-076 first (spec amendment), then designer.
- **C4:** short manual pass before checkpoint 3: US4-2 storefront listing on X, and T103 edit of an attached rule through the change preview.

## Stale or inconsistent spec text (owner/PO to fix; not code defects)
1. `tasks.md` T102 "Leftover" note (line ~329) says the header `rowCount` still counts every row. That was resolved by the checkpoint 1 fix round F1 and FR-094's amendment. Mark as resolved.
2. `tasks.md` T004 is unchecked. Its build note says the `price-lists.ts` half landed and the error codes join per raise site. Tick it or state the remaining part explicitly (status honesty).
3. `quickstart.md` step numbers (US1 1–5, US4 1–7) do not match the spec's US1-n / US4-n acceptance numbering, yet the checkpoint text cites both. Add a one-line mapping or retitle the steps.
4. `quickstart.md` has no step for T103 (open and edit a saved rule; attached rule goes through the change preview, FR-053), nor for FR-094 (restricted price-book export/replace), nor FR-085 stock/products CSV refusal. Add short steps.
5. `quickstart.md` US2 step 1 says the activation text covers "unmapped quote-handling roles"; check it still matches the shipped activation text and the C2-04 deviation (every mapped role is asked, "if" wording).
6. `tasks.md` C2-04 records a deviation (confirm for every mapped role because the overview does not say which roles handle quotes). Not in spec.md; fine as a note, but confirm owner knows.
7. FR-085/FR-086 amendments and FR-094 are present in spec.md (lines ~985, ~991, ~1049) and consistent with T054/T102 and `other-admin-reads.test.ts`. FR-053 text ("or an attached rule is changed") already matches T103. No change needed.
