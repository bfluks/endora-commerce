import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * `scripts/lib/module-root.sh` over a population of **more than one** (issue
 * #315).
 *
 * The shell fixture every check test shares registers one module, and a list of
 * one carries no newline — which is the one input BSD awk refuses in a `-v`
 * assignment (`awk: newline in string`). On macOS that refusal turned
 * `check:language` into a pass over a single directory and `check:naming` into
 * a red on an unmodified tree, while every fixture stayed green. So each case
 * here hands the library two of what it lists: two registered modules, two
 * nested checkouts.
 */

const MODULE_ROOT_SH = fileURLToPath(new URL('../../../../scripts/lib/module-root.sh', import.meta.url));

let repo: string | null = null;

afterEach(() => {
  if (repo !== null) rmSync(repo, { recursive: true, force: true });
  repo = null;
});

function write(path: string, content: string): void {
  const target = join(repo!, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(): void {
  repo = mkdtempSync(join(tmpdir(), 'module-root-sh-'));
  write('backend/package.json', '{}\n');
  write(
    'backend/src/manifest-index.generated.ts',
    [
      'export const DISCOVERED_MANIFESTS = [',
      "  { id: 'orders', manifest: manifest0 },",
      "  { id: 'blog', manifest: manifest1 },",
      '];',
      '',
    ].join('\n'),
  );
  write('backend/src/modules/orders/manifest.ts', "export const manifest = { id: 'orders' };\n");
  write('backend/src/modules/blog/manifest.ts', "export const manifest = { id: 'blog' };\n");
}

function moduleRoot(snippet: string): string {
  return execFileSync('bash', ['-c', `source "${MODULE_ROOT_SH}"\n${snippet}`], {
    cwd: repo!,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('module-root.sh over more than one entry', () => {
  it('resolves every registered module directory, not the first or none', () => {
    fixture();
    expect(
      moduleRoot('module_root_module_directories backend/src/manifest-index.generated.ts')
        .trim()
        .split('\n'),
    ).toEqual(['backend/src/modules/blog', 'backend/src/modules/orders']);
  });

  it('drops the paths of every nested checkout, not only a lone one', () => {
    fixture();
    mkdirSync(join(repo!, 'vendor/one/.git'), { recursive: true });
    mkdirSync(join(repo!, 'vendor/two/.git'), { recursive: true });
    expect(
      moduleRoot(
        "printf 'vendor/one/a.ts\\nvendor/two/b.ts\\nbackend/src/c.ts\\n' | module_root_drop_nested_checkouts",
      ).trim(),
    ).toBe('backend/src/c.ts');
  });
});
