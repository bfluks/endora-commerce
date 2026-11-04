import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type AssetDetail, type AssetsLibraryPort } from '@endora-commerce/contracts';
import { AuditLogEntry, enterSystemScope, ModuleDisabledError } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { forgetAssets, pdfBytes, runName, TINY_JPEG } from '../../helpers/asset-replace-fixtures.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Issue #694 — `assetsLibraryPort.replace`: a module replaces an asset's file in
 * place through the published port, with everything `specs/156-asset-stable-url/`
 * promises the admin route — same id, same storage key and URLs, a new content
 * version, the old file kept as the previous version, one `asset.replace` audit
 * row — and the same refusals.
 *
 * The bytes are handed as a plain async iterable, never a Node stream: that is
 * the contract's `AssetUploadStream`, and the shape a module that never imports
 * `node:stream` sends.
 *
 * **Owner off.** `assets_library` declares `nonDeactivatable`, so the operator
 * axis has no off state; the platform axis — a deployment without the module —
 * does, and resolving the port there throws `ModuleDisabledError` before
 * anything is replaced.
 */
describe('assetsLibraryPort.replace (issue #694)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];

  const port = (): AssetsLibraryPort => h.container.resolve<AssetsLibraryPort>('assetsLibraryPort');
  const asSystem = <T>(label: string, run: () => Promise<T>): Promise<T> =>
    enterSystemScope(`test: assetsLibraryPort.replace — ${label}`, run);

  async function* bytesOf(value: Buffer): AsyncGenerator<Uint8Array> {
    yield new Uint8Array(value);
  }

  async function uploadPdf(marker: string): Promise<AssetDetail> {
    const value = pdfBytes(marker);
    const detail = await asSystem('upload', () =>
      port().upload({
        filename: `${runName()}-${marker}.pdf`,
        declaredMime: 'application/pdf',
        stream: bytesOf(value),
        declaredSize: value.length,
        folderId: null,
        label: null,
        visibility: 'public',
      }),
    );
    created.push(detail.id);
    return detail;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('keeps the id and every URL, changes the content version and keeps the previous file', async () => {
    const original = await uploadPdf('original');
    const before = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    const replacement = pdfBytes('replacement from a PIM');
    const filename = `${runName()}-replacement.pdf`;

    const detail = await asSystem('replace', () =>
      port().replace({
        assetId: original.id,
        filename,
        declaredMime: 'application/pdf',
        stream: bytesOf(replacement),
        declaredSize: replacement.length,
        expectedContentVersion: original.contentVersion,
      }),
    );

    expect(detail.id).toBe(original.id);
    expect(detail.fileUrl).toBe(original.fileUrl);
    expect(detail.contentVersion).not.toBe(original.contentVersion);
    expect(detail.filename).toBe(filename);

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.storageLocator).toBe(before.storageLocator);
    expect(row.previousContentVersion).toBe(original.contentVersion);
    expect(row.previousFilename).toBe(original.filename);
    expect((await readFile(join(store.baseDir, row.storageLocator))).equals(replacement)).toBe(true);
    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${original.id}` });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(replacement)).toBe(true);

    const audit = await h.em().fork().find(AuditLogEntry, { action: 'asset.replace', objectId: original.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.stateAfter).toMatchObject({ filename });
  });

  it('refuses a stale expected content version with ASSET_REPLACE_CONFLICT and changes nothing', async () => {
    const original = await uploadPdf('conflict');
    const replacement = pdfBytes('too late');

    await expect(
      asSystem('stale replace', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-late.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
          expectedContentVersion: 'ffffffffffff',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.ASSET_REPLACE_CONFLICT });

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.contentVersion).toBe(original.contentVersion);
    expect(row.filename).toBe(original.filename);
  });

  it('refuses a file of another kind with ASSET_REPLACE_KIND_MISMATCH', async () => {
    const original = await uploadPdf('kind');

    await expect(
      asSystem('kind mismatch', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-photo.jpg`,
          declaredMime: 'image/jpeg',
          stream: bytesOf(TINY_JPEG),
          declaredSize: TINY_JPEG.length,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 415, code: ERROR_CODES.ASSET_REPLACE_KIND_MISMATCH });

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.contentVersion).toBe(original.contentVersion);
  });

  it('refuses an unknown asset with ASSET_NOT_FOUND', async () => {
    const replacement = pdfBytes('nobody');
    await expect(
      asSystem('unknown asset', () =>
        port().replace({
          assetId: randomUUID(),
          filename: `${runName()}-nobody.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.ASSET_NOT_FOUND });
  });

  it('fails closed while assets_library is platform-unavailable, and answers again once it is back', async () => {
    const original = await uploadPdf('owner-off');
    const replacement = pdfBytes('while off');
    const replace = (): Promise<AssetDetail> =>
      asSystem('owner off', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-off.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
          expectedContentVersion: original.contentVersion,
        }),
      );

    await withModuleOff('assets_library', 'platform-unavailable', async () => {
      await expect(replace()).rejects.toBeInstanceOf(ModuleDisabledError);
    });

    const untouched = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(untouched.contentVersion).toBe(original.contentVersion);
    expect(
      await h.em().fork().count(AuditLogEntry, { action: 'asset.replace', objectId: original.id }),
    ).toBe(0);

    // The positive control: the same call, the module back, goes through.
    const detail = await replace();
    expect(detail.id).toBe(original.id);
    expect(detail.contentVersion).not.toBe(original.contentVersion);
  });
});
