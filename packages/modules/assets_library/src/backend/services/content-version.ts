import { randomBytes } from 'node:crypto';

/**
 * A fresh content version — the identity of the bytes an asset holds
 * (`specs/156-asset-stable-url/research.md` R-7). Twelve lower-case hex
 * characters from six random bytes. It is public (it appears in `?v=` and in
 * the ETag), so no storage key is ever derived from it.
 */
export function newContentVersion(): string {
  return randomBytes(6).toString('hex');
}
