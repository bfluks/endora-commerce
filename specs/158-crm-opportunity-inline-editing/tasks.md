# Tasks: CRM opportunity — inline editing, formatted text, richer order references

All tasks are done; each landed test-first.

- [x] T001 Grammar of formatted text, with linear-time reading — `packages/contracts/src/crm-rich-text.ts` (+ test)
- [x] T002 `OpportunityReferenceOrderSchema`; order facts in `ReferenceService` (+ test)
- [x] T003 `readReturnTo` / `withReturnTo` in admin-kit (+ `admin/test/kit/kit-return-to.test.ts`)
- [x] T004 Order and Quote Request detail *Back* honours `returnTo` (+ tests in their custom-fields suites)
- [x] T005 CRM links to Orders and Quote Requests carry `returnTo` (`lib/return-here.ts`)
- [x] T006 Document ↔ text conversion — `lib/rich-text-doc.ts` (+ test)
- [x] T007 `ReferenceField` on TipTap with toolbar, chips, shortcuts, limit (+ `reference-field`, `mentions`, `references`, `comments` suites)
- [x] T008 `ReferenceText` formatted reader and Order facts; history shows plain words
- [x] T009 Event descriptions formatted (editor without references, reader)
- [x] T010 `InlineEdit`, `useOpportunityUpdate`, `OpportunityTitle`; sidebar, value and Overview in place; form removed (+ `OpportunityEdit`, `OpportunityDetail` suites)
- [x] T011 i18n (en, pl), changesets, module documentation (en, pl)
