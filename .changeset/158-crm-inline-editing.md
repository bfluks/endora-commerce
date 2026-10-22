---
'@endora-commerce/mod-crm': minor
---

The Opportunity screen is edited in place, its free text is formatted, and an Order reference says what the Order is.

- **Inline editing.** The header's *Edit* and its form are gone: the title, the description, the expected close date, the contact person, the Sales Channel and a typed value are each edited where they are shown, with *Save* and *Cancel*. A save sends that field alone under `If-Match`; on `409 VERSION_CONFLICT` the newer Opportunity is shown and the draft kept.
- **Formatted text (WYSIWYG).** Descriptions, notes, messages and Event descriptions are written in a TipTap editor with a toolbar (bold, italic, strikethrough, lists, links) and keep the `@`, `@@` and `@@@` reference shortcuts. What is stored is the text grammar of `@endora-commerce/contracts` — no HTML. **New optional peer dependencies `@tiptap/react` and `@tiptap/starter-kit` (`^3`)** for the admin layer; the admin application already carries them.
- **Order references** show the status, total, date and customer, open the Order with a way back to the Opportunity, and have a button that opens it in a new tab. Every link from an Opportunity to an Order or a Quote Request carries `?returnTo=`.
- Admin API: an Order reference in `references[]` carries `order` (see `@endora-commerce/contracts`).
