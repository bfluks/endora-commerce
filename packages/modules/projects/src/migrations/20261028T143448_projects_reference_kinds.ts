import { Migration } from '@mikro-orm/migrations';

/**
 * One reference grammar for the platform (`specs/165-task-management/`
 * research R-5, issue #446): `opportunity` and `project` became reference
 * kinds everywhere, so a Project's text may name an Opportunity or another
 * Project. The index of who mentions what gains the two target types; the
 * constraint is replaced, and the rows and every text are untouched.
 *
 * `target_id` stays a value: no foreign key, so `crm`'s table is not
 * referenced, and a reference to a target since gone renders as unavailable.
 */
export class Migration20261028T143448ProjectsReferenceKinds extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "project_references" drop constraint "project_references_target_type_check";`);
    this.addSql(`
      alter table "project_references"
        add constraint "project_references_target_type_check"
        check ("target_type" in ('admin_user', 'order', 'product', 'quote_request', 'task', 'opportunity', 'project'));
    `);
  }

  override async down(): Promise<void> {
    // Neither type has a place in the narrower constraint; the texts they were
    // derived from keep their tokens, so the rows come back with the next save.
    this.addSql(`delete from "project_references" where "target_type" in ('opportunity', 'project');`);
    this.addSql(`alter table "project_references" drop constraint "project_references_target_type_check";`);
    this.addSql(`
      alter table "project_references"
        add constraint "project_references_target_type_check"
        check ("target_type" in ('admin_user', 'order', 'product', 'quote_request', 'task'));
    `);
  }
}
