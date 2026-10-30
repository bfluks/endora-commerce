import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `specs/156-asset-stable-url/` security review — every request the module's
 * admin client builds encodes the asset or folder id it puts in the path, so an
 * id can never add a segment or a query of its own; and the replace request
 * authenticates exactly as the kit's own multipart upload does.
 */

const calls = vi.hoisted(() => [] as Array<{ method: string; path: string }>);
vi.mock('@endora-commerce/admin-kit/lib', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const record = (method: string) => async (path: string) => {
    calls.push({ method, path });
    return { data: { permalinkedAssets: 0 } };
  };
  return {
    ...actual,
    apiClient: { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') },
  };
});

const { assetsLibraryClient } = await import('../../../../packages/modules/assets_library/src/admin/api/assets-library-client');
const { uploadAsset } = await import('@endora-commerce/admin-kit/components');

const HOSTILE = '../x?y=1#z';
const ENCODED = encodeURIComponent(HOSTILE);

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('assetsLibraryClient — ids in paths', () => {
  it.each([
    ['getAsset', () => assetsLibraryClient.getAsset(HOSTILE), `/api/v1/admin/assets/${ENCODED}`],
    ['getAssetUrl', () => assetsLibraryClient.getAssetUrl(HOSTILE), `/api/v1/admin/assets/${ENCODED}/url`],
    ['patchAsset', () => assetsLibraryClient.patchAsset(HOSTILE, {}), `/api/v1/admin/assets/${ENCODED}`],
    ['softDeleteAsset', () => assetsLibraryClient.softDeleteAsset(HOSTILE), `/api/v1/admin/assets/${ENCODED}`],
    ['restoreAsset', () => assetsLibraryClient.restoreAsset(HOSTILE), `/api/v1/admin/assets/${ENCODED}/restore`],
    ['moveAsset', () => assetsLibraryClient.moveAsset(HOSTILE, null), `/api/v1/admin/assets/${ENCODED}/move`],
    [
      'restorePreviousVersion',
      () => assetsLibraryClient.restorePreviousVersion(HOSTILE, { expectedContentVersion: 'a', expectedPreviousContentVersion: 'b' }),
      `/api/v1/admin/assets/${ENCODED}/previous-version/restore`,
    ],
    ['setPermalink', () => assetsLibraryClient.setPermalink(HOSTILE, 'x.pdf'), `/api/v1/admin/assets/${ENCODED}/permalink`],
    ['removePermalink', () => assetsLibraryClient.removePermalink(HOSTILE), `/api/v1/admin/assets/${ENCODED}/permalink`],
    ['countFolderPermalinks', () => assetsLibraryClient.countFolderPermalinks(HOSTILE), `/api/v1/admin/assets/folders/${ENCODED}/permalink-count`],
    ['patchFolder', () => assetsLibraryClient.patchFolder(HOSTILE, { name: 'n' }), `/api/v1/admin/assets/folders/${ENCODED}`],
    [
      'deleteFolder',
      () => assetsLibraryClient.deleteFolder(HOSTILE, { mode: 'move-to-parent' } as never),
      `/api/v1/admin/assets/folders/${ENCODED}`,
    ],
  ])('%s encodes the id', async (_name, call, path) => {
    await call();
    expect(calls.map((c) => c.path)).toEqual([path]);
  });

  it('replaceAsset encodes the id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await assetsLibraryClient.replaceAsset(HOSTILE, new File(['x'], 'x.pdf'), 'a1b2c3d4e5f6');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.endsWith(`/api/v1/admin/assets/${ENCODED}/replace`)).toBe(true);
  });
});

describe('assetsLibraryClient.replaceAsset — authentication', () => {
  it('sends the credentials and headers the kit’s own multipart upload sends', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadAsset(new File(['x'], 'x.pdf'), {});
    await assetsLibraryClient.replaceAsset('id', new File(['x'], 'x.pdf'), 'a1b2c3d4e5f6');
    const [, upload] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, replace] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(replace.credentials).toBe(upload.credentials);
    expect(new Headers(replace.headers).get('authorization')).toBe(new Headers(upload.headers).get('authorization'));
  });
});
