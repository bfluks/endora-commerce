import { Migration } from '@mikro-orm/migrations';

/**
 * One reference standard for Projects and CRM (`specs/163-projects-and-tasks/`
 * FR-044, research R-14) — an Opportunity's text may refer to a Quote Request
 * and a Task, so the index of who mentions what gains those two target types
 * beside `product`, `order` and `admin_user`. The constraint is replaced; the
 * rows, and every text, are untouched.
 *
 * `target_id` stays a value, as it is for the other three: no foreign key, so
 * neither `quote_requests`' nor `tasks`' table is referenced, and a reference
 * to a target since gone simply renders as unavailable.
 *
 * Precedent: `20261007T180600_crm_opportunity_reference_admin_user.ts`.
 */
export class Migration20261027T020030CrmOpportunityReferenceDocuments extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "crm_opportunity_references" drop constraint "crm_opportunity_references_target_type_check";`,
    );
    this.addSql(`
      alter table "crm_opportunity_references"
        add constraint "crm_opportunity_references_target_type_check"
        check ("target_type" in ('product', 'order', 'admin_user', 'quote_request', 'task'));
    `);
  }

  override async down(): Promise<void> {
    // Neither type has a place in the narrower constraint; the texts they were
    // derived from keep their tokens, so the rows come back with the next save.
    this.addSql(`delete from "crm_opportunity_references" where "target_type" in ('quote_request', 'task');`);
    this.addSql(
      `alter table "crm_opportunity_references" drop constraint "crm_opportunity_references_target_type_check";`,
    );
    this.addSql(`
      alter table "crm_opportunity_references"
        add constraint "crm_opportunity_references_target_type_check"
        check ("target_type" in ('product', 'order', 'admin_user'));
    `);
  }
}
