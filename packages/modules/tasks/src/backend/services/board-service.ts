import type { SupportedLanguage, TaskBoard, TaskBoardColumn, TaskBoardQuery } from '@endora-commerce/contracts';
import type { TaskBoardCardFieldService } from './board-card-field-service.js';
import type { TaskService } from './task-service.js';
import { statusRef, type TaskWorkflowRead } from './task-workflow-read.js';

export interface TaskBoardServiceDeps {
  /** The list — the one statement of the filters and of a Task as a card. */
  tasks: Pick<TaskService, 'visibilityScope' | 'countByStatus' | 'list'>;
  workflow: Pick<TaskWorkflowRead, 'graph'>;
  cardFields: Pick<TaskBoardCardFieldService, 'selected'>;
}

/**
 * The Task board (`specs/165-task-management/contracts/admin-api.md` §1,
 * research R-11, FR-019 – FR-022) — CRM's `board-service.ts`, the model.
 *
 * One column per status of the workflow, in weight order, each with the
 * number of Tasks in it under the filters, its first `perColumn` cards and
 * whether there are more; further cards of a lane come from `GET /tasks`
 * filtered to that status, which is why a card is the list's own summary, in
 * the list's own order.
 *
 * **The board reads no table itself.** The count is one grouped statement and
 * the cards one list page per column, both `TaskService`'s, over the same
 * conditions — so a column's count is the list's total for that status under
 * the same filters, by construction. The visibility scope (context, draft,
 * private) is computed **once** per request and handed to every read, rather
 * than once per column (research R-11, *Rejected*).
 *
 * The columns are read one after another, as CRM's are: a board is a handful
 * of columns, and asking for all of them at once would take that many
 * connections from the pool for one request.
 */
export class TaskBoardService {
  constructor(private readonly deps: TaskBoardServiceDeps) {}

  /** `GET /tasks/board`. */
  async get(query: TaskBoardQuery, language: SupportedLanguage): Promise<TaskBoard> {
    const { perColumn, ...filters } = query;
    const [scope, graph, cardFields] = await Promise.all([
      this.deps.tasks.visibilityScope(),
      this.deps.workflow.graph(),
      this.deps.cardFields.selected(),
    ]);
    const counts = await this.deps.tasks.countByStatus(filters, scope);
    const wanted = filters.status && filters.status.length > 0 ? new Set(filters.status) : null;

    const columns: TaskBoardColumn[] = [];
    for (const status of [...graph.statuses].sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code))) {
      // A status the filter leaves out is a column with nothing in it.
      const page =
        wanted && !wanted.has(status.code)
          ? { items: [], nextCursor: null }
          : await this.deps.tasks.list({ ...filters, status: [status.code], limit: perColumn }, language, {
              scope,
              cardFields,
            });
      columns.push({
        status: statusRef(graph, status.code, language),
        count: counts.get(status.code) ?? 0,
        items: page.items,
        hasMore: page.nextCursor !== null,
      });
    }
    return { columns };
  }
}
