import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { LockMode } from '@mikro-orm/core';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { ADMIN, forgetAssets, pdfBytes, runName, uploadAsset } from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T028a — a visibility change takes the row lock
 * a replace takes (research R-18), so the ACL a replace copies with can never
 * be one a concurrent visibility flip has already overturned.
 */
describe('a visibility change waits for the asset row lock (feature 156)', () => {
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

  it('does not answer while another transaction holds the row FOR UPDATE, then applies the change', async () => {
    const asset = await uploadAsset(h, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('lock'),
    });
    created.push(asset.id);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lockTaken!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockTaken = resolve;
    });
    const holder = h
      .em()
      .fork()
      .transactional(async (tx) => {
        await tx.findOne(Asset, { id: asset.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        lockTaken();
        await gate;
      });
    await locked;

    // Without the lock the PATCH reads the row at once and reaches the storage
    // adapter (the ACL call) before blocking on its UPDATE; with it, it reaches
    // nothing until the holder commits.
    const adapterLookups = vi.spyOn(h.assetsLibrary.adapters, 'getForBackend');
    let answered = false;
    const patch = h.app
      .inject({
        method: 'PATCH',
        url: `/api/v1/admin/assets/${asset.id}`,
        cookies: ADMIN,
        payload: { visibility: 'private' },
      })
      .then((res) => {
        answered = true;
        return res;
      });

    await sleep(500);
    expect(answered).toBe(false);
    expect(adapterLookups).not.toHaveBeenCalled();

    release();
    await holder;
    const res = await patch;
    adapterLookups.mockRestore();
    expect(res.statusCode, res.body).toBe(200);
    const row = await h.em().fork().findOneOrFail(Asset, { id: asset.id });
    expect(row.visibility).toBe('private');
  });
});
