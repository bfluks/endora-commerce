---
'@endora-commerce/contracts': minor
---

`adminOrderPreviewLineSchema` gains an optional `taxRate` (a fraction, e.g. `0.23`): the rate a priced preview line is taxed at, from the same authority as the preview's `summary.taxTotal`. Absent on an unavailable line. The admin create-order screen sums a line group's VAT from it (feature 159).
