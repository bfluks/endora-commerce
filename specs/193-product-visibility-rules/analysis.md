# Spec 193 product visibility rules — cross-artifact analysis

Analyzed: `feat/193-product-visibility-rules` @ `1324af947` (spec, plan, research, data-model, contracts, tasks, threat-model, quickstart; constitution I, III, VIII, XI, XIII, XVII). Read-only, no builds/tests. Date 2026-11-25. Saved by the coordinator from the product-owner's report.

**Verdict: not clean** — 1 CRITICAL, 3 HIGH, 10 MEDIUM, 17 LOW.

## Upstream drift and dependencies

| Check | Result |
| --- | --- |
| `origin/master` after fetch | `c3e8a8755`, unchanged on every touched path |
| Spec 192 (#1901) | Issue open, no PR; branch only on fork `feat/192-quote-request-draft-share` @ `bd1edae62` (+13 since `6f4259f45`). No `orders/` or `admin-kit/` file; touches `carts/.../cart-conversion-service.ts`, `contracts/src/errors.ts`, OpenAPI baseline, migrations registry (conflict risk with T004, T008, T025). |
| Related open PR | #1914 quote_requests port — re-measure before Phase 9a |

## Findings

| ID | Severity | Location | Summary | Fix owner |
| --- | --- | --- | --- | --- |
| C1 | CRITICAL | T082, T085, T048; FR→test map | Test-first (Principle III) missing: clone-to-quote refusal (FR-039), `noFixedPrice` row field, assistant-tool scoping (test only in 5c after T048) | architect |
| H1 | HIGH | T049, T068, T070; R-10, R-11 | FR-059/092/093 not wired for `product.scoped_values.import` (connector `applyScopes` + CSV import, `scoped-values-import.ts:304`), `product.bulk_update.undo` (`bulk-operation.service.ts:727`), maybe `copy_to_channels` (`scoped-values.commands.ts:324`); refusal seam is `resolveRequestScope` → `scoped-values-state.ts:204`, T070 targets wrong lines; read side `scoped-values-read.service.ts:324` also refuses non-member scopes | architect |
| H2 | HIGH | FR-090, FR-092, FR-093; ports §2 `excludedOnlyByRule`; R-18; T089 | "Channel-scoped status inactive / moving to active" undefined: channel row vs per-language statuses; do cells stored pending admission count | product-owner → owner |
| H3 | HIGH | FR-043, FR-074; T087 | Only English "no fixed price" pinned; fixed Polish text must be pinned ("brak ustalonej ceny") | product-owner |
| M1 | MEDIUM | quickstart US2 step 1 | Contradicts OQ-G (`*` roles); missing walks for I-2, FR-090–093, US4-9/10/11, Q-2 rebuild | architect |
| M2 | MEDIUM | T017, T020, T071; admin-api | TM-4c 403-with-manage case unbuildable after FR-026 → keep as unit-tested defence in depth | architect |
| M3 | MEDIUM | T050, T051–T054, T044 | Off-state tests missing for 5c surfaces, price-book grid, flags worker | architect |
| M4 | MEDIUM | plan § Parallel builders; T046, T058, T068, T070, T044 | Stream ownership overlaps (sales_channels in T046, admissions ledger writer, PL/manifest.ts), undeclared cross-stream edges, T068 wrongly [P] | architect |
| M5 | MEDIUM | checkpoints 1–3 | Scopes don't match the 192 gate | architect |
| M6 | MEDIUM | plan Complexity row 2; R-10 | Zero-channel exception (waiving at-least-one-channel floor) not in spec | product-owner |
| M7 | MEDIUM | FR-043; admin-api §3; T083, T086, T087 | Quote-line marker has no contract field/test | architect |
| M8 | MEDIUM | spec Dependencies/F3; plan § Sequencing; tasks drift command | Stale 192 facts; drift command misses carts, inventory, import_export, contracts, kernel ports | product-owner + architect |
| M9 | MEDIUM | T042, T047, T021, T037/T039 | Planned behaviour without FR (bulk ops, aggregates, extra overview warnings, `no-store` vs SC-003/FR-073) | product-owner |
| M10 | MEDIUM | FR-076; T077 | Activation text "turning on applies FR-023 at once" untasked/untested | architect |

## LOW
Spec (product-owner): 1 stale Status line; 2 Dependencies still says 9b gate is open; 3 terminology drift (offer-creation/quote-handling/`rfqs:handle`, Q-1/Q1); 4 glossary note: "restricted" includes fail-closed vs port `restricted` kind.
Threat model: 5 old task ids in §3 (pointer to tasks.md map); 6 `liftable` vs `mapping_without_effect`; 7 TM-11 per-channel admin scope unmapped (platform has none — record).
Plan/contracts/tasks (architect): 8 admin-api §2 heading/OQ-D wording; 9 table counts 3+3 vs 4+4; 10 T056 409 without error code; 11 T091 catalog facts via ports only; 12 T059 assert `membership_changed` per rule change; 13 US1-20 explicit in T080; 14 SC-006 timing in T099; 15 Verification lines miss T060/T088/T076 tests; 16 FR-060 integration case; 17 `website_rule_admissions` cleanup on detach.

## Coverage
67 FRs all tasked (partial: FR-039 C1, FR-043 M7, FR-076 M10, FR-092/093 H1); 9 SCs (SC-006 unmeasured); 99 tasks; TM-1..16 mapped (gaps TM-11, TM-4c); all phases ≤ 10 tasks with Verification lines; pl+en covered except H3. Owner answers given with uncertainty (OQ-B, OQ-H) to confirm at acceptance.

**Next:** close C1, H1, H2, H3 (+ MEDIUM), re-run analyze; implementation blocked until clean.

## Round 2 — 2026-11-25

Analyzed `503f528fb` (read-only). `origin/master` `c3e8a8755`, 0 commits on widened drift paths. Spec 192: issue #1901 open, no PR, fork branch `3c740f2c0` (+14 since `bd1edae62`, near done); overlap now also `contracts/src/index.ts`, `error-code-routing/reference-ledgers.ts`, `_i18n/i18n/{en,pl}.json`, `carts/docs/carts.md`. PR #1914 open.

**Verdict: not clean** — 0 CRITICAL, 1 HIGH, 7 MEDIUM, 8 LOW (new). Round 1: all closed (H1 code-verified) except M5 partly (→ N4).

| ID | Severity | Location | Summary | Fix owner |
| --- | --- | --- | --- | --- |
| N1 | HIGH | ports §2 `excludedOnlyByRule`; R-18; T089, T091; FR-090 vs FR-093 | For a rule-excluded (non-member) product every stored channel status is pending or left over; FR-093 says pending ones don't count, FR-090 drops "inactive by channel status"; plan can't tell them apart. T091 unbuildable as specified; T089 setup undefined | architect / owner |
| N2 | MEDIUM | data-model `website_rule_admissions`; T058, T068 | Hook token removals vs "only apply job writes": FR-093 exemption lost after re-admission | architect |
| N3 | MEDIUM | data-model flag note; T068; R-11 | "channel-scoped" wording: per-language write could consume exemption | architect |
| N4 | MEDIUM | checkpoint 2 | Accepts US4-10/12 which are gated (9b) | architect |
| N5 | MEDIUM | T037 | FR-079 governed-channel case needs stream B; undeclared edge | architect |
| N6 | MEDIUM | T070; R-11 read side; FR-093 | Pending values accepted from admin save/copy/read without FR | product-owner / architect |
| N7 | MEDIUM | FR-043 pl text; FR-031/033/036/079/086 | No clarification entry for these; proposals list incomplete | product-owner + owner |
| N8 | MEDIUM | T065 | `sales_channels` FR-082 sweep has no failing test | architect |

LOW: L1 `scoped-values.service.ts:50` caller missing in T070; L2 192 tip/overlap files stale; L3 T077 before T078; L4 threat-model:200 warnings vs FR-086; L5 `no-store` with module absent; L6 checkpoint 1 range FR-074/076; L7 quickstart FR-079 + zero-channel walks; L8 Status line.

Related client-side finding (TM analyze round 2): a PIM connector under a "follow publish" policy writes an inactive channel status for a product hidden in every language and creates it globally inactive — interacts with N1.
