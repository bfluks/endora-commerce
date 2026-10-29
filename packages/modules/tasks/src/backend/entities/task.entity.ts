import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { TaskStatus } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Task — a piece of work for an administrator, with a due date and a status
 * (`specs/163-projects-and-tasks/data-model.md` §1).
 *
 * **`@RuleScoped`, because its tenancy is its context's rule** (research R-9).
 * A Task carries no Organization of its own: a Task without a context is
 * visible to every holder of `tasks:read`, and a Task with one is visible
 * exactly when the module that registered its context type says the caller
 * may see the context. No ORM filter backs that — every read of this table
 * goes through `TaskVisibility` (`services/task-visibility.ts`), which is the
 * module's only read path.
 *
 * The context — `contextType` / `contextId` / `contextGroupId` — is opaque
 * here: `tasks` names no module that owns one. The assignee and the creator
 * are administrators held by value.
 */
@RuleScoped()
@Entity({ tableName: 'tasks' })
export class Task {
  [OptionalProps]?:
    | 'id'
    | 'description'
    | 'status'
    | 'assignedAdminUserId'
    | 'dueOn'
    | 'completedAt'
    | 'contextType'
    | 'contextId'
    | 'contextGroupId'
    | 'contextNote'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `TSK-` + the zero-padded value of `tasks_number_seq`. */
  @Property({ type: 'text' })
  @Unique()
  number!: string;

  @Property({ type: 'text' })
  title!: string;

  /** Plain text carrying reference tokens; never HTML. */
  @Property({ type: 'text' })
  description: string = '';

  @Property({ type: 'text' })
  status: TaskStatus = 'todo';

  @Property({ type: 'uuid', nullable: true })
  assignedAdminUserId?: string | null;

  @Property({ type: 'date', nullable: true })
  dueOn?: string | null;

  /** Set on entering `done`, cleared on leaving it. */
  @Property({ type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @Property({ type: 'uuid' })
  createdByAdminUserId!: string;

  /** The context's type, registered by its owner (`project`); `null` with no context. */
  @Property({ type: 'text', nullable: true })
  contextType?: string | null;

  @Property({ type: 'uuid', nullable: true })
  contextId?: string | null;

  /** A group inside the context — a Project's Stage. */
  @Property({ type: 'uuid', nullable: true })
  contextGroupId?: string | null;

  /** Written by the context's owner, e.g. "Responsible role: Installer". */
  @Property({ type: 'text', nullable: true })
  contextNote?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
