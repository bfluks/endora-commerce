#!/usr/bin/env node
/**
 * First step of every workspace package's `build`: delete the package's emit
 * directory before `tsc` writes into it (issue #443).
 *
 *     node ../../scripts/clean-package-dist.mjs --src src --out dist && tsc -p tsconfig.build.json
 *
 * Run from the package directory. `--src` and `--out` are the package's own
 * `rootDir` and `outDir` from its `tsconfig.build.json` — for a module package
 * the manifest generator renders them, the same derivation that produces the
 * `exports` targets and `copy-package-assets.mjs`'s flags (D-100).
 *
 * ## Why the step exists
 *
 * `tsc` writes what the current sources compile to and deletes nothing, so the
 * output of a deleted source survives every later build. `dist/` is
 * git-ignored and every runtime resolves a package there (D-164), so the
 * orphan is invisible to `git status` and fully visible to the code: two
 * removed `price_lists` entities kept being exported by the built package and
 * `classification-check.test.ts` counted 11 entity classes against the
 * repository's 9. A clean before the compile makes `dist` a function of the
 * current sources and of nothing that happened before.
 *
 * ## Why a full clean and not a prune of orphaned outputs
 *
 * No package builds incrementally (no `incremental`, no `composite`, no
 * `.tsbuildinfo` anywhere in the tree), so every build already recompiles the
 * whole program and deleting the directory first costs nothing measurable. A
 * prune would have to know every writer of `dist`: `tsc` under two
 * configurations, `copy-package-assets.mjs`, the CLI's release index and
 * storefront reference, a Tailwind stylesheet. A rule that guessed which file
 * came from which writer would be the next place an orphan survives; a clean
 * has no such rule. The second `tsc` of a package with a UI layer writes into
 * the same `dist`, which is why this runs once, before the first compile, and
 * never between the two.
 *
 * The cost is that a compile which fails leaves no `dist` at all instead of the
 * previous one. That is `noEmitOnError`'s own rule (feature 080, R11) carried
 * one step further: a build that failed ships nothing.
 *
 * ## What it refuses, and why
 *
 * Exit 2 — usage, or an `--out` this step must never delete: the package
 * directory itself, anything outside it, or a directory that is, contains or
 * sits inside `--src`. An `outDir` of `.` is expressible in a
 * `tsconfig.build.json` and the generator renders it as `--out .`; deleting it
 * would delete the package.
 */

import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const PREFIX = '[package-dist]';

/** `--name value`, or `null` when the flag is absent. */
function flag(argv, name) {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = argv[at + 1];
  return value === undefined || value.startsWith('--') ? null : value;
}

/** True when `inner` is `outer` or sits below it. */
function within(outer, inner) {
  const path = relative(outer, inner);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function main(argv, cwd = process.cwd()) {
  const src = flag(argv, 'src');
  const out = flag(argv, 'out');
  if (src === null || out === null) {
    process.stderr.write(
      `${PREFIX} usage: node scripts/clean-package-dist.mjs --src <rootDir> --out <outDir>\n` +
        `Both are the package's own emit layout from its tsconfig.build.json; this step does ` +
        `not guess them, because a guessed outDir deletes something nothing rebuilds.\n`,
    );
    return 2;
  }

  const packageRoot = resolve(cwd);
  const srcRoot = resolve(packageRoot, src);
  const outRoot = resolve(packageRoot, out);

  if (outRoot === packageRoot || !within(packageRoot, outRoot)) {
    process.stderr.write(
      `${PREFIX} refusing to delete ${out}: an emit directory must sit strictly inside the ` +
        `package directory (${packageRoot}). An outDir of '.' or one outside the package ` +
        `cannot be cleaned before a build — give the package a dedicated outDir.\n`,
    );
    return 2;
  }
  if (within(srcRoot, outRoot) || within(outRoot, srcRoot)) {
    process.stderr.write(
      `${PREFIX} refusing to delete ${out}: it overlaps the source root ${src}, so cleaning ` +
        `it would delete sources.\n`,
    );
    return 2;
  }

  const existed = existsSync(outRoot);
  rmSync(outRoot, { recursive: true, force: true });
  process.stdout.write(`${PREFIX} cleaned: ${out}/ ${existed ? 'removed' : 'absent'}\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
