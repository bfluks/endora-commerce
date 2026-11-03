'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { DesktopFromTier, Responsive, ResponsiveImage } from '@endora-commerce/page-builder-core';
import { ratioVars } from '../utils/aspect-ratio.js';
import { resolveImageUrl } from '../utils/resolve-image-url.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';

/** Below the tablet tier (768 px), the mobile image is the one shown. */
export const PICTURE_MOBILE_MEDIA = '(max-width: 767.98px)';

/** R19C (T263): with `desktopFrom: 'desktop'`, below the desktop tier (1024 px). */
export const PICTURE_MOBILE_MEDIA_BELOW_DESKTOP = '(max-width: 1023.98px)';

/** The media query under which an image's mobile variant is shown; unset or `tablet`, today's. */
export function pictureMobileMedia(desktopFrom: DesktopFromTier | undefined): string {
  return desktopFrom === 'desktop' ? PICTURE_MOBILE_MEDIA_BELOW_DESKTOP : PICTURE_MOBILE_MEDIA;
}

export interface PictureProps {
  image: ResponsiveImage | Partial<ResponsiveImage>;
  /** The page's lead image: loaded eagerly with a high fetch priority. */
  priority?: boolean;
  className?: string;
}

/**
 * A `ResponsiveImage` as one `<picture>` (`specs/163-page-builder-marketing-pages/`
 * research R-9): the mobile image as a `<source>` below the tablet tier (or,
 * with `desktopFrom: 'desktop'`, R19C, below the desktop tier), the
 * desktop image as the `<img>`, and a mobile-only image used at every width.
 * Lazy and async-decoded unless it is the priority image. Renders nothing when
 * there is no image at all.
 */
export function Picture({ image, priority = false, className }: PictureProps): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const source = image.imageSource ?? 'url';

  const desktop = resolveImageUrl(
    { imageSource: source, ...(image.src !== undefined ? { src: image.src } : {}), ...(image.assetId ? { assetId: image.assetId } : {}) },
    null,
    assets,
    mediaBaseUrl,
  );
  const mobile = resolveImageUrl(
    {
      imageSource: source,
      ...(image.mobileSrc !== undefined ? { src: image.mobileSrc } : {}),
      ...(image.mobileAssetId ? { assetId: image.mobileAssetId } : {}),
    },
    null,
    assets,
    mediaBaseUrl,
  );

  const src = desktop || mobile;
  if (!src) return null;

  const vars = ratioVars(image.ratio as Responsive<string> | undefined);
  const hasRatio = Object.keys(vars).length > 0;
  const imgStyle: CSSProperties = {
    ...(image.fit ? { objectFit: image.fit } : {}),
    ...(image.position ? { objectPosition: image.position } : {}),
  };

  return (
    <picture
      className={['cmsc-picture', hasRatio ? 'cmsc-picture--ratio' : '', className ?? ''].filter(Boolean).join(' ')}
      style={vars as CSSProperties}
    >
      {desktop && mobile && mobile !== desktop ? <source media={pictureMobileMedia(image.desktopFrom)} srcSet={mobile} /> : null}
      <img
        src={src}
        alt={image.alt ?? ''}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        {...(Object.keys(imgStyle).length > 0 ? { style: imgStyle } : {})}
      />
    </picture>
  );
}
