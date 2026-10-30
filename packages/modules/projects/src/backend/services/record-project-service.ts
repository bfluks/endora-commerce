import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ProjectPanelRecordKind,
  type ProjectRecordKind,
  type ProjectSummary,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { RECORD_OWNER, type LinkedRecordOwners } from './linked-records.js';
import type { OwnerReadCheck, OwnerReadChecks } from './owner-read-permissions.js';
import { isUuid, projectNotFound, type ProjectAccess, type VisibleProjectRow } from './project-access.js';
import type { ProjectReadService } from './project-read-service.js';
import { PROJECT_TASK_CONTEXT_TYPE, type ProjectTasks } from './project-tasks.js';

/**
 * Which Project a record is in — `GET /projects/records/:kind/:recordId/project`
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.3, research R-11) —
 * for the panel the record's own screen shows (FR-022).
 *
 * The caller must hold the code the record's owner reads it with; the owner of
 * a switchable kind is asked for its presence first (503), its code next (403)
 * — the order and the reason of `link-service.ts`. An Order, a Quote Request
 * or an Opportunity answers through its link; a Task through its context, read
 * through the Tasks module's own port, which applies the Task's context
 * visibility.
 *
 * The answer is the Project's summary, read through `ProjectAccess`: a record
 * in no Project and one in a Project the caller may not see are one answer,
 * 404 `PROJECT_NOT_FOUND` (FR-020, US5 sc.5), so the panel renders nothing for
 * either.
 */

export interface RecordProjectServiceDeps {
  emFactory: () => EntityManager;
  access: ProjectAccess;
  read: ProjectReadService;
  owners: LinkedRecordOwners;
  tasks: ProjectTasks;
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests' | 'opportunities' | 'tasks'>;
}

export class RecordProjectService {
  constructor(private readonly deps: RecordProjectServiceDeps) {}

  async projectOf(kind: ProjectPanelRecordKind, recordId: string): Promise<ProjectSummary> {
    const projectId = kind === 'task' ? await this.#ofTask(recordId) : await this.#ofLinked(kind, recordId);
    if (projectId === null) throw projectNotFound();
    const visible = await this.deps.access.findVisible(projectId);
    if (!visible) throw projectNotFound();
    return this.deps.read.summary(visible);
  }

  async #ofLinked(kind: Exclude<ProjectPanelRecordKind, 'task'>, recordId: string): Promise<string | null> {
    if (!this.deps.owners.isPresent(kind)) throw new ModuleDisabledError(RECORD_OWNER[kind]);
    const check: OwnerReadCheck =
      kind === 'order'
        ? this.deps.mayRead.orders
        : kind === 'quote_request'
          ? this.deps.mayRead.quoteRequests
          : this.deps.mayRead.opportunities;
    await this.#assert(check);
    return this.#linkedProjectId(kind, recordId);
  }

  /**
   * `projectReadPort.findByRecord`: the Project a linked record is in, if the
   * caller may see it — `null` for a record in no Project and for one in a
   * Project out of sight alike. The port answers another module's code, which
   * owns its own gates, so neither the record owner's presence nor its read
   * code is asked here; the link holds the record by value either way.
   */
  async findByRecord(kind: ProjectRecordKind, recordId: string): Promise<VisibleProjectRow | null> {
    if (!isUuid(recordId)) return null;
    const projectId = await this.#linkedProjectId(kind, recordId);
    return projectId === null ? null : this.deps.access.findVisible(projectId);
  }

  async #linkedProjectId(kind: ProjectRecordKind, recordId: string): Promise<string | null> {
    const rows = (await this.deps.emFactory().execute(
      `select l."project_id" from "project_links" l where l."record_kind" = ? and l."record_id" = ?`,
      [kind, recordId],
    )) as Array<{ project_id: string }>;
    return rows[0]?.project_id ?? null;
  }

  async #ofTask(taskId: string): Promise<string | null> {
    if (!this.deps.tasks.present()) throw new ModuleDisabledError('tasks');
    await this.#assert(this.deps.mayRead.tasks);
    const task = await this.deps.tasks.read.findById(taskId);
    if (!task || task.contextType !== PROJECT_TASK_CONTEXT_TYPE || task.contextId === null) return null;
    return task.contextId;
  }

  async #assert(check: OwnerReadCheck): Promise<void> {
    if (await check()) return;
    throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Seeing the project of this record needs the permission to read it.');
  }
}
