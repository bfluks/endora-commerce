import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { ADMIN, forgetAssets, pdfBytes, runName, uploadAsset } from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T050a — a purge frees an asset's permalink as a
 * previously used name (research R-22, owner ruling P5).
 */
describe('a purged asset releases its permalink (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await store.undo();
    await teardownBackendServer(h);
  });

  async function releaseRows(permalink: string) {
    return h
      .em()
      .getConnection()
      .execute<Array<{ asset_id: string; reason: string }>>(
        `select asset_id::text as asset_id, reason from asset_permalink_releases where permalink_lower = ?`,
        [permalink.toLowerCase()],
      );
  }

  it('records the release on purge, and asks before another asset takes the name', async () => {
    const permalink = `${runName()}/sheet.pdf`;
    const first = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('a') });
    created.push(first.id);
    const set = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/assets/${first.id}/permalink`,
      cookies: ADMIN,
      payload: { permalink },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${first.id}`, cookies: ADMIN })).statusCode).toBe(200);

    const sweep = await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 400 * DAY_MS));
    expect(sweep.hardDeleted).toBeGreaterThanOrEqual(1);
    expect(await releaseRows(permalink)).toEqual([{ asset_id: first.id, reason: 'purged' }]);

    const second = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('b') });
    created.push(second.id);
    const put = (body: Record<string, unknown>) =>
      h.app.inject({ method: 'PUT', url: `/api/v1/admin/assets/${second.id}/permalink`, cookies: ADMIN, payload: body });
    const refused = await put({ permalink });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('ASSET_PERMALINK_PREVIOUSLY_USED');
    const confirmed = await put({ permalink, confirmReuse: true });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(await releaseRows(permalink)).toEqual([]);
  });
});
