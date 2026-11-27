import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Feature 164 (SC-004, FR-010) — no Admin UI layout preference lives in the
 * browser any more. Pins, folded groups, rail mode and page sizes are the
 * server's; the only source that may still name the three legacy
 * `localStorage` keys is the one-time carry-over that reads and removes them.
 *
 * A source scan, so that the rule covers every list and every shell surface,
 * not only the paths a behavioural test drives.
 */

const REPO = resolve(__dirname, '../../..');
const ALLOWED = new Set(['packages/admin-kit/src/lib/admin-preferences/legacy-carry-over.ts']);
const LEGACY_KEY = /b2b-admin\.nav\.|b2b-admin\.page-size/;
const SOURCE = /\.(ts|tsx|js|jsx)$/;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist') return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : SOURCE.test(entry) ? [path] : [];
  });
}

function roots(): string[] {
  const modules = join(REPO, 'packages/modules');
  return [
    join(REPO, 'packages/admin-kit/src'),
    join(REPO, 'packages/admin-shell/src'),
    join(REPO, 'admin/src'),
    ...readdirSync(modules).map((id) => join(modules, id, 'src/admin')),
  ];
}

describe('no Admin UI layout preference is kept in browser storage (SC-004)', () => {
  it('the scanned roots hold source files', () => {
    expect(roots().flatMap(filesUnder).length).toBeGreaterThan(100);
  });

  it('no source names a legacy key except the carry-over', () => {
    const offenders = roots()
      .flatMap(filesUnder)
      .map((file) => relative(REPO, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => LEGACY_KEY.test(readFileSync(join(REPO, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the carry-over itself exists, so the allow-list names a real file', () => {
    for (const file of ALLOWED) expect(existsSync(join(REPO, file))).toBe(true);
  });
});
