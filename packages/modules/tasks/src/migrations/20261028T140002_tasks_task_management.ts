import { Migration } from '@mikro-orm/migrations';

/**
 * `tasks` — Task management (`specs/165-task-management/data-model.md` §1–§3):
 * the whole schema of feature 165, in one migration, so that no later story
 * regenerates the registries.
 *
 * - `tasks` is altered: a status becomes a code of the configured workflow
 *   (the four-literal check goes; no row changes, research R-1), the single
 *   assignee moves to `task_assignees` (R-2), and the columns of the due
 *   moment, start date, priority, draft/private, hierarchy, source key, custom
 *   fields and publication arrive.
 * - Nine tables hang off a Task, each cascading with it. They are rule-scoped
 *   as `tasks` is and read only through `TaskVisibility` (R-21).
 * - Six tables are platform-wide configuration (workflow, priorities, tags)
 *   and per-administrator rows (saved views, digest subscriptions).
 *
 * **Order inside `up`:** create the tables → seed the workflow and the
 * priorities → copy the assignees → drop the column → add the checks. A status
 * and a priority are never referenced by foreign key: a Task holds the code.
 *
 * No foreign key leaves this module's tables (163 research R-1): an
 * administrator, an asset, a linked record and a reference target are held by
 * value, so the manifest's `dependencies` are not this migration's concern.
 *
 * **`down` restores the 163 shape**, losing what 163 cannot hold: a Task keeps
 * one assignee — the first by `assigned_at` — and a status outside the four
 * seeded codes falls back to the seeded code of its category (`todo` for an
 * open one).
 */
export class Migration20261028T140002TasksTaskManagement extends Migration {
  override async up(): Promise<void> {
    // --- Configuration (@GlobalEntity) ------------------------------------
    this.addSql(`
      create table "task_statuses" (
        "id" uuid not null default gen_random_uuid(),
        "code" varchar(64) not null,
        "name" jsonb not null default '{}',
        "default_name" varchar(120) not null,
        "category" varchar(16) not null,
        "is_initial" boolean not null default false,
        "weight" int not null default 100,
        "color" varchar(16) not null default '#64748b',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "task_statuses_pkey" primary key ("id"),
        constraint "task_statuses_code_unique" unique ("code"),
        constraint "task_statuses_code_check" check ("code" ~ '^[a-z][a-z0-9_]*$'),
        constraint "task_statuses_category_check" check ("category" in ('open', 'done', 'cancelled'))
      );
    `);
    // At most one initial status; the workflow graph requires exactly one.
    this.addSql(
      `create unique index "task_statuses_one_initial" on "task_statuses" ("is_initial") where "is_initial";`,
    );

    this.addSql(`
      create table "task_status_transitions" (
        "id" uuid not null default gen_random_uuid(),
        "from_code" varchar(64) not null,
        "to_code" varchar(64) not null,
        "created_at" timestamptz not null default now(),
        constraint "task_status_transitions_pkey" primary key ("id"),
        constraint "task_status_transitions_from_to_unique" unique ("from_code", "to_code"),
        constraint "task_status_transitions_distinct_check" check ("from_code" <> "to_code")
      );
    `);
    this.addSql(
      `create index "task_status_transitions_from_code_index" on "task_status_transitions" ("from_code");`,
    );

    this.addSql(`
      create table "task_priorities" (
        "id" uuid not null default gen_random_uuid(),
        "code" varchar(64) not null,
        "name" jsonb not null default '{}',
        "default_name" varchar(120) not null,
        "color" varchar(16) not null default '#64748b',
        "weight" int not null default 100,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "task_priorities_pkey" primary key ("id"),
        constraint "task_priorities_code_unique" unique ("code"),
        constraint "task_priorities_code_check" check ("code" ~ '^[a-z][a-z0-9_]*$' and "code" <> 'none')
      );
    `);

    this.addSql(`
      create table "task_tags" (
        "id" uuid not null default gen_random_uuid(),
        "name" varchar(64) not null,
        "color" varchar(16) not null default '#64748b',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "task_tags_pkey" primary key ("id")
      );
    `);
    this.addSql(`create unique index "task_tags_name_lower_unique" on "task_tags" (lower("name"));`);

    // --- Per administrator (@GlobalEntity) ------------------------------------
    this.addSql(`
      create table "task_list_saved_views" (
        "id" uuid not null default gen_random_uuid(),
        "owner_admin_user_id" uuid not null,
        "name" varchar(160) not null,
        "shared" boolean not null default false,
        "filters" jsonb not null default '{}'::jsonb,
        "sort" jsonb null,
        "visible_columns" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "task_list_saved_views_pkey" primary key ("id"),
        constraint "task_list_saved_views_filters_size_check" check (octet_length("filters"::text) <= 8192)
      );
    `);
    this.addSql(
      `create unique index "task_list_saved_views_owner_name_unique" on "task_list_saved_views" ("owner_admin_user_id", lower("name"));`,
    );

    this.addSql(`
      create table "task_digest_subscriptions" (
        "admin_user_id" uuid not null,
        "hour" smallint not null,
        "last_sent_on" date null,
        "updated_at" timestamptz not null default now(),
        constraint "task_digest_subscriptions_pkey" primary key ("admin_user_id"),
        constraint "task_digest_subscriptions_hour_check" check ("hour" between 0 and 23)
      );
    `);

    // --- Owned by a Task (@RuleScoped, read through TaskVisibility) ------------
    this.addSql(`
      create table "task_assignees" (
        "task_id" uuid not null,
        "admin_user_id" uuid not null,
        "assigned_at" timestamptz not null default now(),
        "assigned_by_admin_user_id" uuid null,
        constraint "task_assignees_pkey" primary key ("task_id", "admin_user_id"),
        constraint "task_assignees_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "task_assignees_admin_user_id_index" on "task_assignees" ("admin_user_id");`);

    this.addSql(`
      create table "task_tag_assignments" (
        "task_id" uuid not null,
        "tag_id" uuid not null,
        constraint "task_tag_assignments_pkey" primary key ("task_id", "tag_id"),
        constraint "task_tag_assignments_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade,
        constraint "task_tag_assignments_tag_fk" foreign key ("tag_id") references "task_tags" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "task_tag_assignments_tag_id_index" on "task_tag_assignments" ("tag_id");`);

    this.addSql(`
      create table "task_comments" (
        "id" uuid not null default gen_random_uuid(),
        "task_id" uuid not null,
        "body" text not null,
        "author_admin_user_id" uuid not null,
        "edited_at" timestamptz null,
        "deleted_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        constraint "task_comments_pkey" primary key ("id"),
        constraint "task_comments_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade,
        constraint "task_comments_body_length_check" check (char_length("body") <= 20000)
      );
    `);
    this.addSql(`create index "task_comments_task_id_created_at_index" on "task_comments" ("task_id", "created_at");`);

    this.addSql(`
      create table "task_references" (
        "id" uuid not null default gen_random_uuid(),
        "task_id" uuid not null,
        "source_kind" varchar(16) not null,
        "source_id" uuid null,
        "target_type" varchar(32) not null,
        "target_id" uuid not null,
        constraint "task_references_pkey" primary key ("id"),
        constraint "task_references_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade,
        constraint "task_references_source_kind_check" check ("source_kind" in ('description', 'comment')),
        constraint "task_references_source_check" check (("source_kind" = 'comment') = ("source_id" is not null)),
        constraint "task_references_target_type_check"
          check ("target_type" in ('admin_user', 'order', 'product', 'quote_request', 'task', 'opportunity', 'project'))
      );
    `);
    this.addSql(`create index "task_references_task_id_index" on "task_references" ("task_id");`);
    this.addSql(`create index "task_references_target_index" on "task_references" ("target_type", "target_id");`);

    this.addSql(`
      create table "task_attachments" (
        "id" uuid not null default gen_random_uuid(),
        "task_id" uuid not null,
        "asset_id" uuid not null,
        "added_by_admin_user_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "task_attachments_pkey" primary key ("id"),
        constraint "task_attachments_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade,
        constraint "task_attachments_task_asset_unique" unique ("task_id", "asset_id")
      );
    `);
    this.addSql(`create index "task_attachments_asset_id_index" on "task_attachments" ("asset_id");`);

    this.addSql(`
      create table "task_record_links" (
        "id" uuid not null default gen_random_uuid(),
        "task_id" uuid not null,
        "record_kind" varchar(32) not null,
        "record_id" uuid not null,
        "linked_by_admin_user_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "task_record_links_pkey" primary key ("id"),
        constraint "task_record_links_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade,
        constraint "task_record_links_unique" unique ("task_id", "record_kind", "record_id"),
        constraint "task_record_links_record_kind_check" check ("record_kind" in ('opportunity', 'order', 'quote_request'))
      );
    `);
    this.addSql(`create index "task_record_links_record_index" on "task_record_links" ("record_kind", "record_id");`);

    this.addSql(`
      create table "task_relations" (
        "task_a_id" uuid not null,
        "task_b_id" uuid not null,
        "created_by_admin_user_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "task_relations_pkey" primary key ("task_a_id", "task_b_id"),
        constraint "task_relations_task_a_fk" foreign key ("task_a_id") references "tasks" ("id") on delete cascade,
        constraint "task_relations_task_b_fk" foreign key ("task_b_id") references "tasks" ("id") on delete cascade,
        constraint "task_relations_order_check" check ("task_a_id" < "task_b_id")
      );
    `);
    this.addSql(`create index "task_relations_task_b_id_index" on "task_relations" ("task_b_id");`);

    this.addSql(`
      create table "task_reminders" (
        "id" uuid not null default gen_random_uuid(),
        "task_id" uuid not null,
        "created_by_admin_user_id" uuid not null,
        "mode" varchar(16) not null,
        "remind_at" timestamptz not null,
        "offset_minutes" int null,
        "recipient_admin_user_ids" uuid[] not null,
        "created_at" timestamptz not null default now(),
        constraint "task_reminders_pkey" primary key ("id"),
        constraint "task_reminders_task_fk" foreign key ("task_id") references "tasks" ("id") on delete cascade,
        constraint "task_reminders_mode_check" check ("mode" in ('absolute', 'relative')),
        constraint "task_reminders_offset_check" check (("mode" = 'relative') = ("offset_minutes" is not null)),
        constraint "task_reminders_recipients_check" check (cardinality("recipient_admin_user_ids") between 1 and 21)
      );
    `);
    this.addSql(`create index "task_reminders_remind_at_index" on "task_reminders" ("remind_at");`);
    this.addSql(`create index "task_reminders_task_id_index" on "task_reminders" ("task_id");`);

    this.addSql(`
      create table "task_reminder_deliveries" (
        "id" uuid not null default gen_random_uuid(),
        "reminder_id" uuid not null,
        "admin_user_id" uuid not null,
        "outcome" varchar(16) not null,
        "recorded_at" timestamptz not null default now(),
        constraint "task_reminder_deliveries_pkey" primary key ("id"),
        constraint "task_reminder_deliveries_reminder_fk" foreign key ("reminder_id")
          references "task_reminders" ("id") on delete cascade,
        constraint "task_reminder_deliveries_unique" unique ("reminder_id", "admin_user_id"),
        constraint "task_reminder_deliveries_outcome_check" check ("outcome" in ('delivered', 'expired', 'skipped'))
      );
    `);

    // --- The new columns of `tasks` -----------------------------------------
    this.addSql(`
      alter table "tasks"
        add column "due_at" timestamptz null,
        add column "start_on" date null,
        add column "priority_code" text null,
        add column "is_draft" boolean not null default false,
        add column "is_private" boolean not null default false,
        add column "parent_task_id" uuid null,
        add column "source_key" text null,
        add column "custom_field_values" jsonb not null default '{}',
        add column "published_at" timestamptz null;
    `);

    // --- Seeds: the four statuses of 163, every move between them, four priorities.
    // The colours are those of 163's status badge.
    this.addSql(`
      insert into "task_statuses" ("code", "name", "default_name", "category", "is_initial", "weight", "color")
      values
        ('todo',        '{"en": "To do", "pl": "Do zrobienia"}', 'To do',       'open',      true,  10, '#64748b'),
        ('in_progress', '{"en": "In progress", "pl": "W toku"}', 'In progress', 'open',      false, 20, '#f59e0b'),
        ('done',        '{"en": "Done", "pl": "Zrobione"}',      'Done',        'done',      false, 30, '#10b981'),
        ('cancelled',   '{"en": "Cancelled", "pl": "Anulowane"}', 'Cancelled',  'cancelled', false, 40, '#94a3b8');
    `);
    this.addSql(`
      insert into "task_status_transitions" ("from_code", "to_code")
      select f."code", t."code" from "task_statuses" f cross join "task_statuses" t where f."code" <> t."code";
    `);
    this.addSql(`
      insert into "task_priorities" ("code", "name", "default_name", "color", "weight")
      values
        ('urgent', '{"en": "Urgent", "pl": "Pilny"}',     'Urgent', '#dc2626', 10),
        ('high',   '{"en": "High", "pl": "Wysoki"}',      'High',   '#f97316', 20),
        ('normal', '{"en": "Normal", "pl": "Normalny"}',  'Normal', '#3b82f6', 30),
        ('low',    '{"en": "Low", "pl": "Niski"}',        'Low',    '#94a3b8', 40);
    `);

    // --- Copy the assignees, publish every existing Task, drop the column.
    // When a Task was assigned is not recorded in 163; its last change is the
    // nearest moment the row knows of.
    this.addSql(`
      insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at")
      select "id", "assigned_admin_user_id", "updated_at" from "tasks" where "assigned_admin_user_id" is not null;
    `);
    this.addSql(`update "tasks" set "published_at" = "created_at";`);
    this.addSql(`drop index if exists "tasks_assigned_admin_user_id_status_due_on_index";`);
    this.addSql(`alter table "tasks" drop column "assigned_admin_user_id";`);

    // --- The checks, the hierarchy and the indexes --------------------------
    this.addSql(`alter table "tasks" drop constraint "tasks_status_check";`);
    this.addSql(`
      alter table "tasks"
        add constraint "tasks_parent_task_fk" foreign key ("parent_task_id") references "tasks" ("id") on delete set null,
        add constraint "tasks_private_context_check" check (not ("is_private" and "context_type" is not null)),
        add constraint "tasks_draft_source_check" check (not ("is_draft" and "source_key" is not null)),
        add constraint "tasks_parent_self_check" check ("parent_task_id" <> "id"),
        add constraint "tasks_source_key_length_check" check ("source_key" is null or char_length("source_key") <= 100);
    `);
    this.addSql(`create index "tasks_parent_task_id_index" on "tasks" ("parent_task_id");`);
    this.addSql(`create index "tasks_priority_code_index" on "tasks" ("priority_code");`);
    this.addSql(
      `create unique index "tasks_context_source_key_unique" on "tasks" ("context_type", "context_id", "source_key") where "source_key" is not null;`,
    );
    this.addSql(
      `create index "tasks_created_by_hidden_index" on "tasks" ("created_by_admin_user_id") where "is_draft" or "is_private";`,
    );
    this.addSql(`create index "tasks_due_at_index" on "tasks" ("due_at") where "due_at" is not null;`);
  }

  override async down(): Promise<void> {
    // The single assignee comes back first, while `task_assignees` still exists.
    this.addSql(`alter table "tasks" add column "assigned_admin_user_id" uuid null;`);
    this.addSql(`
      update "tasks" t set "assigned_admin_user_id" = first."admin_user_id"
        from (
          select distinct on ("task_id") "task_id", "admin_user_id"
            from "task_assignees"
           order by "task_id", "assigned_at" asc, "admin_user_id" asc
        ) first
       where first."task_id" = t."id";
    `);
    // A status 163 cannot hold falls back to the seeded code of its category.
    this.addSql(`
      update "tasks" t set "status" = case s."category" when 'done' then 'done' when 'cancelled' then 'cancelled' else 'todo' end
        from "task_statuses" s
       where s."code" = t."status" and t."status" not in ('todo', 'in_progress', 'done', 'cancelled');
    `);
    this.addSql(`update "tasks" set "status" = 'todo' where "status" not in ('todo', 'in_progress', 'done', 'cancelled');`);

    this.addSql(`drop index if exists "tasks_due_at_index";`);
    this.addSql(`drop index if exists "tasks_created_by_hidden_index";`);
    this.addSql(`drop index if exists "tasks_context_source_key_unique";`);
    this.addSql(`drop index if exists "tasks_priority_code_index";`);
    this.addSql(`drop index if exists "tasks_parent_task_id_index";`);
    this.addSql(`
      alter table "tasks"
        drop constraint if exists "tasks_parent_task_fk",
        drop constraint if exists "tasks_private_context_check",
        drop constraint if exists "tasks_draft_source_check",
        drop constraint if exists "tasks_parent_self_check",
        drop constraint if exists "tasks_source_key_length_check";
    `);

    this.addSql('drop table if exists "task_reminder_deliveries";');
    this.addSql('drop table if exists "task_reminders";');
    this.addSql('drop table if exists "task_relations";');
    this.addSql('drop table if exists "task_record_links";');
    this.addSql('drop table if exists "task_attachments";');
    this.addSql('drop table if exists "task_references";');
    this.addSql('drop table if exists "task_comments";');
    this.addSql('drop table if exists "task_tag_assignments";');
    this.addSql('drop table if exists "task_assignees";');
    this.addSql('drop table if exists "task_digest_subscriptions";');
    this.addSql('drop table if exists "task_list_saved_views";');
    this.addSql('drop table if exists "task_tags";');
    this.addSql('drop table if exists "task_priorities";');
    this.addSql('drop table if exists "task_status_transitions";');
    this.addSql('drop table if exists "task_statuses";');

    this.addSql(`
      alter table "tasks"
        drop column "due_at",
        drop column "start_on",
        drop column "priority_code",
        drop column "is_draft",
        drop column "is_private",
        drop column "parent_task_id",
        drop column "source_key",
        drop column "custom_field_values",
        drop column "published_at";
    `);
    this.addSql(
      `alter table "tasks" add constraint "tasks_status_check" check ("status" in ('todo', 'in_progress', 'done', 'cancelled'));`,
    );
    this.addSql(
      `create index "tasks_assigned_admin_user_id_status_due_on_index" on "tasks" ("assigned_admin_user_id", "status", "due_on");`,
    );
  }
}
