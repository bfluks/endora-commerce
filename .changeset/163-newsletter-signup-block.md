---
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

A newsletter signup block that subscribes through the platform's own newsletter module.

- `newsletter.Signup` is declared by `@endora-commerce/mod-newsletter` (category *Forms*, English and Polish labels, 14 translatable texts) and rendered by `@endora-commerce/cms-components` (exported as `Signup`, with `NEWSLETTER_SUBSCRIBE_PATH` and `NEWSLETTER_SIGNUP_MAX_TOPICS`). It has a heading, text, e-mail label and placeholder, button label, up to 12 topics mapped to newsletter tag codes (optionally required), a consent text, a layout and translatable outcome messages. The form posts to the storefront path `/newsletter/subscribe`, works without JavaScript (the outcome is read back from the page URL, and the visitor lands back on the anchor of the `cms.Section` the block stands in) and, with JavaScript, submits in place and keeps the typed address. Subscriptions are recorded with `source: 'cms-block'`, the consent time and the chosen tags. The block disappears from the editor and the storefront when the newsletter module is off.
- **A storefront must provide the `/newsletter/subscribe` route handler** for the block to work; the reference storefront ships one. To show the outcome without JavaScript, pass `location` (`{ path, query }`) to `CmsRenderProvider`; blocks read it with the new `useCmsRenderLocation()`.
- `cms.NewsletterSignup` is kept unchanged for forms that post to an external newsletter service, and is relabelled **"External newsletter form"** in the block list. It adds an optional consent checkbox (`showConsent`, off by default, with an inline rich-text `consentLabel`); stored forms render as before.
