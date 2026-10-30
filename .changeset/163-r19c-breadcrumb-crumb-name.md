---
'@endora-commerce/mod-cms': minor
---

The storefront page payload's `breadcrumbs.trail[].name` is now each ancestor's page **name**, the same source as the current page's crumb. It used to be the ancestor's meta title in the served language, falling back to the name, so one trail mixed browser titles and page names. A storefront that wants another label per crumb must now read it elsewhere.
