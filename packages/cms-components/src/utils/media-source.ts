/**
 * Where a media's files come from — the asset library or URLs
 * (`specs/163-page-builder-marketing-pages/` T191, T194).
 *
 * A source chosen in the editor is stored. A media stored before the choice
 * existed has none, and shows the one its values imply: a URL set and no
 * library asset is the URL source; anything else — an asset, both, or
 * nothing yet — is the library, whose asset has always won over a URL.
 */
export type MediaSource = 'library' | 'url';

const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

export function impliedMediaSource(
  stored: unknown,
  urls: ReadonlyArray<string | undefined>,
  assetIds: ReadonlyArray<string | undefined>,
): MediaSource {
  if (stored === 'library' || stored === 'url') return stored;
  return urls.some(filled) && !assetIds.some(filled) ? 'url' : 'library';
}

/**
 * The one of a library asset's URL and a URL a source picks: its own first,
 * the other as the fallback (unset reads as the library).
 */
export function pickBySource(source: unknown, fromLibrary: string, fromUrl: string): string {
  return source === 'url' ? fromUrl || fromLibrary : fromLibrary || fromUrl;
}
