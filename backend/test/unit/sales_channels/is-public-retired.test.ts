import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #492 — the sales channel `isPublic` flag is retired in favour of the
 * pricing display-mode chain (`pricing.unauthenticated_display_mode = none` is
 * the per-channel "hide prices until sign-in").
 *
 * The flag withheld prices from **everyone** on a channel, signed-in buyers
 * included, and a second switch beside the display-mode chain is exactly what
 * made that hard to see. So the guard is that nothing reads it any more: no
 * identifier `isPublic` and no column `is_public` anywhere in the code, the
 * applications or the tests — the compiler catches a property read, and this
 * catches a raw SQL statement or a fixture naming the dropped column, which it
 * cannot.
 *
 * Allowed: the platform's migration history (the column is created in the
 * foundation migration and dropped by `…CoreSalesChannelsRetireIsPublic`), and
 * the tests of that migration, which recreate the column to have something to
 * migrate.
 */
const REPO = resolve(import.meta.dirname, '../../../..');

const ROOTS = ['packages', 'backend/src', 'backend/scripts', 'backend/test', 'admin/src', 'admin/test', 'storefront'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

const ALLOWED: readonly string[] = [
  'packages/platform/src/migrations/',
  'backend/test/helpers/retire-is-public-migration.ts',
  'backend/test/integration/sales_channels/retire-is-public-migration.test.ts',
  'backend/test/unit/sales_channels/is-public-retired.test.ts',
];

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|sql)$/;

const PATTERN = /\bisPublic\b|\bis_public\b/;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
}

describe('sales channel isPublic is retired (#492)', () => {
  it('no source file outside the migration history names `isPublic` or `is_public`', () => {
    const files: string[] = [];
    for (const root of ROOTS) walk(join(REPO, root), files);
    expect(files.length).toBeGreaterThan(1000);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO, file).split(sep).join('/');
      if (ALLOWED.some((allowed) => rel === allowed || (allowed.endsWith('/') && rel.startsWith(allowed)))) {
        continue;
      }
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (PATTERN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the entity carries no `isPublic`', () => {
    // The cached shape is held to its exact key list in the platform's own
    // `sales-channels-cache.test.ts`.
    const channel = new SalesChannel();
    channel.code = 'probe';
    channel.name = { en: 'Probe' };
    channel.defaultLanguage = 'en';
    channel.defaultCurrency = 'PLN';
    expect(Object.keys(channel)).not.toContain('isPublic');
  });
});
