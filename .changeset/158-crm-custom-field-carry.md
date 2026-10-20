---
'@endora-commerce/mod-crm': minor
---

Sales Opportunities created for, or joined by, an Order or a Quote Request receive the document's carried custom-field values.

- **On automatic creation.** An Opportunity created for a placed Order or a submitted Quote
  Request receives every value whose Order or Quote Request definition carries to Opportunities.
  The values are stored by the `crm.opportunity.create` Command, run on the system's behalf, and
  are not re-validated against the Opportunity's other fields, so a required field cannot stop
  the creation.
- **On joining.** An Order placed from a Quote Request linked to an Opportunity carries its values
  into that Opportunity's **empty** fields inside the `crm.opportunity.link_add` Command; a value
  the Opportunity already holds is kept. An operator's manual link and an origin link carry
  nothing into the Opportunity.
- **History.** When anything was carried or skipped, the creation or link entry's `after` gains
  `customFieldCarry: { source: { entityType, recordId }, carried, skipped }` (each skipped key
  with its reason), and the link entry gains `customFieldValues` when values were carried. These
  entries are what `GET /api/v1/admin/crm/opportunities/:id/history` returns.
- `OpportunityServiceDeps` and `OpportunityLinkServiceDeps` gain the required `customFieldCarry`
  (`CustomFieldCarryPort`); `AutomaticOpportunityInput` and `AutomaticLink` gain an optional
  `carry`.
