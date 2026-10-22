---
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-search': minor
---

**Behaviour change for API clients — additive field.** Comparison items and search hit summaries carry `minOrderQuantity`, read from the catalogue record (never from the search index): the product's minimum order quantity for `simple` and `configurable` products, `null` otherwise or when none is set. Storefronts can start a quantity input at the minimum.
