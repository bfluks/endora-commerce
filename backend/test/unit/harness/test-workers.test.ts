/**
 * The complete suite's worker count, and how a worker finds its own services.
 *
 * Pure: everything here reads an environment object the test builds, so it
 * runs in the fast unit job. The provisioning itself — clones and Redis
 * leases — is exercised by every complete run, which prints the line
 * `[test-setup] N workers: …` from `test/global-setup.ts`.
 */
import { describe, expect, it } from 'vitest';

import { backendTestOptions } from '../../../vitest.shared.js';
import {
  backendTestWorkers,
  LOCAL_DEFAULT_TEST_WORKERS,
  servicesForWorker,
  TEST_WORKERS_ENV,
  WORKER_SERVICES_ENV,
} from '../../test-workers.js';

describe('the worker count', () => {
  it('is the local default on a developer machine', () => {
    expect(backendTestWorkers({})).toBe(LOCAL_DEFAULT_TEST_WORKERS);
    expect(LOCAL_DEFAULT_TEST_WORKERS).toBe(6);
  });

  it('is one under CI, in either spelling a runner uses', () => {
    expect(backendTestWorkers({ CI: 'true' })).toBe(1);
    expect(backendTestWorkers({ CI: '1' })).toBe(1);
  });

  it('does not read a CI variable that says no', () => {
    expect(backendTestWorkers({ CI: 'false' })).toBe(LOCAL_DEFAULT_TEST_WORKERS);
    expect(backendTestWorkers({ CI: '0' })).toBe(LOCAL_DEFAULT_TEST_WORKERS);
  });

  it('is what the developer asked for, CI or not', () => {
    expect(backendTestWorkers({ [TEST_WORKERS_ENV]: '3' })).toBe(3);
    expect(backendTestWorkers({ [TEST_WORKERS_ENV]: '4', CI: 'true' })).toBe(4);
  });

  it('refuses a value that is not a positive integer', () => {
    for (const value of ['0', '-1', 'six', '2.5']) {
      expect(() => backendTestWorkers({ [TEST_WORKERS_ENV]: value })).toThrow(TEST_WORKERS_ENV);
    }
  });

  it('is one for a run that shares one database on purpose', () => {
    expect(backendTestWorkers({ BACKEND_TEST_ISOLATION: 'shared' })).toBe(1);
    expect(backendTestWorkers({ ALLOW_NON_TEST_DATABASE_URL: '1' })).toBe(1);
  });

  it('refuses parallel workers on one shared database rather than ignoring the request', () => {
    expect(() =>
      backendTestWorkers({ BACKEND_TEST_ISOLATION: 'shared', [TEST_WORKERS_ENV]: '6' }),
    ).toThrow(/shares one database/);
    expect(backendTestWorkers({ BACKEND_TEST_ISOLATION: 'shared', [TEST_WORKERS_ENV]: '1' })).toBe(
      1,
    );
  });
});

describe('the services a worker connects to', () => {
  const published = {
    [WORKER_SERVICES_ENV]: JSON.stringify([
      { databaseUrl: 'postgresql://h/b2b_test_r_a', redisUrl: 'redis://h/1' },
      { databaseUrl: 'postgresql://h/b2b_test_r_b', redisUrl: 'redis://h/2' },
    ]),
  };

  it('are none on a run that published none, so the run keeps its own', () => {
    expect(servicesForWorker('1', {})).toBeUndefined();
  });

  it('are the entry for the worker’s pool id, counted from one', () => {
    expect(servicesForWorker('1', published)).toEqual({
      databaseUrl: 'postgresql://h/b2b_test_r_a',
      redisUrl: 'redis://h/1',
    });
    expect(servicesForWorker('2', published)?.databaseUrl).toBe('postgresql://h/b2b_test_r_b');
  });

  it('are refused for a pool id the run did not provision, never borrowed from worker 1', () => {
    expect(() => servicesForWorker('3', published)).toThrow(/provisioned 2 worker/);
    expect(() => servicesForWorker(undefined, published)).toThrow(/VITEST_POOL_ID/);
  });

  it('are refused when what was published is not a list of services', () => {
    expect(() => servicesForWorker('1', { [WORKER_SERVICES_ENV]: '{"a":1}' })).toThrow(
      WORKER_SERVICES_ENV,
    );
  });
});

describe('the setup file that applies them', () => {
  it('runs before every other setup file, so nothing imports the ORM config first', () => {
    const setupFiles = backendTestOptions().setupFiles;
    const list = Array.isArray(setupFiles) ? setupFiles : [setupFiles];
    expect(list[0]).toBe('./test/worker-services-setup.ts');
  });
});
