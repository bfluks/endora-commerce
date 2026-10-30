import { Migration } from '@mikro-orm/migrations';

/**
 * A quote request's history records the custom-field values a Sales
 * Opportunity could not carry into it (`specs/162-custom-fields-value-carry/`,
 * data-model §3): the event type check gains `custom-field-carry-skipped`.
 *
 * `down()` restores the twelve values of the `pdf-sent` migration, and fails
 * while a `custom-field-carry-skipped` row exists — as narrowing any check must.
 */
const BEFORE = `'created','submitted','modified','approved','canceled','expired',
  'completed','customer-accepted-revision','customer-rejected-revision',
  're-submitted','note-added','pdf-sent'`;

export class Migration20261021T164808QuoteRequestsQuoteRequestEventCarrySkipped extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "quote_request_events" drop constraint "qre_event_type_check";`);
    this.addSql(
      `alter table "quote_request_events" add constraint "qre_event_type_check" check ("event_type" in (${BEFORE}, 'custom-field-carry-skipped'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "quote_request_events" drop constraint "qre_event_type_check";`);
    this.addSql(
      `alter table "quote_request_events" add constraint "qre_event_type_check" check ("event_type" in (${BEFORE}));`,
    );
  }
}
