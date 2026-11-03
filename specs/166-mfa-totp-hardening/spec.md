# Feature Specification: TOTP hardening — a QR code at enrolment, and a replay guard that holds under parallel requests

**Feature Branch**: `mfa-crm-upstream` (spec directory `specs/166-mfa-totp-hardening/`)
**Created**: 2026-10-29
**Status**: Requested by the owner 2026-10-29
**Input**: owner request, 2026-10-29 — bring three two-factor improvements into `mfa`:

1. enrolment shows a QR code of the `otpauth://` URI next to the manual key;
2. a per-account limit on wrong second-factor codes (five failures in fifteen minutes answer 429);
3. replay protection — a TOTP code whose time step is at or before the last accepted step is refused.

Each item was checked against the module first; what already holds is recorded, not rebuilt
(see `research.md` R2 and R3).

## User Scenarios & Testing

### User Story 1 — Scan instead of type (Priority: P1)

An administrator turning two-factor authentication on in **Account security** sees a QR code
they can scan with an authenticator app, with the manual key and the `otpauth://` URI still
beside it for an app that cannot scan.

**Independent test**: `POST /api/v1/admin/account/mfa/setup` (and the customer
`/api/v1/account/mfa/setup`, and the set-up ticket's `begin`) answers `qrSvg`, an SVG document of
a QR code encoding exactly the `otpauthUri` of the same answer.

**Acceptance scenarios**

1. **Given** 2FA is enabled for the scope, **when** the account starts setup, **then** the answer
   carries `secret`, `otpauthUri` and `qrSvg`, and the Admin UI renders `qrSvg` as an image with a
   translated alternative text.
2. **Given** a label containing markup, **when** the QR code is drawn, **then** the SVG carries no
   script and no external reference (the label is only ever QR-encoded data).

### User Story 2 — One code, one sign-in (Priority: P1)

A code that has signed somebody in cannot sign anybody in again — not later, and not by being sent
at the same moment on a second challenge.

**Independent test**: three challenges for one account, the same valid TOTP code sent to all three
at once: exactly one answers 200, the others 401. The same for one recovery code.

**Acceptance scenarios**

1. **Given** a TOTP code was accepted, **when** the same code (or one of an earlier step) is
   presented again, **then** it is refused (already the behaviour before this feature).
2. **Given** two or more requests present the same valid TOTP code concurrently, **then** exactly
   one is accepted.
3. **Given** two or more requests present the same unused recovery code concurrently, **then**
   exactly one is accepted and the code is spent once.

### Edge cases

- A self-service confirmation (disable, regenerate recovery codes) goes through the same check, so
  the same guarantee holds there.
- The activation code also advances the accepted step, so the code that activated the enrolment
  cannot complete the next sign-in.

## Requirements

- **FR-001** The setup answer of every enrolment path MUST carry `qrSvg`: an SVG QR code of its
  `otpauthUri`, generated on the server.
- **FR-002** The Admin UI's Account security setup MUST show that QR code beside the manual key,
  with an alternative text in `en` and `pl`.
- **FR-003** A wrong second-factor code MUST count against a per-account limit that answers 429.
  *Already present* — see `research.md` R2; no change.
- **FR-004** A TOTP code whose time step is `<=` the enrolment's last accepted step MUST be refused,
  and the comparison and the advance of the step MUST be one atomic database statement.
- **FR-005** A recovery code MUST be spent by one atomic statement that only succeeds while the code
  is unused.

## Out of scope

- The Storefront's two setup screens (`/account/security`, `/login/setup`) keep showing the URI
  and the key; see `research.md` R4.
- No new setting and no change to the attempt budget or the throttle numbers.

## Success criteria

- **SC-001** The parallel tests of US2 pass repeatedly; before the change they admit more than one
  request.
- **SC-002** The setup answer's `qrSvg` is an SVG on every enrolment path.
