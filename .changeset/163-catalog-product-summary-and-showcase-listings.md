---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/cms-components': minor
---

Products carry a short plain-text summary, and the product listing blocks gain a showcase card for marketing pages.

- `@endora-commerce/mod-catalog` derives `summary` from the product description already on the row — markup stripped, entities decoded, at most 160 characters cut at a word boundary with `…`, in the request language with the same channel override as the product page — and returns it on the storefront product list and product reads; `null` when there is no description. No extra query per product. `@endora-commerce/contracts` adds the optional `summary` to `productSummarySchema`.
- `catalog.ProductGrid` and `catalog.ProductSlider` (rendered by `@endora-commerce/cms-components`, declared by `@endora-commerce/mod-catalog`) keep every option and default they had and add a header (heading, lead, button), `cardVariant` (`default` or `showcase`), a card link label `ctaLabel` and a `footerButton`. The slider takes the Carousel's options; a stored slider keeps its look through `productSliderFromLegacy` (arrows over the edges, dots below, pixel gap). The new texts are translatable, and the field labels ship in English and Polish.
- `CmsProductCardView` accepts `variant: 'showcase'`: image on a neutral backdrop, name, summary and a "more" link labelled by `ctaLabel`, without price or SKU. `CmsProductSummary` gains the optional `summary`; `PRODUCT_CARD_VARIANTS` and the shared listing fields are exported from `components/catalog/product-listing-parts`.
