---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
---

CRM's collaboration components are in the kit, so any module's screen can have notes, messages,
references, attachments and a change history without copying them.

**`@endora-commerce/admin-kit/components`** gains:

- `ReferenceField` — the formatted text field in which `@` mentions a person, `@@` refers to a
  document and `@@@` to a Product. What may be referred to is the `kinds` prop (the standard is
  `REFERENCE_TRIGGER_KINDS`, `['admin_user', 'document', 'product']`), and where the suggestions
  come from is a `ReferenceLookups` adapter (`searchPeople`, `searchDocuments`, `searchProducts`)
  the screen fills from its own lookups, behind its own permissions. `@@` with `kind: 'document'`
  shows one list grouped Orders · Quote requests · Tasks, from a `RecordDocumentLookupResponse`.
- `ReferenceText` — a stored text drawn with its formatting, and every reference — person, Order,
  Product, Quote Request, Task — as a chip that links to its screen, or says it is unavailable.
  An Order's chip carries `data-order-reference="<id>"`, and a chip inside the field carries its
  token in `data-reference-token`; a chip copied from CRM's earlier editor, whose attribute was
  `data-crm-token`, still pastes back as a chip.
- `CommentThread` and `CommentComposer` — a record's notes or messages, over a `CommentThreadApi`
  adapter (`list`, `add`, `update`, `remove`); `RecordComment`, `CommentThreadCopy`.
- `AttachmentUploader` and `uploadAttachment(path, file)` — a file chosen or dropped, posted
  multipart to the record's own upload endpoint.
- `useRecordHistory` and `RecordHistory` — a cursor-paginated change history whose headings,
  field labels and values the record injects; `recordHistoryChanges` lists what an entry changed.
- `CursorPagination` — rows per page and Previous / Next for a list that knows no total, with a
  `maxPageSize`.
- the reference grammar's editor halves: `findMentionTrigger`, `clipReferenceText`,
  `editorDocOf`, `textOfEditorDoc`, `REFERENCE_NODE`, `MENTION_QUERY_LIMIT`.

The kit now declares `@tiptap/react` and `@tiptap/starter-kit` (`^3.22.5`) as peer dependencies.

**`@endora-commerce/mod-i18n`**: the components' English and Polish sentences are in the shared
`core` bundle (`references.*`, `editor.*`, `comments.*`, `history.*`, `cursorPagination.*`).

CRM is the components' first user; what that changes for `@endora-commerce/mod-crm` is in its own
entry.
