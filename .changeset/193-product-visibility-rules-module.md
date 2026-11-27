---
"@endora-commerce/mod-product-visibility-rules": minor
"@endora-commerce/contracts": minor
---

New module `@endora-commerce/mod-product-visibility-rules` (`product_visibility_rules`): limits which products an administrator role sees by the products' catalogue prices, and lets a sales channel's products follow a named product rule. This release ships its schema (configuration tables and the derived catalogue-price flag and website-rule tables, all platform-global) and its activation control `product_visibility_rules.module_enabled`, which defaults to **off** — installing it changes nothing.

`@endora-commerce/contracts` exports the module's vocabulary and shapes from `product-visibility.ts` (`AdminProductVisibilityScope`, `VisibilityPredicate`, `AdminProductVisibilityPort`, `ProductRuleGovernancePort`, `ProductRuleDefinitionSchema`, the configuration API request and response schemas, `PRODUCT_VISIBILITY_SETTING_CODES`, `PRODUCT_VISIBILITY_PERMISSIONS`, `PRODUCT_VISIBILITY_ERROR_CODES`) and, from `price-lists.ts`, the catalogue reference price port type `CatalogueReferencePricePort`, `designationStatusSchema` / `DesignationStatus` and the event `price_lists.catalogue_prices_changed` (`CATALOGUE_PRICES_CHANGED_EVENT`, `CataloguePricesChangedEventSchema`). All additions; nothing existing changes.
