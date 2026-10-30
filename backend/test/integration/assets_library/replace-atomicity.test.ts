import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  cleanupEntriesOf,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T027 — a replace whose copy onto the stable key
 * fails changes nothing a reader can see and leaves nothing behind (FR-004,
 * US1-5; research R-1, R-21).
 */
describe('replace atomicity (feature 156)', () => {
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

  async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { recursive: true });
    return entries.map(String);
  }

  it('answers 503 and keeps the row, the bytes, the ETag and the previous version when the stable copy fails', async () => {
    const original = pdfBytes('atomic-one');
    const asset = await uploadAsset(h, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: original,
    });
    created.push(asset.id);
    const before = await h.em().fork().findOneOrFail(Asset, { id: asset.id });
    const firstServe = await h.app.inject({ method: 'GET', url: `/assets/file/${asset.id}` });
    const etag = String(firstServe.headers.etag);

    const adapters = h.assetsLibrary.adapters;
    const realGetForBackend = adapters.getForBackend.bind(adapters);
    const spy = vi.spyOn(adapters, 'getForBackend').mockImplementation((async (code: 'local') => {
      const real = await realGetForBackend(code);
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'copy') {
            return async (input: { from: string; to: string }) => {
              if (input.to === before.storageLocator) throw new Error('simulated copy failure');
              return (target as { copy: (i: unknown) => Promise<void> }).copy(input);
            };
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    }) as never);
    try {
      const res = await replaceAsset(h, asset.id, {
        filename: `${runName()}-2.pdf`,
        mime: 'application/pdf',
        value: pdfBytes('atomic-two'),
      });
      expect(res.statusCode, res.body).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('ASSET_STORAGE_UNAVAILABLE');
    } finally {
      spy.mockRestore();
    }

    const after = await h.em().fork().findOneOrFail(Asset, { id: asset.id });
    expect(after.filename).toBe(before.filename);
    expect(after.mimeType).toBe(before.mimeType);
    expect(after.sizeBytes).toBe(before.sizeBytes);
    expect(after.contentVersion).toBe(before.contentVersion);
    expect(after.previousStorageLocator ?? null).toBeNull();
    expect((await readFile(join(store.baseDir, before.storageLocator))).equals(original)).toBe(true);

    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${asset.id}` });
    expect(served.rawPayload.equals(original)).toBe(true);
    expect(String(served.headers.etag)).toBe(etag);

    const leftovers = (await filesUnder(store.baseDir)).filter(
      (name) => name.includes('.stage-') || name.includes('.prev-') || name.includes('.tmp-'),
    );
    expect(leftovers).toEqual([]);
    expect(await cleanupEntriesOf(h, asset.id)).toEqual([]);
  });
});
