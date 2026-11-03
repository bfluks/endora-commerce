import { Migration } from '@mikro-orm/migrations';

/**
 * `tasks` — the whole schema of the module, in one migration
 * (`specs/163-projects-and-tasks/data-model.md` §1).
 *
 * One table and one sequence. Everything lands here, before the first user
 * story, so that no later story adds a migration or an entity.
 *
 * **No foreign key leaves the table.** The assignee, the creator and the
 * context are held by value: an administrator is checked through
 * `admin_users`' read port on write, and a context belongs to whichever module
 * registered its type — `tasks` names none of them (research R-1). So the
 * manifest declares no dependency for this migration's sake.
 *
 * The context is **all or nothing**: a type without an id, or an id without a
 * type, is refused by a check, and a group (a Project's Stage) exists only
 * inside a context.
 */
export class Migration20261026T133731TasksInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create sequence "tasks_number_seq";`);
    this.addSql(`
      create table "tasks" (
        "id" uuid not null default gen_random_uuid(),
        "number" text not null,
        "title" text not null,
        "description" text not null default '',
        "status" text not null default 'todo',
        "assigned_admin_user_id" uuid null,
        "due_on" date null,
        "completed_at" timestamptz null,
        "created_by_admin_user_id" uuid not null,
        "context_type" text null,
        "context_id" uuid null,
        "context_group_id" uuid null,
        "context_note" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "tasks_pkey" primary key ("id"),
        constraint "tasks_number_unique" unique ("number"),
        constraint "tasks_status_check" check ("status" in ('todo', 'in_progress', 'done', 'cancelled')),
        constraint "tasks_title_length_check" check (char_length("title") between 1 and 200),
        constraint "tasks_description_length_check" check (char_length("description") <= 20000),
        constraint "tasks_context_note_length_check" check ("context_note" is null or char_length("context_note") <= 200),
        constraint "tasks_context_check" check (("context_type" is null) = ("context_id" is null)),
        constraint "tasks_context_group_check" check ("context_group_id" is null or "context_id" is not null)
      );
    `);
    // My Tasks: an assignee's open Tasks by due date.
    this.addSql(
      `create index "tasks_assigned_admin_user_id_status_due_on_index" on "tasks" ("assigned_admin_user_id", "status", "due_on");`,
    );
    // The completion gate and a context's Tasks tab: the open Tasks of one Stage.
    this.addSql(
      `create index "tasks_context_type_context_id_context_group_id_status_index" on "tasks" ("context_type", "context_id", "context_group_id", "status");`,
    );
    // The Tasks list filtered by status and due date, and the overdue filter.
    this.addSql(`create index "tasks_status_due_on_index" on "tasks" ("status", "due_on");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tasks";`);
    this.addSql(`drop sequence if exists "tasks_number_seq";`);
  }
}
