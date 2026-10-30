---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-product-feeds': minor
---

A product feed publishes a sub-cent unit price as the exact price of a pack instead of rounding it (issue #430).

- **Behaviour change.** A price with a third or fourth significant decimal place (0.0125) was written rounded to two (0.01), against a product page showing 0,0125 zł. It is now published as the price of N units — N the smallest of 10, 100, 1 000, 10 000 that makes it exact (0.0125 → 100 at 1.25; a gross feed publishes the gross of that pack's net) — with N in the template's pack fields. A template with no `pack_quantity` field leaves the item out with the run issue `sub_cent_price_without_pack_field`; a price needing a pack above 10 000 with `sub_cent_price_beyond_pack_limit`. A price with two decimal places is published byte for byte as before.
- **`feedFieldSourceKindSchema`** (contracts) gains `pack_quantity`, `pack_unit_pricing_measure` and `pack_unit_pricing_base_measure`; **`feedRunIssueReasonSchema`** gains `sub_cent_price_without_pack_field` and `sub_cent_price_beyond_pack_limit`.
- **The predefined Google Merchant Center template** binds them to `g:multipack`, `g:unit_pricing_measure` and `g:unit_pricing_base_measure`, after `g:sale_price`; migration `Migration20261025T145041ProductFeedsGoogleTemplatePackFields` adds them to an installed template.
- **Resolver SPI**: `FeedItemPrice.taxRatePercent: number | null` (required) and `ResolveFeedItemInput.templateFields` (optional, the whole template when `fields` is one field). New `feedPackQuantity` / `MAX_FEED_PACK_QUANTITY` in `services/feed-pack.ts`.
