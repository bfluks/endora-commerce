/**
 * Where a file that needs a freshly migrated database of its own gets one.
 *
 * Pure: the decision reads an environment object the test builds, so it runs
 * in the fast unit job. The clone itself, and the claim that a clone with the
 * template's invariants withdrawn *is* a migrated database, are held by
 * `test/integration/demo/migrated-clone-parity.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { BASE_DATABASE_URL_ENV, TEMPLATE_DATABASE_ENV } from '@endora-commerce/test-kit/database';

import { migratedDatabaseSource } from '../../helpers/migrated-database.js';

const BASE = 'postgresql://b2b:b2b@localhost:5441/b2b_test';
const TEMPLATE = 'b2b_test_tpl_0123456789ab';

describe('migratedDatabaseSource', () => {
  it('clones the template this run was cloned from when the lease published it', () => {
    expect(
      migratedDatabaseSource({ [BASE_DATABASE_URL_ENV]: BASE, [TEMPLATE_DATABASE_ENV]: TEMPLATE }),
    ).toEqual({ kind: 'clone', baseUrl: BASE, template: TEMPLATE });
  });

  it('migrates from empty when the run has no template, and says why', () => {
    // `BACKEND_TEST_ISOLATION=shared` exports neither variable: the shared path
    // is the pre-#189 behaviour in full, and a migration is what it costs.
    const source = migratedDatabaseSource({});
    expect(source.kind).toBe('migrate');
    expect(source.kind === 'migrate' && source.reason).toContain(TEMPLATE_DATABASE_ENV);
  });

  it('does not clone half a declaration', () => {
    expect(migratedDatabaseSource({ [BASE_DATABASE_URL_ENV]: BASE }).kind).toBe('migrate');
    expect(migratedDatabaseSource({ [TEMPLATE_DATABASE_ENV]: TEMPLATE }).kind).toBe('migrate');
  });
});
