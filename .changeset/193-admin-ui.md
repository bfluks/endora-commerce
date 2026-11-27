---
"@endora-commerce/mod-product-visibility-rules": minor
"@endora-commerce/contracts": minor
"@endora-commerce/mod-admin-users": minor
"@endora-commerce/mod-catalog": minor
---

`@endora-commerce/mod-product-visibility-rules` gains its Admin UI (spec 193, Phase 8): an `./admin` layer with the configuration screen at `/product-visibility` (visibility categories, the price book designated for each currency's catalogue price, each admin role's mapping — read-only without `product_visibility:manage` or for a caller who is not unrestricted) and the website rules screen at `/product-visibility/website-rules` (product rules; attaching a rule to a sales channel through a preview the administrator confirms; detaching), a sidebar entry under *Access*, and a second palette action `open-website-rules`. The module's description on `/platform/modules` now says that switching it on applies at once to unmapped quote-handling roles and that switching it off lifts every product restriction. `@endora-commerce/contracts` adds two read-only zones, `admin_users.roles.list.columns` and `admin_users.roles.editor.aside` (props `AdminRoleZoneProps { roleId }`), which `@endora-commerce/mod-admin-users`' role screen now mounts; the visibility module contributes each role's effect to both. `@endora-commerce/mod-catalog`'s product list shows a banner when the list answer carries `visibility` (a restricted role's category, or that a role with no category sees no products); with the module off the field is absent and nothing changes.
