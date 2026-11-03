import { readFileSync } from 'node:fs';

/**
 * Which Endora Commerce release this instance runs, for the feedback payload's
 * `platformVersion` and the relay request's `user-agent`.
 *
 * **Read from this package's own manifest, not from the platform's
 * `PLATFORM_VERSION`.** That constant answers `GET /api/v1/admin/platform-info`,
 * but it is not on any barrel a module may name (`./http` publishes what a
 * module raises, not the platform's identity), and reaching into the platform
 * package's file or manifest would be a `host-internal-subpath`. It also does
 * not need to be: releases are lockstep — one `fixed` changesets group over
 * `@endora-commerce/*` — so this package's version **is** the release, read the
 * same way the platform reads its own.
 *
 * `src/backend/` and `dist/backend/` sit at the same depth, so
 * `../../package.json` is this package's manifest from the source tree and from
 * the published artefact alike; npm always ships `package.json`.
 */

/** `MAJOR.MINOR.PATCH`, optionally with a pre-release or build suffix. */
const RELEASE_NUMBER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/** The placeholder an unreleased manifest carries: it has a release's shape and is not one. */
const UNRELEASED = '0.0.0';

/** `null` when the manifest cannot be read or carries no release number. */
export function readPlatformRelease(
  manifest: URL = new URL('../../package.json', import.meta.url),
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string') return null;
  if (version === UNRELEASED || !RELEASE_NUMBER.test(version)) return null;
  return version;
}
