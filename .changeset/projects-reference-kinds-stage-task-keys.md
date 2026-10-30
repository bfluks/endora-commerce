---
'@endora-commerce/mod-projects': minor
---

Projects follows the new Tasks shapes and gains two reference kinds (`specs/165-task-management/`).

- Migration `projects_reference_kinds` widens `project_references_target_type_check` to the seven reference kinds; its `down` restores the five. A Project's texts resolve `[[opportunity:…]]` and `[[project:…]]` references, and the `@@` list offers Opportunities and Projects.
- `projectReadPort` gains `findByIds` and `search`, through the Project access seam.
- Stage Tasks are created with a source key (the Stage Task definition's id), so retrying a Stage whose Tasks were partly created creates only the missing ones (#450). The Project's Task context answers `existingContexts`, so Tasks of a deleted Project or Stage are cleaned up by Tasks' maintenance pass.
- The completion gate counts a Task as finished by its status category; the Tasks tab shows each Task's configured status and all its assignees.
