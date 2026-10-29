import type { TaskContextQuery, TaskReadPort, TaskRecord, TaskSearchQuery } from '@endora-commerce/contracts';
import type { TaskRow, TaskService } from './task-service.js';

/**
 * `taskReadPort` — reading Tasks from another module
 * (`specs/163-projects-and-tasks/contracts/ports-and-events.md` §1).
 *
 * Every answer goes through the service's visibility-checked reads: an
 * administrator's call is narrowed by context visibility (research R-9), a
 * call the system makes is not. Published with `providePort`, so a consumer
 * resolving it while `tasks` is off gets `ModuleDisabledError`.
 */
export class TaskReadPortService implements TaskReadPort {
  constructor(private readonly tasks: TaskService) {}

  async findById(id: string): Promise<TaskRecord | null> {
    const row = await this.tasks.findVisibleRow(id);
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<TaskRecord[]> {
    return (await this.tasks.visibleRowsByIds(ids)).map(toRecord);
  }

  async search(query: TaskSearchQuery): Promise<TaskRecord[]> {
    return (await this.tasks.searchVisibleRows(query.q, query.limit)).map(toRecord);
  }

  async listInContext(q: TaskContextQuery): Promise<TaskRecord[]> {
    return (await this.tasks.rowsInContext(q, { openOnly: false })).map(toRecord);
  }

  async listOpenInContext(q: TaskContextQuery): Promise<TaskRecord[]> {
    return (await this.tasks.rowsInContext(q, { openOnly: true })).map(toRecord);
  }

  countInContext(q: TaskContextQuery): Promise<number> {
    return this.tasks.countInContext(q);
  }
}

/** A Task as it crosses a module boundary — a plain shape, never the entity. */
export function toRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    dueOn: row.due_on,
    assignedAdminUserId: row.assigned_admin_user_id,
    contextType: row.context_type,
    contextId: row.context_id,
    contextGroupId: row.context_group_id,
    contextNote: row.context_note,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at),
  };
}
