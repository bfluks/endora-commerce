---
'@endora-commerce/mod-catalog': patch
---

The products list has its own address for the Archived tab, `/catalog/products/archived`, and follows the address after it has loaded: opening that address or a `?status=` link while the list is already on screen switches the tab. A saved view that held the removed Draft status still opens on All, and now says so once, until a tab is chosen or the note is dismissed.
