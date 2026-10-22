---
'@endora-commerce/mod-admin-feedback': minor
---

New package `@endora-commerce/mod-admin-feedback` (module id `admin_feedback`): administrators send
feedback from the admin to the makers of Endora Commerce.

It serves `POST /api/v1/admin/feedback` (body `AdminFeedbackRequest` from
`@endora-commerce/contracts`) to any signed-in administrator, with no permission code and a limit
of five sends per administrator per ten minutes. The instance adds what it knows about itself — the
release it runs, its configured public API address, the sending administrator's name and id — and
posts an `AdminFeedbackRelayPayload` as JSON to the relay, with a ten-second timeout and redirects
not followed. It answers `204` when the relay accepts, `429 RATE_LIMITED` when the relay
rate-limits, `502 ADMIN_FEEDBACK_DELIVERY_FAILED` for any other refusal, a network failure or a
timeout, and `503 ADMIN_FEEDBACK_NOT_CONFIGURED` when the relay address is empty or not an
`http(s)` URL. Nothing is stored: no table, no migration, and the message is never logged.

Settings, in the new **Feedback** group: `admin_feedback.module_enabled` (the activation switch, on
by default — switch it off if the instance must not send data to Endora) and
`admin_feedback.relay_url` (default `https://commerce.endora.software/api/platform-feedback/`;
empty switches sending off). One palette action opens the settings. The admin's "Send feedback"
link and dialog are `@endora-commerce/admin-shell`'s, shown while this module is present.
