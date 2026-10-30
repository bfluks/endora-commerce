import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, TASK_STATUS_REASSIGN_MAX } from '@endora-commerce/contracts';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/**
 * Moving every Task off a configuration value being removed — a status
 * (FR-016) or a priority (FR-024) — inside the removing Command
 * (`specs/165-task-management/` research R-1, R-9; T001 (a)).
 *
 * **Configuration, not a write on a Task.** The Tasks are selected across the
 * whole platform, whoever may see them — drafts and private Tasks included —
 * because a Task the operator cannot see still holds the value. Nothing about
 * them is handed back to the caller but how many moved, and each move is
 * recorded in that Task's own history, on the Command's transaction, so the
 * rows commit or roll back with the removal.
 */

/** The column a removal moves Tasks off: the status or the priority, each held by code. */
export type TaskReassignmentColumn = 'status' | 'priority_code';

/** One Task holding the value being removed, locked until the Command commits. */
export interface HeldTask {
  id: string;
  completed_at: Date | string | null;
}

/**
 * The Tasks holding `code` in `column`, locked `FOR UPDATE` — a Task cannot
 * leave or take the value until the removal commits. Above
 * {@link TASK_STATUS_REASSIGN_MAX} the removal answers 409
 * `TASK_STATUS_IN_USE_TOO_MANY {max, …details}` and nothing moves.
 */
export async function holdTasksFor(
  em: EntityManager,
  column: TaskReassignmentColumn,
  code: string,
  tooMany: { message: string; details: Record<string, unknown> },
): Promise<HeldTask[]> {
  const held = (await em.execute(
    `select "id", "completed_at" from "tasks" where "${column}" = ? order by "id" limit ? for update`,
    [code, TASK_STATUS_REASSIGN_MAX + 1],
  )) as HeldTask[];
  if (held.length > TASK_STATUS_REASSIGN_MAX) {
    throw new HttpError(409, ERROR_CODES.TASK_STATUS_IN_USE_TOO_MANY, tooMany.message, {
      ...tooMany.details,
      max: TASK_STATUS_REASSIGN_MAX,
    });
  }
  return held;
}

/** The uuid array literal of `held`'s ids, for `where "id" = any(?::uuid[])`. */
export function heldIds(held: readonly HeldTask[]): string {
  return `{${held.map((row) => row.id).join(',')}}`;
}

/**
 * One audit row per moved Task, on the Command's transaction:
 * `action` against the Task, `before` and `after` of each built by the caller
 * (`after` carries the removal's `reason`).
 */
export function recordReassignments(
  auditLog: AuditPort,
  em: EntityManager,
  held: readonly HeldTask[],
  action: string,
  states: (row: HeldTask) => { before: Record<string, unknown>; after: Record<string, unknown> },
): void {
  for (const row of held) {
    const { before, after } = states(row);
    recordAuditFromContext(auditLog, em, {
      action,
      objectType: 'task',
      objectId: row.id,
      stateBefore: before,
      stateAfter: after,
    });
  }
}
