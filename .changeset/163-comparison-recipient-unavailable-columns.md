---
'@endora-commerce/mod-comparisons': minor
---

A shared comparison no longer discloses a product its reader cannot acquire. For any reader who is not the comparison's owner, a column whose product is not available at the reader's (channel, language) — archived, outside its window, outside its audience, switched off there — is the `(removed product)` column: no name, SKU, slug, price, image or compared values, and `hiddenProductCount` does not count it, so it reads exactly like a removed product. The owner keeps the column with its details and `available: false`. `ComparisonService.buildOwnerView` takes a fourth argument, `reader: 'owner' | 'recipient'` (exported as `ComparisonReader`), defaulting to `'recipient'`; the `/me` routes, the owner's PDF and the admin audit view pass `'owner'`, and the share route passes `'owner'` only when the reader owns the comparison.
