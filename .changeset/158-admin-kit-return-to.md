---
'@endora-commerce/admin-kit': minor
---

A detail screen can lead its Back to the screen that opened it, and a page header can carry controls beside its title.

- **New in `@endora-commerce/admin-kit/lib`**: `readReturnTo(searchParams)` returns the `?returnTo=` path a screen was opened with, or `null` for anything that is not a path of the application (a scheme, a host, `//`); `withReturnTo(target, returnTo)` adds it to a link, keeping the query and the hash; `RETURN_TO_PARAM`.
- **`PageHeader`** takes an optional `titleActions`, drawn beside the heading but outside it, so the heading's accessible name stays its words. Pages that do not pass it render as before.
