import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { readEmitLayout } from '../../../scripts/lib/module-packages.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';
import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../../scripts/lib/workspace-packages.js';

/**
 * A package's `dist` holds what its current sources compile to, and nothing a
 * deleted source once compiled to (issue #443).
 *
 * ## The defect
 *
 * `tsc` writes and never deletes, and `dist/` is git-ignored, so the output of
 * a removed source survived every later `pnpm run build:packages` where no
 * `git status` could show it — while every runtime resolves a package there
 * (D-164). Two `price_lists` entities deleted upstream kept being exported by
 * the built package, and `test/unit/tenancy/classification-check.test.ts`
 * failed with *"package read 11 entity class(es), repository read 9"*.
 *
 * ## What is asserted
 *
 * The step itself, over trees this test builds: an orphan does not survive a
 * build rendered the way the generator renders it, a fresh `dist` is not an
 * error, and an `outDir` whose deletion would delete the package or its
 * sources is refused. Then the population: every workspace package under
 * `packages/` that compiles with `tsconfig.build.json` runs the clean as its
 * first step, over its own emit layout — the module packages because the
 * generator renders it, the others because this says so.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRoot(HERE);
const CLEAN = join(REPO_ROOT ?? '', 'scripts', 'clean-package-dist.mjs');
const TSC = join(REPO_ROOT ?? '', 'node_modules', '.bin', 'tsc');

const temporaryRoots: string[] = [];

function fixtureTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'package-dist-clean-'));
  temporaryRoots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  return root;
}

function runClean(cwd: string, args: readonly string[]): { code: number; out: string } {
  const result = spawnSync(process.execPath, [CLEAN, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe('a package build leaves no output of a deleted source (issue #443)', () => {
  describe('the clean step, over trees this test builds', () => {
    it('removes an orphan a previous build left, and the rebuild emits the live sources', () => {
      const root = fixtureTree({
        'src/live.ts': 'export const live = 1;\n',
        'tsconfig.build.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            rootDir: './src',
            outDir: './dist',
            declaration: true,
            noEmitOnError: true,
            skipLibCheck: true,
            types: [],
          },
          include: ['src'],
        }),
        // What a deleted `src/removed.entity.ts` leaves behind.
        'dist/removed.entity.js': 'export class Removed {}\n',
        'dist/removed.entity.d.ts': 'export declare class Removed {}\n',
        'dist/nested/gone.js': 'export {};\n',
      });
      // The command the generator renders, run the way pnpm runs it.
      const build = spawnSync(
        'sh',
        ['-c', `node ${CLEAN} --src src --out dist && ${TSC} -p tsconfig.build.json`],
        { cwd: root, encoding: 'utf8' },
      );
      expect(`${build.stdout}${build.stderr}`).toContain('[package-dist] cleaned: dist/ removed');
      expect(build.status).toBe(0);
      expect(existsSync(join(root, 'dist/removed.entity.js'))).toBe(false);
      expect(existsSync(join(root, 'dist/removed.entity.d.ts'))).toBe(false);
      expect(existsSync(join(root, 'dist/nested'))).toBe(false);
      expect(readFileSync(join(root, 'dist/live.js'), 'utf8')).toContain('live');
    });

    it('treats a package that was never built as clean, not as an error', () => {
      const root = fixtureTree({ 'src/a.ts': 'export {};\n' });
      const { code, out } = runClean(root, ['--src', 'src', '--out', 'dist']);
      expect(out).toContain('[package-dist] cleaned: dist/ absent');
      expect(code).toBe(0);
    });

    it.each([
      ['the package directory itself', '.'],
      ['a directory outside the package', '../elsewhere'],
      ['the source root', 'src'],
      ['a directory inside the source root', 'src/out'],
    ])('refuses to delete %s', (_label, out) => {
      const root = fixtureTree({ 'src/a.ts': 'export {};\n', 'dist/a.js': 'export {};\n' });
      const { code, out: text } = runClean(root, ['--src', 'src', '--out', out]);
      expect(text).toContain('refusing to delete');
      expect(code).toBe(2);
      expect(existsSync(join(root, 'src/a.ts'))).toBe(true);
      expect(existsSync(join(root, 'dist/a.js'))).toBe(true);
    });

    it('refuses an outDir that contains the source root', () => {
      const root = fixtureTree({ 'lib/src/a.ts': 'export {};\n' });
      const { code } = runClean(root, ['--src', 'lib/src', '--out', 'lib']);
      expect(code).toBe(2);
      expect(existsSync(join(root, 'lib/src/a.ts'))).toBe(true);
    });

    it('refuses to guess a layout it was not given', () => {
      const root = fixtureTree({ 'dist/a.js': 'export {};\n' });
      expect(runClean(root, ['--out', 'dist']).code).toBe(2);
      expect(existsSync(join(root, 'dist/a.js'))).toBe(true);
    });
  });

  describe('every package under packages/ in this checkout', () => {
    it('cleans its own emit directory as the first step of its build', () => {
      expect(REPO_ROOT).not.toBeNull();
      const workspaceFs = nodeWorkspaceFs();
      const manifestFs = nodeManifestFs();
      const packagesRoot = join(REPO_ROOT!, 'packages');
      let checked = 0;
      for (const member of workspaceMembers(REPO_ROOT!, workspaceFs)) {
        if (relative(packagesRoot, member.dir).startsWith('..')) continue;
        const text = workspaceFs.readText(join(member.dir, 'package.json'));
        if (text === null) continue;
        const build = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts?.['build'];
        if (build === undefined || !build.includes('tsc -p tsconfig.build.json')) continue;
        const emit = readEmitLayout(member.dir, member.name, manifestFs);
        expect(emit, `${member.name}: no tsconfig.build.json`).not.toBeNull();
        const prefix = relative(member.dir, REPO_ROOT!);
        expect(
          build.startsWith(
            `node ${prefix}/scripts/clean-package-dist.mjs ` +
              `--src ${emit!.rootDir || '.'} --out ${emit!.outDir || '.'} && `,
          ),
          `${member.name}: build is '${build}'. A module package's script is rendered by ` +
            '`pnpm --filter backend run manifests:generate`; any other package names the ' +
            'clean by hand, before its first compile.',
        ).toBe(true);
        checked += 1;
      }
      // Not vacuous: module packages and the hand-written ones both count.
      expect(checked).toBeGreaterThan(13);
    });
  });
});
