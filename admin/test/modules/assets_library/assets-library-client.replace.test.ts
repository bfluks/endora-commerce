import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { assetsLibraryClient } from '../../../../packages/modules/assets_library/src/admin/api/assets-library-client';

/**
 * `specs/156-asset-stable-url/` UI block review — `replaceAsset`, the one
 * multipart request the drawer makes outside the kit's JSON client: the field
 * order the route depends on, and how a refusal reaches the drawer.
 */

const ASSET_ID = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const FILE = new File(['%PDF-1.4 new'], 'certificate-2026.pdf', { type: 'application/pdf' });

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assetsLibraryClient.replaceAsset', () => {
  it('posts expectedContentVersion before the file part, with credentials, and answers the detail', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ data: { id: ASSET_ID, filename: 'certificate-2026.pdf' } }), { status: 200 }),
    );
    const out = await assetsLibraryClient.replaceAsset(ASSET_ID, FILE, 'a1b2c3d4e5f6');
    expect(out).toMatchObject({ id: ASSET_ID, filename: 'certificate-2026.pdf' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith(`/api/v1/admin/assets/${ASSET_ID}/replace`)).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(['expectedContentVersion', 'file']);
    expect(body.get('expectedContentVersion')).toBe('a1b2c3d4e5f6');
    expect((body.get('file') as File).name).toBe('certificate-2026.pdf');
  });

  it('throws an error envelope as the kit’s ApiError, code and details intact', async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          error: { code: 'ASSET_REPLACE_KIND_MISMATCH', message: 'kind', details: { currentKind: 'pdf', newKind: 'image' } },
        }),
        { status: 415 },
      ),
    );
    const error = await assetsLibraryClient.replaceAsset(ASSET_ID, FILE, 'a1b2c3d4e5f6').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(415);
    expect((error as ApiError).envelope.error).toMatchObject({
      code: 'ASSET_REPLACE_KIND_MISMATCH',
      details: { currentKind: 'pdf', newKind: 'image' },
    });
  });

  it('throws a body that is not an envelope as the kit does — INTERNAL, never the raw body', async () => {
    stubFetch(new Response('<html><body>502 Bad Gateway from the proxy</body></html>', { status: 503 }));
    const error = await assetsLibraryClient.replaceAsset(ASSET_ID, FILE, 'a1b2c3d4e5f6').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).envelope.error.code).toBe('INTERNAL');
    expect((error as ApiError).message).not.toContain('<html>');
    expect((error as ApiError).envelope.error.message).not.toContain('<html>');
  });
});
