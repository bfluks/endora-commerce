---
'@endora-commerce/platform': minor
---

`StorefrontRevalidator.revalidate` is bounded and no longer silent about a refusal. Each call carries `AbortSignal.timeout(5000)`, and a non-2xx answer from the storefront's `/api/revalidate` — a `401` from a `REVALIDATE_SECRET` the two sides disagree on, a `400`, a `5xx` — is logged at warn level with its status and the number of tags (never the secret), as a transport failure already was. It still resolves either way: a revalidation never fails the write that asked for it. Before, a wrong secret left every tagged storefront entry stale with nothing in the log.
