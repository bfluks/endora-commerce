# Contract: ports, registries, events and dependency edges

## 1. `TaskReadPort` (published by `tasks`, gated on its presence)

The method set is unchanged. What changes is what the methods return and which Tasks they consider:

- **`TaskRecord`** returns:
  - `status: string` (a code), `statusCategory` and `closed`;
  - `assigneeIds: string[]` instead of `assignedAdminUserId`;
  - `draft` and `private`.
- **Visibility:** every method applies the full visibility predicate, R-3 included. A private Task of another admin is therefore absent from CRM's and Projects' references and lookups.
- **`listOpenInContext`** means category `open` and not a draft (R-1, R-3). Projects' completion gate keeps calling it unchanged.

## 2. `TaskWritePort`

- **`createMany({context, tasks: NewContextTask[]})`.**
  - `NewContextTask` is `{title, description?, assigneeIds?, dueOn?, contextGroupId?, contextNote?, sourceKey?}`.
  - A `sourceKey` that already exists in the context is not created again; its existing id is returned in `ids`, in input order (R-19).
  - New Tasks start in the current initial status and are published, never drafts.
- **`deleteInContext({contextType, contextId})`** is unchanged.

## 3. `TaskContextDescriptor` (registered into `taskContextRegistry`)

The descriptor gains one optional method:

```ts
/**
 * Which of these contexts still exist, and the group ids each has now —
 * regardless of who may see them. Called by `tasks` only under the system
 * actor, from its maintenance pass (issue #450). A context the owner cannot
 * vouch for must be returned as existing: absence here deletes Tasks.
 */
existingContexts?(ids: readonly string[]): Promise<Map<string, ReadonlySet<string>>>;
```

- **Projects' implementation:** one query over `projects` joined to `project_stages`, through `ProjectAccess` in system mode.
- **A contributor without the method** is never cleaned up.

## 4. Ports `tasks` consumes

| Port | Owner | Edge | Used for |
| --- | --- | --- | --- |
| `adminNotificationRecordPort` | `admin_notifications` | `degrades-without` (existing) | assignment, comments, mentions, reminders, digest |
| `transactionalEmailSenderAccessor`, `emailDefaultsPort` | `transactional_emails` | `dependencies` (non-deactivatable) | reminder and digest e-mails |
| `assetsLibraryPort`, asset-reference registry | `assets_library` | `dependencies` + `contributes-to` | attachments |
| `customFieldValueService`, `customFieldListFilterPort`, definition read | `custom_fields` | `dependencies` | the `task` host |
| `orderReadPort` | `orders` | `dependencies` | references, links |
| `catalogProductReadPort` | `catalog` | `dependencies` | references |
| `quoteRequestReadPort` | `quote_requests` | **`degrades-without`**: *"Quote Requests cannot be referenced or linked; existing references and links show as unavailable."* | references, links |
| `opportunityReadPort` | `crm` | **`degrades-without`**: *"Opportunities cannot be referenced or linked; existing ones show as unavailable, and the Tasks panel on an Opportunity is not shown."* | references, links |
| `projectReadPort` | `projects` | **`degrades-without`**: *"Projects cannot be referenced; existing references show as unavailable."* | references |
| `adminUserReadPort`, `permissionService`, `adminTenantScopePort` | `admin_users`, `auth`, `organizations` | `dependencies` (existing or non-deactivatable) | mentions, recipients |

## 5. Port changes in other modules

**`OpportunityReadPort` (`crm`)** gains:
- `findByIds(ids: readonly string[]): Promise<OpportunityRecord[]>`
- `search({q, limit ≤ 20}): Promise<OpportunityRecord[]>`, matching on number and title.

Both are tenant-scoped like `findById` and check no permission. The caller checks `crm:read`.

**`ProjectReadPort` (`projects`)** gains:
- `findByIds(ids)`
- `search({q, limit ≤ 20})`

Both go through `ProjectAccess`, so they return only what the caller may see.

## 6. Events published

Defined in `data-model.md` §8. **Nothing subscribes today.** The removal of
`tasks.task.assigned.v1` and the change of `from`/`to` to codes are breaking changes to
`@endora-commerce/contracts`, and the changeset says so (`specs/conventions/release-intent.md`).

## 7. Registries `tasks` contributes to

- **`adminSearchProviderRegistry`** (existing): the provider applies R-3.
- **Asset-reference registry (new):** `findReferences(assetIds)` answers `{kind: 'task_attachment', entityId, label: 'Task TSK-…'}`. It is pushed from a contribution-only boot hook with no presence probe, so the protection holds while Tasks is off.

## 8. Workers

There is one queue, `tasks-reminders`. It is a Job Scheduler with an id equal to the queue name, it ticks every 60 s, it carries no data and it runs with `concurrency: 1`. It is attached through `ctx.worker` and only where `processRunsWorkers`.

Each tick runs at most three passes. Each pass is gated by `isPresent('tasks')` and by its own `anyRowExists` probe before entering `enterSystemScope`:

| Pass | Cadence inside the tick | Probe |
| --- | --- | --- |
| reminders | every tick | a reminder is due without a delivery for one of its recipients |
| digest | when ≥ 15 min have passed since the last digest pass (an in-memory stamp; a restart only makes it run sooner) | a subscription has `hour <= local hour` and was not sent today |
| maintenance (#450) | when ≥ 15 min have passed since the last maintenance pass | a Task has a context |
