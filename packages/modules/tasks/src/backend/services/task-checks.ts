import { ERROR_CODES, type AdminUserReadPort, type TaskContext } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { TaskContextRegistry } from './task-context-registry.js';
import { taskAssigneeInvalid, taskContextInvalid } from './task-errors.js';

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
