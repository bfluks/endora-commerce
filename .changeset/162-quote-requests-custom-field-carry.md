---
'@endora-commerce/mod-quote-requests': minor
---

A Quote Request created from a Sales Opportunity receives the Opportunity's carried custom-field values.

- **`quoteRequestCustomFieldCarryPort`** (`CustomFieldCarryReceiverPort` from
  `@endora-commerce/contracts`) carries a Sales Opportunity's values into a Quote Request's
  **empty** fields in one `quote_request.custom_fields.carry` Command, attributed to the system.
  A value the request already holds is kept. A missing request and one of another Organization
  both answer `not-found`, and nothing is written; when nothing is carried and nothing skipped,
  no audit entry is written.
- **History.** A value that cannot be carried is named in one `custom-field-carry-skipped` event
  (new value of the `qre_event_type_check` constraint, migration
  `Migration20261021T164808QuoteRequestsQuoteRequestEventCarrySkipped`), shown in
  `GET /api/v1/admin/quote-requests/:id/history` as a `custom_field_carry_skipped` entry with
  `customFieldCarry` (the source Opportunity and every skipped key with its reason). It is
  admin-only: buyer replies leave the event out.
