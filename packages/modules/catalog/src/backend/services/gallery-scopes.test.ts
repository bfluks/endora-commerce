import { describe, expect, it } from 'vitest';
import { effectiveGallery, type GalleryChannelOverrides } from './gallery-scopes.js';

/**
 * Feature 163 (FR-076, data-model §7, R14) — the gallery in one sales channel: the
 * global items minus the ones hidden there; role R held by the channel's own holder,
 * else the global one — and by nobody when that holder is hidden there.
 */
const items = [
  { id: 'hero', labels: ['base_image' as const, 'thumbnail' as const] },
  { id: 'side', labels: ['small_image' as const] },
  { id: 'life', labels: [] },
];

function overrides(partial: Partial<GalleryChannelOverrides> = {}): GalleryChannelOverrides {
  return { roles: new Map(), hidden: new Set(), ...partial };
}

describe('effectiveGallery', () => {
  it('is the global gallery when the channel has no override (off state)', () => {
    expect(effectiveGallery(items, undefined)).toEqual(items);
    expect(effectiveGallery(items, overrides())).toEqual(items);
  });

  it("moves a role to the channel's own holder, taking it off the global one (US9 #1)", () => {
    const gallery = effectiveGallery(items, overrides({ roles: new Map([['base_image', 'life']]) }));
    expect(gallery).toEqual([
      { id: 'hero', labels: ['thumbnail'] },
      { id: 'side', labels: ['small_image'] },
      { id: 'life', labels: ['base_image'] },
    ]);
  });

  it('drops a hidden item, and the roles it held resolve to none (US9 #2)', () => {
    const gallery = effectiveGallery(items, overrides({ hidden: new Set(['hero']) }));
    expect(gallery).toEqual([
      { id: 'side', labels: ['small_image'] },
      { id: 'life', labels: [] },
    ]);
  });

  it('leaves a role with no holder when the channel names a hidden item for it', () => {
    const gallery = effectiveGallery(
      items,
      overrides({ roles: new Map([['small_image', 'life']]), hidden: new Set(['life']) }),
    );
    expect(gallery.flatMap((item) => item.labels)).toEqual(['base_image', 'thumbnail']);
  });

  it('ignores a channel holder that is not one of the items: the global holder applies', () => {
    const gallery = effectiveGallery(items, overrides({ roles: new Map([['base_image', 'gone']]) }));
    expect(gallery.find((item) => item.id === 'hero')?.labels).toEqual(['base_image', 'thumbnail']);
  });

  it('keeps the items in their global order and carries their other fields', () => {
    const rich = [
      { id: 'a', labels: [], position: 0, assetId: 'x' },
      { id: 'b', labels: [], position: 1, assetId: 'y' },
    ];
    expect(effectiveGallery(rich, overrides()).map((item) => item.assetId)).toEqual(['x', 'y']);
  });
});
