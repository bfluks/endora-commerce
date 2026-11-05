# Implementation Plan: CRM opportunity — inline editing, formatted text, richer order references

**Branch**: `feat/158-crm-opportunity-inline-editing` | **Spec**: [spec.md](./spec.md) |
**Research**: [research.md](./research.md)

## Summary

The Opportunity screen of `crm` loses its edit form: each field is edited where it is shown.
Free text becomes formatted (TipTap), stored as a Markdown subset over the existing token
grammar. Order references carry status, total, date and customer. The Order and Quote Request
detail screens honour `?returnTo=`, which every CRM link to them now carries.

## Technical Context

TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM; React 19 + Vite through
`@endora-commerce/admin-kit` (admin). **No new runtime dependency of the application**:
`@tiptap/react` and `@tiptap/starter-kit` are already the admin's; `mod-crm` gains them as
optional peers (see Complexity Tracking). No migration, no new endpoint, no schema change.

## Constitution Check

- **I. Modular** — orders and quote_requests read a generic `returnTo` through admin-kit; they
  name no CRM concept (held by `admin/test/modules/*/…after-zone.test.tsx`).
- **II. API-first** — the grammar and `OpportunityReferenceOrderSchema` are in `contracts`.
- **III. TDD** — every part landed red first: grammar, document conversion, reference service,
  `returnTo`, field, renderer, inline editing.
- **IV. Minimal dependencies** — Complexity Tracking below.
- **IX. UI reuse** — admin-kit `Button`, `Input`, `Combobox`, `PageHeader` (one new optional
  prop, `titleActions`); the CMS's editor library.
- **XIII. Command Bus** — every write is the existing `PATCH`.

## Project Structure

```text
packages/contracts/src/crm-rich-text.ts            # grammar (R-2) + tests
packages/contracts/src/crm.ts                      # OpportunityReferenceOrderSchema
packages/admin-kit/src/lib/return-to.ts            # readReturnTo / withReturnTo (R-4)
packages/admin-kit/src/ui/page-header.tsx          # titleActions
packages/modules/crm/src/backend/services/reference-service.ts   # order facts
packages/modules/crm/src/admin/
  components/InlineEdit.tsx                        # R-1
  components/ReferenceField.tsx                    # TipTap editor (R-3)
  components/editor/reference-node.ts
  components/ReferenceText.tsx                     # formatted reader, order facts
  lib/rich-text-doc.ts  lib/return-here.ts  lib/use-opportunity-update.ts
  pages/opportunity-detail/OpportunityTitle.tsx
packages/modules/orders/src/admin/pages/OrderDetail.tsx
packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx
```

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `@tiptap/react`, `@tiptap/starter-kit` as optional peers of `mod-crm` (`^3`, ranges derived by `manifests:generate` from the admin application) | A WYSIWYG field with lists, links and inline reference chips (issue #376). The issue asks to reuse an editor already in the tree; TipTap is the admin's for the CMS, so the application installs nothing new. Optional, like `react`: a consumer without the admin layer needs neither. | Extending feature 143's hand-written `contenteditable`: its model maps every DOM position to a text offset over three node kinds; hidden markers and nested blocks would mean writing a document model — what the library is. `@tiptap/core`/`@tiptap/pm` are not imported directly (they come through `@tiptap/react`), so no range is invented for them. |
