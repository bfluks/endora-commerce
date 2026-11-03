import type { TaskContextQuery, TaskReadPort, TaskRecord, TaskSearchQuery } from '@endora-commerce/contracts';
import type { TaskService } from './task-service.js';

/**
 * `taskReadPort` — reading Tasks from another module
 * (`specs/165-task-management/contracts/ports-and-events.md` §1).
 *
 * Every answer goes through the service's visibility-checked reads: an
 * administrator's call is narrowed by context visibility (163 research R-9) and
 * by the draft/private rule (165 R-3), so another admin's private Task is
 * absent from CRM's and Projects' references; a call the system makes is not
 * narrowed. Published with `providePort`, so a consumer resolving it while
 * `tasks` is off gets `ModuleDisabledError`.
 */
export class TaskReadPortService implements TaskReadPort {
  constructor(private readonly tasks: TaskService) {}

  async findById(id: string): Promise<TaskRecord | null> {
    const row = await this.tasks.findVisibleRow(id);
    return row ? ((await this.tasks.records([row]))[0] ?? null) : null;
  }

  async findByIds(ids: readonly string[]): Promise<TaskRecord[]> {
    return this.tasks.records(await this.tasks.visibleRowsByIds(ids));
  }

  async search(query: TaskSearchQuery): Promise<TaskRecord[]> {
    return this.tasks.records(await this.tasks.searchVisibleRows(query.q, query.limit));
  }

  async listInContext(q: TaskContextQuery): Promise<TaskRecord[]> {
    return this.tasks.records(await this.tasks.rowsInContext(q, { openOnly: false }));
  }

  /** Not closed and not a draft — the completion gate's question (R-1, R-3). */
  async listOpenInContext(q: TaskContextQuery): Promise<TaskRecord[]> {
    return this.tasks.records(await this.tasks.rowsInContext(q, { openOnly: true }));
  }

  countInContext(q: TaskContextQuery): Promise<number> {
    return this.tasks.countInContext(q);
  }
}
