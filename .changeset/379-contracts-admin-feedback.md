---
'@endora-commerce/contracts': minor
---

New `admin-feedback` contract (issue #379): `AdminFeedbackRequestSchema` (what the Admin UI sends to its instance), `AdminFeedbackRelayPayloadSchema` (what the instance relays — the words plus the platform release, the Admin UI and API addresses and the sending administrator), `adminFeedbackPhoneSchema`, `ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH`, `ADMIN_FEEDBACK_ERROR_CODES`, `ADMIN_FEEDBACK_SETTING_CODES` and `ADMIN_FEEDBACK_DEFAULT_RELAY_URL` (the commerce.endora.software relay, with its trailing slash). `ERROR_CODES` gains `ADMIN_FEEDBACK_NOT_CONFIGURED` and `ADMIN_FEEDBACK_DELIVERY_FAILED`.
