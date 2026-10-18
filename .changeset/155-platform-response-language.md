---
'@endora-commerce/platform': minor
---

**New: `request.responseLanguage()`** on every request of a composition that installs the error envelope (`registerErrorEnvelope`). It answers the language the envelope translates an error sentence into — the admin's stored preference for an admin, otherwise the q-sorted `Accept-Language`, otherwise the channel's default language — so a handler can name things in a refusal in the same language as its sentence. Resolved lazily, once per request, and shared with the envelope; it never throws, answering `LANGUAGE_FALLBACK` when no language resolver was injected or the resolver failed. The declaration rides on `@endora-commerce/platform/http`; no new export.
