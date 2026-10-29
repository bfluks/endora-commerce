---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
---

An Opportunity's texts follow the reference standard shared with Projects: `@@` is one document
list — Orders · Quote requests · Tasks — and a Quote Request or a Task can be referred to in the
description, a note or a message. The Opportunity's screens are drawn with the admin kit's
collaboration components, and the screen ends with a zone other modules can fill.

**`@endora-commerce/mod-crm`**:

- **`@@` opens the document list**, where it searched the Organization's Orders alone. *Insert
  document* replaces *Insert order*. Orders and Quote Requests are the Opportunity's
  Organization's (on the create form, the Organization chosen there); Tasks are any the reader
  may see. Each group is offered only to a holder of `orders:read`, `rfqs:handle` or `tasks:read`
  respectively, and only while its module is on; a role holding none of the three keeps `@@` as
  typed.
- **`[[quote_request:<uuid>]]` and `[[task:<uuid>]]` are stored and resolved** like the other
  three types: `references` names a Quote Request by its number (`/quote-requests/<id>`) and a
  Task by its number (`/tasks/<id>`), and answers `available: false` without a label for a reader
  without `rfqs:handle` / `tasks:read`, for a Task its context hides, for a target that is gone,
  and while Quote Requests / Tasks are switched off. Texts stored before are unchanged byte for
  byte, and read as they did.
- New route `GET /api/v1/admin/crm/lookups/documents?opportunityId=…&q=…` (`crm:write`; or
  `organizationId=…` before the Opportunity exists) answering `RecordDocumentLookupResponse`, at
  most ten documents per group — the shape Projects serves at `GET /projects/lookups/documents`.
- New migration `crm_opportunity_reference_documents`: the `crm_opportunity_references`
  target-type check admits `quote_request` and `task`. Its `down` deletes the rows of those two
  types first; the texts keep their tokens.
- A new `degrades-without` edge on `tasks` (`taskReadPort`): with Tasks off or absent, Task
  references read as unavailable and Tasks are not offered after `@@`. Tasks stays switchable
  while CRM is on.
- Notes, messages, references, attachments, the change history and the list pager are drawn with
  the `@endora-commerce/admin-kit/components` collaboration components; apart from `@@` above,
  what these screens show and do is unchanged. The package no longer declares `@tiptap/react` or
  `@tiptap/starter-kit` — the editor is the kit's. A chip's token attribute is now
  `data-reference-token` (was `data-crm-token`), and an Order chip's `data-order-reference` (was
  `data-crm-order-reference`); a chip copied from the earlier editor still pastes as a chip.
- The Opportunity's screen mounts the `opportunity.detail.after` zone once, after the card
  holding its tabs, handing over the Opportunity's id and nothing else. With nobody contributing
  — no module, one that is switched off, or a person without the contribution's permission — the
  screen is unchanged. CRM names no contributor; the first is the Projects module's *Project*
  panel.

**`@endora-commerce/contracts`**:

- `OpportunityDocumentLookupQuerySchema` (`opportunityId?`, `organizationId?`, `q?`) and its type,
  the query of the new route; the answer is `RecordDocumentLookupResponseSchema`.
- `AdminZoneNameSchema` gains `'opportunity.detail.after'`, with its props
  `OpportunityDetailZoneProps { opportunityId }` in `AdminZonePropsMap`. A consumer that switches
  exhaustively over `AdminZoneName` gets a compile error until it handles the new member.
