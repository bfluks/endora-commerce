---
'@endora-commerce/demo-composition': minor
---

The demo shop has Projects and Tasks to show.

Two new composition steps, each guarded by the presence of every module it touches:

- **projects for the demo organisation, and a Template** (`projects`, `organizations`,
  `admin_users`, `orders`) — the Template *Showroom fit-out* (four Stages, the first gated by two
  Stage Tasks) and four Projects made from it: one open in that first Stage, one completed, one
  lost and one internal, with the demo administrator as Project Manager and the demo Sales Reps
  as Members. The open and the completed Project each hold one of the demo organisation's Orders
  where one exists.
- **stage tasks of the demo projects** (`tasks`, `projects`, `admin_users`) — the Tasks those
  Projects' Stages made, created by the demo administrator. Where `tasks` is absent the step is
  a reported skip and the Projects are seeded all the same.

Both are withdrawn by id on `demo reset`. **`demo reset` also withdraws the Projects an
administrator opened for the demo organisation since**, which used to refuse the reset (the
organisation's foreign key from `project_organizations` is `on delete restrict`): two new
sections of the used-demo withdrawal delete the Tasks of those Projects, then the Projects that
are the demo organisation's alone, whole. A Project it shares with another organisation stays;
only the demo organisation's place on it and its links to the demo organisation's records go. An
internal Project is never matched. The package gains `@endora-commerce/mod-projects` and
`@endora-commerce/mod-tasks` as optional peer dependencies.
