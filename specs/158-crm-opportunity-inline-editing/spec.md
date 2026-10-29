# Feature Specification: CRM opportunity — inline editing, formatted text, richer order references

**Feature Branch**: `feat/158-crm-opportunity-inline-editing`
**Created**: 2026-10-20
**Status**: Implemented
**Input**: GitHub issue #376 — *CRM opportunity detail: inline editing, WYSIWYG content and
richer @@ order mentions*; and the owner's addition of 2026-10-20: opening an Order or a Quote
Request from an Opportunity must offer a **Back** that returns to the Opportunity being worked
on.

Builds on `specs/143-crm-sales-opportunities/` (the Opportunity screen, User Stories 1, 4, 12,
18, 20 and 21). Nothing here changes the server's storage or its write paths.

## User Scenarios & Testing

### User Story 1 — Edit a field where it is shown (Priority: P1)

A Sales Rep reading an Opportunity changes its title, description, expected close date,
contact person, Sales Channel or typed value without opening a separate form.

**Acceptance Scenarios**

1. **Given** a holder of `crm:write`, **When** they open an Opportunity, **Then** every field
   that can change has a pencil named "Edit <field>", always visible; a holder of `crm:read`
   alone sees none; the Organization, currency, source, number and record dates have none.
2. **Given** the pencil is pressed, **Then** the field becomes its control holding the current
   value, with the focus in it, and *Save* and *Cancel*; Enter saves a one-line field,
   Ctrl/Cmd + Enter the description, Escape cancels and returns the focus to the pencil.
3. **When** a field is saved, **Then** the Opportunity's `PATCH` names that field alone under
   `If-Match`, the answer is put on screen, and "<field> saved." is announced.
4. **When** somebody else saved first (409 `VERSION_CONFLICT`), **Then** the newer Opportunity
   is shown, a sentence says so, the draft is kept, and only a second *Save* sends it.
5. **When** any other refusal comes, **Then** the server's sentence is shown under the control
   and the draft is kept.
6. A computed value has no pencil; the value mode, assignee, tags and custom fields keep the
   in-place controls they had.

### User Story 2 — Write and read formatted text (Priority: P1)

Descriptions, notes, messages and Event descriptions are written in a WYSIWYG editor and read
formatted.

1. The editor offers bold, italic, strikethrough, bulleted and numbered lists and links
   (`http`, `https`, `mailto`), from a toolbar and from the usual keys.
2. The `@`, `@@` and `@@@` shortcuts and the insert buttons behave as in feature 143; an
   Event's description takes no references.
3. What is stored is text — no HTML; text written before reads unchanged.
4. A link a reader may not follow is never drawn as one.

### User Story 3 — Know which Order a text refers to (Priority: P2)

An `@@` Order reference shows the Order's status, total, date and customer beside its number,
opens the Order with a way back, and has a button that opens it in a new tab.

### User Story 4 — Come back to the Opportunity (Priority: P1, owner's addition)

From any link of an Opportunity to an Order or a Quote Request, the document's screen offers a
*Back* that returns to the Opportunity and the tab it was opened from.

## Requirements

- **FR-001** Every changeable fact of the sidebar and the page's title is edited in place.
- **FR-002** The Overview tab's description is edited in its own section; the custom fields keep
  their panel.
- **FR-003** A save sends the one field under `If-Match` through the existing `PATCH` (Command
  Bus, Constitution XIII); a stale version is said and never silently overwritten.
- **FR-004** Each inline field has the idle, editing, saving and error states, each announced.
- **FR-010** Descriptions, notes, messages and Event descriptions are written in a formatted
  editor and read formatted; the stored form is the text grammar of research R-2.
- **FR-011** The reference shortcuts, buttons, role gating and length limits of feature 143
  hold in the formatted editor; a chip is one character to Backspace and Delete.
- **FR-012** An available Order reference carries and shows status, total, date and customer,
  and offers opening the Order in a new tab.
- **FR-020** The Order and Quote Request detail screens honour `?returnTo=` (an in-app path
  only); every CRM link to them carries the Opportunity's address and tab.

## Success Criteria

- No Opportunity field needs a separate form to change (SC-001).
- No stored text contains HTML; existing texts render unchanged (SC-002).
- From an Order or Quote Request opened from an Opportunity, one click returns to it (SC-003).
