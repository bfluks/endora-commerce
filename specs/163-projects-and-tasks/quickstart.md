# Quickstart: proving each slice

Prerequisites: `pnpm install --frozen-lockfile && pnpm run build:packages`;
`pnpm run dev:infra:test` for contract/integration suites (`TEST_DATABASE_URL` set);
`pnpm run setup` for a local instance with demo data.

Targeted runs while iterating:

```bash
pnpm --filter backend exec vitest run test/integration/projects/<file>
pnpm --filter backend exec vitest run test/integration/tasks/<file>
pnpm --filter admin exec vitest run test/modules/projects
pnpm --filter @endora-commerce/mod-projects run test     # co-located unit tests
pnpm --filter @endora-commerce/admin-kit run test        # promoted components
```

## Story → proving test

| Story | Test (backend unless noted) | Proves |
| --- | --- | --- |
| Foundation | `integration/tasks/off-state.test.ts`, `integration/projects/off-state.test.ts`, `…/migration.test.ts`, `…/tenant-scope.test.ts` | toggleable, absent when off, restored; out-of-scope = not found |
| US1 Run a Project | `integration/projects/stage-walk.test.ts` — with **`tasks` off**: create (2 Orgs, 3 Members, one with two Roles), walk 3 Stages, close completed; second Project closed lost in Stage 2; refused non-permitted move; reopen; concurrent move → one 409 `PROJECT_CHANGED` | spec US1, SC-002 |
| US2 Tasks | `integration/tasks/tasks-crud.test.ts`, `integration/projects/completion-gate.test.ts` (gate refuses naming the Task; lost bypasses; gate off lets go; `tasks` off → gate not applied + entry note) | US2, FR-012, FR-040 |
| US3 Templates | `integration/projects/templates.test.ts` (create from Template, first-Stage Tasks created, later Stage Tasks on entry, single-holder assignment, Template edit leaves Project unchanged, re-entry creates nothing) | FR-015 – FR-017, SC-001 |
| US4 Roles | `contract/projects/roles.contract.test.ts` (seeded en/pl, archive keeps on Projects, system rows not deletable) + `integration/projects/roles-grant-nothing.test.ts` (permission set unchanged) | FR-007 – FR-009 |
| US5 Visibility | `integration/projects/visibility.test.ts` — matrix: setting {everyone, members} × Project {inherit, everyone, members_and_listed} × viewer {member, listed, other, see_all}; plus every route of FR-020 (list, detail, search, mentionable, panels ×4, Tasks of the Project, analytics, notifications) returns not-found-identical for the invisible case | SC-003 |
| Q1 = C | `integration/projects/organization-reach.test.ts` — sales representative reaching 1 of 2 Orgs sees nothing; internal Project visible only to `allowAll`; removing the last Org with links refused | FR-004 |
| US6 Links | `integration/projects/links.test.ts` (Org mismatch 422, double link 409 naming visible holder only, unreadable kind rendered unavailable, crm/quote_requests off → unavailable + not addable) ; `admin/test/modules/projects/ProjectPanel.test.tsx` and the four `*.after-zone` tests | FR-021 – FR-024, SC-006 |
| US7 Collaboration | `integration/projects/comments.test.ts`, `…/mentions.test.ts` (one notification per newly mentioned visible person, never the text), `…/attachments.test.ts` (asset library refuses deletion while used); admin-kit component tests | FR-025 – FR-027 |
| FR-044 `@@` standard | `integration/crm/references-documents.test.ts` (Quote Request and Task tokens saved, resolved, unavailable when hidden / absent / owner off; pre-existing texts unchanged), `migration` up/down for the widened constraint, `contract/crm/document-lookups.contract.test.ts`, `admin/test/modules/crm/ReferenceField.documents.test.tsx` (`@@` grouped list, groups gated by permission and presence) | FR-044 |
| US8 Alerts | `integration/projects/stage-alerts.test.ts` — clock-controlled 60-day timeline: exactly one per eligible Member per (Stage, offset, deadline), none after leaving the Stage, re-armed by a moved deadline, none backdated, skip of a Member out of reach, bell + e-mail outcomes, bell module off → e-mail only | FR-035, SC-004 |
| US9 Custom fields | `integration/projects/custom-fields.test.ts` (required field refusal names it; history hides values without `custom_fields:read`; `projects` off → type not offered) | FR-036 |
| US10 Analytics | `integration/projects/analytics.test.ts` — seeded 50 Projects with hand-computed expectations for every figure, per currency, by Stage name, filters, scope narrowing | FR-037, FR-038, SC-005 |
| US11 Platform | `contract/projects/palette-actions.test.ts`, `admin/test/modules/projects/nav-section.test.tsx`, off-state tests extended per story | FR-039 – FR-041 |
| Perf | `perf/projects/list.perf.test.ts` — 1 000 Projects, list + filter < 2 s; R-9 measurement with 5 000 Projects | SC-008, R-9 |

## Manual walk (after `pnpm run setup` with demo data)

1. Sign in as the demo admin → ⌘K "Projects" → open the demo Template *Showroom fit-out*.
2. ⌘K "New project" → load the Template → two Organizations → add yourself as Project Manager.
3. Stage bar → try to move on with the gated first Stage → refused naming the Stage Tasks →
   complete them in the Tasks tab → move on.
4. Open a linked Order → the Project panel is under its tabs.
5. Settings → *Projects* → visibility *Members only* → sign in as a non-member → the Project is
   absent everywhere, including the Order's panel.
6. `/platform/modules` → switch Tasks off → the Project still works, the Tasks tab is gone, the
   next move out of a gated Stage records "gate not applied".

## Verification before reporting done

`pnpm -r run typecheck && pnpm -r run lint`, the targeted suites above,
`pnpm --filter '!backend' run test` (admin-kit and contracts changed), and the check set:
`check:naming`, `check:language`, `check:command-coverage -- --strict --module projects` (and
`tasks`), `check:admin-zones`, `check:port-dependencies`, `check:port-catches`,
`check:entry-scope`, `check:entry-presence`, `check:module-boundary`, `check:module-docs`,
`check:docs-translations`, `check:bundle-pairing`, `check:action-route-permissions`,
`pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts` (no package script), `overlay:check`, `composer:check`, `manifests:check`.
Grep `backend/test/**` for every CRM admin component path the promotion moves (AGENTS.md trap).
