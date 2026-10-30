---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/cms-components': minor
---

The page editor's preview of a product listing shows the same line under each product name as the storefront, and the option says what each line is.

- `@endora-commerce/contracts` exports `productSummaryText(description)` and `PRODUCT_SUMMARY_MAX_LENGTH`, moved from `@endora-commerce/mod-catalog`, which re-exports them from the same module path. The rule is unchanged.
- `@endora-commerce/mod-cms`' admin preview maps a product's description to its card `summary` through it (`mapAdminProductToCmsSummary`), in the language its name is picked in. The summary line, and a Showcase card's default line, were always empty in the editor.
- `catalog.ProductGrid` and `catalog.ProductSlider` label `cardTextLine` **Text under the product name**, with **Card style default (SKU; summary on Showcase)**, **Short description (from the product description)**, **SKU** and **None**, in English and Polish. The stored values are unchanged.
