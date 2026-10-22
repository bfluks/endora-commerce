---
'@endora-commerce/admin-kit': patch
---

`OrganizationPickerMulti`'s `selectedLabels` takes an optional `status`: a label without one renders its chip without a status badge. Type-only widening; existing callers are unaffected.
