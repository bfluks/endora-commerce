---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-catalog': patch
---

The button below a product grid or product slider can be centred or aligned right.

`catalog.ProductGrid` and `catalog.ProductSlider` take `footerButtonAlign` (`start`, `center` or `end`, labelled Left, Center and Right), offered once the footer button has a label. Unset, the button stays at the start as before; the other values add `cmsc-pb-product-listing__footer--center` or `--end`.
