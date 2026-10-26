---
'@endora-commerce/mod-catalog': patch
---

Gallery labels and order are audited like the rest of a gallery item. A `PATCH …/gallery/:itemId` body carrying `labels` runs the Command `product.media.update`: the labels are replaced on the Command's transaction under the product row lock (a refused label rolls the whole write back), and the audit entry's `before` / `after` carry `labels`. With `?replace=true` the entry restores this item only, not the label another item lost. `PUT …/gallery/order` runs as `product.media.update` in one transaction, with `orderedGalleryItemIds` before and after, and announces `product.updated.v1` `['media']`; an unchanged order or label set writes nothing. Deleting a gallery item or an attachment writes one audit entry (`gallery_item.delete`, `product_attachment.delete`); the route-level `gallery.delete`, `gallery.reorder` and `attachment.delete` rows are no longer written beside them.
