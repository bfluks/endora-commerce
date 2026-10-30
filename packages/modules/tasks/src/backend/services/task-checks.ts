import {
  ADMIN_PERMISSION_WILDCARD,
  ERROR_CODES,
  type AdminUserReadPort,
  type PermissionReadPort,
  type TaskContext,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { TaskContextRegistry } from './task-context-registry.js';
import { taskAssigneeContextHidden, taskAssigneeInvalid, taskContextInvalid } from './task-errors.js';

/**
 * The checks a Task write makes before its first Command runs, shared by the
 * HTTP service and the write port so both refuse alike.
 */

/** Every named assignee is an active administrator, or the whole write is refused. */
export async function assertAssignable(
  adminUsers: AdminUserReadPort,
  adminUserIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const named = [...new Set(adminUserIds.filter((id): id is string => typeof id === 'string'))];
  if (named.length === 0) return;
  const found = await adminUsers.findByIds(named, { activeOnly: true });
  const active = new Set(found.filter((a) => a.status === 'active' && a.deletedAt === null).map((a) => a.id));
  if (named.some((id) => !active.has(id))) throw taskAssigneeInvalid();
}

/**
 * What the Tasks screens assign (`specs/165-task-management/` FR-001,
 * `contracts/admin-api.md` §1): every named assignee is an active
 * administrator **who holds `tasks:read`** — somebody who could not open the
 * Task is not given it — or the whole write is 422 `TASK_ASSIGNEE_INVALID`.
 * For a Task in a context, {@link assertAssigneesSeeContext} follows.
 *
 * The write port keeps {@link assertAssignable} alone: a context's owner
 * assigns the people its own rules name (163 behaviour), and they are told only
 * when they may see the Task. A Project's Stage Tasks go to the Member holding
 * each definition's Role, who need not hold `tasks:read` or `projects:read`;
 * refusing one of them would refuse the whole batch, and entering the Stage
 * would record `tasks_materialize_failed` for a Task nobody else would get
 * (issue #506, owner ruling 2026-10-29: the HTTP routes only).
 */
export async function assertMayBeAssigned(
  adminUsers: AdminUserReadPort,
  permissions: PermissionReadPort,
  adminUserIds: readonly string[],
): Promise<void> {
  const named = [...new Set(adminUserIds)];
  await assertAssignable(adminUsers, named);
  for (const adminUserId of named) {
    const held = await permissions.listPermissions(adminUserId);
    if (!held.includes(ADMIN_PERMISSION_WILDCARD) && !held.includes('tasks:read')) throw taskAssigneeInvalid();
  }
}

/**
 * Every named assignee of a Task in a context may see that record — its
 * owner's `canSeeAs` answers yes — or the write is 422 `TASK_ASSIGNEE_INVALID`
 * naming the first who may not (spec, Edge Cases; issue #506, option A). A
 * Task in no context asks nothing. An owner that is not present vouches for
 * nobody, though a Task of one is hidden before this is reached. The HTTP
 * routes only: see {@link assertMayBeAssigned} for why the write port does not.
 */
export async function assertAssigneesSeeContext(
  contexts: Pick<TaskContextRegistry, 'presentFor'>,
  adminUsers: AdminUserReadPort,
  context: { contextType: string | null; contextId: string | null } | null,
  adminUserIds: readonly string[],
): Promise<void> {
  if (!context || context.contextType === null || context.contextId === null) return;
  const named = [...new Set(adminUserIds)];
  if (named.length === 0) return;
  const descriptor = contexts.presentFor(context.contextType);
  if (!descriptor) throw taskAssigneeInvalid();
  for (const adminUserId of named) {
    if (await descriptor.canSeeAs(adminUserId, context.contextId)) continue;
    const [person] = await adminUsers.findByIds([adminUserId]);
    const name = person ? `${person.firstName} ${person.lastName}`.trim() || person.email : adminUserId;
    throw taskAssigneeContextHidden({ id: adminUserId, name });
  }
}

/**
 * A context an administrator puts a Task into on the Tasks screens (FR-031):
 * its type registered by a **present** module, the record one the caller may
 * see, and — when the record has groups (a Project's Stages) — one of those
 * groups named. A Task belongs to a group of such a record, never to the
 * record alone. Asked under the caller's own context.
 */
export async function assertContextForCaller(contexts: TaskContextRegistry, context: TaskContext): Promise<void> {
  const descriptor = contexts.presentFor(context.contextType);
  if (!descriptor) {
    throw taskContextInvalid(`No module that is switched on owns the Task context "${context.contextType}".`);
  }
  const visible = await descriptor.visibleContextIds([context.contextId]);
  if (!visible.has(context.contextId)) {
    throw taskContextInvalid('The record does not exist or is not available to you.');
  }
  const description = (await descriptor.describe([context.contextId])).get(context.contextId);
  if (!description) throw taskContextInvalid('The record does not exist or is not available to you.');
  const groupId = context.contextGroupId ?? null;
  if (groupId === null) {
    if (description.groups.size > 0) throw taskContextInvalid('Choose where in the record the Task belongs.');
    return;
  }
  if (!description.groups.has(groupId)) throw taskContextInvalid('The record has no such part.');
}

/** Whether two contexts name the same record — its groups aside. */
function sameRecord(
  a: { contextType: string | null; contextId: string | null } | null,
  b: { contextType: string | null; contextId: string | null } | null,
): boolean {
  return (a?.contextType ?? null) === (b?.contextType ?? null) && (a?.contextId ?? null) === (b?.contextId ?? null);
}

/** The context owner's answer to "may the caller change which Tasks this record holds" (`canChangeTasks`). */
async function mayChangeTasks(contexts: TaskContextRegistry, contextType: string, contextId: string): Promise<boolean> {
  const descriptor = contexts.presentFor(contextType);
  return Boolean(descriptor) && (await descriptor!.canChangeTasks(contextId));
}

/**
 * Taking a Task out of the context it is in — detaching it, or moving it to
 * another record — is the context owner's to allow (`canChangeTasks`), not only
 * `tasks:write`'s: otherwise a holder who merely sees a record could publish
 * its Tasks to every holder of `tasks:read` (T144). Moving between the groups
 * of one record is not asked. An owner that is off hides the Task before this
 * is reached; one that is unregistered refuses.
 */
export async function assertMayTakeOut(
  contexts: TaskContextRegistry,
  current: { contextType: string | null; contextId: string | null },
  next: TaskContext | null,
): Promise<void> {
  if (current.contextType === null || current.contextId === null) return;
  if (sameRecord(current, next)) return;
  if (!(await mayChangeTasks(contexts, current.contextType, current.contextId))) {
    throw taskContextInvalid('You may not take this Task out of the record it belongs to.');
  }
}

/**
 * Putting a Task into a record — creating it there, or moving it there from
 * elsewhere — is the record owner's to allow too (`canChangeTasks`, T147):
 * `tasks:write` and sight of the record are not enough to add to its work.
 * Moving between the groups of one record is not asked. Asked after
 * {@link assertContextForCaller}, which names a record the caller does not see.
 */
export async function assertMayPutIn(
  contexts: TaskContextRegistry,
  current: { contextType: string | null; contextId: string | null } | null,
  next: TaskContext,
): Promise<void> {
  if (sameRecord(current, next)) return;
  if (!(await mayChangeTasks(contexts, next.contextType, next.contextId))) {
    throw taskContextInvalid('You may not add a Task to this record.');
  }
}

/**
 * Deleting a Task of a record is the record owner's to allow (`canChangeTasks`,
 * T147). The caller sees the Task — a 404 would misreport it — so the refusal
 * is `403` `FORBIDDEN`, the answer to a permission the caller lacks. A Task of
 * no record is `tasks:write`'s alone.
 */
export async function assertMayDelete(
  contexts: TaskContextRegistry,
  current: { contextType: string | null; contextId: string | null },
): Promise<void> {
  if (current.contextType === null || current.contextId === null) return;
  if (!(await mayChangeTasks(contexts, current.contextType, current.contextId))) {
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'You may not delete a Task of the record it belongs to.');
  }
}
