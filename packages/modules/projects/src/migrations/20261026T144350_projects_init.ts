import { Migration } from '@mikro-orm/migrations';

/**
 * `projects` — the whole schema of the module, in one migration
 * (`specs/163-projects-and-tasks/data-model.md` §2).
 *
 * Twenty-three tables and one sequence: seven of configuration (Project Roles,
 * loss reasons, Templates and their children) and sixteen that a Project owns
 * or that count its unread messages. Everything lands here, before the first
 * user story — the custom-field value bag included — so that no later story
 * adds a migration or an entity: the generated registries are rewritten by
 * every such addition, and stories built in parallel would collide on them.
 *
 * **One foreign key leaves the module**:
 * `project_organizations.organization_id` → `organizations`, `on delete
 * restrict` — the manifest declares `organizations` for it. Every other
 * cross-module reference — an administrator, an asset, a linked Order, Quote
 * Request or Opportunity, a reference target — is held by value and checked
 * through its owner's port, because the owner may be switched off, or the
 * column is polymorphic.
 *
 * **An open Project always has a current Stage**, checked at commit by a
 * deferred constraint trigger (`projects_open_has_current_stage`): a Project
 * is created before its Stages exist, so the check cannot be a row check; one
 * transaction writes the Project, its Stages and its current Stage.
 *
 * What the database does not hold, the services do: that alert offsets are
 * distinct (a check constraint cannot compare an array's elements without a
 * subquery), that a move names Stages of its own Project, and that a Member
 * is an active administrator.
 *
 * The two system Project Roles and the five system loss reasons are seeded
 * here, into this module's own tables, with English and Polish names
 * (research R-20). No Template is seeded; the demo Template is demo data.
 */
export class Migration20261026T144350ProjectsInit extends Migration {
  override async up(): Promise<void> {
    // --- Configuration (`@GlobalEntity`) -----------------------------------
    for (const table of ['project_roles', 'project_loss_reasons']) {
      this.addSql(`
        create table "${table}" (
          "id" uuid not null default gen_random_uuid(),
          "code" text not null,
          "name" jsonb not null default '{}',
          "default_name" text not null,
          "is_system" boolean not null default false,
          "archived_at" timestamptz null,
          "position" int not null,
          "created_at" timestamptz not null default now(),
          "updated_at" timestamptz not null default now(),
          constraint "${table}_pkey" primary key ("id"),
          constraint "${table}_code_unique" unique ("code"),
          constraint "${table}_default_name_length_check" check (char_length("default_name") between 1 and 120)
        );
      `);
    }

    this.addSql(`
      create table "project_templates" (
        "id" uuid not null default gen_random_uuid(),
        "name" text not null,
        "description" text not null default '',
        "archived_at" timestamptz null,
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "project_templates_pkey" primary key ("id"),
        constraint "project_templates_name_length_check" check (char_length("name") between 1 and 120),
        constraint "project_templates_description_length_check" check (char_length("description") <= 20000)
      );
    `);

    this.addSql(`
      create table "project_template_roles" (
        "template_id" uuid not null,
        "role_id" uuid not null,
        constraint "project_template_roles_pkey" primary key ("template_id", "role_id"),
        constraint "project_template_roles_template_fk" foreign key ("template_id")
          references "project_templates" ("id") on delete cascade,
        constraint "project_template_roles_role_fk" foreign key ("role_id")
          references "project_roles" ("id") on delete restrict
      );
    `);
    this.addSql(`create index "project_template_roles_role_id_index" on "project_template_roles" ("role_id");`);

    this.addSql(`
      create table "project_template_stages" (
        "id" uuid not null default gen_random_uuid(),
        "template_id" uuid not null,
        "name" text not null,
        "color" text not null,
        "position" int not null,
        "planned_duration_days" int not null default 0,
        "responsible_role_ids" uuid[] not null default '{}',
        "alert_offsets_days" int[] not null default '{}',
        "completion_gate" boolean not null default false,
        "completion_permitted" boolean not null default false,
        constraint "project_template_stages_pkey" primary key ("id"),
        constraint "project_template_stages_template_fk" foreign key ("template_id")
          references "project_templates" ("id") on delete cascade,
        constraint "project_template_stages_template_position_unique" unique ("template_id", "position")
          deferrable initially deferred,
        constraint "project_template_stages_name_length_check" check (char_length("name") between 1 and 80),
        constraint "project_template_stages_color_check" check ("color" ~ '^#[0-9a-fA-F]{6}$'),
        constraint "project_template_stages_duration_check" check ("planned_duration_days" between 0 and 3650),
        constraint "project_template_stages_alert_offsets_check"
          check (1 <= all ("alert_offsets_days") and 365 >= all ("alert_offsets_days"))
      );
    `);

    this.addSql(`
      create table "project_template_stage_tasks" (
        "id" uuid not null default gen_random_uuid(),
        "template_stage_id" uuid not null,
        "title" text not null,
        "description" text not null default '',
        "responsible_role_id" uuid null,
        "due_offset_days" int not null default 0,
        "position" int not null,
        constraint "project_template_stage_tasks_pkey" primary key ("id"),
        constraint "project_template_stage_tasks_stage_fk" foreign key ("template_stage_id")
          references "project_template_stages" ("id") on delete cascade,
        constraint "project_template_stage_tasks_role_fk" foreign key ("responsible_role_id")
          references "project_roles" ("id") on delete set null,
        constraint "project_template_stage_tasks_title_length_check" check (char_length("title") between 1 and 200),
        constraint "project_template_stage_tasks_description_length_check" check (char_length("description") <= 20000),
        constraint "project_template_stage_tasks_due_offset_check" check ("due_offset_days" between 0 and 3650)
      );
    `);
    this.addSql(
      `create index "project_template_stage_tasks_template_stage_id_position_index" on "project_template_stage_tasks" ("template_stage_id", "position");`,
    );

    this.addSql(`
      create table "project_template_stage_moves" (
        "template_id" uuid not null,
        "from_stage_id" uuid not null,
        "to_stage_id" uuid not null,
        constraint "project_template_stage_moves_pkey" primary key ("from_stage_id", "to_stage_id"),
        constraint "project_template_stage_moves_template_fk" foreign key ("template_id")
          references "project_templates" ("id") on delete cascade,
        constraint "project_template_stage_moves_from_fk" foreign key ("from_stage_id")
          references "project_template_stages" ("id") on delete cascade,
        constraint "project_template_stage_moves_to_fk" foreign key ("to_stage_id")
          references "project_template_stages" ("id") on delete cascade,
        constraint "project_template_stage_moves_distinct_check" check ("from_stage_id" <> "to_stage_id")
      );
    `);
    this.addSql(
      `create index "project_template_stage_moves_template_id_index" on "project_template_stage_moves" ("template_id");`,
    );

    // --- Projects (`@RuleScoped`, read only through `ProjectAccess`) -------
    this.addSql(`create sequence "projects_number_seq";`);
    this.addSql(`
      create table "projects" (
        "id" uuid not null default gen_random_uuid(),
        "number" text not null,
        "title" text not null,
        "description" text not null default '',
        "value_amount" numeric(18,2) null,
        "value_currency" char(3) null,
        "start_on" date not null default current_date,
        "state" text not null default 'open',
        "current_stage_id" uuid null,
        "closed_at" timestamptz null,
        "lost_stage_id" uuid null,
        "loss_reason_id" uuid null,
        "loss_comment" text null,
        "visibility" text not null default 'inherit',
        "template_id" uuid null,
        "custom_field_values" jsonb not null default '{}',
        "created_by_admin_user_id" uuid not null,
        "version" int not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "projects_pkey" primary key ("id"),
        constraint "projects_number_unique" unique ("number"),
        constraint "projects_loss_reason_fk" foreign key ("loss_reason_id")
          references "project_loss_reasons" ("id") on delete restrict,
        constraint "projects_template_fk" foreign key ("template_id")
          references "project_templates" ("id") on delete set null,
        constraint "projects_state_check" check ("state" in ('open', 'completed', 'lost')),
        constraint "projects_visibility_check" check ("visibility" in ('inherit', 'everyone', 'members_and_listed')),
        constraint "projects_title_length_check" check (char_length("title") between 1 and 200),
        constraint "projects_description_length_check" check (char_length("description") <= 20000),
        constraint "projects_loss_comment_length_check" check ("loss_comment" is null or char_length("loss_comment") <= 2000),
        constraint "projects_closed_check" check (("state" = 'open') = ("closed_at" is null)),
        constraint "projects_loss_reason_check" check (("state" = 'lost') = ("loss_reason_id" is not null)),
        constraint "projects_lost_stage_check" check (("state" = 'lost') = ("lost_stage_id" is not null)),
        constraint "projects_value_check" check (("value_amount" is null) = ("value_currency" is null)),
        constraint "projects_value_amount_check" check ("value_amount" is null or "value_amount" >= 0)
      );
    `);
    this.addSql(`create index "projects_state_created_at_index" on "projects" ("state", "created_at");`);
    this.addSql(`create index "projects_template_id_index" on "projects" ("template_id");`);
    this.addSql(`create index "projects_closed_at_index" on "projects" ("closed_at");`);

    this.addSql(`
      create table "project_stages" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "name" text not null,
        "color" text not null,
        "position" int not null,
        "planned_duration_days" int not null default 0,
        "responsible_role_ids" uuid[] not null default '{}',
        "alert_offsets_days" int[] not null default '{}',
        "completion_gate" boolean not null default false,
        "completion_permitted" boolean not null default false,
        "started_on" date null,
        "deadline_on" date null,
        "deadline_manual" boolean not null default false,
        "tasks_materialized_at" timestamptz null,
        "tasks_skipped_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "project_stages_pkey" primary key ("id"),
        constraint "project_stages_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_stages_project_position_unique" unique ("project_id", "position")
          deferrable initially deferred,
        constraint "project_stages_name_length_check" check (char_length("name") between 1 and 80),
        constraint "project_stages_color_check" check ("color" ~ '^#[0-9a-fA-F]{6}$'),
        constraint "project_stages_duration_check" check ("planned_duration_days" between 0 and 3650),
        constraint "project_stages_alert_offsets_check"
          check (1 <= all ("alert_offsets_days") and 365 >= all ("alert_offsets_days"))
      );
    `);
    // The alert sweep reads open Stages by deadline.
    this.addSql(`create index "project_stages_deadline_on_index" on "project_stages" ("deadline_on");`);

    // A Project's current and lost Stage are its own Stages. `no action`, not
    // `restrict`: deleting a Project deletes its Stages in the same statement,
    // and only a check at the statement's end sees both gone.
    this.addSql(`
      alter table "projects"
        add constraint "projects_current_stage_fk" foreign key ("current_stage_id")
          references "project_stages" ("id") on delete no action,
        add constraint "projects_lost_stage_fk" foreign key ("lost_stage_id")
          references "project_stages" ("id") on delete no action;
    `);
    this.addSql(`create index "projects_current_stage_id_index" on "projects" ("current_stage_id");`);

    this.addSql(`
      create function "projects_open_has_current_stage"() returns trigger
        language plpgsql as $$
      begin
        if exists (select 1 from "projects" p
                    where p."id" = new."id" and p."state" = 'open' and p."current_stage_id" is null) then
          raise exception 'projects_open_has_current_stage: an open Project must have a current Stage (%)', new."id"
            using errcode = 'check_violation', constraint = 'projects_open_has_current_stage';
        end if;
        return null;
      end;
      $$;
    `);
    this.addSql(`
      create constraint trigger "projects_open_has_current_stage"
        after insert or update of "state", "current_stage_id" on "projects"
        deferrable initially deferred
        for each row execute function "projects_open_has_current_stage"();
    `);

    this.addSql(`
      create table "project_organizations" (
        "project_id" uuid not null,
        "organization_id" uuid not null,
        constraint "project_organizations_pkey" primary key ("project_id", "organization_id"),
        constraint "project_organizations_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_organizations_organization_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete restrict
      );
    `);
    this.addSql(
      `create index "project_organizations_organization_id_index" on "project_organizations" ("organization_id");`,
    );

    this.addSql(`
      create table "project_members" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "admin_user_id" uuid not null,
        "added_at" timestamptz not null default now(),
        constraint "project_members_pkey" primary key ("id"),
        constraint "project_members_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_members_project_admin_user_unique" unique ("project_id", "admin_user_id")
      );
    `);
    this.addSql(`create index "project_members_admin_user_id_index" on "project_members" ("admin_user_id");`);

    this.addSql(`
      create table "project_member_roles" (
        "member_id" uuid not null,
        "role_id" uuid not null,
        constraint "project_member_roles_pkey" primary key ("member_id", "role_id"),
        constraint "project_member_roles_member_fk" foreign key ("member_id")
          references "project_members" ("id") on delete cascade,
        constraint "project_member_roles_role_fk" foreign key ("role_id")
          references "project_roles" ("id") on delete restrict
      );
    `);
    this.addSql(`create index "project_member_roles_role_id_index" on "project_member_roles" ("role_id");`);

    this.addSql(`
      create table "project_viewers" (
        "project_id" uuid not null,
        "admin_user_id" uuid not null,
        constraint "project_viewers_pkey" primary key ("project_id", "admin_user_id"),
        constraint "project_viewers_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "project_viewers_admin_user_id_index" on "project_viewers" ("admin_user_id");`);

    this.addSql(`
      create table "project_stage_tasks" (
        "id" uuid not null default gen_random_uuid(),
        "stage_id" uuid not null,
        "title" text not null,
        "description" text not null default '',
        "responsible_role_id" uuid null,
        "due_offset_days" int not null default 0,
        "position" int not null,
        constraint "project_stage_tasks_pkey" primary key ("id"),
        constraint "project_stage_tasks_stage_fk" foreign key ("stage_id")
          references "project_stages" ("id") on delete cascade,
        constraint "project_stage_tasks_role_fk" foreign key ("responsible_role_id")
          references "project_roles" ("id") on delete set null,
        constraint "project_stage_tasks_title_length_check" check (char_length("title") between 1 and 200),
        constraint "project_stage_tasks_description_length_check" check (char_length("description") <= 20000),
        constraint "project_stage_tasks_due_offset_check" check ("due_offset_days" between 0 and 3650)
      );
    `);
    this.addSql(
      `create index "project_stage_tasks_stage_id_position_index" on "project_stage_tasks" ("stage_id", "position");`,
    );

    this.addSql(`
      create table "project_stage_moves" (
        "project_id" uuid not null,
        "from_stage_id" uuid not null,
        "to_stage_id" uuid not null,
        constraint "project_stage_moves_pkey" primary key ("from_stage_id", "to_stage_id"),
        constraint "project_stage_moves_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_stage_moves_from_fk" foreign key ("from_stage_id")
          references "project_stages" ("id") on delete cascade,
        constraint "project_stage_moves_to_fk" foreign key ("to_stage_id")
          references "project_stages" ("id") on delete cascade,
        constraint "project_stage_moves_distinct_check" check ("from_stage_id" <> "to_stage_id")
      );
    `);
    this.addSql(`create index "project_stage_moves_project_id_index" on "project_stage_moves" ("project_id");`);

    // Stage history (R-5). Stage ids are values, not keys: a row keeps the
    // names the Stages had, and outlives a Stage deleted later.
    this.addSql(`
      create table "project_stage_entries" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "from_stage_id" uuid null,
        "to_stage_id" uuid null,
        "kind" text not null,
        "from_stage_name" text null,
        "to_stage_name" text null,
        "notes" text[] not null default '{}',
        "actor_admin_user_id" uuid null,
        "at" timestamptz not null default now(),
        constraint "project_stage_entries_pkey" primary key ("id"),
        constraint "project_stage_entries_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_stage_entries_kind_check"
          check ("kind" in ('enter', 'close_completed', 'close_lost', 'reopen')),
        constraint "project_stage_entries_notes_check"
          check ("notes" <@ array['gate_not_applied_tasks_off', 'stage_tasks_skipped', 'tasks_materialize_failed']::text[])
      );
    `);
    this.addSql(`create index "project_stage_entries_project_id_at_index" on "project_stage_entries" ("project_id", "at");`);

    this.addSql(`
      create table "project_links" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "record_kind" text not null,
        "record_id" uuid not null,
        "linked_by_admin_user_id" uuid null,
        "linked_at" timestamptz not null default now(),
        constraint "project_links_pkey" primary key ("id"),
        constraint "project_links_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_links_record_kind_check" check ("record_kind" in ('order', 'quote_request', 'opportunity'))
      );
    `);
    // A record belongs to at most one Project (FR-021).
    this.addSql(
      `create unique index "project_links_record_kind_record_id_unique" on "project_links" ("record_kind", "record_id");`,
    );
    this.addSql(`create index "project_links_project_id_index" on "project_links" ("project_id");`);

    this.addSql(`
      create table "project_comments" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "kind" text not null,
        "body" text not null,
        "author_admin_user_id" uuid not null,
        "edited_at" timestamptz null,
        "deleted_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        constraint "project_comments_pkey" primary key ("id"),
        constraint "project_comments_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_comments_kind_check" check ("kind" in ('note', 'message')),
        constraint "project_comments_body_length_check" check (char_length("body") between 1 and 20000),
        constraint "project_comments_deleted_note_check" check ("deleted_at" is null or "kind" = 'note')
      );
    `);
    this.addSql(
      `create index "project_comments_project_id_kind_created_at_index" on "project_comments" ("project_id", "kind", "created_at");`,
    );

    this.addSql(`
      create table "project_message_reads" (
        "project_id" uuid not null,
        "admin_user_id" uuid not null,
        "last_read_at" timestamptz not null,
        constraint "project_message_reads_pkey" primary key ("project_id", "admin_user_id"),
        constraint "project_message_reads_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade
      );
    `);

    // One row, one instant: when unread messages started being counted here.
    // An administrator with no read marker for a Project has unread only the
    // messages written after it (CRM's `crm_message_read_baselines`).
    this.addSql(`
      create table "project_message_read_baselines" (
        "id" smallint not null default 1,
        "unread_since" timestamptz not null,
        constraint "project_message_read_baselines_pkey" primary key ("id"),
        constraint "project_message_read_baselines_single_row_check" check ("id" = 1)
      );
    `);
    this.addSql(`insert into "project_message_read_baselines" ("id", "unread_since") values (1, now());`);

    this.addSql(`
      create table "project_references" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "source_kind" text not null,
        "source_id" uuid null,
        "target_type" text not null,
        "target_id" uuid not null,
        constraint "project_references_pkey" primary key ("id"),
        constraint "project_references_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_references_source_kind_check" check ("source_kind" in ('description', 'comment')),
        constraint "project_references_target_type_check"
          check ("target_type" in ('admin_user', 'order', 'product', 'quote_request', 'task'))
      );
    `);
    this.addSql(`create index "project_references_project_id_index" on "project_references" ("project_id");`);
    this.addSql(
      `create index "project_references_target_type_target_id_index" on "project_references" ("target_type", "target_id");`,
    );

    this.addSql(`
      create table "project_attachments" (
        "id" uuid not null default gen_random_uuid(),
        "project_id" uuid not null,
        "asset_id" uuid not null,
        "added_by_admin_user_id" uuid not null,
        "added_at" timestamptz not null default now(),
        constraint "project_attachments_pkey" primary key ("id"),
        constraint "project_attachments_project_fk" foreign key ("project_id")
          references "projects" ("id") on delete cascade,
        constraint "project_attachments_project_asset_unique" unique ("project_id", "asset_id")
      );
    `);
    this.addSql(`create index "project_attachments_asset_id_index" on "project_attachments" ("asset_id");`);

    // Deadline alerts (R-12): one row per (Stage, offset, deadline), claimed
    // before it is delivered and settled after — so a moved deadline re-arms
    // and nothing is sent twice.
    this.addSql(`
      create table "project_stage_alert_deliveries" (
        "id" uuid not null default gen_random_uuid(),
        "stage_id" uuid not null,
        "offset_days" int not null,
        "deadline_on" date not null,
        "claimed_at" timestamptz not null default now(),
        "outcome" text null,
        "recipient_count" int null,
        "settled_at" timestamptz null,
        constraint "project_stage_alert_deliveries_pkey" primary key ("id"),
        constraint "project_stage_alert_deliveries_stage_fk" foreign key ("stage_id")
          references "project_stages" ("id") on delete cascade,
        constraint "project_stage_alert_deliveries_outcome_check"
          check ("outcome" is null or "outcome" in ('bell', 'bell_email', 'email', 'no_recipient', 'undeliverable'))
      );
    `);
    this.addSql(
      `create unique index "project_stage_alert_deliveries_stage_offset_deadline_unique" on "project_stage_alert_deliveries" ("stage_id", "offset_days", "deadline_on");`,
    );

    // --- Seeds (this module's own rows, research R-20) ---------------------
    this.addSql(`
      insert into "project_roles" ("code", "name", "default_name", "is_system", "position")
      values
        ('sales_rep',       '{"en": "Sales Rep", "pl": "Handlowiec"}',                 'Sales Rep',       true, 10),
        ('project_manager', '{"en": "Project Manager", "pl": "Kierownik Projektu"}',   'Project Manager', true, 20);
    `);
    this.addSql(`
      insert into "project_loss_reasons" ("code", "name", "default_name", "is_system", "position")
      values
        ('price',               '{"en": "Price", "pl": "Cena"}',                                       'Price',                   true, 10),
        ('competitor',          '{"en": "Chose a competitor", "pl": "Wybór konkurencji"}',             'Chose a competitor',      true, 20),
        ('cancelled_by_client', '{"en": "Cancelled by the client", "pl": "Anulowany przez klienta"}', 'Cancelled by the client', true, 30),
        ('no_decision',         '{"en": "No decision", "pl": "Brak decyzji"}',                         'No decision',             true, 40),
        ('other',               '{"en": "Other", "pl": "Inny powód"}',                                 'Other',                   true, 50);
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "project_stage_alert_deliveries" cascade;');
    this.addSql('drop table if exists "project_attachments" cascade;');
    this.addSql('drop table if exists "project_references" cascade;');
    this.addSql('drop table if exists "project_message_read_baselines" cascade;');
    this.addSql('drop table if exists "project_message_reads" cascade;');
    this.addSql('drop table if exists "project_comments" cascade;');
    this.addSql('drop table if exists "project_links" cascade;');
    this.addSql('drop table if exists "project_stage_entries" cascade;');
    this.addSql('drop table if exists "project_stage_moves" cascade;');
    this.addSql('drop table if exists "project_stage_tasks" cascade;');
    this.addSql('drop table if exists "project_viewers" cascade;');
    this.addSql('drop table if exists "project_member_roles" cascade;');
    this.addSql('drop table if exists "project_members" cascade;');
    this.addSql('drop table if exists "project_organizations" cascade;');
    this.addSql('drop table if exists "projects" cascade;');
    this.addSql('drop table if exists "project_stages" cascade;');
    this.addSql('drop function if exists "projects_open_has_current_stage"();');
    this.addSql('drop sequence if exists "projects_number_seq";');
    this.addSql('drop table if exists "project_template_stage_moves" cascade;');
    this.addSql('drop table if exists "project_template_stage_tasks" cascade;');
    this.addSql('drop table if exists "project_template_stages" cascade;');
    this.addSql('drop table if exists "project_template_roles" cascade;');
    this.addSql('drop table if exists "project_templates" cascade;');
    this.addSql('drop table if exists "project_loss_reasons" cascade;');
    this.addSql('drop table if exists "project_roles" cascade;');
  }
}
