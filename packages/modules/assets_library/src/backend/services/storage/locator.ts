// Pure helper: shard the asset UUID into a directory path of the form
// `<aa>/<bb>/<assetId>.<ext>` so neither the local-FS leaf directories nor
// the cloud bucket key space ever bunches up. See research.md R5.

import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';

export function computeLocator(input: { assetId: string; originalFilename: string }): string {
  const id = input.assetId.toLowerCase();
  if (id.length < 4) {
    throw new Error(`computeLocator: assetId too short ("${input.assetId}")`);
  }
  const aa = id.slice(0, 2);
  const bb = id.slice(2, 4);
  const rawExt = extname(input.originalFilename).slice(1);
  const ext = rawExt.length > 0 ? rawExt : 'bin';
  return `${aa}/${bb}/${id}.${ext}`;
}

/**
 * The extension a key the platform invents may carry: the filename's extension
 * lower-cased when it is 1–10 characters of `[a-z0-9]`, `bin` otherwise. A
 * filename is uploader-supplied text, so nothing else of it reaches a key.
 * Stable keys keep `computeLocator`'s original rule.
 */
export function safeKeyExtension(filename: string): string {
  const ext = extname(filename).slice(1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin';
}

/**
 * A staging or previous-version key beside a stable key:
 * `<dir>/<assetId>.<tag>-<32 hex>.<ext>` (specs/156-asset-stable-url/
 * contracts/storage-and-retention.md §1). The random part is 128 bits drawn
 * fresh, never derived from anything public, so the key cannot be guessed; the
 * basename still starts with the asset id, so `parseAssetIdFromLocator` holds.
 */
export function siblingLocator(
  stableLocator: string,
  tag: 'stage' | 'prev',
  filename: string,
  random: () => string = () => randomBytes(16).toString('hex'),
): string {
  const slash = stableLocator.lastIndexOf('/');
  const dir = slash >= 0 ? stableLocator.slice(0, slash + 1) : '';
  const base = stableLocator.slice(slash + 1);
  const dot = base.indexOf('.');
  const assetId = dot >= 0 ? base.slice(0, dot) : base;
  return `${dir}${assetId}.${tag}-${random()}.${safeKeyExtension(filename)}`;
}
