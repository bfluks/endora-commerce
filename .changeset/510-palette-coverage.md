---
'@endora-commerce/mod-taxes': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-mfa': patch
---

Every admin screen of these four modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords.

- `@endora-commerce/mod-taxes` declares the `open-taxes` action for the tax-rule table (`taxes:read`).
- `@endora-commerce/mod-blog` declares `open-blog-posts`, `open-blog-categories` and `open-blog-tags` (`blog.read`) beside the existing `new-post`.
- `@endora-commerce/mod-carts` declares the `open-carts` action and a sidebar entry under *Sales* for the platform-wide cart list (`carts:read`). The list was previously reachable only by typing its address.
- `@endora-commerce/mod-mfa` declares the `open-security` action and a sidebar entry under *System* for the signed-in admin's own two-factor authentication screen. Neither carries a permission code, like the screen itself: every admin manages their own second factor.
