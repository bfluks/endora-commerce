/**
 * What a packed tarball holds, read off disk — the half of the pack gate that
 * touches `tar`, kept apart from the judgement in `pack-assert.ts`, which takes
 * no child process and no filesystem.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { PackedEntry } from './pack-assert.js';

/**
 * Every file under the tarball's `package/`, with its size, `package/`
 * stripped — or `null` when the tarball could not be read or holds nothing.
 *
 * **Extracted into `into` and walked, not listed** (issue #315). The listing
 * used to parse `tar -tzvf` columns, and only GNU tar prints the ones it
 * expected: bsdtar, which is macOS's `tar`, prints `mode links owner group size
 * month day time path`, so no line matched, every tarball listed as empty and
 * every package came back `no-compiled-code`. `tar -xzf` means the same thing
 * to both, and the sizes are then the filesystem's rather than a column's.
 *
 * Zero files is `null` and not an empty list: `pnpm pack` always writes a
 * `package.json`, so a tarball with nothing in it is a listing that failed,
 * and handing the judgement an empty package would report a verdict about the
 * reader rather than about the package.
 */
export function listTarball(tarball: string, into: string): readonly PackedEntry[] | null {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const extracted = spawnSync('tar', ['-xzf', tarball, '-C', into], { encoding: 'utf8' });
  if (extracted.status !== 0) return null;
  const root = join(into, 'package');
  let found;
  try {
    found = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {
    return null;
  }
  const entries: PackedEntry[] = [];
  for (const entry of found) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    entries.push({ path: relative(root, file).split(sep).join('/'), size: statSync(file).size });
  }
  return entries.length === 0 ? null : entries;
}
