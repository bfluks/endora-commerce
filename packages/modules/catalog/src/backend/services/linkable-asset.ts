import { ERROR_CODES, type AssetReadPort, type AssetRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The two questions this module asks `assets_library` before it links a file by id. */
export type LinkableAssetReader = Pick<AssetReadPort, 'findById' | 'visibleToCaller'>;

/**
 * The library file an administrator may link to a catalog record, or `null` —
 * for a missing file and for one the library hides from the caller alike
 * (`specs/166-asset-reference-visibility/` FR-006, review T055 F-2).
 *
 * A product's gallery, attachments and download and a category's image are
 * unrestricted references: linking a hidden file would show it to every
 * library reader (FR-001 b), and refusing it any other way than a missing one
 * would say that it exists. `visibleToCaller` is asked right after the
 * existence read, about the row's own id.
 */
export async function findLinkableAsset(assets: LinkableAssetReader, assetId: string): Promise<AssetRecord | null> {
  const asset = await assets.findById(assetId);
  if (!asset) return null;
  return (await assets.visibleToCaller([asset.id])).has(asset.id) ? asset : null;
}

/** The answer for a file that cannot be linked — missing or hidden, byte for byte. */
export function assetNotFound(assetId: string): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, `Asset ${assetId} not found.`);
}

/** Refuse a file that cannot be linked; answers the file otherwise. */
export async function requireLinkableAsset(assets: LinkableAssetReader, assetId: string): Promise<AssetRecord> {
  const asset = await findLinkableAsset(assets, assetId);
  if (!asset) throw assetNotFound(assetId);
  return asset;
}
