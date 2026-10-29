# Contract: Ports, registries and events

Types live in `packages/contracts/src/tasks.ts` and `projects.ts`. Ports are published with
`ctx.di.providePort` (gated: 503 `MODULE_DISABLED` while the owner is off) and consumed with
`lazyPort<T>(ctx, 'literal')`. Registries are registered ungated with `ctx.di.register` and
filter contributors by `effectiveState.isPresent(ownerModuleId)` when enumerated.

## 1. Published by `tasks`

### `taskReadPort: TaskReadPort`

```ts
interface TaskReadPort {
  findById(id: string): Promise<TaskRecord | null>;           // context-visibility applied (R-9)
  findByIds(ids: readonly string[]): Promise<TaskRecord[]>;    // the same; one query per page of references
  search(q: { q?: string; limit: number }): Promise<TaskRecord[]>;
                                                               // the same; by number or title, newest first —
                                                               // the `@@` list's Tasks (FR-044; added by T106)
  listInContext(q: { contextType: string; contextId: string; contextGroupId?: string }):
    Promise<TaskRecord[]>;
  listOpenInContext(q: { contextType: string; contextId: string; contextGroupId?: string }):
    Promise<TaskRecord[]>;                                     // status ∉ {done, cancelled}
  countInContext(q: { contextType: string; contextId: string; contextGroupId?: string }):
    Promise<number>;
}
interface TaskRecord { id; number; title; status; dueOn; assignedAdminUserId;
  contextType; contextId; contextGroupId; contextNote; completedAt; createdAt }
```

Calls made by the system (no admin session, e.g. a sweep) are not narrowed by visibility.

### `taskWritePort: TaskWritePort`

```ts
interface TaskWritePort {
  createMany(input: { context: TaskContext; tasks: NewContextTask[] }): Promise<{ ids: string[] }>;
  // one tasks.task.create Command per Task, actor = the ambient actor; ≤ 100 per call
  deleteInContext(q: { contextType: string; contextId: string }): Promise<{ deleted: number }>;
  // used when a Project is deleted (spec edge case: "its Tasks are deleted with it")
}
interface NewContextTask { title; description?; assignedAdminUserId?: string | null;
  dueOn?: string | null; contextNote?: string | null }
interface TaskContext { contextType: string; contextId: string; contextGroupId?: string | null }
```

### `taskContextRegistry: TaskContextRegistryPort` (ungated)

```ts
interface TaskContextDescriptor {
  contextType: string;           // 'project'
  ownerModuleId: string;         // 'projects'
  allVisibleContextIds(): Promise<string[]>;            // ambient caller
  visibleContextIds(ids: readonly string[]): Promise<Set<string>>;
  describe(ids: readonly string[]): Promise<Map<string, { label: string; href: string;
    groups: Map<string, string> }>>;                     // groupId → label (Stage names)
  canSeeAs(adminUserId: string, id: string): Promise<boolean>;   // another admin (assignee bell)
  canChangeTasks(id: string): Promise<boolean>;  // ambient caller may put a Task in, take one out
                                                 // (detach / move to another record) or delete one (T144, T147)
  renderNote?(note: string, language: SupportedLanguage): Promise<string>;
}
interface TaskContextRegistryPort { register(d: TaskContextDescriptor): void }
```

Absent or unregistered owner ⇒ Tasks of that context are hidden (fail-closed).

### Events (`tasks`)

| Event | Payload |
| --- | --- |
| `tasks.task.created.v1` | `{ taskId, contextType, contextId, contextGroupId, assignedAdminUserId }` |
| `tasks.task.status_changed.v1` | `{ taskId, from, to, contextType, contextId, contextGroupId }` |
| `tasks.task.assigned.v1` | `{ taskId, from, to }` |
| `tasks.task.deleted.v1` | `{ taskId, contextType, contextId }` |

`projects` subscribes to none in this feature (the gate reads at move time).

## 2. Published by `projects`

### `projectReadPort: ProjectReadPort` (for overlays and later modules)

```ts
interface ProjectReadPort {
  findById(id: string): Promise<ProjectRecord | null>;           // ProjectAccess applied
  findByRecord(kind: 'order' | 'quote_request' | 'opportunity', id: string):
    Promise<ProjectRecord | null>;
}
```

### `projectStageGuardRegistry: ProjectStageGuardRegistryPort` (ungated, R-6)

```ts
interface ProjectStageGuard {
  ownerModuleId: string;
  before(ctx: { projectId: string; fromStageId: string | null; toStageId: string | null;
    kind: 'move' | 'close_completed' | 'close_lost' | 'reopen' }):
    Promise<{ allow: true } | { allow: false; reason: string }>;
}
```

### Events (`projects`)

`projects.project.created.v1`, `projects.stage.moved.v1`, `projects.project.closed.v1`,
`projects.project.reopened.v1`, `projects.record.linked.v1`, `projects.record.unlinked.v1` —
payloads in `data-model.md` §2.5. Emitted once per Command on commit.

## 3. Consumed by `projects`

| Name | Owner | Edge kind (`nonBindingDependencies` unless stated) | `whenAbsent` |
| --- | --- | --- | --- |
| `taskReadPort`, `taskWritePort` | tasks | `degrades-without` | "Projects work without Tasks: no Tasks tab, no Stage Tasks, no completion gates." |
| `taskContextRegistry` | tasks | `contributes-to` | — |
| `opportunityReadPort` | crm | `degrades-without` | "Sales Opportunities cannot be linked to Projects; existing links show as unavailable." |
| `quoteRequestReadPort` | quote_requests | `degrades-without` | "Quote Requests cannot be linked to Projects; existing links show as unavailable." |
| `adminNotificationRecordPort` | admin_notifications | `degrades-without` | "Project members are not notified of messages and mentions, and get Stage deadline alerts by e-mail only." |
| `adminSearchProviderRegistry` | admin_search | `contributes-to` | — |
| `orderReadPort` | orders | `dependencies` (binding; not deactivatable) | |
| `assetsLibraryPort`, `assetReadPort`, `assetReferenceRegistry` | assets_library | `dependencies` | |
| `customFieldValueService`, `customFieldListFilterPort` | custom_fields | `dependencies` | |
| `catalogProductReadPort` | catalog | `dependencies` (Product reference labels) | |
| `adminUserReadPort`, `permissionService` (`PermissionReadPort`) | admin_users | `dependencies` | |
| `adminTenantScopePort`, `organizationDetailsPort` | organizations | `dependencies` | |
| `settingsReadPort` | settings | `dependencies` | |
| `transactionalEmailSenderAccessor`, `emailDefaultsPort` | transactional_emails | `dependencies` | |
| `auditLogService` (`AuditPort`) | platform | — | |
| `auditReferenceRegistry` | audit_logs | `dependencies` (label resolver for `project`) | |

`crm` consumes `taskReadPort` too (`degrades-without`, R-14 / FR-044) to resolve Task
references; it does not register a Task context.

`tasks` consumes: `adminUserReadPort`, `permissionService` (admin_users),
`adminNotificationRecordPort` (`degrades-without`: "Assignees are not notified of new Tasks."),
`settingsReadPort`, `auditLogService`, `auditReferenceRegistry`, `adminSearchProviderRegistry`
(`contributes-to`).

Every consumed name above was read from `crm/src/backend/index.ts`'s `lazyPort` calls on
2026-10-26, where crm already consumes each of them under the same name.
