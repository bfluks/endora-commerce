import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — `push_notification_preferences` refuses a row that names a customer
 * account and no organisation, by the same `CHECK` every other `@CustomerScoped`
 * table with an organisation column carries.
 *
 * `20261016T172243_pwa_push_notification_preferences.ts` created the table with
 * both columns `not null` and no `CHECK`. Today that refuses the same row, but
 * by the wrong rule: `not null` on `organization_id` is a statement about this
 * table's current shape (a preference always names an account), while the
 * `CHECK` is the attribution rule itself — an owned row has an organisation —
 * and it is the one that survives the day either column is relaxed. It is also
 * what `backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`
 * holds: that guard derives its population from the ORM's metadata, relaxes
 * `not null` on a temporary copy so it reaches the rule it is about, and
 * requires a `check_violation`. The table joined its population the moment the
 * entity gained `organizationId`.
 *
 * ## No derivation and no refusal step
 *
 * The attribution migrations of 2026-08-30 derive, count and refuse before they
 * constrain (D-184), because their column arrived nullable onto existing rows.
 * Here `organization_id` has been `not null` since the table was created, so no
 * row can violate the constraint and adding it validates trivially. A
 * derivation would be dead code that suggests otherwise.
 *
 * Touches no other module's table, so there is no manifest edge to declare.
 */
export class Migration20261020T131018PwaPreferencesOrganizationAttributionCheck extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "push_notification_preferences"
        add constraint "push_notification_preferences_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "push_notification_preferences" drop constraint if exists "push_notification_preferences_organization_attribution_chk";`,
    );
  }
}
