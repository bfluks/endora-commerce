---
'@endora-commerce/mod-orders': minor
---

An Order created from a Sales Opportunity receives the Opportunity's carried custom-field values.

- **`orderCustomFieldCarryPort`** (`CustomFieldCarryReceiverPort` from `@endora-commerce/contracts`)
  carries a Sales Opportunity's values into an Order's **empty** fields in one
  `order.custom_fields.carry` Command, attributed to the system. A value the Order already holds is
  kept. A missing Order and one of another Organization both answer `not-found`, and nothing is
  written; when nothing is carried and nothing skipped, no audit entry is written.
- A value that cannot be carried is named in one internal, author-less, non-notifying system note
  in the Order's comments, as at placement.
