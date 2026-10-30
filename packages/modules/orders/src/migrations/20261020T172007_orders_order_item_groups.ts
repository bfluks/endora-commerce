import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 159 — named, ordered groups of an order's lines
 * (`specs/159-quote-request-item-groups/data-model.md` §2.3).
 *
 * `order_item_groups` belongs to one order (cascade on its delete) and is
 * written once, at placement — hence no `updated_at`. `order_items.group_id`
 * points at it on delete set null. `position` is the line's order within its
 * section; `not null default 0` is a metadata-only add on a table holding every
 * order line ever placed, and nothing is backfilled (research R-6). Both foreign
 * keys point at this module's own tables (`order_items` has been altered by this
 * module before).
 */
export class Migration20261020T172007OrdersOrderItemGroups extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "order_item_groups" (
      "id" uuid not null,
      "order_id" uuid not null,
      "name" varchar(120) not null,
      "position" int not null,
      "created_at" timestamptz not null,
      constraint "order_item_groups_pkey" primary key ("id"),
      constraint "order_item_groups_order_fk"
        foreign key ("order_id") references "orders" ("id") on delete cascade,
      constraint "order_item_groups_name_check" check (char_length(btrim("name")) between 1 and 120),
      constraint "order_item_groups_position_check" check ("position" >= 0)
    );`);
    this.addSql(`create index "order_item_groups_order_id_index" on "order_item_groups" ("order_id");`);
    this.addSql(`alter table "order_items" add column "group_id" uuid null, add column "position" int not null default 0;`);
    this.addSql(`alter table "order_items" add constraint "order_items_group_fk"
      foreign key ("group_id") references "order_item_groups" ("id") on delete set null;`);
    this.addSql(`alter table "order_items" add constraint "order_items_position_check" check ("position" >= 0);`);
    this.addSql(`create index "order_items_group_id_index" on "order_items" ("group_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "order_items_group_id_index";`);
    this.addSql(`alter table "order_items" drop constraint if exists "order_items_position_check";`);
    this.addSql(`alter table "order_items" drop constraint if exists "order_items_group_fk";`);
    this.addSql(`alter table "order_items" drop column if exists "position", drop column if exists "group_id";`);
    this.addSql(`drop table if exists "order_item_groups";`);
  }
}
