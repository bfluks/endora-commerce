---
"@endora-commerce/mod-product-visibility-rules": minor
---

`@endora-commerce/mod-product-visibility-rules` registers a `beforeCommit` hook on every catalog status writer (`CATALOG_HOOKABLE_ACTIONS`, spec 193 T068): a product that becomes active again — its global status to active or un-archived, or its channel status (scope level `channel`, never a per-language one) moving to active on a channel a website rule governs — leaves that channel in the same transaction, its admission is deleted and it is marked, so it is back only once the rule re-admits it (FR-092, SC-005). The first channel-status write after the product's admission is exempt and only sets `post_admission_status_seen` (FR-093, Q1 A). While the module is off the hook does not run.
