---
'@endora-commerce/mod-carts': minor
---

A basket line ordered by a packaging unit, added by a caller that names the channel itself (`CartWritePort.addItem` / `addItems` with `salesChannelId`, an operator surface), snapshots the unit's name at that channel's default language — its translation there, else the global name — like the product name beside it. It used to take the global name. `CartService` takes the kernel's `salesChannelResolutionPort` as a new optional last constructor argument, read only when a unit is named.
