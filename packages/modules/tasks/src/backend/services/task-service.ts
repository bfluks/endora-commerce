import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  foldDiacritics,
  TASK_CLOSED_STATUSES,
  type AdminUserReadPort,
  type AdminUserRecord,
  type CreateTaskBody,
  type SupportedLanguage,
  type TaskAssigneeOption,
  type TaskContextDescription,
  type TaskContextQuery,
  type TaskContextSummary,
  type TaskDetail,
  type TaskListQuery,
  type TaskListResponse,
  type TaskStatus,
  type TaskSummary,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { TaskAdminSearchQuery } from '../admin-search-provider.js';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { assertAssignable, assertContextForCaller, assertMayDelete, assertMayPutIn, assertMayTakeOut } from './task-checks.js';
import {
  assignTaskCommand,
  changeTaskStatusCommand,
  createTaskCommand,
  deleteTaskCommand,
  updateTaskCommand,
  type TaskFieldChanges,
} from './task-commands.js';
import type { TaskContextRegistry } from './task-context-registry.js';
import { taskNotFound } from './task-errors.js';
import { tellAfterCommit, type TaskNotifier } from './task-notifier.js';
import type { SqlFragment, TaskVisibility } from './task-visibility.js';

export { taskNotFound } from './task-errors.js';

/**
 * Tasks — the HTTP side of `specs/163-projects-and-tasks/contracts/admin-api.md`
 * §1: the list, *My Tasks*, one Task, and creating, editing and deleting one.
 * The read port reads through the methods here.
 *
 * Every write is one or more Commands of `task-commands.ts` (Constitution
 * XIII), every refusal checked before the first runs. A `PATCH` that changes
 * several kinds of thing runs one Command per kind — fields, assignment,
 * status — so each has the audit row and the event the contract names.
 * Assigning somebody other than the caller tells them in the bell, after the
 * write commits (FR-032).
 *
 * **Every read of the `tasks` table in this module is in this file** and asks
 * {@link TaskVisibility} first (`Task` is `@RuleScoped`, so no ORM filter
 * would). A Task the caller may not see answers 404 `TASK_NOT_FOUND`, exactly
 * as a missing one does, and is absent from every list.
 *
 * The reads are SQL rather than `em.find`, because the visibility pre-filter is
 * one SQL predicate built before the query runs, and the keyset cursor is a row
 * comparison.
 */

/** One `tasks` row as the reads select it. */
export interface TaskRow {
  id: string;
  number: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigned_admin_user_id: string | null;
  /** `YYYY-MM-DD`, formatted by the query so no driver date parsing is involved. */
  due_on: string | null;
  completed_at: Date | null;
  created_by_admin_user_id: string;
  context_type: string | null;
  context_id: string | null;
  context_group_id: string | null;
  context_note: string | null;
  created_at: Date;
  updated_at: Date;
  /** `created_at` as Postgres prints it, at full precision — the keyset cursor's key. */
  cursor_at: string;
  /** Open and past its due date, by the database's calendar day. */
  overdue: boolean;
}

const CLOSED = TASK_CLOSED_STATUSES.map((status) => `'${status}'`).join(', ');

const COLUMNS = `t."id", t."number", t."title", t."description", t."status", t."assigned_admin_user_id",
  to_char(t."due_on", 'YYYY-MM-DD') as "due_on", t."completed_at", t."created_by_admin_user_id",
  t."context_type", t."context_id", t."context_group_id", t."context_note", t."created_at", t."updated_at",
  t."created_at"::text as "cursor_at",
  (t."status" not in (${CLOSED}) and t."due_on" is not null and t."due_on" < current_date) as "overdue"`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TaskServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  visibility: TaskVisibility;
  contexts: TaskContextRegistry;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  notifier: TaskNotifier;
  /**
   * A sentence of this module's bundle in the reader's language — the label of
   * a context its owner did not describe (`_i18n`'s resolver, lazy).
   */
  translate: (key: string, language: SupportedLanguage) => Promise<string>;
}

/** The most Tasks *My Tasks* answers — a person's open work, not an archive. */
export const MY_TASKS_LIMIT = 500;
/** The most options the assignee picker offers for one search. */
export const ASSIGNEE_OPTIONS_LIMIT = 50;

/** The administrator behind the current request, or `null` for the system. */
export function actingAdminUserId(): string | null {
  const actor = getTenantContext()?.actor;
  return actor?.kind === 'admin' && actor.id ? actor.id : null;
}

function personName(person: Pick<AdminUserRecord, 'firstName' | 'lastName' | 'email'>): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

function isActive(admin: AdminUserRecord): boolean {
  return admin.status === 'active' && admin.deletedAt === null;
}

/** Whether `context` is the context `row` is already in. */
function sameContext(
  context: { contextType: string; contextId: string; contextGroupId?: string | null | undefined } | null,
  row: Pick<TaskRow, 'context_type' | 'context_id' | 'context_group_id'>,
): boolean {
  if (context === null) return row.context_type === null;
  return (
    context.contextType === row.context_type &&
    context.contextId === row.context_id &&
    (context.contextGroupId ?? null) === row.context_group_id
  );
}

interface Cursor {
  at: string;
  id: string;
}

function encodeCursor(row: TaskRow): string {
  return Buffer.from(JSON.stringify({ a: row.cursor_at, i: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { a?: unknown; i?: unknown };
    if (typeof parsed.a === 'string' && typeof parsed.i === 'string' && UUID.test(parsed.i)) {
      return { at: parsed.a, id: parsed.i };
    }
  } catch {
    // Falls through to the refusal below: a cursor is opaque, and one this
    // service did not issue is a malformed request rather than "page one".
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this list issued.');
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  /** One Task the caller may see, or `null` — hidden and missing alike. */
  async findVisibleRow(id: string): Promise<TaskRow | null> {
    if (!UUID.test(id)) return null;
    const rows = (await this.deps.emFactory().execute(`select ${COLUMNS} from "tasks" t where t."id" = ?`, [
      id,
    ])) as TaskRow[];
    const row = rows[0];
    if (!row) return null;
    const visible = await this.deps.visibility.canSee({ contextType: row.context_type, contextId: row.context_id });
    return visible ? row : null;
  }

  /** `GET /tasks/:id`. */
  async get(id: string, language: SupportedLanguage): Promise<TaskDetail> {
    const row = await this.findVisibleRow(id);
    if (!row) throw taskNotFound();
    return this.#detail(row, language);
  }

  /**
   * `GET /tasks` — newest first, a keyset page. Hidden contexts are excluded
   * by the visibility pre-filter, so a page and the next one are exact.
   */
  async list(query: TaskListQuery, language: SupportedLanguage): Promise<TaskListResponse> {
    const where: string[] = [];
    const params: unknown[] = [];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    if (query.status && query.status.length > 0) {
      where.push(`t."status" = any(?::text[])`);
      params.push(`{${query.status.join(',')}}`);
    }
    if (query.assignee === 'none') {
      where.push(`t."assigned_admin_user_id" is null`);
    } else if (query.assignee === 'me') {
      // "Mine" is whoever asks; with no administrator behind the request
      // nobody is, and the answer is none.
      const me = actingAdminUserId();
      if (me === null) return { items: [], nextCursor: null };
      where.push(`t."assigned_admin_user_id" = ?`);
      params.push(me);
    } else if (query.assignee) {
      where.push(`t."assigned_admin_user_id" = ?`);
      params.push(query.assignee);
    }
    if (query.dueFrom) {
      where.push(`t."due_on" >= ?::date`);
      params.push(query.dueFrom);
    }
    if (query.dueTo) {
      where.push(`t."due_on" <= ?::date`);
      params.push(query.dueTo);
    }
    if (query.overdue === true) {
      where.push(`(t."status" not in (${CLOSED}) and t."due_on" < current_date)`);
    } else if (query.overdue === false) {
      where.push(`not (t."status" not in (${CLOSED}) and t."due_on" is not null and t."due_on" < current_date)`);
    }
    if (query.contextType) {
      where.push(`t."context_type" = ?`);
      params.push(query.contextType);
    }
    if (query.contextId) {
      where.push(`t."context_id" = ?`);
      params.push(query.contextId);
    }
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      where.push(`(t."title" ilike ? or t."number" ilike ?)`);
      params.push(like, like);
    }
    const after = decodeCursor(query.cursor);
    if (after) {
      where.push(`(t."created_at", t."id") < (?::timestamptz, ?::uuid)`);
      params.push(after.at, after.id);
    }

    const rows = (await this.deps.emFactory().execute(
      `select ${COLUMNS} from "tasks" t
        ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
        order by t."created_at" desc, t."id" desc
        limit ?`,
      [...params, query.limit + 1],
    )) as TaskRow[];
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: await this.#summaries(page, language),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  /**
   * `GET /tasks/mine` — the caller's open Tasks by due date, undated last, then
   * oldest first; narrowed by context visibility like the list (FR-030).
   */
  async mine(language: SupportedLanguage): Promise<TaskSummary[]> {
    const me = actingAdminUserId();
    if (me === null) return [];
    const where = [`t."assigned_admin_user_id" = ?`, `t."status" not in (${CLOSED})`];
    const params: unknown[] = [me];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const rows = (await this.deps.emFactory().execute(
      `select ${COLUMNS} from "tasks" t where ${where.join(' and ')}
        order by t."due_on" asc nulls last, t."created_at" asc, t."id" asc
        limit ${MY_TASKS_LIMIT}`,
      params,
    )) as TaskRow[];
    return this.#summaries(rows, language);
  }

  /** The Tasks of `ids` the caller may see — the audit trail's labels. */
  async visibleRowsByIds(ids: readonly string[]): Promise<TaskRow[]> {
    const candidates = [...new Set(ids.filter((id) => UUID.test(id)))];
    if (candidates.length === 0) return [];
    const where = [`t."id" = any(?::uuid[])`];
    const params: unknown[] = [`{${candidates.join(',')}}`];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    return (await this.deps.emFactory().execute(
      `select ${COLUMNS} from "tasks" t where ${where.join(' and ')}`,
      params,
    )) as TaskRow[];
  }

  /**
   * Tasks the caller may see whose number or title contains `q`, newest first,
   * at most `limit` — `taskReadPort.search`, the `@@` document list's Tasks
   * (`specs/163-projects-and-tasks/` FR-044). The list's own filter, narrowed
   * by the same visibility pre-filter.
   */
  async searchVisibleRows(q: string | undefined, limit: number): Promise<TaskRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const needle = (q ?? '').trim();
    if (needle !== '') {
      const like = `%${needle.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      where.push(`(t."title" ilike ? or t."number" ilike ?)`);
      params.push(like, like);
    }
    return (await this.deps.emFactory().execute(
      `select ${COLUMNS} from "tasks" t
        ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
        order by t."created_at" desc, t."id" desc
        limit ?`,
      [...params, Math.max(0, Math.trunc(limit))],
    )) as TaskRow[];
  }

  /**
   * Admin global search (`contracts/admin-surfaces.md` §6): the Tasks the
   * caller may see whose number or title — whichever `fields` selects —
   * contains the text, or whose id it is. The exact number ranks first, then a
   * number it begins, then the newest; `limit + 1` rows are read to answer
   * `hasMore`. The same visibility pre-filter as the list.
   */
  async searchForAdmin(query: TaskAdminSearchQuery): Promise<{ rows: TaskRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const like = `%${query.likeEscaped}%`;
    const or: string[] = [];
    const params: unknown[] = [];
    if (fields.has('number')) {
      or.push(`t."number" ilike ?`);
      params.push(like);
    }
    if (fields.has('title')) {
      or.push(`t."title" ilike ?`);
      params.push(like);
    }
    if (query.isUuid && UUID.test(query.text)) {
      or.push(`t."id" = ?::uuid`);
      params.push(query.text);
    }
    if (or.length === 0) return { rows: [], hasMore: false };
    const where = [`(${or.join(' or ')})`];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const rank = fields.has('number')
      ? `case when lower(t."number") = lower(?) then 0 when t."number" ilike ? then 1 else 2 end, `
      : '';
    const rankParams = fields.has('number') ? [query.text, `${query.likeEscaped}%`] : [];
    const rows = (await this.deps.emFactory().execute(
      `select ${COLUMNS} from "tasks" t
        where ${where.join(' and ')}
        order by ${rank}t."created_at" desc, t."id" desc
        limit ?`,
      [...params, ...rankParams, query.limit + 1],
    )) as TaskRow[];
    const hasMore = rows.length > query.limit;
    return { rows: hasMore ? rows.slice(0, query.limit) : rows, hasMore };
  }

  /** `POST /tasks` — a Task of the caller's, in a context they may see or in none. */
  async create(body: CreateTaskBody, language: SupportedLanguage): Promise<TaskDetail> {
    const context = body.context ?? null;
    if (context) {
      await assertContextForCaller(this.deps.contexts, context);
      await assertMayPutIn(this.deps.contexts, null, context);
    }
    const assignee = body.assignedAdminUserId ?? null;
    await assertAssignable(this.deps.adminUsers, [assignee]);
    const id = await this.deps.commandBus.run(
      createTaskCommand(context, {
        title: body.title,
        description: body.description ?? '',
        assignedAdminUserId: assignee,
        dueOn: body.dueOn ?? null,
        contextNote: null,
      }),
    );
    const task = await this.#afterWrite(id, language);
    if (assignee !== null) await this.#tellAssignee(assignee, task);
    return task;
  }

  /**
   * `PATCH /tasks/:id` — up to three Commands, in this order, each only when it
   * changes something: the fields, the assignment, the status.
   */
  async update(id: string, body: UpdateTaskBody, language: SupportedLanguage): Promise<TaskDetail> {
    const row = await this.findVisibleRow(id);
    if (!row) throw taskNotFound();
    if (body.context !== undefined && !sameContext(body.context, row)) {
      await assertMayTakeOut(
        this.deps.contexts,
        { contextType: row.context_type, contextId: row.context_id },
        body.context,
      );
    }
    if (body.context) {
      await assertContextForCaller(this.deps.contexts, body.context);
      await assertMayPutIn(this.deps.contexts, { contextType: row.context_type, contextId: row.context_id }, body.context);
    }
    if (body.assignedAdminUserId !== undefined) await assertAssignable(this.deps.adminUsers, [body.assignedAdminUserId]);

    const fields: TaskFieldChanges = {};
    if (body.title !== undefined && body.title !== row.title) fields.title = body.title;
    if (body.description !== undefined && body.description !== row.description) fields.description = body.description;
    if (body.dueOn !== undefined && body.dueOn !== row.due_on) fields.dueOn = body.dueOn;
    if (body.context !== undefined && !sameContext(body.context, row)) fields.context = body.context;
    if (Object.keys(fields).length > 0) await this.deps.commandBus.run(updateTaskCommand(row.id, fields));

    let newlyAssigned: string | null = null;
    if (body.assignedAdminUserId !== undefined) {
      const assigned = await this.deps.commandBus.run(assignTaskCommand(row.id, body.assignedAdminUserId));
      if (assigned) newlyAssigned = body.assignedAdminUserId;
    }
    if (body.status !== undefined) await this.deps.commandBus.run(changeTaskStatusCommand(row.id, body.status));

    const task = await this.#afterWrite(row.id, language);
    if (newlyAssigned !== null) await this.#tellAssignee(newlyAssigned, task);
    return task;
  }

  /** `DELETE /tasks/:id`. */
  async delete(id: string): Promise<void> {
    const row = await this.findVisibleRow(id);
    if (!row) throw taskNotFound();
    await assertMayDelete(this.deps.contexts, { contextType: row.context_type, contextId: row.context_id });
    if (!(await this.deps.commandBus.run(deleteTaskCommand(row.id)))) throw taskNotFound();
  }

  /** `GET /tasks/lookups/assignees` — active administrators, by name. */
  async assignees(q: string | undefined): Promise<TaskAssigneeOption[]> {
    const needle = foldDiacritics(q ?? '').trim().toLowerCase();
    return (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter((admin) => isActive(admin))
      .map((admin) => ({ id: admin.id, name: personName(admin), email: admin.email }))
      .filter(
        (option) =>
          needle === '' ||
          [option.name, option.email].some((value) => foldDiacritics(value).toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, ASSIGNEE_OPTIONS_LIMIT);
  }

  /**
   * The Task a write has just committed, read by id **without** visibility: the
   * write may have moved it into a context the caller does not see (a Project
   * they are not a Member of), and answering 404 for a change that committed
   * would misreport it. Never a first read.
   */
  async #afterWrite(id: string, language: SupportedLanguage): Promise<TaskDetail> {
    const rows = (await this.deps.emFactory().execute(`select ${COLUMNS} from "tasks" t where t."id" = ?`, [
      id,
    ])) as TaskRow[];
    if (!rows[0]) throw taskNotFound();
    return this.#detail(rows[0], language);
  }

  async #detail(row: TaskRow, language: SupportedLanguage): Promise<TaskDetail> {
    const [summary] = await this.#summaries([row], language);
    const creator = (await this.#people([row.created_by_admin_user_id])).get(row.created_by_admin_user_id);
    return {
      ...summary!,
      description: row.description,
      // Reference resolution for a Task's description is scheduled by no task
      // of this feature; the field is empty until it is.
      references: [],
      context:
        summary!.context && row.context_id
          ? {
              ...summary!.context,
              id: row.context_id,
              groupId: row.context_group_id,
              canChangeTasks: await this.#mayChangeTasks(row, summary!.context.available),
            }
          : null,
      contextNote: await this.#note(row, language),
      createdBy: creator ? { id: creator.id, name: personName(creator) } : null,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  /**
   * The context owner's `canChangeTasks` for the reader, so a screen does not
   * offer a Delete or a move the server would refuse (T147). An unavailable
   * context answers `false`.
   */
  async #mayChangeTasks(row: TaskRow, available: boolean): Promise<boolean> {
    if (!available || row.context_type === null || row.context_id === null) return false;
    const descriptor = this.deps.contexts.presentFor(row.context_type);
    return descriptor ? descriptor.canChangeTasks(row.context_id) : false;
  }

  /**
   * The Task's note in the reader's language — worded by the context's owner
   * when it says how (`renderNote`), otherwise as it was stored. Only a present
   * owner is asked; a Task that reached here passed visibility, so it is.
   */
  async #note(row: TaskRow, language: SupportedLanguage): Promise<string | null> {
    if (row.context_note === null || !row.context_type) return row.context_note;
    const descriptor = this.deps.contexts.presentFor(row.context_type);
    return descriptor?.renderNote ? descriptor.renderNote(row.context_note, language) : row.context_note;
  }

  /**
   * FR-032: somebody other than the caller now holds the Task. Told only when
   * they may see the Task: a Task in a context is theirs to hear about only if
   * the context's owner says they may see that context (FR-020 — a bell is read
   * outside any visibility, and the number would name a Task they cannot open).
   * An owner that is not present cannot vouch for anybody, so nobody is told.
   */
  async #tellAssignee(assignee: string, task: TaskDetail): Promise<void> {
    if (assignee === actingAdminUserId()) return;
    await tellAfterCommit(task.id, async () => {
      if (!(await this.#assigneeMaySee(assignee, task))) return;
      await this.deps.notifier.assigned({ targetAdminUserId: assignee, taskId: task.id, number: task.number });
    });
  }

  async #assigneeMaySee(assignee: string, task: TaskDetail): Promise<boolean> {
    if (task.context === null) return true;
    const descriptor = this.deps.contexts.presentFor(task.context.type);
    return descriptor !== null && (await descriptor.canSeeAs(assignee, task.context.id));
  }

  /**
   * The Tasks of one context (or one group inside it), oldest first — what the
   * read port answers. The context's own owner is asked once whether the
   * caller may see it; the system is not narrowed.
   */
  async rowsInContext(q: TaskContextQuery, options: { openOnly: boolean }): Promise<TaskRow[]> {
    const filter = await this.#inContext(q);
    if (!filter) return [];
    return (await this.deps.emFactory().execute(
      `select ${COLUMNS} from "tasks" t where ${filter.sql}
         ${options.openOnly ? `and t."status" not in (${CLOSED})` : ''}
        order by t."created_at" asc, t."id" asc`,
      filter.params,
    )) as TaskRow[];
  }

  async countInContext(q: TaskContextQuery): Promise<number> {
    const filter = await this.#inContext(q);
    if (!filter) return 0;
    const rows = (await this.deps.emFactory().execute(
      `select count(*)::int as "n" from "tasks" t where ${filter.sql}`,
      filter.params,
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** The predicate selecting one context's Tasks, or `null` when the caller may not see the context. */
  async #inContext(q: TaskContextQuery): Promise<SqlFragment | null> {
    if (!UUID.test(q.contextId) || (q.contextGroupId !== undefined && !UUID.test(q.contextGroupId))) return null;
    const visible = await this.deps.visibility.canSee({ contextType: q.contextType, contextId: q.contextId });
    if (!visible) return null;
    const sql = [`t."context_type" = ?`, `t."context_id" = ?`];
    const params: unknown[] = [q.contextType, q.contextId];
    if (q.contextGroupId !== undefined) {
      sql.push(`t."context_group_id" = ?`);
      params.push(q.contextGroupId);
    }
    return { sql: sql.join(' and '), params };
  }

  async #summaries(rows: readonly TaskRow[], language: SupportedLanguage): Promise<TaskSummary[]> {
    if (rows.length === 0) return [];
    const [people, descriptions] = await Promise.all([
      this.#people(rows.map((row) => row.assigned_admin_user_id).filter((id): id is string => id !== null)),
      this.#describe(rows),
    ]);
    let unavailable: string | null = null;
    const contextOf = async (row: TaskRow): Promise<TaskContextSummary | null> => {
      if (!row.context_type || !row.context_id) return null;
      const description = descriptions.get(row.context_type)?.get(row.context_id);
      if (description && description.label !== '') {
        return {
          type: row.context_type,
          available: true,
          label: description.label,
          href: description.href || null,
          groupLabel: (row.context_group_id && description.groups.get(row.context_group_id)) || null,
        };
      }
      // Fail closed: the owner did not describe the record — gone since the
      // visibility check, or its owner answered for fewer ids than asked.
      unavailable ??= await this.deps.translate('context.unavailable', language);
      return { type: row.context_type, available: false, label: unavailable, href: null, groupLabel: null };
    };
    const contexts: Array<TaskContextSummary | null> = [];
    for (const row of rows) contexts.push(await contextOf(row));
    return rows.map((row, index) => {
      const assignee = row.assigned_admin_user_id ? people.get(row.assigned_admin_user_id) : undefined;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        status: row.status,
        dueOn: row.due_on,
        overdue: row.overdue,
        assignee: assignee ? { id: assignee.id, name: personName(assignee), active: isActive(assignee) } : null,
        context: contexts[index] ?? null,
      };
    });
  }

  async #people(ids: readonly string[]): Promise<Map<string, AdminUserRecord>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const found = await this.deps.adminUsers.findByIds(unique);
    return new Map(found.map((admin) => [admin.id, admin]));
  }

  /**
   * What each context's owner says about the contexts of `rows`, asked once
   * per type, under the caller's context. Only a present owner is asked; a
   * row reaching here has passed visibility, so its owner is present.
   */
  async #describe(rows: readonly TaskRow[]): Promise<Map<string, Map<string, TaskContextDescription>>> {
    const byType = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.context_type || !row.context_id) continue;
      const ids = byType.get(row.context_type) ?? new Set<string>();
      ids.add(row.context_id);
      byType.set(row.context_type, ids);
    }
    const out = new Map<string, Map<string, TaskContextDescription>>();
    for (const [contextType, ids] of byType) {
      const descriptor = this.deps.contexts.presentFor(contextType);
      if (!descriptor) continue;
      out.set(contextType, await descriptor.describe([...ids]));
    }
    return out;
  }
}
