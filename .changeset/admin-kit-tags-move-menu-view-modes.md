---
'@endora-commerce/admin-kit': minor
---

Additive (`specs/165-task-management/`):

- `TagChips`, `TagMultiSelect` and `useTagOptions` (`components/tags/`), promoted from CRM with the options source injected, so any module can offer tags.
- `MoveToMenu` (`components/kanban/MoveToMenu.tsx`), the keyboard *Move to…* menu for a `KanbanBoard` card, promoted from CRM; it takes generic `targets {code, name, color}`.
- The reference editor and `ReferenceText` know the reference kinds `opportunity` and `project`: two more document groups in the `@@` list and link targets for both.
- Admin preferences: `listViewModes` in the preference store, and `useListViewModePreference(listId)`, which remembers a list's list-or-board choice across devices.
- `CommentThread` takes `keepDeleted`: a deleted entry keeps its place, marked as deleted, with nothing left to change (`RecordComment.deletedAt`, optional). Without it a deleted entry leaves the list, as before.
- `MultiSelect` and `TagMultiSelect` take `ariaLabelledBy`: the trigger is named by a visible label's id rather than a second copy of it in `ariaLabel`. `TagMultiSelect` takes one of the two.
- `StatusTransitionGraph` names the statuses in its *From* / *To* form and in the selected move through `statusLabel`, as its graph already did, instead of showing their codes; the options' values stay the codes. Every workflow screen built on it (orders, returns, CRM, Projects' stages, Tasks) shows names there now.
- `ReferenceField`'s suggestion list keeps a suggestion's label (a record's number, a person's name) at its width and truncates the description (a title) instead: a long title no longer squeezes the number down to `TSK-…` or out of sight.
- `RecordHistory` and `CommentThread` take `formatTime`, optional: an entry's time in the record's own format. Without it both write it with `formatDateTime`, as before.
