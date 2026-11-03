/**
 * A temp directory a test hands out is spelled the way Node resolves it
 * (issue #315).
 *
 * On macOS `os.tmpdir()` is under `/var/folders/…`, and `/var` is a symlink to
 * `/private/var`. Node resolves an entry module's real path, so a script copied
 * into a temp directory and spawned sees `import.meta.url` under
 * `/private/var/…` while `process.argv[1]` still says `/var/…`. The main guard
 * every `backend/scripts/check-*.ts` carries compares the two, came out false,
 * and the script exited 0 having done nothing — a red proof that could not go
 * red. Tests that compare a path a script resolved against the one they built
 * failed the same way. `test/realpath-tmpdir-setup.ts` points `TMPDIR` at the
 * real path once, so every temp directory, and every child spawned in one,
 * agrees with Node. On Linux the two spellings are already the same.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('the temp directory the suite runs in', () => {
  it('is already its own real path', () => {
    expect(tmpdir()).toBe(realpathSync(tmpdir()));
  });

  it('lets a script copied into it pass the main guard the check scripts use', () => {
    const dir = mkdtempSync(join(tmpdir(), 'realpath-tmpdir-'));
    try {
      const script = join(dir, 'guard.mjs');
      writeFileSync(
        script,
        "import { pathToFileURL } from 'node:url';\n" +
          'console.log(String(import.meta.url === pathToFileURL(process.argv[1]).href));\n',
      );
      const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
      expect(run.stdout.trim()).toBe('true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
