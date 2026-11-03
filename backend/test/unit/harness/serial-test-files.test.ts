/**
 * `test/serial-test-files.ts` is a declared list, so it is held in both
 * directions, in the manner of the service-dependent ledger:
 *
 *   - every entry matches at least one file — a stale entry would quietly keep
 *     nothing serial while reading as if it did;
 *   - every contract, integration or perf file that meets one of the declared
 *     rules is covered — a new file that queries the shared Meilisearch instance
 *     or spawns a lifecycle CLI cannot land in the parallel project unnoticed.
 *
 * Service-free: it reads files and nothing else.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  matchesSerialPattern,
  SERIAL_RULES,
  SERIAL_TEST_FILES,
} from '../../serial-test-files.js';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The roots the rules are judged over: the complete suite's service-bound files. */
const RULE_ROOTS = ['test/contract', 'test/integration', 'test/perf'] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(test|bench|perf)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

function backendFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => walk(join(BACKEND_ROOT, root))).map((file) =>
    relative(BACKEND_ROOT, file).split('\\').join('/'),
  );
}

const ALL_TEST_FILES = backendFiles(['test', 'src']);

function covered(path: string): boolean {
  return SERIAL_TEST_FILES.some((entry) => matchesSerialPattern(path, entry.pattern));
}

describe('the serial test list', () => {
  it('has entries, each an exact path or a directory followed by /**', () => {
    expect(SERIAL_TEST_FILES.length).toBeGreaterThan(0);
    for (const { pattern, reason } of SERIAL_TEST_FILES) {
      expect(pattern, 'a glob the prefix matcher cannot read').toMatch(/^[\w./-]+(\/\*\*)?$/);
      expect(reason.length, `${pattern} carries no reason`).toBeGreaterThan(20);
    }
  });

  it('names no entry that matches nothing', () => {
    const stale = SERIAL_TEST_FILES.filter(
      (entry) => !ALL_TEST_FILES.some((file) => matchesSerialPattern(file, entry.pattern)),
    ).map((entry) => entry.pattern);
    expect(stale, 'these serial entries match no test file — delete them').toEqual([]);
  });

  it('covers every service-bound file that meets one of its rules', () => {
    const files = backendFiles(RULE_ROOTS);
    expect(files.length, 'the rule roots hold no test files — the walk is wrong').toBeGreaterThan(
      100,
    );
    const missing: string[] = [];
    for (const file of files) {
      if (covered(file)) continue;
      const source = readFileSync(join(BACKEND_ROOT, file), 'utf8');
      for (const rule of SERIAL_RULES) {
        if (rule.test.test(source)) missing.push(`${file} — ${rule.name}`);
      }
    }
    expect(
      missing,
      'these files lean on something every worker shares but run in the parallel project. ' +
        'Add them to test/serial-test-files.ts with a reason, or stop them leaning on it.',
    ).toEqual([]);
  });

  it('matches by directory prefix and by exact path, and nothing looser', () => {
    expect(matchesSerialPattern('test/integration/search/a.test.ts', 'test/integration/search/**'))
      .toBe(true);
    expect(matchesSerialPattern('test/integration/searchx/a.test.ts', 'test/integration/search/**'))
      .toBe(false);
    expect(matchesSerialPattern('test/a.test.ts', 'test/a.test.ts')).toBe(true);
    expect(matchesSerialPattern('test/ab.test.ts', 'test/a.test.ts')).toBe(false);
  });
});
