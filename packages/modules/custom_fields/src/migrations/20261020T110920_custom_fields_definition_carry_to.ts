import { Migration } from '@mikro-orm/migrations';

/**
 * A custom-field definition names the entity types its values carry to when a
 * record of such a type is created from, or joins, a record of the
 * definition's own type (`specs/162-custom-fields-value-carry/`, data-model
 * §1). Every existing definition reads `[]`: no value is carried until an
 * operator turns the option on, and nothing is back-filled.
 *
 * `custom_field_definitions` is a platform-global table (no tenant column) and
 * the column references no other module's table.
 */
export class Migration20261020T110920CustomFieldsDefinitionCarryTo extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "custom_field_definitions" add column "carry_to" jsonb not null default '[]'::jsonb;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "custom_field_definitions" drop column "carry_to";`);
  }
}
