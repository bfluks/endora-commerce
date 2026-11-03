# Implementation Plan: TOTP hardening

**Branch**: `mfa-crm-upstream` | **Date**: 2026-10-29 | **Spec**: `specs/166-mfa-totp-hardening/spec.md`

## Summary

The `mfa` setup answer gains `qrSvg`, a QR code of `otpauthUri` drawn on the server with `uqr`, and
the Admin UI's Account security shows it. The TOTP replay guard and the recovery-code spend become
single conditional `UPDATE`s, so a code admits one sign-in even when sent on several challenges at
once. The per-account limit on wrong codes already exists and is left as it is (`research.md` R2).

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing `otpauth`, MikroORM; new `uqr` (R1)
**Storage**: PostgreSQL `mfa_enrolments.last_accepted_step`, `mfa_recovery_codes.used_at` — both exist; no migration
**Testing**: vitest — a co-located unit test in `packages/modules/mfa`, integration tests in `backend/test/integration/mfa/`
**Scope**: `packages/modules/mfa`, `packages/contracts` (`mfaSetupResponseSchema`), `backend/package.json`

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I Modular | All changes inside `mfa`, plus its contract schema. |
| II API-first | `mfaSetupResponseSchema` gains `qrSvg` first; additive. |
| III TDD | Unit test for the QR answer and integration tests for the parallel guard written first and seen red. |
| IV Minimal dependencies | One new runtime dependency, justified below and in `research.md` R1. |
| VI Naming / VIII English | Followed. |
| IX UI reuse | The Admin UI uses the existing card and an `<img>`; no new primitive. |
| XI Tenancy | `mfa_enrolments` / `mfa_recovery_codes` are global entities; the updates name the row's id. |
| XIII Command Bus | Unchanged: second-factor verification is auth-flow bookkeeping, already marked `command-coverage-ignore`. |
| XVII Toggleable | No new route, worker or surface. |
| i18n | The new admin strings ship in `en` and `pl` through the module bundle. |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Runtime dependency `uqr` | Scanning a QR code is how authenticator apps enrol; the stack has no QR encoder. | Hand-writing an encoder (Reed–Solomon, masking, version/format info) is code nobody should own; `qrcode` carries transitive dependencies; a client-side encoder duplicates the dependency per client; a remote QR service leaks the secret. |
