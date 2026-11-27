import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { channelUrlLanguages } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Feature 167 (US6, FR-034, plan "pre-existing defects") — the admin-initiated password
 * reset e-mail links the storefront's real reset page, `/password-reset/confirm`
 * (it linked `/reset-password`, which no storefront route serves), under the language
 * prefix of the channel's default language.
 */
describe('admin password reset e-mail link', () => {
  let h: BackendServerHandle;
  const sent: Array<{ text?: string }> = [];

  beforeAll(async () => {
    h = await setupBackendServer({
      organizationsMailer: {
        send: async (message: { text?: string }) => {
          sent.push(message);
          return { status: 'sent' as const };
        },
      } as never,
    });
    // As admin-lifecycle.contract.test.ts: a customer may register without an organization.
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('links /password-reset/confirm under the default language prefix', async () => {
    const email = `pwd-link-${Date.now()}@example.com`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'Secret-pass-1', firstName: 'Pwd', lastName: 'Link', acceptedTermsVersion: 'v1' },
    });
    const id = (await h.em().findOne(CustomerAccount, { email }))!.id;
    sent.length = 0;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${id}/password-reset`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);

    const channel = (await h.em().findOne(SalesChannel, { systemDefault: true }))!;
    const main = channelUrlLanguages(channel).find((l) => l.isDefault)!;
    const prefix = main.prefixed ? `/${main.prefix}` : '';
    const text = sent.map((m) => m.text ?? '').join('\n');
    expect(text).toMatch(new RegExp(`https?://[^\\s]*${prefix}/password-reset/confirm\\?token=[^\\s]+`));
    expect(text).not.toContain('/reset-password');
  });
});
