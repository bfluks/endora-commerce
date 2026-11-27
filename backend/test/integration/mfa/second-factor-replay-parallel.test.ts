import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * A second-factor code is accepted once, however the requests carrying it
 * arrive (`specs/166-mfa-totp-hardening/` FR-004, FR-005).
 *
 * The replay guard used to read the enrolment's last accepted time step, compare
 * it with the code's, and write the new one back. Two sign-ins presenting the
 * same code at the same moment both read the old step, so both were admitted —
 * and so were two presenting the same recovery code. Driven through the real
 * route, the real database and the real Redis.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';

function totpCode(secretBase32: string, offsetMs = 0): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: Date.now() + offsetMs });
}

describe('second step — one code admits one sign-in under parallel requests', () => {
  let h: BackendServerHandle;
  let secret: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: CUSTOMER_COOKIE,
    });
    secret = (setup.json().data as { secret: string }).secret;
    const activated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER_COOKIE,
      payload: { code: totpCode(secret) },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    recoveryCodes = activated.json().data.recoveryCodes as string[];
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function challenges(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const login = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
      });
      expect(login.json().data.status).toBe('mfaRequired');
      ids.push(login.json().data.challengeId as string);
    }
    return ids;
  }

  function verifyAll(ids: string[], code: string) {
    return Promise.all(
      ids.map((challengeId) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/customer/mfa/verify',
          payload: { challengeId, code },
        }),
      ),
    );
  }

  it('admits exactly one of three sign-ins presenting the same TOTP code at once', async () => {
    // The activation spent the current step; the next one is inside the window.
    const code = totpCode(secret, 30_000);
    const answers = await verifyAll(await challenges(3), code);
    const statuses = answers.map((answer) => answer.statusCode);
    expect(statuses.filter((status) => status === 200), statuses.join(',')).toHaveLength(1);
    expect(statuses.every((status) => [200, 401].includes(status)), statuses.join(',')).toBe(true);
  });

  it('admits exactly one of three sign-ins presenting the same recovery code at once', async () => {
    const answers = await verifyAll(await challenges(3), recoveryCodes[0]!);
    const statuses = answers.map((answer) => answer.statusCode);
    expect(statuses.filter((status) => status === 200), statuses.join(',')).toHaveLength(1);
    expect(statuses.every((status) => [200, 401].includes(status)), statuses.join(',')).toBe(true);

    const status = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      cookies: CUSTOMER_COOKIE,
    });
    expect(status.json().data.recoveryCodesRemaining).toBe(recoveryCodes.length - 1);
  });
});
