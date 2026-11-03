import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T056 — a permalink serves what the file URL
 * serves (FR-016 – FR-020, US2, owner ruling P2).
 */

const HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'x-content-type-options',
  'content-security-policy',
];

describe('serving by permalink (feature 156)', () => {
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

  async function asset(visibility: 'public' | 'private' = 'public', value = pdfBytes(runName())) {
    const a = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value }, { visibility });
    created.push(a.id);
    return a.id;
  }

  async function setPermalink(id: string, permalink: string): Promise<void> {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/assets/${id}/permalink`,
      cookies: ADMIN,
      payload: { permalink, confirmReuse: true },
    });
    expect(r.statusCode, r.body).toBe(200);
  }

  const get = (url: string) => h.app.inject({ method: 'GET', url });

  async function signedQuery(id: string): Promise<string> {
    const r = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}/url`, cookies: ADMIN });
    return new URL((r.json() as { data: { url: string } }).data.url).search;
  }

  it.each([
    ['one segment', () => `${runName()}.pdf`],
    ['three segments', () => `${runName()}/docs/certificate.pdf`],
  ])('serves the file under a %s permalink with the file URL’s headers', async (_label, make) => {
    const bytes = pdfBytes(`served ${runName()}`);
    const id = await asset('public', bytes);
    const permalink = make();
    await setPermalink(id, permalink);
    const byId = await get(`/assets/file/${id}`);
    const byName = await get(`/assets/file/${permalink}`);
    expect(byName.statusCode).toBe(200);
    expect(byName.rawPayload.equals(bytes)).toBe(true);
    for (const header of HEADERS) expect(byName.headers[header], header).toBe(byId.headers[header]);
    const download = await get(`/assets/file/${permalink}?download=1`);
    expect(String(download.headers['content-disposition'])).toMatch(/^attachment;/);
    const upper = await get(`/assets/file/${permalink.toUpperCase()}`);
    expect(upper.statusCode).toBe(200);
  });

  it('serves the newest bytes after each of three replaces', async () => {
    const id = await asset();
    const permalink = `${runName()}/sheet.pdf`;
    await setPermalink(id, permalink);
    for (let i = 1; i <= 3; i += 1) {
      const bytes = pdfBytes(`version ${i} ${runName()}`);
      const r = await replaceAsset(h, id, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: bytes });
      expect(r.statusCode, r.body).toBe(200);
      expect((await get(`/assets/file/${permalink}`)).rawPayload.equals(bytes)).toBe(true);
    }
  });

  it('answers 404 on a permalink the asset no longer holds', async () => {
    const id = await asset();
    const old = `${runName()}/old.pdf`;
    await setPermalink(id, old);
    await setPermalink(id, `${runName()}/new.pdf`);
    const r = await get(`/assets/file/${old}`);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
  });

  it('answers 410 while soft-deleted, 200 once restored, 404 on both forms once purged', async () => {
    const id = await asset();
    const permalink = `${runName()}/lifecycle.pdf`;
    await setPermalink(id, permalink);
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies: ADMIN })).statusCode).toBe(200);
    expect((await get(`/assets/file/${permalink}`)).statusCode).toBe(410);
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/assets/${id}/restore`, cookies: ADMIN })).statusCode).toBe(200);
    expect((await get(`/assets/file/${permalink}`)).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies: ADMIN })).statusCode).toBe(200);
    await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 400 * 24 * 60 * 60 * 1000));
    expect((await get(`/assets/file/${permalink}`)).statusCode).toBe(404);
    expect((await get(`/assets/file/${id}`)).statusCode).toBe(404);
  });

  it('hides a private asset’s permalink without a valid signature and serves it with one', async () => {
    const id = await asset('private');
    const permalink = `${runName()}/private.pdf`;
    await setPermalink(id, permalink);
    const hidden = await get(`/assets/file/${permalink}`);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
    const query = await signedQuery(id);
    const served = await get(`/assets/file/${permalink}${query}`);
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toBe('private, no-store, max-age=0');

    expect((await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies: ADMIN })).statusCode).toBe(200);
    expect((await get(`/assets/file/${permalink}`)).statusCode).toBe(404);
    expect((await get(`/assets/file/${permalink}${query}`)).statusCode).toBe(410);
  });

  it('stops serving a public asset’s permalink at the next request once it is made private', async () => {
    const id = await asset();
    const permalink = `${runName()}/flip.pdf`;
    await setPermalink(id, permalink);
    expect((await get(`/assets/file/${permalink}`)).statusCode).toBe(200);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/assets/${id}`,
      cookies: ADMIN,
      payload: { visibility: 'private' },
    });
    expect(patch.statusCode).toBe(200);
    expect((await get(`/assets/file/${permalink}`)).statusCode).toBe(404);
  });

  // Security review: a name no permalink can be — a NUL byte, characters outside
  // the permalink rule, more than 200 characters — never reaches the database and
  // answers exactly what an unused name answers.
  it.each([
    ['a NUL byte', 'a%00b'],
    ['a character outside the rule', 'a%20b.pdf'],
    ['an over-length name', 'n'.repeat(201)],
  ])('answers %s with the 404 an unused name gets', async (_label, path) => {
    const unused = await get(`/assets/file/${runName()}-unused.pdf`);
    const junk = await get(`/assets/file/${path}`);
    expect(unused.statusCode).toBe(404);
    expect(junk.statusCode).toBe(404);
    const strip = (body: string) => {
      const parsed = JSON.parse(body) as { error: Record<string, unknown> };
      delete parsed.error['requestId'];
      return parsed;
    };
    expect(strip(junk.body)).toEqual(strip(unused.body));
    for (const header of [...HEADERS, 'content-type']) expect(junk.headers[header], header).toBe(unused.headers[header]);
  });
});
