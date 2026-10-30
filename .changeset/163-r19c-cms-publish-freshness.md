---
'@endora-commerce/platform': minor
'@endora-commerce/mod-cms': minor
---

A CMS save or publish answers once the storefront has dropped its cached copy, so the next storefront request shows the new content.

- `@endora-commerce/platform`: `StorefrontRevalidator` logs a call the storefront refuses (`{ status, tags }`; a 401 means `REVALIDATE_SECRET` differs between the backend and the storefront) and gives up after `timeoutMs` (new option, default 3000 ms). Both used to pass silently.
- `@endora-commerce/mod-cms`: `CmsContentInvalidator` awaits its `publish` callback, which may now return a promise (`CmsModuleOptions.publishContentChange: (change) => void | Promise<void>`). The module dispatches `cms.content_changed.v1` in an EventBus scope and its storefront-revalidation subscriber returns the revalidation, so a page, block, template or hook write waits for it (bounded by the revalidator's timeout, never failing the write).
