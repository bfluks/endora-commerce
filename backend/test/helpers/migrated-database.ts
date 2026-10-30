import { randomBytes } from 'node:crypto';

import { Client } from 'pg';
import {
  BASE_DATABASE_URL_ENV,
  cloneTemplateForCaller,
  dropRunDatabase,
  TEMPLATE_DATABASE_ENV,
} from '@endora-commerce/test-kit/database';

import { withdrawPlatformInvariants } from '../template-seed.js';

/**
 * A database of a file's own, holding exactly what `migration:up` from empty
 * leaves — for the files that then drive a **first boot** through a spawned
 * CLI and measure what it writes (`test/integration/demo/`).
 *
 * They used to create an empty database and spawn the migrator into it, once
 * per file. The run already holds that schema, migrated once by
 * `test/global-setup.ts` into the template this invocation was cloned from, so
 * here it is a clone of that template — `cloneTemplateForCaller`, the seam
 * `provisionWorkers` and `setupMigratorTestDb` use — with the one thing the
 * template holds beyond its migrations withdrawn again
 * (`withdrawPlatformInvariants` in `test/template-seed.ts`).
 * `test/integration/demo/migrated-clone-parity.test.ts` is what holds that the
 * two are the same database, and it is the one file left migrating from empty.
 *
 * Under `BACKEND_TEST_ISOLATION=shared` there is no template to clone, so this
 * falls back to the old path — an empty database and the caller's own
 * migration — and says so.
 */
export type MigratedDatabaseSource =
  | { readonly kind: 'clone'; readonly baseUrl: string; readonly template: string }
  | { readonly kind: 'migrate'; readonly reason: string };

export function migratedDatabaseSource(
  env: NodeJS.ProcessEnv = process.env,
): MigratedDatabaseSource {
  const baseUrl = env[BASE_DATABASE_URL_ENV];
  const template = env[TEMPLATE_DATABASE_ENV];
  if (baseUrl && template) return { kind: 'clone', baseUrl, template };
  return {
    kind: 'migrate',
    reason:
      `${BASE_DATABASE_URL_ENV}/${TEMPLATE_DATABASE_ENV} are not set, so this invocation has ` +
      `no template to clone`,
  };
}

export interface MigratedDatabase {
  readonly name: string;
  readonly url: string;
  /** Drops the database; safe to call once the file is done with it. */
  readonly drop: () => Promise<void>;
}

/** `DATABASE_URL`'s host, port and credentials, with the database replaced. */
function runDsnFor(database: string): string {
  const declared = process.env['DATABASE_URL'];
  if (declared === undefined || declared === '') {
    throw new Error(
      'migratedDatabase: DATABASE_URL is not set, so there is no server to create a ' +
        'database on.',
    );
  }
  const url = new URL(declared);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * @param prefix names the database on the fallback path only (`<prefix>_<rand>_test`);
 *   a clone carries the run-database name shape, so the crashed-run sweep collects it.
 * @param migrate the caller's own `migration:up` over a URL, run on the fallback path only.
 */
export async function migratedDatabase(
  prefix: string,
  migrate: (url: string) => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigratedDatabase> {
  const source = migratedDatabaseSource(env);
  if (source.kind === 'clone') {
    const clone = await cloneTemplateForCaller(source.baseUrl, source.template);
    const drop = (): Promise<void> => dropRunDatabase(source.baseUrl, clone.name, () => {});
    try {
      await withClient(clone.url, withdrawPlatformInvariants);
    } catch (error) {
      await drop();
      throw error;
    }
    return { name: clone.name, url: clone.url, drop };
  }

  process.stdout.write(`[migrated-database] ${source.reason} — migrating one from empty.\n`);
  const name = `${prefix}_${randomBytes(4).toString('hex')}_test`;
  const drop = (): Promise<void> =>
    withClient(runDsnFor('postgres'), async (admin) => {
      await admin.query(`drop database if exists "${name}" with (force)`);
    });
  await withClient(runDsnFor('postgres'), async (admin) => {
    await admin.query(`create database "${name}"`);
  });
  const url = runDsnFor(name);
  try {
    await migrate(url);
  } catch (error) {
    await drop();
    throw error;
  }
  return { name, url, drop };
}
