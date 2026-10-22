---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-quote-requests': patch
---

Custom-field carry review fixes.

- **`@endora-commerce/contracts`** — every string of `customFieldCarrySkipLabelSchema` is at most 200 characters (`CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX`, new export); a longer `labelDefault` or per-locale label is refused.
- **`@endora-commerce/mod-custom-fields`** — the carry port cuts a skip's label snapshot to that limit, since a definition's per-locale labels are not capped, so every skip it plans parses.
- **`@endora-commerce/mod-quote-requests`** — the Opportunity → Quote Request carry takes the request's row `for update` and plans over the bag it re-reads under the lock, so an administrator's concurrent edit is never overwritten. A carry that fills a field still raises the request's `version`.
