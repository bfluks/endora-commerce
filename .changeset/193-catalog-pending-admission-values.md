---
"@endora-commerce/mod-catalog": minor
---

`@endora-commerce/mod-catalog` stores channel-scoped and channel × language values written for a sales channel a `product_visibility_rules` website rule governs, while the rule has not admitted the product yet (spec 193 FR-093): the admin save, copy to channels, the scopes update, URL keys, the products CSV import and connector `applyScopes` accept such a channel instead of answering `SCOPE_INVALID`, and none of them adds the product to the channel. The admin scoped-values read answers the pending values at that scope. On admission the product appears on the channel with them. `productRuleGovernancePort` is declared `degrades-without`: with the module off or absent a non-member channel is `SCOPE_INVALID`, as before.
