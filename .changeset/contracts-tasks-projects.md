---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/mod-i18n': minor
---

The contract surface of the new `tasks` and `projects` modules, one shared reference grammar,
and a new sidebar section.

**`@endora-commerce/contracts`** gains, exported from the package root:

- `tasks.ts` — the Tasks admin API schemas (`TaskListQuerySchema`, `CreateTaskBodySchema`,
  `UpdateTaskBodySchema`, `TaskSummarySchema`, `TaskDetailSchema`, `TaskContextSchema` and their
  siblings, with inferred types), `TASKS_EVENTS` and the event payload types, `TASKS_ERROR_CODES`,
  and the interfaces another module uses: `TaskReadPort`, `TaskWritePort`,
  `TaskContextRegistryPort` with `TaskContextDescriptor`;
- `projects.ts` — the Projects admin API schemas (`ProjectListQuerySchema`,
  `CreateProjectBodySchema`, `CloseProjectBodySchema`, `ProjectTemplateBodySchema`,
  `ProjectAnalyticsQuerySchema`, `ProjectDetailSchema` and their siblings), `PROJECTS_EVENTS` and
  the event payload types, `PROJECTS_ERROR_CODES`, and `ProjectReadPort`,
  `ProjectStageGuardRegistryPort` with `ProjectStageGuard`;
- `record-references.ts` — the `[[<type>:<uuid>]]` reference grammar under neutral names
  (`recordReferenceTypeSchema`, `formatRecordReferenceToken`, `extractRecordReferenceTokens`,
  `splitRecordReferenceText`, `mentionedAdminUserIds`, `RecordReferenceSchema`), the `@@` lookup
  answer `RecordDocumentLookupResponseSchema`, and the shared `RecordHistoryPageSchema`;
- `record-rich-text.ts` — the formatted-text grammar (`parseRecordRichText`,
  `formatRecordRichText`, `recordRichTextToPlain`, `isSafeRecordRichHref`).

`ERROR_CODES` gains the codes the two modules raise — `TASK_NOT_FOUND`, `TASK_CONTEXT_INVALID`,
`TASK_ASSIGNEE_INVALID` and the `PROJECT_*` codes of `PROJECTS_ERROR_CODES`.

**`AdminZoneNameSchema` has a new member, `'task.detail.after'`**, with its props
`TaskDetailZoneProps { taskId }` in `AdminZonePropsMap` — the zone a Task's screen mounts after its
content. A consumer that switches exhaustively over `AdminZoneName` gets a compile error until it
handles the new member.

**The reference grammar reads five types where it read three**: `quote_request` and `task` join
`product`, `order` and `admin_user`. Every CRM name — `opportunityReferenceTypeSchema`,
`formatOpportunityReferenceToken`, `extractOpportunityReferenceTokens`,
`splitOpportunityReferenceText`, `OpportunityReferenceSchema`, `parseOpportunityRichText` and the
rest of `crm.ts` §9 and `crm-rich-text.ts` — is still exported, now as an alias of the shared
one. A text stored before reads as it did. A consumer that switches exhaustively over
`OpportunityReferenceType`, or indexes a `Record` by it, gets a compile error until it handles
the two new members.

**`assetReferenceKindSchema` has a new member, `'project_attachment'`** — a file a Project
uses, which the media library then refuses to delete. A consumer that switches exhaustively over
`AssetReferenceKind` gets a compile error until it handles the new member.

**`AdminNavSectionNameSchema` has a new member, `'work'`**, and `@endora-commerce/admin-shell`
declares the section after *CRM*, labelled "Projects & tasks" / "Projekty i zadania"
(`appShell.section.work` in `@endora-commerce/mod-i18n`). It renders only while a module
contributes a visible entry to it. A consumer that switches exhaustively over
`AdminNavSectionName` gets a compile error until it handles the new member.
