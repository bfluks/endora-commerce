/**
 * Setup file — points `TMPDIR` at the real path of the temp directory, for this
 * worker and every child it spawns (issue #315).
 *
 * macOS's `os.tmpdir()` sits under `/var`, a symlink to `/private/var`, and Node
 * resolves an entry module's real path: a check script copied into a temp
 * directory and spawned there compared `/private/var/…` against
 * `process.argv[1]`'s `/var/…`, failed its own main guard and exited 0 having
 * read nothing. Eleven test files went red on a Mac and green on Linux, where
 * the two spellings are one. `os.tmpdir()` reads `TMPDIR` on every call, so
 * setting it once here is enough. The proof is
 * `test/unit/harness/realpath-tmpdir.test.ts`.
 */
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env['TMPDIR'] = realpathSync(tmpdir());
