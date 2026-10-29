import {
  ERROR_CODES,
  type AdminUserReadPort,
  type RecordHistoryPage,
  type RecordHistoryQuery,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { taskNotFound } from './task-errors.js';
import type { TaskService } from './task-service.js';
import type { TaskVisibility } from './task-visibility.js';

/** The object type every Command about a Task is recorded under. */
export const TASK_AUDIT_OBJECT_TYPE = 'task';

/** The most the audit port answers in one read (`AuditPort.query`), whatever is asked. */
const AUDIT_QUERY_CAP = 500;

/**
 * How far back a history reaches: one entry fewer than the cap, so a read that
 * comes back full proves an earlier entry exists and the last page says so
 * (`truncated`) — CRM's `opportunity-history-service.ts`, the model.
 */
export const TASK_HISTORY_REACH = AUDIT_QUERY_CAP - 1;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    // Falls through: a cursor this service did not issue is a malformed request.
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this history issued.');
}

export interface TaskHistoryServiceDeps {
  tasks: Pick<TaskService, 'findVisibleRow'>;
  /** Whether the reader may see a context an entry names — the Task may have left it since. */
  visibility: Pick<TaskVisibility, 'canSee'>;
  /** The kernel's audit port — a platform service. */
  auditLog: Pick<AuditPort, 'query'>;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

/**
 * `GET /tasks/:id/history` — **the audit log is the history**: every write of
 * a Task is a Command recorded against `task` and its id. The Task is read
 * through the visibility seam first, so a Task the caller may not see answers
 * 404 here exactly as it does by id. Served to `tasks:read`, not
 * `audit_log:read`.
 *
 * Audit states carry no description text (`task-commands.ts`), so an entry
 * resolves no reference tokens: `references` is always empty.
 *
 * Seeing the Task today does not mean seeing every context it was ever in: a
 * Task that left a Project the reader may not see still names it in its older
 * entries. Such a context is served blank — its type, id, group and note —
 * as {@link withoutContext} states (T144 F4).
 */
const CONTEXT_KEYS = ['contextType', 'contextId', 'contextGroupId', 'contextNote'] as const;

/** An audited state with its context blanked. */
export function withoutContext(state: Record<string, unknown>): Record<string, unknown> {
  const out = { ...state };
  for (const key of CONTEXT_KEYS) if (Object.hasOwn(out, key)) out[key] = null;
  return out;
}

/** The context an audited state names, if any. */
function contextOf(state: unknown): { contextType: string; contextId: string } | null {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null;
  const { contextType, contextId } = state as Record<string, unknown>;
  return typeof contextType === 'string' && typeof contextId === 'string' ? { contextType, contextId } : null;
}

export class TaskHistoryService {
  constructor(private readonly deps: TaskHistoryServiceDeps) {}

  async list(taskId: string, query: RecordHistoryQuery): Promise<RecordHistoryPage> {
    const offset = decodeCursor(query.cursor);
    const task = await this.deps.tasks.findVisibleRow(taskId);
    if (!task) throw taskNotFound();

    const read = await this.deps.auditLog.query({
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      limit: Math.min(offset + query.limit + 1, AUDIT_QUERY_CAP),
    });
    const entries = read.slice(0, TASK_HISTORY_REACH);
    const page = entries.slice(offset, offset + query.limit);
    const hasMore = entries.length > offset + query.limit;
    const truncated = !hasMore && read.length > TASK_HISTORY_REACH;

    const actorIds = [...new Set(page.map((entry) => entry.actorAdminUserId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const names = new Map(actors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]));

    // Each context the page names, asked once, under the reader's own context.
    const seen = new Map<string, boolean>();
    for (const entry of page) {
      for (const state of [entry.stateBefore, entry.stateAfter]) {
        const context = contextOf(state);
        if (!context) continue;
        const key = `${context.contextType}:${context.contextId}`;
        if (!seen.has(key)) seen.set(key, await this.deps.visibility.canSee(context));
      }
    }
    const served = (state: unknown): unknown => {
      const context = contextOf(state);
      if (!context || seen.get(`${context.contextType}:${context.contextId}`)) return state ?? null;
      return withoutContext(state as Record<string, unknown>);
    };

    return {
      data: page.map((entry) => {
        const actorId = entry.actorAdminUserId ?? null;
        return {
          id: entry.id,
          actedAt: entry.actedAt.toISOString(),
          action: entry.action,
          actor:
            actorId === null
              ? { kind: 'system', id: null, name: null }
              : { kind: 'admin', id: actorId, name: names.get(actorId) ?? null },
          before: served(entry.stateBefore),
          after: served(entry.stateAfter),
          references: [],
        };
      }),
      pagination: { cursor: hasMore ? encodeCursor(offset + query.limit) : null, hasMore, limit: query.limit },
      truncated,
    };
  }
}
