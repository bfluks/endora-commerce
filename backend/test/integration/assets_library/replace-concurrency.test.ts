import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
  type AssetBody,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T028 — two replaces of one asset sent together
 * with the same expected version: exactly one wins, and everything a reader
 * sees belongs to it (FR-009). A further replace supersedes the previous
 * version (US3-4, FR-022).
 */
describe('concurrent replaces (feature 156)', () => {
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

  it('lets exactly one of two concurrent replaces win, and a third supersede the previous version', async () => {
    const original = await uploadAsset(h, {
      filename: `${runName()}-original.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('original'),
    });
    created.push(original.id);

    const files = {
      a: { filename: `${runName()}-a.pdf`, mime: 'application/pdf', value: pdfBytes('candidate a') },
      b: { filename: `${runName()}-b.pdf`, mime: 'application/pdf', value: pdfBytes('candidate b, longer') },
    };
    const [ra, rb] = await Promise.all([
      replaceAsset(h, original.id, files.a, { expectedContentVersion: original.contentVersion }),
      replaceAsset(h, original.id, files.b, { expectedContentVersion: original.contentVersion }),
    ]);
    const statuses = [ra.statusCode, rb.statusCode].sort();
    expect(statuses, `${ra.body} | ${rb.body}`).toEqual([200, 409]);
    const loserBody = (ra.statusCode === 409 ? ra : rb).json() as { error: { code: string } };
    expect(loserBody.error.code).toBe('ASSET_REPLACE_CONFLICT');
    const winner = ra.statusCode === 200 ? files.a : files.b;
    const winnerDetail = ((ra.statusCode === 200 ? ra : rb).json() as { data: AssetBody }).data;

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.filename).toBe(winner.filename);
    expect(row.mimeType).toBe('application/pdf');
    expect(Number(row.sizeBytes)).toBe(winner.value.length);
    expect(row.previousFilename).toBe(original.filename);
    expect(row.previousContentVersion).toBe(original.contentVersion);
    expect((await readFile(join(store.baseDir, row.storageLocator))).equals(winner.value)).toBe(true);
    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${original.id}` });
    expect(served.rawPayload.equals(winner.value)).toBe(true);

    const audit = await h.em().fork().find(AuditLogEntry, { action: 'asset.replace', objectId: original.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.stateAfter).toMatchObject({ filename: winner.filename });

    const firstPrevious = row.previousStorageLocator!;
    await access(join(store.baseDir, firstPrevious));

    const third = { filename: `${runName()}-c.pdf`, mime: 'application/pdf', value: pdfBytes('third') };
    const rc = await replaceAsset(h, original.id, third, {
      expectedContentVersion: winnerDetail.contentVersion,
    });
    expect(rc.statusCode, rc.body).toBe(200);
    const after = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(after.previousFilename).toBe(winner.filename);
    expect(after.previousContentVersion).toBe(winnerDetail.contentVersion);
    expect(after.previousStorageLocator).not.toBe(firstPrevious);
    await expect(access(join(store.baseDir, firstPrevious))).rejects.toThrow();
  });
});
