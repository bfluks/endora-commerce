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
  membership and language changes — superseded in round 3), and SC-008. No open clarification marker remains. D-1 (draft preview
  reachability) stays deferred with an interim reading, by owner choice; the FR-010 value set is provisional
  and is re-asked before acceptance.
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
- "No implementation details": the *Current state* section cites code paths deliberately (house style of
  specs 156/157) to anchor the baseline; requirements themselves are stated as behaviour. FR-016 and FR-052
  name a performance property and the existing bulk path, not a technology.
