---
"@endora-commerce/mod-sales-channels": patch
---

The channel-side membership routes (`PUT` / `DELETE /api/v1/admin/sales-channels/:code/:entityType/:entityId`) are manual writes (spec 193, FR-054): on a sales channel whose product membership a website rule governs they answer `409 CHANNEL_MEMBERSHIP_GOVERNED`, translated and naming the rule, and change nothing. Ungoverned channels and other entity types behave as before.
