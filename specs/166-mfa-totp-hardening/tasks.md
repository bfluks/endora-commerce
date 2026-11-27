# Tasks: TOTP hardening (166)

- [X] T001 Research what `mfa` already does for each item (`research.md` R2, R3)
- [X] T002 [US1] Failing unit test: `generateSecret` answers `qrSvg` (`packages/modules/mfa/src/backend/services/totp.test.ts`)
- [X] T003 [US1] Failing integration assertion: the setup answer carries `qrSvg` (`backend/test/integration/mfa/customer-enrol-and-login.test.ts`)
- [X] T004 [US2] Failing integration test: one TOTP code / one recovery code sent on three challenges at once admits one (`backend/test/integration/mfa/second-factor-replay-parallel.test.ts`)
- [X] T005 [US1] Add `uqr`; `generateSecret` and `MfaEnrolmentService.setup` answer `qrSvg`; `mfaSetupResponseSchema` declares it
- [X] T006 [US1] Admin UI Account security renders the QR code; `en` / `pl` strings
- [X] T007 [US2] Conditional `UPDATE`s for the TOTP step and the recovery-code spend in `verifySecondFactor`
- [X] T008 README, changeset
