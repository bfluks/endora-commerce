# Specification Quality Checklist: Product data scopes per sales channel and language

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Clarify session 1 (2026-10-21) resolved the original three markers (FR-010 value set, FR-060 gate,
  FR-070/FR-072 URL keys and redirects) and D-2, D-4, D-6, and added FR-017 (effective scoped values in
  every storefront consumer).
- Clarify round 2 (2026-10-21) resolved the remaining four markers: display visibility dropped (FR-003,
  FR-020, FR-021, FR-022 removed, D-3 moot, FR-050 status only); price display mode per channel removed
  (FR-101, D-5); the no-warning rule covers every scoped field (FR-013, A-9); `inactive` below global is
  plain "off" (FR-010). It also added FR-018 (quote requests honour availability) and extended FR-017
  (snapshot language), FR-060/FR-061 (refuse-mode granularity), FR-070/FR-015 (URL-key clashes on
  membership and language changes — superseded in round 3), and SC-008. No open clarification marker remains. D-1 (preview
  reachability of an unpublished product) stayed deferred with an interim reading, by owner choice, and the
  FR-010 value set was provisional and to be re-asked before acceptance — both settled in Session
  2026-10-25 (below).
- Clarify round 3 (2026-10-21): URL keys are unique per language across all channels (option B,
  superseding the per-(channel, language) answer, N4 and C2; C1 moot). FR-070, FR-072, FR-015, FR-041,
  SC-008, US4, US7 and the edge cases were rewritten; the membership- and language-change clash handling
  and the orphaned-by-clash key are gone. The publication window is date-time instants in the operator's
  local time (C3; FR-023, US2, A-10). A channel audience override replaces the whole rule and may name
  non-member organizations with a warning (C4; FR-030, US3). No open marker remains.
- Clarify round 4 (2026-10-21): the three consequences of per-language uniqueness confirmed (FR-070 now
  defines the effective key at (C, L); FR-072 states that a first language key turns the global key into a
  redirect in that language only). Cross-language redirects dropped — only keys of L resolve at (C, L)
  (K1; FR-071, US7 #1, edge case). Imports and PIM connectors writing a taken key have the key refused and
  reported, never taking over a redirect (K2; new FR-093, A-11, US7 #9). The completeness gate's URL-key
  item is satisfied by the global key, while name and required attributes may not be satisfied by another
  language's fallback value (K3; FR-060, US6). The publication window's end is inclusive (K4; FR-023,
  Terms, US2 #5). No open marker remains.
- Session 2026-10-22: owner answers recorded — Q-A serve existing SEO overrides (US8 #2, FR-075, SC-001);
  Q-B language path prefix is a separate issue #396, `?lang` interim with an accepted residual gap
  (FR-071, FR-074); Q-C hide the redirect list with `seo` off (FR-111, US7 #10); M3 the completeness gate
  fires on status writes only, missing values shown in the overview (FR-060, FR-061, FR-041, US6 #6); Q-D
  no single-write undo, bulk undo plus audit before-state (FR-081, US1 #8). Redirect semantics aligned with
  the language-less (former global) redirect of the design (Key Entities, FR-071, FR-072, US7 #11); FR-005
  notes the CMS slug handle; FR-090 requires the admin scope-flag control. No open marker remains; D-1 stayed
  deferred by owner choice (moot since Session 2026-10-25).
- Session 2026-10-25: the owner's final Q1 — status is `active` / `inactive` at every scope, `inactive`
  is plain "off" everywhere, archiving is a separate global Archive / Restore action (FR-010, FR-019,
  FR-053), existing data migrated with today's `inactive` products kept archived (FR-110, SC-009), the old
  values refused by the API with no alias (FR-112), "Archived" a list filter of its own (FR-113); D-1 moot;
  O-1…O-6 and W5 answered. The release is breaking (*Compatibility and release*); the plan records it at
  the bump level D-225 allows in a `0.x` series (`minor`, research R30.6). No open marker remains and no
  item is deferred.
- Analyze after the Block Q plan (2026-10-25, product owner): coordinator decisions recorded — the break is
  a changeset marked BREAKING at `minor` (spec *Compatibility and release*, contracts, plan, R30.6);
  `products_status_check` accepted (data-model §13, whose `down` now matches R30.1); Phase 9c is S2's, inside
  P17 (tasks Blocks table, chain, sequence line, Phase 9c); bulk undo emits for every field (T156k, data-model
  §14); the completeness gate fires when an archived product's status is set `active` (FR-060, edge case);
  feed criteria stored as `status = draft` are not migrated (*Compatibility and release*). Also fixed: the
  410 rule of FR-005 / O-3 stated in full in T156t, T107 and `contracts/url-keys-and-redirects.md` §4;
  T156l's import-adapter RED moved ahead of T156e; SC-002, SC-003, FR-043, FR-084 and FR-092 (Q1) added to
  the coverage table.
- "No implementation details": the *Current state* section cites code paths deliberately (house style of
  specs 156/157) to anchor the baseline; requirements themselves are stated as behaviour. FR-016 and FR-052
  name a performance property and the existing bulk path, not a technology.
