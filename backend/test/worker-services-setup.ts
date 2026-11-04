// The first setup file of every complete-suite test file: point this worker at
// its own database and Redis logical database before the file under test, or
// anything it imports, reads `DATABASE_URL` or `REDIS_URL`. The ORM
// configuration captures `DATABASE_URL` at import, so this has to run first.
// A one-worker run published nothing and keeps the run's own. See
// test/test-workers.ts.

import { servicesForWorker } from './test-workers.js';

const services = servicesForWorker(process.env['VITEST_POOL_ID']);
if (services !== undefined) {
  process.env['DATABASE_URL'] = services.databaseUrl;
  process.env['REDIS_URL'] = services.redisUrl;
}
