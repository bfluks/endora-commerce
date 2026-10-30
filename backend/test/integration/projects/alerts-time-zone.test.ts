import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `projects.alerts_time_zone` takes only a time zone the runtime knows —
 * "today" for every Stage entry, deadline and list read is counted in it, and
 * an unknown zone answered 500 on each of them (T118's validator, pulled
 * forward into User Story 2).
 */
describe('projects — the alerts time zone setting', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const write = (value: unknown) =>
    h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.alerts_time_zone/value',
      cookies: admin,
      payload: { scope: 'all', value },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await write('Europe/Warsaw');
    await teardownBackendServer(h);
  });

  it('refuses a zone that does not exist, and the Projects list keeps answering', async () => {
    const refused = await write('Mars/Olympus_Mons');
    expect(refused.statusCode, refused.body).toBe(422);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/projects', cookies: admin });
    expect(list.statusCode, list.body).toBe(200);
  });

  it('accepts an IANA zone', async () => {
    const accepted = await write('America/New_York');
    expect(accepted.statusCode, accepted.body).toBeLessThan(400);
  });
});
