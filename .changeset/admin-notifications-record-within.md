---
'@endora-commerce/mod-admin-notifications': minor
'@endora-commerce/contracts': minor
---

`adminNotificationRecordPort` gains `recordWithin(em, input)`, a co-transactional twin of `record`: the bell entry is created and persisted on the **caller's** EntityManager, with no fork and no flush, so it commits or rolls back with the caller's transaction (`specs/165-task-management/` SC-004 — a Task reminder's delivery row and its bell entry are one write, which makes the bell exactly once). It refuses what `record` refuses, before anything is persisted; the recipient's older entries are pruned by their next `record`. `record(input)` is unchanged.

`AdminNotificationRecordPort` now takes a type parameter, `AdminNotificationRecordPort<EM = unknown>`, the caller's MikroORM `EntityManager` (the contracts hold no `@mikro-orm` import). Existing consumers that only call `record` compile unchanged; a test double typed as the port must add `recordWithin`.
