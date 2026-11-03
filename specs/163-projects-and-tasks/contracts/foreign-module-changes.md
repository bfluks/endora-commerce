# Contract: Changes outside `packages/modules/tasks` and `packages/modules/projects`

The complete list. Anything a task touches outside the two modules and not listed here is a
plan defect to raise, not to do. Each section names its owner's test that must stay green
unchanged, proving existing behaviour is untouched.

## A. Contracts (`packages/contracts/src/`)

| File | Change | Why |
| --- | --- | --- |
| `tasks.ts`, `projects.ts` | **new** — every schema, port and event type of both modules | Principle II |
| `index.ts` | + two exports | |
| `record-references.ts`, `record-rich-text.ts` | **new** — the reference grammar and rich-text helpers under neutral names, types widened to `quote_request`, `task`; `RecordDocumentLookupResponse` (R-14) | one standard for both modules (FR-044) |
| `crm.ts`, `crm-rich-text.ts` | the §9 grammar becomes aliases of the above, **widened** to five types; exported names unchanged | additive; guard: `crm` contract tests, plus new cases for the two types |
| `admin-contributions.ts` | + `'work'` in `AdminNavSectionNameSchema`; + zones `opportunity.detail.after`, `task.detail.after` with props types and `AdminZonePropsMap` entries | R-11, R-16 |
| `custom-fields.ts` | + `'project'` in `supportedEntityTypeSchema` | R-18 |
| `assets-library.ts` | + `project_attachment` in `assetReferenceKindSchema` (additive; no exhaustive switch over it) | the Projects asset-deletion guard's descriptor (T112) |
| `settings.ts` | + `ANALYTICS_REPORTING_TIME_ZONE_SETTING`, `ReportingTimeZonePort`, `isIanaTimeZone` (T146, owner decisions 2026-10-27) | the reporting time zone `analytics` owns and Projects reads; the IANA check shared with `projects.alerts_time_zone` |
| `errors.ts` | + each `TASKS_ERROR_CODES` / `PROJECTS_ERROR_CODES` entry joins `ERROR_CODES` in the same change that first raises it (with its manifest declaration and en/pl translation) | `check:error-translations` refuses an undeclared code |

Before changing either enum: grep `admin/test`, `backend/test` and every package for exhaustive
uses of the enum — including tests that assert on the HTTP listing (`custom-fields/entity-types`)
or hold a literal list of the types, which an identifier grep misses — and repair them in the same change (CRM plan risk row, same trap).

## B. Admin host and design system

| File | Change |
| --- | --- |
| `packages/admin-shell/src/components/AppShell.tsx` | + `work` section after `crm` |
| `packages/modules/_i18n/i18n/{en,pl}.json` | + `appShell.section.work` |
| `packages/admin-kit/src/components/references/` | **new** — `ReferenceField`, `ReferenceText`, `reference-node.ts`, `rich-text-doc.ts`, `mention-trigger.ts` (trigger kinds become a prop: `['admin_user','document','product']`), `ReferenceLookups` adapter type |
| `packages/admin-kit/src/components/comments/` | **new** — `CommentThread`, `CommentComposer` |
| `packages/admin-kit/src/components/attachments/` | **new** — `AttachmentUploader`, `uploadAttachment` (endpoint as a prop) |
| `packages/admin-kit/src/components/record-history/` | **new** — `RecordHistory` (from `OpportunityHistory`; field labels and value renderers as props), `CursorPagination` |
| `packages/admin-kit/package.json` | + `@tiptap/react`, `@tiptap/starter-kit` as peer + dev (same `^3.22.5`) |
| `packages/admin-kit` i18n bundle | the promoted components' strings move with them (en + pl) |

## C. `crm` (guard: every existing `admin/test/modules/crm/*` and `backend/test/{contract,integration}/crm/*` green; only tests asserting `@@` = Orders change, and each such change is listed in the commit; a test may switch the bundle it reads a moved sentence from — same key, same text — and that is listed too)

| File | Change |
| --- | --- |
| `src/admin/components/ReferenceField.tsx`, `ReferenceText.tsx`, `CommentThread.tsx`, `CommentComposer.tsx`, `AttachmentUploader.tsx`, `OpportunityHistory.tsx`, `CursorPagination.tsx`, `editor/reference-node.ts`, `lib/rich-text-doc.ts`, `lib/mention-trigger.ts`, `lib/upload-attachment.ts` | replaced by thin wrappers over the admin-kit components passing CRM's `crmApi` adapters, then the wrappers' call sites updated and the wrappers removed where trivial |
| `src/admin/pages/OpportunityDetail.tsx` | + `<AdminZone name="opportunity.detail.after" props={{ opportunityId: id }} />` after the tabs card |
| `package.json` | Tiptap peers removed by `manifests:generate` if no direct import remains |
| `admin/test/modules/crm/OpportunityDetail.after-zone.test.tsx` | **new** — mount + probe contribution, the `OrderDetail.after-zone.test.tsx` pattern |

**Reference standard (FR-044, R-14)**:

| File | Change |
| --- | --- |
| `src/migrations/<stamp>_crm_opportunity_reference_documents.ts` | **new** — widen `crm_opportunity_references_target_type_check` to `product, order, admin_user, quote_request, task`; `down` deletes the two new types first (precedent `20261007T180600_…_admin_user.ts`) |
| `src/backend/services/reference-service.ts` | resolve `quote_request` (existing `quoteRequestReadPort`, `rfqs:handle`, presence) and `task` (`taskReadPort`) labels and URLs |
| `src/backend/services/owner-read-permissions.ts` | + `tasks: 'tasks:read'` check |
| `src/backend/services/crm-document-lookup-service.ts`, `routes/routes.document-lookups.ts` | + `GET /api/v1/admin/crm/lookups/documents?opportunityId=&q=` (`crm:write`) → `RecordDocumentLookupResponse` |
| `src/backend/index.ts` | + `lazyPort<TaskReadPort>(ctx, 'taskReadPort')` wiring |
| `src/manifest.ts` | + `nonBindingDependencies` `{ moduleId: 'tasks', name: 'taskReadPort', kind: 'degrades-without', whenAbsent: 'References to Tasks show as unavailable and Tasks are not offered after @@.' }` |
| `src/admin/api.ts` | + `lookupDocuments` adapter for the kit's `ReferenceField` |
| `i18n/{en,pl}.json`, `docs/crm.md` (+ Polish copy) | `@@` documented as the document list |
| `specs/143-crm-sales-opportunities/spec.md` | one-line pointer at User Story 18: `@@` superseded by `specs/163-projects-and-tasks/` FR-044 |
| `backend/test/{contract,integration}/crm/references*.test.ts` | + Quote Request and Task references: resolve, unavailable when hidden / absent / module off |

No CRM table other than the constraint above, no permission and no event changes.

## D. `custom_fields` (guard: its contract tests)

| File | Change |
| --- | --- |
| `src/backend/services/custom-field-registry.ts` | + `project` entry (`ownerModuleId: 'projects'`, `orgOwned: true`, `listFilter: true`) |
| `src/backend/services/host-storage-binding.ts` | + `project: { table: 'projects', column: 'custom_field_values' }` |
| `i18n/{en,pl}.json` | + `customFields.entity.project` (Project / Projekt) |

## D2. `analytics` (T146, owner decisions 2026-10-27, #465; guard: `backend/test/integration/analytics/*` and its package tests)

| File | Change |
| --- | --- |
| `src/manifest.ts` | + setting `analytics.reporting_time_zone` (group `analytics`, default `UTC`); + `settings` in `dependencies` (owner of `settingWriteValidatorRegistry`, not deactivatable) |
| `src/backend/index.ts` | + gated `reportingTimeZonePort` (`providePort`); + boot push of the setting's validator into `settingWriteValidatorRegistry` |
| `src/backend/services/reporting-time-zone.ts` (+ test) | **new** — the port and the IANA validator |
| `i18n/{en,pl}.json` | + `settingGroups.analytics.name`, `settingLabels.analytics.reporting_time_zone.*` |
| `docs/analytics.md` (+ Polish copy) | the setting and the port |
| `package.json` | `zod` as a peer (generated: the port's settings read takes a schema) |

Projects reads the port behind a `degrades-without` edge: with `analytics` off or absent its
analytics count in `UTC`. CRM is to read the same port (#474); nothing in CRM changes here.

## E. Tests and scripts outside the modules

| File | Change |
| --- | --- |
| `backend/scripts/check-command-coverage.ts` | + `tasks`, `projects` in `MIGRATED_MODULES` |
| `backend/test/unit/tenancy/scheduled-work-probes.test.ts` | + the projects sweep probe and its `scheduled-work-probe.ts` copy (the one probe + parity test) |
| `backend/test/helpers/package-entities.ts` | + both modules' entities if the helper enumerates packages by hand **[unverified]** — read first |
| `backend/test/{contract,integration}/{tasks,projects}/` | **new** test trees |
| `backend/test/fixtures/error-code-routing/reference-ledgers.ts` | + every minted `TASK_*` / `PROJECT_*` code in `MINTED_ERROR_CODES` |
| `backend/test/unit/_i18n/error-code-migration-progress.test.ts` | + `tasks`, `projects` in the roster |
| `backend/scripts/check-port-dependencies.ts` | ledger the `taskContextRegistry` contribution policy |
| `backend/test/unit/kernel/contribution-absent-owner.test.ts` | + a `projects` composer |
| `backend/test/integration/audit_logs/reference-contributions.test.ts` | + `tasks` among audit-reference owners |
| `backend/test/fixtures/openapi-baseline.json` | regenerated with `UPDATE_OPENAPI_BASELINE=1` whenever a phase adds routes |
| `admin/test/modules/{tasks,projects}/` | **new** |
| `admin/test/modules/admin-kit/…` (or the kit's own test dir) | tests for the promoted components, moved from CRM's where they existed |

## F. Generated and release artefacts

`backend/src/composition.generated.ts`, `manifest-index.generated.ts`,
`db/migrations-registry.generated.ts`, `db/entities-registry.generated.ts`,
`backend/test/entities.generated.ts`, `admin/src/modules.generated.ts`,
`admin/src/tailwind.generated.css`, `docs/sidebars.modules.generated.js`,
`docs/docs/modules/module-map.generated.md`, both packages' `package.json` and `tailwind.css`,
`backend/package.json` (+ `mod-tasks`, `mod-projects` as `workspace:*` — hand-written, no generator
writes it; issue #445),
`pnpm-lock.yaml` (`pnpm install --lockfile-only`). Changesets: one per meaning — `mod-tasks`
(minor, new), `mod-projects` (minor, new), `admin-kit` (minor: promoted components + Tiptap
peer), `contracts` (minor), `mod-crm` (minor: `@@` document list with Quote Requests and Tasks, kit components, new zone),
`mod-custom-fields` (minor: Project host), `admin-shell` (minor: section), `mod-analytics` (minor:
the reporting time zone, T146).

## G. Documentation

`packages/modules/tasks/docs/tasks.md`, `packages/modules/projects/docs/projects.md` (users +
developers), Polish copies under `docs/i18n/pl/…` per `module-documentation.md`; the admin-kit
component docs page if the kit documents components there.

## H. If `projects` is deleted from the codebase

Left behind, all inert and naming no Project concept: the `work` nav section (shows Tasks), the
`opportunity.detail.after` and `task.detail.after` zones (empty), `project` in the custom-field
enum (offered only while its owner is present — so never), the widened reference grammar, the
promoted kit components. `tasks` is untouched. Removing `project` from the custom-fields enum
and registry is the only clean-up a deletion owes.
