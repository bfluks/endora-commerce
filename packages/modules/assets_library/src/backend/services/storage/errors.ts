// Adapter-side error classes — the upload pipeline / resolveUrl path map these
// onto the platform's standard HTTP error envelope codes (see contracts/
// assets-library-admin-http.contract.md).

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
  constructor(message: string) {
    super(message);
  }
}

export class BackendUnavailableError extends Error {
  override readonly name = 'BackendUnavailableError';
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class LocatorMissingError extends Error {
  override readonly name = 'LocatorMissingError';
  constructor(message: string) {
    super(message);
  }
}

export class LegacyAssetCannotHardenError extends Error {
  override readonly name = 'LegacyAssetCannotHardenError';
  constructor() {
    super(
      'Cannot mark a `legacy` (pre-013 absolute-URL) asset as private — re-upload it through the active adapter first.',
    );
  }
}

/**
 * True when a storage error says the object is already gone — local `ENOENT`,
 * a GCS `404`, an S3 `NoSuchKey` — on the error itself or on its `cause`. The
 * cleanup pass treats that answer as success; `delete` itself keeps throwing
 * on it (specs/156-asset-stable-url/contracts/storage-and-retention.md §1).
 */
export function isObjectNotFound(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const e = current as { code?: unknown; name?: unknown; Code?: unknown; cause?: unknown };
    if (e.code === 'ENOENT' || e.code === 404 || e.code === '404') return true;
    if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') return true;
    current = e.cause;
  }
  return false;
}
