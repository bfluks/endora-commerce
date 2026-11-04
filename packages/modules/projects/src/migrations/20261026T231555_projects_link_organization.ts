import { Migration } from '@mikro-orm/migrations';

/**
 * A linked record's Organization, on the link (`specs/163-projects-and-tasks/`,
 * User Story 6 — task T092).
 *
 * Removing an Organization from a Project while a record of it is linked is
 * refused (spec edge case, 409 `PROJECT_ORGANIZATION_IN_USE`). The record is
 * held by value and its owner may be switched off (CRM, Quote Requests), so
 * the question "is a linked record of this Organization?" cannot be asked of
 * the owner at removal time. The Organization is read from the owner once,
 * when the link is made — it is validated there anyway, and none of the three
 * kinds ever changes Organization — and kept here.
 *
 * The foreign key into `project_organizations` makes the rule structural: a
 * Project's Organization with a link of it cannot be removed, whatever path
 * removes it. `no action` rather than `restrict`, so deleting a Project —
 * which cascades into both tables — is checked at the end of the statement,
 * when both rows are gone.
 *
 * `not null` at once: no write path to `project_links` existed before this
 * story, so the table is empty everywhere this runs.
 */
export class Migration20261026T231555ProjectsLinkOrganization extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "project_links" add column "organization_id" uuid not null;`);
    this.addSql(`
      alter table "project_links" add constraint "project_links_project_organization_fk"
        foreign key ("project_id", "organization_id")
        references "project_organizations" ("project_id", "organization_id") on delete no action;
    `);
    this.addSql(
      `create index "project_links_project_id_organization_id_index" on "project_links" ("project_id", "organization_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "project_links_project_id_organization_id_index";`);
    this.addSql(`alter table "project_links" drop constraint if exists "project_links_project_organization_fk";`);
    this.addSql(`alter table "project_links" drop column if exists "organization_id";`);
  }
}
