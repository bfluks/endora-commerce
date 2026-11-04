# Research: TOTP hardening (166)

## R1 — Drawing the QR code: `uqr`, on the server

**Decision**: add `uqr` `^0.1.3` (MIT, no runtime dependencies, ~84 kB installed, ESM + CJS with its own
types, in the unjs organisation; 0.1.3 published 2026-04-03) and draw the code on the server with `renderSVG(otpauthUri, { border: 2 })`.
The setup answer carries the SVG as a string.

**Why a dependency at all**: the stack has no QR encoder. A QR code is Reed–Solomon error
correction, eight mask patterns with their penalty scoring, version and format information — a few
hundred lines that are easy to get subtly wrong and that nobody here should own.

**Why on the server**: the secret already exists only on the server and in this one answer, and
every consumer — the Admin UI, the Storefront, a third-party client — gets the code without
pulling an encoder into its own bundle. The SVG is about 20–25 kB for a typical URI; it is answered
once per setup.

**Alternatives rejected**

- `qrcode` (node-qrcode): larger, with transitive dependencies (`pngjs`, `dijkstrajs`, `yargs` for
  its CLI); its SVG path is one output among several we do not need.
- Rendering on the client from `otpauthUri`: puts an encoder into the Admin UI bundle and into every
  other client separately, which is the same dependency several times.
- A remote QR image service: sends the TOTP secret to a third party. Refused outright.

**Cost**: one runtime dependency of the `mfa` package (a peer, declared by `backend`), pinned by the
lockfile; its output is static markup with no script, checked by a unit test, and rendered in the
Admin UI as an `<img>` data URI, so it is never inserted into the DOM as HTML.

## R2 — Per-account limit on second-factor codes: already present

The brief asked for "five failures per fifteen minutes → 429". `mfa` already has two layers that
together are stricter, and both answer 429:

- **Per challenge**: `ChallengeStore.takeAttempt` — a budget of five codes per pending sign-in,
  taken atomically before the code is checked; the challenge is burned after it
  (`MFA_TOO_MANY_ATTEMPTS`). Covered by `backend/test/integration/mfa/challenge-budget-parallel.test.ts`.
- **Per account**: `createSecondFactorVerifier` runs every code — the sign-in second step and the
  self-service confirmations alike — inside the account owner's `AuthenticationAttemptThrottle`
  (`admin_users` / `customer_accounts`), keyed by the account id: five failures per origin (or known
  device) and twenty per account within thirty minutes start a delay of one minute doubling to
  fifteen (`ADMIN_` / `CUSTOMER_AUTHENTICATION_THROTTLED`). A new challenge does not reset it.

Nothing is added. Adding a third counter would be a second mechanism for one rule.

## R3 — Replay protection: present, but not atomic

`MfaEnrolment.lastAcceptedStep` exists since feature 042 and `verifySecondFactor` refuses a step
`<=` it. The check was *read, compare, write back*: two requests carrying the same code at the same
moment both read the old step and both pass. The throttle of R2 does not prevent it — it admits up
to its threshold of attempts in parallel by design. The recovery-code path had the same shape
(`findOne` where `usedAt is null`, then set `usedAt`).

**Decision**: make each guard one conditional `UPDATE`:

- TOTP: `update mfa_enrolments set last_accepted_step = :step where id = :id and status = 'active'
  and (last_accepted_step is null or last_accepted_step < :step)`; accepted only when one row moved.
- Recovery code: `update mfa_recovery_codes set used_at = now() where enrolment_id = :id and
  code_hash = :hash and used_at is null`; accepted only when one row moved.

No schema change: the column and its type are unchanged, so there is no migration.

## R4 — The Storefront's setup screens: not in this feature

Both Storefront flows hand the setup from a server action to the page through a cookie
(`storefront/lib/session.ts`, `setMfaSetupCookie` / the set-up ticket cookie). A cookie holds about
4 kB; the SVG is five times that. Showing the code there means changing that hand-off (or drawing
the code in the Storefront from the URI, which is R1's rejected alternative). The API already
answers `qrSvg` on both customer paths, so the Storefront change is a follow-up of its own.
