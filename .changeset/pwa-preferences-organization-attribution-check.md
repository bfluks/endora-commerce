---
'@endora-commerce/mod-pwa': patch
---

`push_notification_preferences` gains the organisation attribution check every other customer-scoped table with an organisation column carries (D-187): a row that names a customer account must name an organisation, `check ("customer_account_id" is null or "organization_id" is not null)`, as `push_notification_preferences_organization_attribution_chk`. One new migration, `Migration20261020T131018PwaPreferencesOrganizationAttributionCheck`, exported from `@endora-commerce/mod-pwa/migrations`. Both columns are already `not null`, so no existing row can violate it and nothing is backfilled.
