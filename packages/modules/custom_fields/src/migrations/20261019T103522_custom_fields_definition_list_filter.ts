import { Migration } from '@mikro-orm/migrations';

/**
 * A custom-field definition says whether the admin list of its entity type
 * offers it as a filter (`specs/157-custom-fields-list-filters/`, data-model
 * §1). Every existing definition reads `false`: the option is off until an
 * operator turns it on.
 *
 * `custom_field_definitions` is a platform-global table (no tenant column) and
 * the column references no other module's table.
 */
export class Migration20261019T103522CustomFieldsDefinitionListFilter extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "custom_field_definitions" add column "list_filter" boolean not null default false;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "custom_field_definitions" drop column "list_filter";`);
  }
}
