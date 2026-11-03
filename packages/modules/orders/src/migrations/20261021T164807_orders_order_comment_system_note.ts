import { Migration } from '@mikro-orm/migrations';

/**
 * An order comment may be an author-less **system note** the platform writes:
 * custom-field values that could not be carried into the Order from the record
 * it was created from (`specs/162-custom-fields-value-carry/`, data-model §2).
 * Present ⇒ a system note; every existing comment reads `null` and is unchanged.
 *
 * `down` removes the rows the column defined before dropping it: a system note
 * without its marker would read as a staff comment.
 *
 * `order_comments` is this module's own table; nothing of another module's is
 * referenced.
 */
export class Migration20261021T164807OrdersOrderCommentSystemNote extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "order_comments" add column "system_note" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "order_comments" where "system_note" is not null;`);
    this.addSql(`alter table "order_comments" drop column "system_note";`);
  }
}
