import { afterAll, beforeAll, describe, it } from 'vitest';
import { ADMIN_FEEDBACK_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `admin_feedback` off-state — Constitution XVII item 6 (issue #379).
 *
 * The probe sends an empty body, so while the module is on it is answered
 * `400` by validation and never reaches the relay; while it is off, on either
 * axis, it is answered `503 MODULE_DISABLED`. The module leaves the presence
 * projection the shell gates its "Send feedback" link on, and its relay
 * address is not editable while it is off.
 */
describe('admin_feedback off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'admin_feedback', {
      routes: [{ method: 'POST', url: '/api/v1/admin/feedback', cookies: admin, payload: {} }],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL,
        value: 'https://relay.example.test/feedback/',
        cookies: admin,
      },
    });
  });
});
