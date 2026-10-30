---
'@endora-commerce/mod-mfa': minor
'@endora-commerce/contracts': minor
---

TOTP enrolment shows a QR code, and a second-factor code admits exactly one sign-in (`specs/166-mfa-totp-hardening/`).

- `mfaSetupResponseSchema` gains `qrSvg`: every setup answer — `POST /api/v1/account/mfa/setup`, `POST /api/v1/admin/account/mfa/setup` and the set-up ticket's `begin` — carries the QR code of `otpauthUri` as an SVG document, drawn on the server. Render it as an image (a `data:image/svg+xml` URI), not as HTML. The Admin UI's Account security shows it beside the manual key.
- `@endora-commerce/mod-mfa` gains the peer `uqr` (MIT, no dependencies); an instance's `backend` declares it.
- The TOTP replay guard and the recovery-code spend are each one conditional `UPDATE`: the same valid code sent on several sign-in challenges at once used to be accepted by each of them, and is now accepted once. No migration.
