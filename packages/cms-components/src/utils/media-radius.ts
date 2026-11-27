import type { CSSProperties } from 'react';
import { CORNER_RADIUS_PX, type CornerRadius } from '@endora-commerce/page-builder-core';

/**
 * Feature 163, T140 — a media frame's corners (`mediaCornerRadius` on
 * `cms.LinkTile`, `cms.CarouselImage` and `cms.Video`). The stylesheet reads
 * `--pb-media-radius` with today's 8 px as its fallback, so a block stored
 * without the option, and the default `medium`, look as before.
 */
export const DEFAULT_MEDIA_CORNER_RADIUS: CornerRadius = 'medium';

/** A known corner radius in pixels, else `null`. */
export function mediaRadiusPx(value: unknown): string | null {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(CORNER_RADIUS_PX, value)) return null;
  return `${CORNER_RADIUS_PX[value as CornerRadius]}px`;
}

/** `--pb-media-radius` for a known corner radius, nothing otherwise. */
export function mediaRadiusVars(value: unknown): CSSProperties {
  const px = mediaRadiusPx(value);
  return px === null ? {} : ({ ['--pb-media-radius' as string]: px } as CSSProperties);
}
