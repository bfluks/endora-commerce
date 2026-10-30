/**
 * How many vitest workers the complete backend suite runs, and how each one
 * finds its own database and Redis logical database.
 *
 * The complete suite ran one file at a time for as long as every file shared
 * one database that each booting file truncates. Since issue #189 a run owns
 * its database; this goes one step further and gives every **worker** of the
 * run its own, so files can run side by side without racing on that truncate.
 *
 *   - `BACKEND_TEST_WORKERS` decides the count. Unset, it is
 *     {@link LOCAL_DEFAULT_TEST_WORKERS} on a developer machine and **1** when
 *     `CI` is set: the CI runner is a shared 4 vCPU host whose memory budget is
 *     measured for one fork per job (`.gitlab-ci.yml`, the Memory block above
 *     `test:backend`), so parallelism there is a decision for that host and not
 *     a default inherited from a laptop.
 *   - A run that shares one database on purpose — `BACKEND_TEST_ISOLATION=shared`
 *     or `ALLOW_NON_TEST_DATABASE_URL` — is one worker, because there is nothing
 *     to give a second worker. Asking for more there is refused, not ignored.
 *   - `test/global-setup.ts` provisions worker 1 as the run's own database (the
 *     #189 lease, unchanged) and clones one more per extra worker from the same
 *     migrated template, with one more leased Redis index each. It publishes
 *     the list in {@link WORKER_SERVICES_ENV}.
 *   - `test/worker-services-setup.ts`, the first setup file, points
 *     `DATABASE_URL` and `REDIS_URL` at the entry for `VITEST_POOL_ID` before
 *     anything in the file under test is imported — and a CLI a test spawns
 *     inherits them, as it inherited the run's before.
 *
 * Measured on a 16-thread machine against the fsync-off test Postgres
 * (`pnpm run dev:infra:test`): `test/contract/carts` plus
 * `test/integration/orders`, 71 files, took 648 s serially, 170 s at six
 * workers and 162 s at twelve. Six is where the curve flattens, which is why it
 * is the default rather than the thread count.
 *
 * This file is imported by the vitest config (to size the pool) and by the
 * global setup (to size the provisioning), so both answer from one function and
 * cannot disagree. It reads only the environment.
 */

/** The variable a developer sets to choose the worker count. */
export const TEST_WORKERS_ENV = 'BACKEND_TEST_WORKERS';

/** The local default. See the measurement in the header. */
export const LOCAL_DEFAULT_TEST_WORKERS = 6;

/**
 * Where the global setup publishes each worker's services: a JSON array, index
 * `VITEST_POOL_ID - 1`. Absent on a one-worker run, which keeps the run's own
 * `DATABASE_URL` and `REDIS_URL` exactly as the lease wrote them.
 */
export const WORKER_SERVICES_ENV = 'BACKEND_TEST_WORKER_SERVICES';

/** What one worker connects to. */
export interface WorkerServices {
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

export function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env['CI'];
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** Whether this run shares one database on purpose, in the lease's own two senses. */
function sharesOneDatabase(env: NodeJS.ProcessEnv): boolean {
  return env['BACKEND_TEST_ISOLATION'] === 'shared' || Boolean(env['ALLOW_NON_TEST_DATABASE_URL']);
}

/**
 * The worker count for the complete suite.
 *
 * Throws on a value that is not a positive integer, and on more than one worker
 * for a run that shares one database — both are a command line that cannot
 * mean what it says, and a run that quietly did something else would be
 * measured as if it had not.
 */
export function backendTestWorkers(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TEST_WORKERS_ENV]?.trim();
  if (raw !== undefined && raw !== '') {
    if (!/^[1-9]\d*$/.test(raw)) {
      throw new Error(`${TEST_WORKERS_ENV}="${raw}" is not a positive integer.`);
    }
    const requested = Number.parseInt(raw, 10);
    if (requested > 1 && sharesOneDatabase(env)) {
      throw new Error(
        `${TEST_WORKERS_ENV}=${requested} asks for parallel workers, but this run shares one ` +
          `database (BACKEND_TEST_ISOLATION=shared or ALLOW_NON_TEST_DATABASE_URL), so every ` +
          `worker would truncate the others' fixtures. Use ${TEST_WORKERS_ENV}=1.`,
      );
    }
    return requested;
  }
  if (isCi(env) || sharesOneDatabase(env)) return 1;
  return LOCAL_DEFAULT_TEST_WORKERS;
}

/** Parse what the global setup published; `undefined` on a one-worker run. */
export function publishedWorkerServices(
  env: NodeJS.ProcessEnv = process.env,
): readonly WorkerServices[] | undefined {
  const raw = env[WORKER_SERVICES_ENV];
  if (raw === undefined || raw === '') return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as WorkerServices).databaseUrl !== 'string' ||
        typeof (entry as WorkerServices).redisUrl !== 'string',
    )
  ) {
    throw new Error(`${WORKER_SERVICES_ENV} is not a list of { databaseUrl, redisUrl }.`);
  }
  return parsed as WorkerServices[];
}

/**
 * The services the worker with this `VITEST_POOL_ID` owns, or `undefined` when
 * the run published none (one worker: keep the run's own).
 *
 * A pool id with no entry is refused: it means the pool was widened past what
 * the global setup provisioned — `--maxWorkers` on the command line instead of
 * `BACKEND_TEST_WORKERS` — and falling back to worker 1's database would put two
 * workers back on one database, which is the defect this exists to remove.
 */
export function servicesForWorker(
  poolId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): WorkerServices | undefined {
  const published = publishedWorkerServices(env);
  if (published === undefined) return undefined;
  const id = Number.parseInt(poolId ?? '', 10);
  const entry = Number.isInteger(id) && id >= 1 ? published[id - 1] : undefined;
  if (entry === undefined) {
    throw new Error(
      `vitest worker VITEST_POOL_ID=${poolId ?? '(unset)'} has no database: this run provisioned ` +
        `${published.length} worker(s). Choose the worker count with ${TEST_WORKERS_ENV}, ` +
        `never --maxWorkers, so the global setup provisions one database per worker.`,
    );
  }
  return entry;
}
