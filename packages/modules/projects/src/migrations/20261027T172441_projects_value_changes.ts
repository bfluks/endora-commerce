import { Migration } from '@mikro-orm/migrations';

/**
 * A Project's own record of the values its writes changed
 * (`specs/163-projects-and-tasks/`, task T145, issue #470 decision A).
 *
 * Since T144 F4 the platform audit log names *which* value-bearing fields a
 * write changed — the value and the custom fields — and never their values:
 * the audit log is not tenant-scoped. The Project's history still shows them,
 * from here. One row per Command that changed one of them, written in that
 * Command's transaction; the audit entry points at it by `valueChangeId`.
 *
 * `before` is `null` for a create. Both hold only what changed:
 * `valueAmount` / `valueCurrency` and a `customFieldValues` object of the
 * changed keys. The rows go with the Project (`on delete cascade`).
 */
export class Migration20261027T172441ProjectsValueChanges extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "project_value_changes" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "before" jsonb null,
        "after" jsonb not null,
        "at" timestamptz not null default now(),
        constraint "project_value_changes_pkey" primary key ("id"),
        constraint "project_value_changes_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "project_value_changes_project_id_index" on "project_value_changes" ("project_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "project_value_changes";`);
  }
}
