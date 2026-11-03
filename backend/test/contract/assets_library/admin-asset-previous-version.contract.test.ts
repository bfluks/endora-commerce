import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { overrideAssetSetting, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  createAssetsReader,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
  type AssetBody,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T037 — the previous version on the detail and
 * `POST /api/v1/admin/assets/:id/previous-version/restore` (FR-022 – FR-024,
 * US3; contracts/admin-api.md §2).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface PreviousVersion {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentVersion: string;
  replacedAt: string;
  replacedBy: { id: string; displayName: string } | null;
  restorableUntil: string;
}

type Detail = AssetBody & { previousVersion: PreviousVersion | null; retentionDays: number };

describe('the previous version and its restore (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  let restoreRetention: () => Promise<void>;
  let reader: Awaited<ReturnType<typeof createAssetsReader>>;
  let adminDisplayName = '';
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    restoreRetention = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 9);
    reader = await createAssetsReader(h);
    const admin = await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    adminDisplayName = `${admin.firstName} ${admin.lastName}`.trim();
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await reader.undo();
    await restoreRetention();
    await store.undo();
    await teardownBackendServer(h);
  });

  async function detail(id: string, cookies = ADMIN): Promise<Detail> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}`, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Detail }).data;
  }

  async function serve(id: string, etag?: string) {
    return h.app.inject({
      method: 'GET',
      url: `/assets/file/${id}`,
      ...(etag ? { headers: { 'if-none-match': etag } } : {}),
    });
  }

  function restore(id: string, body: Record<string, unknown>, cookies = ADMIN) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/assets/${id}/previous-version/restore`,
      cookies,
      payload: body,
    });
  }

  async function auditCount(id: string): Promise<number> {
    return h.em().fork().count(AuditLogEntry, { action: 'asset.restore_previous_version', objectId: id });
  }

  /** Uploads one PDF and replaces it with another; answers both files and the detail. */
  async function replacedAsset() {
    const original = pdfBytes(`original ${runName()}`);
    const replacement = pdfBytes(`replacement ${runName()} — longer`);
    const asset = await uploadAsset(h, { filename: `${runName()}-v1.pdf`, mime: 'application/pdf', value: original });
    created.push(asset.id);
    const originalEtag = String((await serve(asset.id)).headers.etag);
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}-v2.pdf`,
      mime: 'application/pdf',
      value: replacement,
    });
    expect(res.statusCode, res.body).toBe(200);
    return { asset, original, replacement, originalEtag, after: await detail(asset.id) };
  }

  it('shows the previous version after a replace, and restores it as a swap — twice', async () => {
    const { asset, original, replacement, originalEtag, after } = await replacedAsset();
    const previous = after.previousVersion!;
    expect(previous).toMatchObject({
      filename: asset.filename,
      mimeType: 'application/pdf',
      sizeBytes: original.length,
      contentVersion: asset.contentVersion,
      replacedBy: { id: TEST_ADMIN_ID, displayName: adminDisplayName },
    });
    expect(Date.parse(previous.restorableUntil) - Date.parse(previous.replacedAt)).toBe(9 * DAY_MS);
    // The replace confirmation names this (UI block review): the detail carries it.
    expect(after.retentionDays).toBe(9);

    const first = await restore(asset.id, {
      expectedContentVersion: after.contentVersion,
      expectedPreviousContentVersion: previous.contentVersion,
    });
    expect(first.statusCode, first.body).toBe(200);
    const restored = (first.json() as { data: Detail }).data;
    expect(restored.filename).toBe(asset.filename);
    expect(restored.contentVersion).toBe(asset.contentVersion);
    expect(restored.previousVersion).toMatchObject({
      filename: after.filename,
      contentVersion: after.contentVersion,
    });
    expect(Date.parse(restored.previousVersion!.replacedAt)).toBeGreaterThanOrEqual(Date.parse(previous.replacedAt));

    const served = await serve(asset.id);
    expect(served.rawPayload.equals(original)).toBe(true);
    expect(String(served.headers.etag)).toBe(originalEtag);
    expect((await serve(asset.id, originalEtag)).statusCode).toBe(304);
    expect(await auditCount(asset.id)).toBe(1);

    const second = await restore(asset.id, {
      expectedContentVersion: restored.contentVersion,
      expectedPreviousContentVersion: restored.previousVersion!.contentVersion,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect((second.json() as { data: Detail }).data.filename).toBe(after.filename);
    expect((await serve(asset.id)).rawPayload.equals(replacement)).toBe(true);
    expect(await auditCount(asset.id)).toBe(2);
  });

  it('refuses a body without the previous version with 400 VALIDATION_FAILED', async () => {
    const { asset, after } = await replacedAsset();
    const res = await restore(asset.id, { expectedContentVersion: after.contentVersion });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['a stale current version', 'current'],
    ['a stale previous version (a second replace after the read)', 'previous'],
  ] as const)('refuses %s with 409 and changes nothing', async (_label, stale) => {
    const { asset, after } = await replacedAsset();
    let body = {
      expectedContentVersion: after.contentVersion,
      expectedPreviousContentVersion: after.previousVersion!.contentVersion,
    };
    let state = after;
    if (stale === 'current') {
      body = { ...body, expectedContentVersion: 'ffffffffffff' };
    } else {
      // Another replace lands between the admin's read and the click: the
      // current version the admin names is still current, the previous one no
      // longer is.
      const again = await replaceAsset(
        h,
        asset.id,
        { filename: `${runName()}-v3.pdf`, mime: 'application/pdf', value: pdfBytes('third') },
      );
      expect(again.statusCode, again.body).toBe(200);
      state = await detail(asset.id);
      body = { ...body, expectedContentVersion: state.contentVersion };
    }
    const etag = String((await serve(asset.id)).headers.etag);
    const bytes = (await serve(asset.id)).rawPayload;

    const res = await restore(asset.id, body);
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ASSET_REPLACE_CONFLICT');

    const now = await detail(asset.id);
    expect(now.contentVersion).toBe(state.contentVersion);
    expect(now.previousVersion).toEqual(state.previousVersion);
    const served = await serve(asset.id);
    expect(served.rawPayload.equals(bytes)).toBe(true);
    expect(String(served.headers.etag)).toBe(etag);
    expect(await auditCount(asset.id)).toBe(0);
  });

  it('refuses an asset that was never replaced with 409 ASSET_NO_PREVIOUS_VERSION', async () => {
    const asset = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('never') });
    created.push(asset.id);
    expect((await detail(asset.id)).previousVersion).toBeNull();
    const res = await restore(asset.id, {
      expectedContentVersion: asset.contentVersion,
      expectedPreviousContentVersion: 'a1b2c3d4e5f6',
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ASSET_NO_PREVIOUS_VERSION');
  });

  it('lets an assets.read admin see the previous version and refuses its restore with 403', async () => {
    const { asset, after } = await replacedAsset();
    const seen = await detail(asset.id, reader.cookies);
    expect(seen.previousVersion?.contentVersion).toBe(after.previousVersion!.contentVersion);
    const res = await restore(
      asset.id,
      {
        expectedContentVersion: after.contentVersion,
        expectedPreviousContentVersion: after.previousVersion!.contentVersion,
      },
      reader.cookies,
    );
    expect(res.statusCode).toBe(403);
    expect((await detail(asset.id)).contentVersion).toBe(after.contentVersion);
  });

  it('never serves the previous file through the bare file URL', async () => {
    const { asset, original, replacement } = await replacedAsset();
    const served = await serve(asset.id);
    expect(served.rawPayload.equals(replacement)).toBe(true);
    expect(served.rawPayload.equals(original)).toBe(false);
  });

  // Block review G — "restorable until" holds before the sweep purges (FR-022).
  it('refuses a previous version past its restorableUntil with 409 ASSET_NO_PREVIOUS_VERSION', async () => {
    const { asset, after } = await replacedAsset();
    await h
      .em()
      .getConnection()
      .execute(`update assets set previous_replaced_at = now() - interval '10 days' where id = ?`, [asset.id]);
    const res = await restore(asset.id, {
      expectedContentVersion: after.contentVersion,
      expectedPreviousContentVersion: after.previousVersion!.contentVersion,
    });
    expect(res.statusCode, res.body).toBe(409);
    const err = (res.json() as { error: { code: string; details?: { restorableUntil?: string } } }).error;
    expect(err.code).toBe('ASSET_NO_PREVIOUS_VERSION');
    expect(Date.parse(err.details!.restorableUntil!)).toBeLessThan(Date.now());
    expect((await detail(asset.id)).contentVersion).toBe(after.contentVersion);
    expect(await auditCount(asset.id)).toBe(0);
  });
});
