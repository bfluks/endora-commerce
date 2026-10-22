---
'@endora-commerce/mod-crm': patch
---

**Behaviour change for API clients — an Opportunity's change history serves custom-field values only to `custom_fields:read`.** `GET /api/v1/admin/crm/opportunities/:id/history` now leaves `customFieldValues` out of every entry's `before` and `after` for a caller who holds `crm:read` without `custom_fields:read` (the `requires` of `crm:read` is advisory, so such a role exists); the rest of each entry is unchanged, and `after.customFieldCarry` — keys, reasons and labels, never a value — is still served to every reader. Decided server-side, once per page, through `OwnerReadChecks.customFields`, a new member of that interface. A carry into a document created from an Opportunity that throws after the link has committed is now written to the log as a warning, with the document and the Opportunity, instead of reaching the event subscriber.
