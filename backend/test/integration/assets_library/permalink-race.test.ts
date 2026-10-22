import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { ADMIN, forgetAssets, pdfBytes, runName, uploadAsset } from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T050 — two assets claiming one permalink at
 * the same moment: the unique index decides, and the loser gets 409, not 500.
 */
describe('permalink race (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('answers one 200 and one 409 ASSET_PERMALINK_TAKEN', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const a = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes(`r${i}`) });
      created.push(a.id);
      ids.push(a.id);
    }
    const permalink = `${runName()}/race.pdf`;
    const answers = await Promise.all(
      ids.map((id) =>
        h.app.inject({ method: 'PUT', url: `/api/v1/admin/assets/${id}/permalink`, cookies: ADMIN, payload: { permalink } }),
      ),
    );
    expect(answers.map((r) => r.statusCode).sort(), answers.map((r) => r.body).join(' | ')).toEqual([200, 409]);
    const loser = answers.find((r) => r.statusCode === 409)!;
    expect((loser.json() as { error: { code: string } }).error.code).toBe('ASSET_PERMALINK_TAKEN');
  });
});
