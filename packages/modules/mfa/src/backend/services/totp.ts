import { TOTP, Secret } from 'otpauth';
import { renderSVG } from 'uqr';

/**
 * TOTP helpers (feature 042) using the already-present `otpauth` dependency.
 * Same parameters as the platform's existing TOTP primitive
 * for authenticator-app compatibility (the `auth` re-export shim it used to
 * name was deleted once it had no importers).
 */
const ISSUER = 'B2B Platform';
const PERIOD = 30;
const DIGITS = 6;
const ALGORITHM = 'SHA1' as const;

/**
 * A new secret, the `otpauth://` URI an authenticator app enrols from, and a QR
 * code of that URI as an SVG document (`specs/166-mfa-totp-hardening/` FR-001,
 * research R1). The SVG is drawn here so no client needs an encoder of its own;
 * it is static markup — a rectangle and one path — with no script and no
 * external reference, and the label only ever reaches it as encoded data.
 */
export function generateSecret(accountLabel: string): {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
} {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });
  const otpauthUri = totp.toString();
  return { secret: secret.base32, otpauthUri, qrSvg: renderSVG(otpauthUri, { border: 2 }) };
}

/**
 * Verify a 6-digit code against a base32 secret. Returns the absolute TOTP
 * time-step that matched (for the replay guard), or null if invalid. Accepts
 * the ±1 step drift window.
 */
export function verifyTotpStep(secretBase32: string, code: string): number | null {
  const normalised = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalised)) return null;
  const totp = new TOTP({
    issuer: ISSUER,
    label: 'verify',
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: normalised, window: 1 });
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / PERIOD) + delta;
}
