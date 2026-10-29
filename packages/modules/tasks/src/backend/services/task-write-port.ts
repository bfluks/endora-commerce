import type { EntityManager } from '@mikro-orm/postgresql';
import {
  calendarDateSchema,
  ERROR_CODES,
  TASK_CONTEXT_NOTE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  TASK_WRITE_PORT_BATCH_MAX,
  TaskContextSchema,
  type AdminUserReadPort,
  type NewContextTask,
  type TaskContext,
  type TaskWritePort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Task } from '../entities/task.entity.js';
import { assertAssignable } from './task-checks.js';
import { createTaskCommand, deleteTaskCommand, type NewTaskFields } from './task-commands.js';
import type { TaskContextRegistry } from './task-context-registry.js';
import { taskContextInvalid } from './task-errors.js';

/**
 * `taskWritePort` — another module creating and deleting Tasks in a context it
 * owns (`specs/163-projects-and-tasks/contracts/ports-and-events.md` §1).
 *
 * `createMany` runs **one `tasks.task.create` Command per Task** under the
 * ambient actor, so each Task has its own audit row and its own
 * `tasks.task.created.v1`. Everything that can refuse the call — the batch
 * size, an entry's shape, the context's owner, an assignee — is checked
 * before the first Command runs, so a refused call writes nothing. The caller
 * calls it **after its own commit** (research R-8): each Command opens its own
 * transaction.
 *
 * The context's type must be registered by a **present** module; the port
 * does not ask whether the caller may see the id, because its caller is that
 * context's owner acting on its own record.
 *
 * Published with `providePort`: resolving it while `tasks` is off throws
 * `ModuleDisabledError` (503 `MODULE_DISABLED`).
 */
export interface TaskWritePortDeps {
  commandBus: CommandBus;
  emFactory: () => EntityManager;
  contexts: TaskContextRegistry;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

function invalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, message);
}

function validEntry(entry: NewContextTask, index: number): NewTaskFields {
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (title.length < 1 || title.length > TASK_TITLE_MAX) {
    throw invalid(`Task ${index + 1}: a title has 1 to ${TASK_TITLE_MAX} characters.`);
  }
  const description = entry.description ?? '';
  if (description.length > TASK_DESCRIPTION_MAX) {
    throw invalid(`Task ${index + 1}: a description has at most ${TASK_DESCRIPTION_MAX} characters.`);
  }
  const contextNote = entry.contextNote ?? null;
  if (contextNote !== null && contextNote.length > TASK_CONTEXT_NOTE_MAX) {
    throw invalid(`Task ${index + 1}: a context note has at most ${TASK_CONTEXT_NOTE_MAX} characters.`);
  }
  const dueOn = entry.dueOn ?? null;
  if (dueOn !== null && !calendarDateSchema.safeParse(dueOn).success) {
    throw invalid(`Task ${index + 1}: a due date is a calendar date, YYYY-MM-DD.`);
  }
  return { title, description, assignedAdminUserId: entry.assignedAdminUserId ?? null, dueOn, contextNote };
}

export class TaskWritePortService implements TaskWritePort {
  constructor(private readonly deps: TaskWritePortDeps) {}

  async createMany(input: { context: TaskContext; tasks: NewContextTask[] }): Promise<{ ids: string[] }> {
    const parsed = TaskContextSchema.safeParse(input.context);
    if (!parsed.success) throw invalid('The context is not a context type and a uuid.');
    const context = parsed.data;
    if (input.tasks.length > TASK_WRITE_PORT_BATCH_MAX) {
      throw invalid(`At most ${TASK_WRITE_PORT_BATCH_MAX} Tasks are created in one call.`);
    }
    const tasks = input.tasks.map(validEntry);
    if (!this.deps.contexts.presentFor(context.contextType)) {
      throw taskContextInvalid(`No module that is switched on owns the Task context "${context.contextType}".`);
    }
    await assertAssignable(this.deps.adminUsers, tasks.map((task) => task.assignedAdminUserId));

    const ids: string[] = [];
    for (const task of tasks) {
      ids.push(await this.deps.commandBus.run(createTaskCommand(context, task)));
    }
    return { ids };
  }

  async deleteInContext(q: { contextType: string; contextId: string }): Promise<{ deleted: number }> {
    const parsed = TaskContextSchema.safeParse({ contextType: q.contextType, contextId: q.contextId });
    if (!parsed.success) throw invalid('The context is not a context type and a uuid.');
    const doomed = await this.deps.emFactory().find(
      Task,
      { contextType: q.contextType, contextId: q.contextId },
      { fields: ['id'], orderBy: { createdAt: 'asc' } },
    );
    let deleted = 0;
    for (const { id } of doomed) {
      if (await this.deps.commandBus.run(deleteTaskCommand(id))) deleted += 1;
    }
    return { deleted };
  }
}
