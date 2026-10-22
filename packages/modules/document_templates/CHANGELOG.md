# @endora-commerce/mod-document-templates

## 0.107.0

### Minor Changes

- dd939be: New module `document_templates` (`specs/152-compare-pdf-template/`): operator-designed Page
  Builder layouts for the PDF documents the platform produces.

  - Table `document_templates` (one migration): templates per document type and scope (all sales
    channels or one), at most one default per scope, one layout per language, optimistic versions.
  - `documentTypeRegistry` — a contribution registry a module pushes its document type into from a
    contribution-only boot hook; a type and each contributed block are answered only while their
    module is present.
  - `documentRenderPort` — the gated Page Builder → pdfmake engine:
    `render({ documentType, salesChannelId, language, data, templateId? })` resolves the channel
    default, the global default, then the built-in layout; `templateId` is honoured only for
    `selection: 'per_document'` types. Images come from the assets library only; pdfmake's URL
    access is denied.
  - Six general-purpose blocks (`document_templates.Heading`, `Text`, `Image`, `Spacer`, `Divider`,
    `PageBreak`), offered to types that opt in.
  - Admin API `/api/v1/admin/document-templates` (12 routes; `document_templates:read` /
    `document_templates:write`), every write a Command with one audit row.
  - Admin: _Document templates_ list and editor (palette = the template's document type), sidebar
    entry and the `open-document-templates` palette action.
  - Activation `document_templates.enabled` (default on). It cannot be switched off while
    `invoices` is on.

- d571d8c: The **Line items table** (`document_templates.ItemsTable`, `specs/153-quote-request-pdf-template/`).

  - A document type that declares a line collection is offered the table: columns chosen from the
    collection's field catalogue (1–16, each with header, width, alignment, format, empty text and a
    visibility rule _always_ / _only if any line has a value_ / _never_), an optional detail row,
    totals and grouping with subtotals. It is printed as a real table that repeats its header row on
    every page and never splits a line's row; its settings are validated when a template is saved
    (`DOCUMENT_TEMPLATE_INVALID` naming the setting).
  - The admin editor gains the table's column, detail row, totals and grouping editors, with
    **Internal** badges on fields customers do not otherwise see, and a canvas drawn with the same
    formatting as the PDF.
  - `GET /api/v1/admin/document-templates/types/:code` answers the type's `collections` (fields in
    the asked language, sample lines and totals).
  - `documentRenderPort.listChoices` answers the templates a person may pick for one document of a
    per-document type.
  - The command palette entry is also found by _quote pdf_, _offer template_, _szablon oferty_ and
    _zapytanie ofertowe pdf_.

### Patch Changes

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [ad55813]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0
  - @endora-commerce/page-builder-admin@0.107.0
  - @endora-commerce/page-builder-core@0.107.0
