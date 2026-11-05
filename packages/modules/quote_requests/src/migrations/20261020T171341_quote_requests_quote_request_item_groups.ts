import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 159 — named, ordered groups of a quote request's lines
 * (`specs/159-quote-request-item-groups/data-model.md` §1.3).
 *
 * `quote_request_item_groups` belongs to one quote request (cascade on its
 * delete); `quote_request_items.group_id` points at it **on delete set null**,
 * so deleting a group never deletes a line (D2). `position` is the line's order
 * within its section; `not null default 0` is a metadata-only add and nothing is
 * backfilled — every line stored before reads `0`, and the `(created_at, id)`
 * tie-break keeps its order (research R-6). Both foreign keys point at this
 * module's own tables.
 */
export class Migration20261020T171341QuoteRequestsQuoteRequestItemGroups extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "quote_request_item_groups" (
      "id" uuid not null,
      "quote_request_id" uuid not null,
      "name" varchar(120) not null,
      "position" int not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "quote_request_item_groups_pkey" primary key ("id"),
      constraint "quote_request_item_groups_quote_request_fk"
        foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade,
      constraint "quote_request_item_groups_name_check" check (char_length(btrim("name")) between 1 and 120),
      constraint "quote_request_item_groups_position_check" check ("position" >= 0)
    );`);
    this.addSql(
      `create index "quote_request_item_groups_quote_request_id_index" on "quote_request_item_groups" ("quote_request_id");`,
    );
    this.addSql(
      `alter table "quote_request_items" add column "group_id" uuid null, add column "position" int not null default 0;`,
    );
    this.addSql(`alter table "quote_request_items" add constraint "quote_request_items_group_fk"
      foreign key ("group_id") references "quote_request_item_groups" ("id") on delete set null;`);
    this.addSql(
      `alter table "quote_request_items" add constraint "quote_request_items_position_check" check ("position" >= 0);`,
    );
    this.addSql(`create index "quote_request_items_group_id_index" on "quote_request_items" ("group_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "quote_request_items_group_id_index";`);
    this.addSql(`alter table "quote_request_items" drop constraint if exists "quote_request_items_position_check";`);
    this.addSql(`alter table "quote_request_items" drop constraint if exists "quote_request_items_group_fk";`);
    this.addSql(`alter table "quote_request_items" drop column if exists "position", drop column if exists "group_id";`);
    this.addSql(`drop table if exists "quote_request_item_groups";`);
  }
}
