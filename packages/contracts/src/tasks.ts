import { z } from 'zod';
import { calendarDateSchema } from './common.js';
import { dataEnvelope } from './envelopes.js';
import type { SupportedLanguage } from './platform-language.js';
import { RecordReferenceSchema } from './record-references.js';

/**
 * Tasks — a first version (`specs/163-projects-and-tasks/`).
 *
 * Every request, response, port, registry and event shape of the `tasks`
 * module, written before the first route (Constitution II) and for **every**
 * story of the feature — later phases add no contract here. The normative prose
 * is `specs/163-projects-and-tasks/contracts/admin-api.md` §1 and
 * `contracts/ports-and-events.md` §1; the schema is `data-model.md` §1.
 *
 * A Task may belong to an **opaque context** — `contextType` / `contextId` /
 * `contextGroupId` — through which another module owns it (a Project and one
 * of its Stages, today). `tasks` names no such module: the context's owner
 * registers a {@link TaskContextDescriptor} that answers who may see its
 * contexts and how to label them (research R-1, R-9).
 *
 * Base path of the HTTP API: `/api/v1/admin/tasks`. There is no storefront or
 * customer route (FR-043).
 */

// ---------------------------------------------------------------------------
// Vocabulary and limits
// ---------------------------------------------------------------------------

/** A Task's status — a free choice among the four in this first version. */
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** The statuses a Task is finished in; any other is open (the completion gate, *My Tasks*). */
export const TASK_CLOSED_STATUSES = ['done', 'cancelled'] as const satisfies readonly TaskStatus[];

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_CONTEXT_NOTE_MAX = 200;
/** The most Tasks one `taskWritePort.createMany` call creates (research R-22). */
export const TASK_WRITE_PORT_BATCH_MAX = 100;
export const TASK_LIST_LIMIT_MAX = 100;

/**
 * A context type — the contributor's own stable code (`project`). snake_case,
 * so it reads the same in a query string, a column and a log line.
 */
export const taskContextTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'A context type is a snake_case code');

const titleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX);
const descriptionSchema = z.string().max(TASK_DESCRIPTION_MAX);
const isoTimestampSchema = z.string();

/**
 * A query-string field that may repeat. One occurrence arrives as a string and
 * several as an array; both normalise to an array.
 */
function repeatable<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(item).max(50).optional(),
  );
}

/** A query-string boolean: `true` / `false` as text, or a real boolean. */
const queryBooleanSchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

// ---------------------------------------------------------------------------
// The Task context (`data-model.md` §1 — all or nothing)
// ---------------------------------------------------------------------------

/**
 * Where a Task belongs, when it belongs anywhere. **All or nothing**: a type
 * without an id, or an id without a type, is no context — the table's check
 * `(context_type is null) = (context_id is null)` says the same — and a group
 * (a Stage) exists only inside a context. A Task with no context is written as
 * `context: null` or by leaving `context` out.
 */
export const TaskContextSchema = z
  .object({
    contextType: taskContextTypeSchema,
    contextId: z.string().uuid(),
    contextGroupId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type TaskContext = z.infer<typeof TaskContextSchema>;

/**
 * A context as the reader is shown it: what the owner's descriptor says about it.
 *
 * `available: false` when the owner's `describe()` did not describe the id —
 * a record that went away between the visibility check and the description.
 * The context then fails closed: `label` is the sentence "unavailable record"
 * in the reader's language, `href` and `groupLabel` are `null`. A label is
 * never empty.
 */
export const TaskContextSummarySchema = z.object({
  type: z.string(),
  available: z.boolean(),
  label: z.string().min(1),
  href: z.string().nullable(),
  groupLabel: z.string().nullable(),
});
export type TaskContextSummary = z.infer<typeof TaskContextSummarySchema>;

export const TaskContextDetailSchema = TaskContextSummarySchema.extend({
  id: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  /**
   * The context owner's `canChangeTasks` for this reader: whether they may
   * delete this Task or move it out of its record. `false` for an unavailable
   * context. A screen offers neither when it is `false` (T147).
   */
  canChangeTasks: z.boolean(),
});
export type TaskContextDetail = z.infer<typeof TaskContextDetailSchema>;

// ---------------------------------------------------------------------------
// §1 Requests
// ---------------------------------------------------------------------------

/** `assignee`: an admin user's id, `me` (the caller) or `none` (unassigned). */
const assigneeFilterSchema = z.union([z.literal('me'), z.literal('none'), z.string().uuid()]);

/** `GET /tasks`. Hidden contexts are pre-filtered before the query runs (R-9). */
export const TaskListQuerySchema = z.object({
  status: repeatable(taskStatusSchema),
  assignee: assigneeFilterSchema.optional(),
  dueFrom: calendarDateSchema.optional(),
  dueTo: calendarDateSchema.optional(),
  /** `true`: open Tasks whose due date has passed. */
  overdue: queryBooleanSchema.optional(),
  contextType: taskContextTypeSchema.optional(),
  contextId: z.string().uuid().optional(),
  /** Number or title. */
  q: z.string().trim().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(TASK_LIST_LIMIT_MAX).default(50),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

/**
 * `POST /tasks`. A `context` is accepted only for a type registered by a
 * present module whose descriptor lists the id as visible to the caller — else
 * 422 `TASK_CONTEXT_INVALID`. The assignee must be an active administrator —
 * else 422 `TASK_ASSIGNEE_INVALID`.
 */
export const CreateTaskBodySchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.optional(),
    assignedAdminUserId: z.string().uuid().nullable().optional(),
    dueOn: calendarDateSchema.nullable().optional(),
    context: TaskContextSchema.nullable().optional(),
  })
  .strict();
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;

/**
 * `PATCH /tasks/:id` — any of the fields, at least one. Assigning the Task to
 * somebody other than the caller notifies them (FR-032); `done` sets
 * `completedAt`, leaving `done` clears it.
 */
export const UpdateTaskBodySchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    dueOn: calendarDateSchema.nullable(),
    assignedAdminUserId: z.string().uuid().nullable(),
    status: taskStatusSchema,
    context: TaskContextSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;

/** `GET /tasks/lookups/assignees?q=` — active administrators. */
export const TaskAssigneeLookupQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
});
export type TaskAssigneeLookupQuery = z.infer<typeof TaskAssigneeLookupQuerySchema>;

// ---------------------------------------------------------------------------
// §1 Responses
// ---------------------------------------------------------------------------

export const TaskAssigneeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** `false` once the administrator was deactivated; the Task keeps them. */
  active: z.boolean(),
});
export type TaskAssignee = z.infer<typeof TaskAssigneeSchema>;

export const TaskSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  dueOn: z.string().nullable(),
  /** Open and past its due date, by the server's calendar day. */
  overdue: z.boolean(),
  assignee: TaskAssigneeSchema.nullable(),
  context: TaskContextSummarySchema.nullable(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskDetailSchema = TaskSummarySchema.extend({
  description: z.string(),
  /** What the description's reference tokens name for this reader (`record-references.ts`). */
  references: z.array(RecordReferenceSchema),
  context: TaskContextDetailSchema.nullable(),
  /**
   * Written by the context's owner when it created the Task, in the reader's
   * language — e.g. "Responsible role: Installer" (`TaskContextDescriptor.renderNote`).
   */
  contextNote: z.string().nullable(),
  createdBy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  completedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** `GET /tasks` — one page; `nextCursor` is `null` on the last. */
export const TaskListResponseSchema = z.object({
  items: z.array(TaskSummarySchema),
  nextCursor: z.string().nullable(),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const TaskAssigneeOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
});
export type TaskAssigneeOption = z.infer<typeof TaskAssigneeOptionSchema>;

export const TaskDetailResponseSchema = dataEnvelope(TaskDetailSchema);
/** `GET /tasks/mine` — the caller's open Tasks, by due date, undated last. */
export const MyTasksResponseSchema = dataEnvelope(z.array(TaskSummarySchema));
export const TaskAssigneeLookupResponseSchema = dataEnvelope(z.array(TaskAssigneeOptionSchema));
// `GET /tasks/:id/history` answers `RecordHistoryPageSchema` of `record-references.ts`.

// ---------------------------------------------------------------------------
// Error codes (`contracts/admin-api.md` §1)
// ---------------------------------------------------------------------------

/**
 * The codes the Tasks API raises. Each joins the platform's `ERROR_CODES`, the
 * `tasks` manifest's `errorCodes` and the module's `errors.<CODE>` sentences in
 * the change that adds its first raise site — `check:error-translations` refuses
 * a code enumerated before a manifest declares it.
 */
export const TASKS_ERROR_CODES = [
  /** No such Task, or one whose context the caller may not see — indistinguishable. */
  'TASK_NOT_FOUND',
  /** The context's type is not registered by a present module, or the caller may not see the id. */
  'TASK_CONTEXT_INVALID',
  /** The assignee is not an active administrator. */
  'TASK_ASSIGNEE_INVALID',
] as const;
export type TasksErrorCode = (typeof TASKS_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Events (`contracts/ports-and-events.md` §1)
// ---------------------------------------------------------------------------

/**
 * The `eventId` / `occurredAt` envelope every in-process event carries. Spelled
 * structurally because this package may not import the platform's `EventBase`.
 */
interface TasksEventEnvelope {
  eventId: string;
  occurredAt: string;
}

/** The event names `tasks` emits, once per Command, on commit. */
export const TASKS_EVENTS = {
  CREATED: 'tasks.task.created.v1',
  STATUS_CHANGED: 'tasks.task.status_changed.v1',
  ASSIGNED: 'tasks.task.assigned.v1',
  DELETED: 'tasks.task.deleted.v1',
} as const;

/** Payload of `tasks.task.created.v1`. */
export interface TaskCreatedEvent extends TasksEventEnvelope {
  taskId: string;
  contextType: string | null;
  contextId: string | null;
  contextGroupId: string | null;
  assignedAdminUserId: string | null;
}

/** Payload of `tasks.task.status_changed.v1`. */
export interface TaskStatusChangedEvent extends TasksEventEnvelope {
  taskId: string;
  from: TaskStatus;
  to: TaskStatus;
  contextType: string | null;
  contextId: string | null;
  contextGroupId: string | null;
}

/** Payload of `tasks.task.assigned.v1`. */
export interface TaskAssignedEvent extends TasksEventEnvelope {
  taskId: string;
  from: string | null;
  to: string | null;
}

/** Payload of `tasks.task.deleted.v1`. */
export interface TaskDeletedEvent extends TasksEventEnvelope {
  taskId: string;
  contextType: string | null;
  contextId: string | null;
}

// ---------------------------------------------------------------------------
// Published ports and the context registry (`contracts/ports-and-events.md` §1)
//
// The `Container name:` marker of each was added in the change that registered
// it (`check:port-shape` refuses a marked port nothing registers — CRM
// `research.md` N-5).
// ---------------------------------------------------------------------------

/** A Task as it crosses a module boundary — a plain shape, never the entity. */
export interface TaskRecord {
  id: string;
  number: string;
  title: string;
  status: TaskStatus;
  dueOn: string | null;
  assignedAdminUserId: string | null;
  contextType: string | null;
  contextId: string | null;
  contextGroupId: string | null;
  contextNote: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

/** What `TaskReadPort.search` is asked: the letters typed, and how many to answer. */
export interface TaskSearchQuery {
  q?: string;
  limit: number;
}

/** The Tasks of one context, or of one group (a Stage) inside it. */
export interface TaskContextQuery {
  contextType: string;
  contextId: string;
  contextGroupId?: string;
}

/**
 * Container name: `taskReadPort`. Owner: `tasks`.
 *
 * Reading Tasks from another module.
 *
 * Context visibility (R-9) is applied for an administrator's call; a call the
 * system makes (no admin session — a sweep) is not narrowed.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`.
 */
export interface TaskReadPort {
  findById(id: string): Promise<TaskRecord | null>;
  /**
   * The Tasks of `ids` the caller may see, in no particular order — a hidden,
   * missing or malformed id is simply absent. One query for a page of
   * references (`specs/163-projects-and-tasks/` FR-044).
   */
  findByIds(ids: readonly string[]): Promise<TaskRecord[]>;
  /**
   * Tasks the caller may see whose number or title contains `q`
   * (case-insensitively; every visible Task for an empty `q`), newest first,
   * at most `limit` — the Tasks group of the `@@` document list (FR-044).
   */
  search(query: TaskSearchQuery): Promise<TaskRecord[]>;
  listInContext(q: TaskContextQuery): Promise<TaskRecord[]>;
  /** Status neither `done` nor `cancelled` — the completion gate's question. */
  listOpenInContext(q: TaskContextQuery): Promise<TaskRecord[]>;
  countInContext(q: TaskContextQuery): Promise<number>;
}

/** One Task another module asks `tasks` to create in its context. */
export interface NewContextTask {
  title: string;
  description?: string;
  assignedAdminUserId?: string | null;
  dueOn?: string | null;
  contextNote?: string | null;
}

/**
 * Container name: `taskWritePort`. Owner: `tasks`.
 *
 * Creating and deleting Tasks from another module.
 *
 * `createMany` runs one `tasks.task.create` Command per Task under the ambient
 * actor, at most {@link TASK_WRITE_PORT_BATCH_MAX} per call; the context's type
 * must be registered by a present module. **Call it after your own commit** —
 * the implementation obtains its own EntityManager (R-8).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError`. A consumer must not wrap the call in a bare `catch`.
 */
export interface TaskWritePort {
  createMany(input: { context: TaskContext; tasks: NewContextTask[] }): Promise<{ ids: string[] }>;
  /** Every Task of one context — used when the context's record is deleted. */
  deleteInContext(q: { contextType: string; contextId: string }): Promise<{ deleted: number }>;
}

/** How a context is shown on a Task: its label, its address, and its groups' labels. */
export interface TaskContextDescription {
  label: string;
  href: string;
  /** groupId → label (a Project's Stage names). */
  groups: Map<string, string>;
}

/**
 * What a module registers to own Tasks: its context type and the answers only
 * it can give. Every method runs under the **caller's** ambient context.
 */
export interface TaskContextDescriptor {
  /** The context type the module owns (`project`). */
  readonly contextType: string;
  /** The contributing module; an absent owner hides its Tasks. */
  readonly ownerModuleId: string;
  /** Every context id of this type the caller may see — the list pre-filter (R-9). */
  allVisibleContextIds(): Promise<string[]>;
  /** Which of `ids` the caller may see. */
  visibleContextIds(ids: readonly string[]): Promise<Set<string>>;
  describe(ids: readonly string[]): Promise<Map<string, TaskContextDescription>>;
  /**
   * Whether **another** administrator — not the caller — may see context `id`:
   * asked before somebody is told about a Task of it (the assignment bell),
   * because a bell is read outside the context's visibility and a Task's
   * number must not reach somebody its context hides it from. Answered against
   * that administrator's own permissions and reach; `false` when unsure.
   */
  canSeeAs(adminUserId: string, id: string): Promise<boolean>;
  /**
   * Whether the caller may change which Tasks context `id` holds: put a Task
   * **into** it (create it there, or move it there from elsewhere), take one
   * **out of** it (detach it, or move it to another record), or **delete** one
   * of its Tasks. Without this a holder of `tasks:write` who merely sees a
   * record could publish its Tasks to every holder of `tasks:read`, add to its
   * work or remove from it (T144, T147). Moving a Task between the groups of
   * one record, and editing a Task where it is, are not asked. Answered under
   * the caller's own context; `false` when unsure.
   */
  canChangeTasks(id: string): Promise<boolean>;
  /**
   * A Task's `contextNote` in the reader's language. The note is the owner's
   * own text, written when it created the Task; an owner that stores a key
   * rather than a sentence (a Project stores the responsible Role) answers it
   * here. Without this method the note is shown as it is stored.
   */
  renderNote?(note: string, language: SupportedLanguage): Promise<string>;
}

/**
 * Container name: `taskContextRegistry`. Owner: `tasks`.
 *
 * The registry a module pushes its {@link TaskContextDescriptor} into.
 *
 * A **contribution seam**: registered ungated (a plain `ctx.di.register`),
 * pushed into from a contribution-only boot hook, declared by the contributor
 * as a `contributes-to` edge.
 *
 * **Enumeration policy: fail-closed.** A Task whose context type is
 * unregistered, or whose owner is not effectively present, is hidden — from
 * lists, counts and by id — and reappears unchanged when the owner is back.
 */
export interface TaskContextRegistryPort {
  register(descriptor: TaskContextDescriptor): void;
}
