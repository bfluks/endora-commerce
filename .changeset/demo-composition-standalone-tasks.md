---
'@endora-commerce/demo-composition': minor
---

The demo shop has Tasks of its own to show (`specs/165-task-management/` R-23).

- A new composition step, **standalone tasks of the demo administrators** (`tasks`,
  `admin_users`, `orders`), seeds ten Tasks of no Project: a parent with three sub-tasks, two
  tags and the seeded priorities, start and due dates, assignees across the demo administrator
  and Sales Reps, two comments that refer to a person and to other Tasks, one private Task and
  one draft of the demo administrator's. The call-back Task links the demo organisation's newest
  Order where one exists. Where `tasks` is absent the step is a reported skip. It is withdrawn by
  id on `demo reset`, its two tags with it.
- The demo Projects' Stage Tasks now carry their Stage Task definition's id as their source key,
  as a materialisation writes it, so retrying a demo Stage's Task creation adds none.
