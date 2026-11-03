// Typed admin client for the Assets Library — feature 013 / US1.
//
// Wraps the shared `apiClient` with strong response types inferred from
// `@endora-commerce/contracts/assets-library`. Components consume this rather than
// touching `apiClient` directly.

import { ApiError, apiBaseUrl, apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  AssetDetail,
  AssetFolder,
  AssetSummary,
  CreateFolderRequest,
  DeleteFolderRequest,
  FolderPermalinkCountResponse,
  ListAssetsResponse,
  ListFoldersResponse,
  PatchAssetRequest,
  PatchFolderRequest,
  RestorePreviousAssetVersionRequest,
} from '@endora-commerce/contracts';

export type { AssetSummary, AssetDetail, AssetFolder };

export const assetsLibraryClient = {
  async listAssets(query: {
    folderId?: string | null;
    q?: string;
    mime?: string;
    visibility?: 'public' | 'private';
    cursor?: string;
    limit?: number;
  }): Promise<ListAssetsResponse> {
    const params = new URLSearchParams();
    if (query.folderId !== undefined && query.folderId !== null) {
      params.set('folderId', query.folderId);
    }
    if (query.q) params.set('q', query.q);
    if (query.mime) params.set('mime', query.mime);
    if (query.visibility) params.set('visibility', query.visibility);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiClient.get<ListAssetsResponse>(
      `/api/v1/admin/assets${qs ? `?${qs}` : ''}`,
    );
  },

  async getAsset(id: string): Promise<AssetDetail> {
    const out = await apiClient.get<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async getAssetUrl(id: string): Promise<{ url: string; expiresAt: string | null }> {
    const out = await apiClient.get<{ data: { url: string; expiresAt: string | null } }>(
      `/api/v1/admin/assets/${encodeURIComponent(id)}/url`,
    );
    return out.data;
  },

  async patchAsset(id: string, patch: PatchAssetRequest): Promise<AssetDetail> {
    const out = await apiClient.patch<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${encodeURIComponent(id)}`,
      patch,
    );
    return out.data;
  },

  async softDeleteAsset(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/assets/${encodeURIComponent(id)}`);
  },

  async restoreAsset(id: string): Promise<AssetDetail> {
    const out = await apiClient.post<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${encodeURIComponent(id)}/restore`,
      {},
    );
    return out.data;
  },

  async moveAsset(id: string, folderId: string | null): Promise<AssetDetail> {
    const out = await apiClient.post<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${encodeURIComponent(id)}/move`,
      { folderId },
    );
    return out.data;
  },

  // — Stable URLs: replace, previous version, permalink (feature 156) ------

  /**
   * Replace the file in place. Multipart, so it goes through `fetch` over the
   * published origin as the kit's upload does; `expectedContentVersion` is sent
   * before the file part. A refusal is thrown as the kit's `ApiError`, so the
   * drawer reads its code and details as it does for every other request; an
   * answer that is not an error envelope (an HTML page from a proxy) becomes
   * `INTERNAL` with the status alone, as the kit's client makes it, never the
   * raw body. It authenticates as the kit's multipart upload does — the
   * session cookie; the admin's shared `apiClient` is built without an API key,
   * so no request of this screen sends a bearer token either.
   */
  async replaceAsset(id: string, file: File, expectedContentVersion: string): Promise<AssetDetail> {
    const fd = new FormData();
    fd.append('expectedContentVersion', expectedContentVersion);
    fd.append('file', file, file.name);
    const r = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/api/v1/admin/assets/${encodeURIComponent(id)}/replace`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!r.ok) {
      const envelope: unknown = await r.json().catch(() => null);
      if (envelope && typeof envelope === 'object' && 'error' in envelope) {
        throw new ApiError(r.status, envelope as ConstructorParameters<typeof ApiError>[1]);
      }
      throw new ApiError(r.status, { error: { code: 'INTERNAL', message: `HTTP ${r.status}` } });
    }
    return ((await r.json()) as { data: AssetDetail }).data;
  },

  async restorePreviousVersion(
    id: string,
    versions: RestorePreviousAssetVersionRequest,
  ): Promise<AssetDetail> {
    const out = await apiClient.post<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${encodeURIComponent(id)}/previous-version/restore`,
      versions,
    );
    return out.data;
  },

  async setPermalink(
    id: string,
    permalink: string,
    options?: { confirmReuse?: boolean },
  ): Promise<AssetDetail> {
    const out = await apiClient.put<{ data: AssetDetail }>(`/api/v1/admin/assets/${encodeURIComponent(id)}/permalink`, {
      permalink,
      ...(options?.confirmReuse ? { confirmReuse: true } : {}),
    });
    return out.data;
  },

  async removePermalink(id: string): Promise<AssetDetail> {
    const out = await apiClient.delete<{ data: AssetDetail }>(`/api/v1/admin/assets/${encodeURIComponent(id)}/permalink`);
    return out.data;
  },

  // — Folders --------------------------------------------------------------

  async listFolders(): Promise<AssetFolder[]> {
    const out = await apiClient.get<ListFoldersResponse>(
      '/api/v1/admin/assets/folders',
    );
    return out.data;
  },

  async createFolder(req: CreateFolderRequest): Promise<AssetFolder> {
    const out = await apiClient.post<{ data: AssetFolder }>(
      '/api/v1/admin/assets/folders',
      req,
    );
    return out.data;
  },

  async patchFolder(id: string, req: PatchFolderRequest): Promise<AssetFolder> {
    const out = await apiClient.patch<{ data: AssetFolder }>(
      `/api/v1/admin/assets/folders/${encodeURIComponent(id)}`,
      req,
    );
    return out.data;
  },

  /** How many live assets in the folder's subtree have a permalink (owner ruling S4). */
  async countFolderPermalinks(id: string): Promise<number> {
    const out = await apiClient.get<FolderPermalinkCountResponse>(
      `/api/v1/admin/assets/folders/${encodeURIComponent(id)}/permalink-count`,
    );
    return out.data.permalinkedAssets;
  },

  async deleteFolder(
    id: string,
    req: DeleteFolderRequest,
  ): Promise<{ deletedFolderId: string; softDeletedAssetIds?: string[] }> {
    const out = await apiClient.delete<{
      data: { deletedFolderId: string; softDeletedAssetIds?: string[] };
    }>(`/api/v1/admin/assets/folders/${encodeURIComponent(id)}`, {
      body: JSON.stringify(req),
      headers: { 'content-type': 'application/json' },
    });
    return out.data;
  },
};
