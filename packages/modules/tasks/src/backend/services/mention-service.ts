import {
  ADMIN_PERMISSION_WILDCARD,
  foldDiacritics,
  mentionedAdminUserIds,
  type AdminUserReadPort,
  type AdminUserRecord,
  type PermissionReadPort,
  type TaskAssigneeOption,
} from '@endora-commerce/contracts';
import { actingAdminUserId, type TaskAccess, type TaskRow } from './task-access.js';
import type { TaskContextRegistry } from './task-context-registry.js';
import { tellAfterCommit, type TaskNotifier } from './task-notifier.js';

/** How many people the mention list offers for one search (admin-api §3). */
export const MENTIONABLE_LIMIT = 20;

const TASKS_READ_PERMISSION = 'tasks:read';

/**
 * The people `next` mentions and `previous` did not — who a save tells. Pure,
 * so the Command that saves a text works it out from the text it replaces
 * (Projects' `newlyMentioned`, copied — the platform surface is narrow).
 */
export function newlyMentioned(previous: string | null | undefined, next: string | null | undefined): string[] {
  const before = new Set(mentionedAdminUserIds(previous));
  return [...new Set(mentionedAdminUserIds(next))].filter((id) => !before.has(id));
}

function personName(person: Pick<AdminUserRecord, 'firstName' | 'lastName' | 'email'>): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

function isActive(person: AdminUserRecord): boolean {
  return person.status === 'active' && person.deletedAt === null;
}

/** What is asked about a Task when deciding whether somebody else may see it. */
export type TaskAudienceFacts = Pick<
  TaskRow,
  'created_by_admin_user_id' | 'is_draft' | 'is_private' | 'context_type' | 'context_id'
>;

export interface TaskAudienceDeps {
  permissions: PermissionReadPort;
  contexts: Pick<TaskContextRegistry, 'presentFor'>;
}

/**
 * Whether **another** administrator may see a Task — who may be assigned,
 * mentioned or told about it (`specs/165-task-management/` R-3, R-5; 163
 * F-14). They must hold `tasks:read`; a draft is its Creator's alone; a private
 * Task is its Creator's alone here (nobody is mentioned in one, research R-5);
 * a Task in a context needs the context's owner to say yes (`canSeeAs`), and an
 * owner that is not present vouches for nobody.
 */
export function createTaskAudience(deps: TaskAudienceDeps) {
  return async function maySee(adminUserId: string, task: TaskAudienceFacts): Promise<boolean> {
    if ((task.is_draft || task.is_private) && adminUserId !== task.created_by_admin_user_id) return false;
    const held = await deps.permissions.listPermissions(adminUserId);
    if (!held.includes(ADMIN_PERMISSION_WILDCARD) && !held.includes(TASKS_READ_PERMISSION)) return false;
    if (task.context_type === null || task.context_id === null) return true;
    const descriptor = deps.contexts.presentFor(task.context_type);
    return descriptor !== null && (await descriptor.canSeeAs(adminUserId, task.context_id));
  };
}

export type TaskAudience = ReturnType<typeof createTaskAudience>;

export interface TaskMentionServiceDeps {
  access: Pick<TaskAccess, 'loadVisible'>;
  audience: TaskAudience;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  permissions: PermissionReadPort;
  notifier: Pick<TaskNotifier, 'mentioned'>;
}

/**
 * People mentioned in a Task's description (and, from User Story 4, its
 * comments) — `specs/165-task-management/` FR-006, research R-5; Projects'
 * `mention-service.ts`, the model.
 *
 * **Who may be mentioned** is somebody who may see the Task: an active
 * administrator holding `tasks:read` who passes {@link createTaskAudience}. On
 * the create form, before there is a Task, the holders of `tasks:read`.
 *
 * **Who is told** is decided again when the text is saved, because the token
 * is text and can be typed by hand: the same question, and never the author.
 * The bell entry names the Task by number, never the text. Told after the
 * commit, under `tellAfterCommit`.
 */
export class TaskMentionService {
  constructor(private readonly deps: TaskMentionServiceDeps) {}

  /** `GET /tasks/lookups/mentionable?taskId=&q=` — at most {@link MENTIONABLE_LIMIT}, by name. */
  async mentionable(query: { taskId?: string | undefined; q?: string | undefined }): Promise<TaskAssigneeOption[]> {
    // The Task first: one the caller may not see is 404 as one that does not exist.
    const task = query.taskId !== undefined ? await this.deps.access.loadVisible(query.taskId) : null;
    const needle = foldDiacritics(query.q ?? '')
      .trim()
      .toLowerCase();
    const candidates = (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter(isActive)
      .map((admin) => ({ admin, name: personName(admin) }))
      .filter(
        ({ admin, name }) =>
          needle === '' || [name, admin.email].some((value) => foldDiacritics(value).toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.admin.id.localeCompare(b.admin.id));

    const options: TaskAssigneeOption[] = [];
    // In name order, stopping at the limit: the questions below are asked of
    // as many people as the list shows, not of every administrator.
    for (const { admin, name } of candidates) {
      if (options.length >= MENTIONABLE_LIMIT) break;
      const allowed = task !== null ? await this.deps.audience(admin.id, task) : await this.#readsTasks(admin.id);
      if (allowed) options.push({ id: admin.id, name, email: admin.email });
    }
    return options;
  }

  /**
   * Tell the newly mentioned who may see the Task, after the save committed;
   * answers who was addressed. Never the author; a draft tells nobody (it is
   * its Creator's alone until published).
   */
  async tell(task: TaskAudienceFacts & { id: string; number: string }, mentioned: readonly string[]): Promise<string[]> {
    const author = actingAdminUserId();
    const ids = [...new Set(mentioned)].filter((id) => id !== author);
    if (ids.length === 0) return [];
    const people = (await this.deps.adminUsers.findByIds(ids)).filter(isActive);
    const addressed: string[] = [];
    for (const person of people) {
      await tellAfterCommit(task.id, async () => {
        if (!(await this.deps.audience(person.id, task))) return;
        await this.deps.notifier.mentioned({ targetAdminUserId: person.id, taskId: task.id, number: task.number });
        addressed.push(person.id);
      });
    }
    return addressed;
  }

  async #readsTasks(adminUserId: string): Promise<boolean> {
    const held = await this.deps.permissions.listPermissions(adminUserId);
    return held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(TASKS_READ_PERMISSION);
  }
}
