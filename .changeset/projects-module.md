---
'@endora-commerce/mod-projects': minor
---

A new module package, `@endora-commerce/mod-projects` (module id `projects`): Projects for zero or
more Organizations — or for none, an internal Project — run through Stages of their own by
Members holding Project Roles, opened, completed, lost and reopened.

- **Activation and settings.** `projects.enabled` (on by default, switchable on
  `/platform/modules`), `projects.visibility` (`members` by default, or `everyone`) and
  `projects.alerts_time_zone` (`Europe/Warsaw`). Off is non-destructive: every route answers
  `503` `MODULE_DISABLED`, every screen, panel, palette action and search hit is gone, no alert
  is sent, and everything is back as it was when it is switched on again.
- **Migrations.** `projects_init` (Projects, their Stages, workflow, Organizations, Members and
  their Roles, listed viewers, Stage Tasks, Stage history, links, notes and messages, references,
  attachments, Templates, Project Roles and loss reasons with their seeded rows, alert
  deliveries), `projects_link_organization` and `projects_value_changes` (the values a write
  changed, which a Project's change history shows).
- **Permissions.** `projects:read`, `projects:write`, `projects:configure` (Templates, Project
  Roles, loss reasons), `projects:analytics`, and `projects:see_all`, which lifts the visibility
  rule but never Organization reach; each of the last four requires `projects:read`. A Project
  Role grants no permission.
- **Admin API** under `/api/v1/admin/projects`: the list (filters, search, sort, `total`, custom
  field filters) and a Project's CRUD; its Organizations, Members, Stages, workflow, moves, close
  and reopen, and Stage history; Stage Tasks and the completion gate; linked Orders, Quote
  Requests and Opportunities, and the Project a record or a Task belongs to; notes, messages,
  mentions, references, attachments (multipart upload) and change history; Templates; the two
  dictionaries; seven analytics figures, over days counted in the reporting time zone of Analytics
  (`analytics.reporting_time_zone`, `UTC` by default, `UTC` while Analytics is off); and the module's own lookups. Every read goes through
  the module's `ProjectAccess` — Organization reach and visibility — and an invisible Project
  answers exactly as a missing one.
- **Admin UI.** The list, *New project*, a Project's screen with its tabs, Templates, Project
  Roles, Loss reasons and Analytics, in the sidebar's *Projects & tasks* section; four palette
  actions (`open-projects`, `new-project`, `open-project-templates`, `open-project-analytics`);
  Projects in admin global search, by number, title or Organization name; a *Project* panel on
  the Order, Quote Request, Opportunity and Task screens, and a *Projects* panel on the
  Organization screen. English and Polish.
- **Collaboration.** Notes and messages with `@` mentions and `@@` / `@@@` references, through the
  admin kit's components; a message notifies the Project's Members, a mention the person named,
  through the bell (`admin_notifications`, optional).
- **Deadline alerts.** A Stage's alert days send a bell entry and the transactional e-mail
  `projects_stage_deadline_alert` (defaults in English and Polish, editable) to every Member who
  may see the Project, from a BullMQ job scheduler every fifteen minutes.
- **Custom fields.** *Project* is a record type on `/custom-fields`; values are validated on save,
  shown on the Project, and offered as list filters. A Project's change history shows each change
  of a custom field or of the value with the value before and after it, kept by the module itself;
  the platform audit log, which is not kept per Organization, names the changed fields only.
- **For other modules.** `projectReadPort` (`findById`, `findByRecord`), gated;
  `projectStageGuardRegistry`, through which a guard refuses a move, close or reopen; the `project`
  Task context in Tasks' registry, which lets a Task into a Project, out of one or be deleted from
  one only for a holder of `projects:write` who sees the Project; the events `projects.project.created.v1`,
  `projects.stage.moved.v1`, `projects.project.closed.v1`, `projects.project.reopened.v1`,
  `projects.record.linked.v1` and `projects.record.unlinked.v1`; and `nextProjectNumber(em)` on
  `./backend`, the door to the `PRJ-…` number sequence.
- **Dependencies.** Binding on `_i18n`, `admin_roles`, `admin_users`, `assets_library`,
  `audit_logs`, `auth`, `catalog`, `custom_fields`, `orders`, `organizations`, `settings` and
  `transactional_emails`; degrades without `analytics` (analytics count in UTC), `tasks` (no Tasks tab, Stage Tasks or completion
  gates), `crm`, `quote_requests` and `admin_notifications`. The package declares
  `@fastify/multipart` `^10`, `bullmq` `^5` and `ioredis` `^5` as peer dependencies, beside the
  platform's own.

Its contract — the API schemas, `ProjectReadPort` and `ProjectStageGuardRegistryPort` — is in
`@endora-commerce/contracts` (see that package's entry).
