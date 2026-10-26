---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-catalog': patch
---

`ModalDialog` takes two optional props: `widthClassName` replaces the panel's default `max-w-lg`, and `dismissOnScrim={false}` keeps a press on the scrim from closing a dialog that holds unsaved input (Escape and the dialog's own buttons still close it). Existing callers are unaffected. The product browser draws an archived product's status as a neutral outline beside the catalogue's Archived pill.

The catalog's bulk edit is one `ModalDialog`: bulk Archive / Restore is confirmed in a second step of the same dialog, focus moves to the outcome's heading, an inline result no longer links to an operation page that does not exist, and a queued Archive / Restore says so and links to its operation. The product list keeps the archived empty-state copy for an unfiltered Archived tab, offers to repeat an empty search among archived products, and shows one coloured pill — Archived — on an archived row; the editor's archived notice carries its Restore action.
