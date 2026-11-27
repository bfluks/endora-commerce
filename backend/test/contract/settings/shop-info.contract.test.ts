import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, ShopInfoResponseSchema } from '@endora-commerce/contracts';
import { resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163 (T087; spec US9, FR-035; research R-20; contracts §5): the
 * Organization data the storefront publishes gains a logo and social profiles.
 *
 * - `logoUrl` is the asset `shop.logo_asset_id` names, resolved to its public
 *   URL; `null` while the setting is empty.
 * - `socialProfiles` is `shop.social_profiles`, a `string_list`.
 * - A write of anything but an `https:` URL to `shop.social_profiles` is
 *   refused by the write validator the `settings` module registers.
 */
describe('Settings — shop info logo and social profiles (feature 163)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const CODES = ['shop.logo_asset_id', 'shop.social_profiles'] as const;
  const storedBefore = new Map<string, { globalValue: unknown; values: unknown[] }>();
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    // Read first, write back in `afterAll` (standing rule 5). A 404 is the RED
    // state: the settings are not declared yet.
    for (const code of CODES) {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/settings/${code}`, cookies: adminCookie });
      if (res.statusCode === 200) {
        const dto = res.json() as { globalValue: unknown; values?: unknown[] };
        storedBefore.set(code, { globalValue: dto.globalValue ?? null, values: dto.values ?? [] });
      }
    }
  });

  afterAll(async () => {
    for (const [code, before] of storedBefore) {
      if (before.globalValue === null && before.values.length === 0) {
        await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/settings/${code}/values`, cookies: adminCookie });
      } else {
        await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/settings/${code}/value`,
          cookies: adminCookie,
          payload: { scope: 'all', value: before.globalValue },
        });
      }
    }
    for (const id of createdAssetIds) {
      await h.em().getConnection().execute('delete from assets where id = ?', [id]);
    }
    await teardownBackendServer(h);
  });

  async function seedAsset(): Promise<{ id: string; url: string }> {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url,
         label, visibility, created_at, updated_at)
       values (?, 'image', 'logo.png', 'image/png', 1024, ?, 'Logo', 'public', now(), now())`,
      [id, `https://example.test/${id}.png`],
    );
    createdAssetIds.push(id);
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ content_version: string }>>('select content_version from assets where id = ?', [id]);
    return { id, url: `${resolvePublicApiBaseUrl()}/assets/file/${id}?v=${row!.content_version}` };
  }

  async function put(code: string, value: unknown) {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: adminCookie,
      payload: { scope: 'all', value },
    });
  }

  async function shopInfo() {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/storefront/shop-info' });
    expect(res.statusCode).toBe(200);
    const parsed = ShopInfoResponseSchema.parse(res.json());
    return { parsed: parsed.data, raw: (res.json() as { data: Record<string, unknown> }).data };
  }

  it('declares both settings, owned by settings and empty by default', async () => {
    for (const [code, valueType, defaultValue] of [
      ['shop.logo_asset_id', 'string', ''],
      ['shop.social_profiles', 'string_list', []],
    ] as const) {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/settings/${code}`, cookies: adminCookie });
      expect(res.statusCode, code).toBe(200);
      expect(res.json()).toMatchObject({ code, valueType, defaultValue, ownerModule: 'settings' });
    }
  });

  it('answers logoUrl from shop.logo_asset_id, and null while it is empty', async () => {
    expect((await put('shop.logo_asset_id', '')).statusCode).toBe(200);
    expect((await shopInfo()).raw['logoUrl']).toBeNull();

    const logo = await seedAsset();
    expect((await put('shop.logo_asset_id', logo.id)).statusCode).toBe(200);
    expect((await shopInfo()).raw['logoUrl']).toBe(logo.url);
  });

  it('answers socialProfiles from shop.social_profiles', async () => {
    const profiles = ['https://social.example.com/shop', 'https://video.example.org/@shop'];
    const res = await put('shop.social_profiles', profiles);
    expect(res.statusCode, res.body).toBe(200);
    expect((await shopInfo()).raw['socialProfiles']).toEqual(profiles);
  });

  it('refuses a social profile that is not an https URL, and stores nothing', async () => {
    const before = (await shopInfo()).raw['socialProfiles'];
    for (const value of [['http://social.example.com/shop'], ['https://ok.example.com', 'not a url']]) {
      const res = await put('shop.social_profiles', value);
      expect(res.statusCode, JSON.stringify(value)).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } });
    }
    expect((await shopInfo()).raw['socialProfiles']).toEqual(before);
  });
});
