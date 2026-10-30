---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-megamenu': patch
---

Linking an existing library file by id refuses a file the administrator may not see in the library exactly as a missing one, and links nothing (`specs/166-asset-reference-visibility/` FR-006). This covers a product's gallery item, attachment and download file (on create), a category's main image, a blog post's and a blog category's main image, and a menu item's asset target and icon. Before, these links made such a file visible to every library reader. A file id that names no file now answers `404 NOT_FOUND` for the product download, the category image and the blog images, where it used to fail with a server error; the menu keeps its `400 MEGAMENU_ASSET_KIND_MISMATCH`.
