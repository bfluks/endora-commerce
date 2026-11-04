# Research: CRM opportunity — inline editing, formatted text, richer order references

## R-1. Inline editing without a form

**Decision.** One primitive, `components/InlineEdit.tsx`, holds the four states (idle, editing,
saving, error) for any control; the title has its own header (`OpportunityTitle.tsx`) because a
form may not live inside the `h1`. Saves go through `lib/use-opportunity-update.ts`: the
existing `PATCH /opportunities/:id` naming one field, `If-Match` the version on screen.

On `VERSION_CONFLICT` the Opportunity is read again and put on screen, and the draft is kept.
Feature 143's form instead disabled *Save* until *Reload*; per field, the newer value is right
there beside the draft, so the second *Save* is an informed choice and needs no extra step.

**Alternatives rejected.** *Keep the form and add pencils* — two ways of editing the same field.
*Save on blur* — an accidental click-away would write; Escape could not undo it.

## R-2. The stored form of formatted text

**Decision.** Text, not HTML: a small Markdown subset on top of the feature 143 token grammar,
written once in `@endora-commerce/contracts` (`crm-rich-text.ts`) — `**bold**`, `_italic_`,
`~~strike~~`, `- item`, `3. item`, `[label](https://…)`, backslash escapes, one block per line.

Why: every server consumer of these fields (reference indexing, mention extraction, the
`ILIKE` search, history, audit lengths, the demo seed) reads text, and none of them changes;
no e-mail or bell entry carries the text (feature 143 R-11), so no renderer outside the admin
needs it. Text written before is valid input and reads as the paragraphs it was — no migration.
Nothing is ever HTML, so there is no sanitiser to trust: the reader draws elements of its own,
every stretch of text a text node.

Two details carry weight. `_` is italic only at a word's edge, so a SKU like `ABC_1_X` or a
`snake_case` name typed before stays as typed. The reader remembers an opener that found no
closer and does not scan for it again, so a line of ten thousand unclosed markers is read in
linear time.

**Alternatives rejected.** *Stored HTML with a sanitiser* (the CMS's) — every server consumer
would read markup, the search would match tags, the limits would count them, and old texts
would need converting. *TipTap JSON* — the same, plus a schema the server would have to know.

## R-3. The editor

**Decision.** TipTap (`@tiptap/react`, `@tiptap/starter-kit`), already in the admin application
for the CMS, replaces feature 143's hand-written `contenteditable` field
(`specs/143-crm-sales-opportunities/research.md` N-M11 rejected a library *for plain text*; a
formatted field is what that research said one would be for). The document is converted to and
from the R-2 text on every change (`lib/rich-text-doc.ts`); the reference chip is an inline atom
node (`components/editor/reference-node.ts`). The trigger logic of `lib/mention-trigger.ts` is
kept unchanged and fed the caret's textblock, a chip counting as one character.

`StarterKit` is configured down to what the text can hold — no headings, quotes, code,
horizontal rules, underline or trailing node. A pasted heading becomes a paragraph, an
underline its words.

## R-4. The way back

**Decision.** `?returnTo=`, the convention the Order and Quote Request create screens already
read, extended to their detail screens through a shared `admin-kit` helper
(`readReturnTo` / `withReturnTo`). Neither module learns about CRM (Constitution I); CRM adds
the parameter (`lib/return-here.ts`) with its own address and tab.

**Alternatives rejected.** *Router state* — lost on reload and on a copied link. *`history.back()`*
— wrong after a reload or a new tab, and leads off-site when there is no history.
