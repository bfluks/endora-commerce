---
'@endora-commerce/admin-kit': minor
---

Line groups editor and grouped reordering in `@endora-commerce/admin-kit/components`.

- **`useGroupedReorder(options)`** — the multi-section sibling of `useReorderList`: items move within and across sections (native pointer drag, the ARIA grab-mode keyboard map crossing section boundaries, `moveItemBy` / `moveItemTo`), non-fixed sections move among themselves (`moveSectionBy`), and every move is announced through the caller's labels. The hook owns no list: it calls `onMoveItem(id, sectionKey, index)` and `onMoveSection(key, index)`.
- **`<LineGroupsEditor>`** — domain-free editor of named, ordered groups of a document's lines: inline group names (required, 120 characters), move up/down, delete (lines move to the ungrouped section, announced), a *Move to group* menu per line, per-section `renderSummary` and `renderSectionFooter`, a `readOnly` mode and a `layout="table"` mode for screens whose lines are table rows. With no group it renders the bare line list. Every string is a prop (`LineGroupsEditorLabels`).
- **`<SplitLineDialog>`** — *Split line*: a modal dialog asking for the quantity to move to a new line (whole steps from `step` to `quantity − step`, invalid entries marked with their reason, Enter confirms) and the section of the new line; with `canSplitLine(quantity, step)` and `splitLineInto(lines, key, split, ops)`, which applies a confirmed split to a display-ordered line list. Every string is a prop (`SplitLineDialogLabels`).
