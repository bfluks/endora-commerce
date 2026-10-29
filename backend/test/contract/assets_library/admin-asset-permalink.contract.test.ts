import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  createAssetsReader,
  forgetAssets,
  pdfBytes,
  runName,
  uploadAsset,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T049 — `PUT` / `DELETE
 * /api/v1/admin/assets/:id/permalink` (contracts/admin-api.md §2; FR-014 –
 * FR-019, FR-021, FR-037, owner ruling P5).
 */

interface Detail {
  id: string;
  permalink: string | null;
  permalinkUrl: string | null;
  fileUrl: string;
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('asset permalinks (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  let reader: Awaited<ReturnType<typeof createAssetsReader>>;
  const created: string[] = [];
  const names: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    reader = await createAssetsReader(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    if (names.length > 0) {
      const lowered = names.map((n) => n.toLowerCase());
      await h
        .em()
        .getConnection()
        .execute(
          `delete from asset_permalink_releases where permalink_lower in (${lowered.map(() => '?').join(', ')})`,
          lowered,
        );
    }
    await reader.undo();
    await store.undo();
    await teardownBackendServer(h);
  });

  /** A per-run permalink: `as156-<s>/<leaf>`. */
  function name(leaf = 'certificate.pdf'): string {
    const value = `${runName()}/${leaf}`;
    names.push(value);
    return value;
  }

  async function asset(fields: Record<string, string> = {}): Promise<string> {
    const a = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('p') }, fields);
    created.push(a.id);
    return a.id;
  }

  function put(id: string, body: Record<string, unknown>, cookies = ADMIN) {
    return h.app.inject({ method: 'PUT', url: `/api/v1/admin/assets/${id}/permalink`, cookies, payload: body });
  }

  function remove(id: string, cookies = ADMIN) {
    return h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}/permalink`, cookies });
  }

  async function audits(id: string, action: string) {
    return h.em().fork().find(AuditLogEntry, { action, objectId: id }, { orderBy: { actedAt: 'asc', id: 'asc' } });
  }

  async function detail(id: string): Promise<Detail> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}`, cookies: ADMIN });
    return (res.json() as { data: Detail }).data;
  }

  it('sets a permalink, answers its URL on the file base, audits once, and is idempotent', async () => {
    const id = await asset();
    const value = name();
    const res = await put(id, { permalink: value });
    expect(res.statusCode, res.body).toBe(200);
    const body = (res.json() as { data: Detail }).data;
    expect(body.permalink).toBe(value);
    const base = body.fileUrl.slice(0, body.fileUrl.indexOf('/assets/file/'));
    expect(body.permalinkUrl).toBe(`${base}/assets/file/${value}`);
    expect(await audits(id, 'asset.permalink_set')).toHaveLength(1);

    const again = await put(id, { permalink: value });
    expect(again.statusCode).toBe(200);
    expect(await audits(id, 'asset.permalink_set')).toHaveLength(1);
  });

  it('refuses a permalink another asset holds, case-insensitively, changing neither', async () => {
    const first = await asset();
    const second = await asset();
    const value = name();
    expect((await put(first, { permalink: value })).statusCode).toBe(200);
    const res = await put(second, { permalink: value.toUpperCase() });
    expect(res.statusCode).toBe(409);
    const err = (res.json() as ErrorBody).error;
    expect(err.code).toBe('ASSET_PERMALINK_TAKEN');
    expect(err.details).toMatchObject({ permalink: value.toUpperCase(), assetId: first });
    expect((await detail(first)).permalink).toBe(value);
    expect((await detail(second)).permalink).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['a'.repeat(201), 'too_long'],
    ['a b.pdf', 'invalid_characters'],
    ['/a.pdf', 'invalid_segment'],
    [randomUUID(), 'uuid_shaped'],
  ])('refuses %j with 400 ASSET_PERMALINK_INVALID (%s), in Polish for a Polish-speaking admin', async (value, reason) => {
    const id = await asset();
    const res = await put(id, { permalink: value });
    expect(res.statusCode).toBe(400);
    const err = (res.json() as ErrorBody).error;
    expect(err.code).toBe('ASSET_PERMALINK_INVALID');
    expect(err.details).toEqual({ code: reason });

    const setLanguage = (language: 'pl' | null) =>
      h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferred-language',
        cookies: ADMIN,
        payload: { preferredLanguage: language },
      });
    expect((await setLanguage('pl')).statusCode).toBe(200);
    try {
      const pl = await put(id, { permalink: value });
      expect((pl.json() as ErrorBody).error.message).toMatch(/[Ss]tały link/);
    } finally {
      await setLanguage(null);
    }
  });

  it('frees a changed permalink at once and asks before another asset takes it; the confirmation is audited', async () => {
    const first = await asset();
    const second = await asset();
    const old = name('sheet.pdf');
    expect((await put(first, { permalink: old })).statusCode).toBe(200);
    expect((await put(first, { permalink: name('sheet-2026.pdf') })).statusCode).toBe(200);
    const stale = await h.app.inject({ method: 'GET', url: `/assets/file/${old}` });
    expect(stale.statusCode).toBe(404);

    const refused = await put(second, { permalink: old });
    expect(refused.statusCode).toBe(409);
    const err = (refused.json() as ErrorBody).error;
    expect(err.code).toBe('ASSET_PERMALINK_PREVIOUSLY_USED');
    expect(err.details).toMatchObject({ permalink: old });
    expect(typeof err.details!['releasedAt']).toBe('string');
    expect((await detail(second)).permalink).toBeNull();

    const confirmed = await put(second, { permalink: old, confirmReuse: true });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const rows = await audits(second, 'asset.permalink_set');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateAfter).toMatchObject({
      permalink: old,
      reusedPermalink: { previousAssetId: first, releasedAt: err.details!['releasedAt'], reason: 'changed' },
    });
  });

  it('lets an asset take its own former permalink back without confirmation (FR-037)', async () => {
    const id = await asset();
    const old = name('own.pdf');
    expect((await put(id, { permalink: old })).statusCode).toBe(200);
    expect((await put(id, { permalink: name('own-new.pdf') })).statusCode).toBe(200);
    const back = await put(id, { permalink: old });
    expect(back.statusCode, back.body).toBe(200);
    const rows = await audits(id, 'asset.permalink_set');
    expect(rows).toHaveLength(3);
    expect(rows[2]!.stateAfter).not.toHaveProperty('reusedPermalink');
    const releases = await h
      .em()
      .getConnection()
      .execute(`select 1 from asset_permalink_releases where permalink_lower = ?`, [old.toLowerCase()]);
    expect(releases).toHaveLength(0);
  });

  it('asks again when a different asset held the name last, even if this asset held it before', async () => {
    const x = await asset();
    const y = await asset();
    const value = name('shared.pdf');
    expect((await put(x, { permalink: value })).statusCode).toBe(200);
    expect((await remove(x)).statusCode).toBe(200);
    expect((await put(y, { permalink: value, confirmReuse: true })).statusCode).toBe(200);
    expect((await remove(y)).statusCode).toBe(200);

    const refused = await put(x, { permalink: value });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as ErrorBody).error.code).toBe('ASSET_PERMALINK_PREVIOUSLY_USED');
    const confirmed = await put(x, { permalink: value, confirmReuse: true });
    expect(confirmed.statusCode).toBe(200);
    const rows = await audits(x, 'asset.permalink_set');
    expect(rows.at(-1)!.stateAfter).toMatchObject({ reusedPermalink: { previousAssetId: y, reason: 'removed' } });
  });

  it('removes a permalink once, audited, and answers 200 without an audit row when none is set', async () => {
    const id = await asset();
    expect((await put(id, { permalink: name() })).statusCode).toBe(200);
    const res = await remove(id);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Detail }).data.permalink).toBeNull();
    expect(await audits(id, 'asset.permalink_remove')).toHaveLength(1);
    expect((await remove(id)).statusCode).toBe(200);
    expect(await audits(id, 'asset.permalink_remove')).toHaveLength(1);
  });

  it('finds an asset by its permalink in the list search', async () => {
    const id = await asset();
    const value = name('searchable.pdf');
    expect((await put(id, { permalink: value })).statusCode).toBe(200);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/assets?q=${encodeURIComponent(value.split('/')[0]!)}`,
      cookies: ADMIN,
    });
    expect((res.json() as { data: Array<{ id: string }> }).data.map((a) => a.id)).toContain(id);
  });

  it('accepts a permalink on a private asset', async () => {
    const id = await asset({ visibility: 'private' });
    const res = await put(id, { permalink: name('private.pdf') });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('keeps a soft-deleted asset’s permalink reserved', async () => {
    const holder = await asset();
    const other = await asset();
    const value = name('reserved.pdf');
    expect((await put(holder, { permalink: value })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${holder}`, cookies: ADMIN })).statusCode).toBe(200);
    const res = await put(other, { permalink: value });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_PERMALINK_TAKEN');
  });

  // Security review: a soft-deleted asset is refused like a replace or a restore
  // of it — restore the asset first — and its permalink stays as it was.
  it('refuses to set or remove the permalink of a soft-deleted asset with 410, changing nothing', async () => {
    const id = await asset();
    const value = name('deleted.pdf');
    expect((await put(id, { permalink: value })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies: ADMIN })).statusCode).toBe(200);
    const set = await put(id, { permalink: name('other.pdf') });
    expect(set.statusCode, set.body).toBe(410);
    expect((set.json() as ErrorBody).error.code).toBe('ASSET_GONE');
    const removed = await remove(id);
    expect(removed.statusCode, removed.body).toBe(410);
    expect((removed.json() as ErrorBody).error.code).toBe('ASSET_GONE');
    const rows = await h.em().fork().execute<Array<{ permalink: string | null }>>(
      'select permalink from assets where id = ?',
      [id],
    );
    expect(rows[0]?.permalink).toBe(value);
    expect(await audits(id, 'asset.permalink_set')).toHaveLength(1);
    expect(await audits(id, 'asset.permalink_remove')).toHaveLength(0);
  });

  it('refuses an assets.read admin with 403 on PUT and DELETE', async () => {
    const id = await asset();
    expect((await put(id, { permalink: name() }, reader.cookies)).statusCode).toBe(403);
    expect((await remove(id, reader.cookies)).statusCode).toBe(403);
  });
});
