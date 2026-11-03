import { Migration } from '@mikro-orm/migrations';

/**
 * One reference grammar for the platform (`specs/165-task-management/`
 * research R-5, issue #446): `opportunity` and `project` became reference
 * kinds everywhere, so an Opportunity's text may name another Opportunity or
 * a Project. The index of who mentions what gains the two target types; the
 * constraint is replaced, and the rows and every text are untouched.
 *
 * `target_id` stays a value: no foreign key, so neither table is referenced,
 * and a reference to a target since gone simply renders as unavailable.
 *
 * Precedent: `20261027T020030_crm_opportunity_reference_documents.ts`.
 */
export class Migration20261028T143444CrmOpportunityReferenceKinds extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "crm_opportunity_references" drop constraint "crm_opportunity_references_target_type_check";`,
    );
    this.addSql(`
      alter table "crm_opportunity_references"
        add constraint "crm_opportunity_references_target_type_check"
        check ("target_type" in ('product', 'order', 'admin_user', 'quote_request', 'task', 'opportunity', 'project'));
    `);
  }

  override async down(): Promise<void> {
    // Neither type has a place in the narrower constraint; the texts they were
    // derived from keep their tokens, so the rows come back with the next save.
    this.addSql(`delete from "crm_opportunity_references" where "target_type" in ('opportunity', 'project');`);
    this.addSql(
      `alter table "crm_opportunity_references" drop constraint "crm_opportunity_references_target_type_check";`,
    );
    this.addSql(`
      alter table "crm_opportunity_references"
        add constraint "crm_opportunity_references_target_type_check"
        check ("target_type" in ('product', 'order', 'admin_user', 'quote_request', 'task'));
    `);
  }
}
