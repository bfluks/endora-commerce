'use client';

import type { ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { withHideOn, type ResponsiveImage } from '@endora-commerce/page-builder-core';
import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import type { DownloadTileProps } from '../schema/component-types.js';
import { imageObjectField } from '../fields/section-block-fields.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';
import { Picture } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, type CmsRenderAsset } from './render-context.js';
import { hasImage } from './section-parts.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';

/**
 * `cms.DownloadTile` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US4, FR-020, FR-021: a file from the asset library,
 * referenced by identity (`fileAssetId`, which the page's asset map resolves),
 * so replacing the asset serves the new version without a page edit.
 *
 * The tile is one `<a href download>` named by its content — the title, the
 * subtitle and the link label ("Download" unless the editor writes another).
 * A file type badge comes from the asset's name or MIME type. An optional
 * image is revealed on hover (lazy). When the asset is not in the map — none
 * chosen, deleted, or private — customers get nothing and the preview a
 * warning (spec edge case).
 */

const DEFAULT_LABEL = 'Download';

/** A short file type for the badge: the file name's extension, else the MIME subtype. */
function fileType(asset: CmsRenderAsset): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(asset.filename ?? '')?.[1];
  const fromUrl = /\.([a-z0-9]{1,8})(?:[?#].*)?$/i.exec(asset.url)?.[1];
  const fromMime = asset.mimeType?.split('/')[1]?.split(/[+.;-]/)[0];
  return (fromName ?? fromUrl ?? fromMime ?? '').toUpperCase();
}

function DownloadTileBody({ props, preview }: { props: DownloadTileProps; preview: boolean }): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const asset = props.fileAssetId ? assets[props.fileAssetId] : undefined;
  const title = props.title?.trim() ?? '';
  const subtitle = props.subtitle?.trim() ?? '';
  const label = props.linkLabel?.trim() || DEFAULT_LABEL;

  if (!asset?.url) {
    if (!preview) return null;
    return (
      <div role="note" className="cmsc-pb-download-tile cmsc-pb-download-tile--missing">
        <span className="cmsc-pb-download-tile__title">{title || 'Download tile'}</span>
        <span className="cmsc-pb-download-tile__warning">
          {props.fileAssetId ? 'The file is no longer in the asset library. Choose another.' : 'Choose a file from the asset library.'}
        </span>
      </div>
    );
  }

  const type = fileType(asset);
  const hover = props.hoverImage;
  return (
    <a
      className={`cmsc-pb-download-tile${hasImage(hover) ? ' cmsc-pb-download-tile--hover-image' : ''}`}
      href={absolutizeMediaUrl(asset.url, mediaBaseUrl)}
      download={asset.filename ?? ''}
      {...itemTagsAttribute(props.tags)}
    >
      {hasImage(hover) ? (
        <span className="cmsc-pb-download-tile__hover">
          <Picture image={{ fit: 'cover', ...hover } as Partial<ResponsiveImage>} />
        </span>
      ) : null}
      <span className="cmsc-pb-download-tile__text">
        {type ? <span className="cmsc-pb-download-tile__type">{type}</span> : null}
        {title ? <span className="cmsc-pb-download-tile__title">{title}</span> : null}
        {subtitle ? <span className="cmsc-pb-download-tile__subtitle">{subtitle}</span> : null}
      </span>
      <span className="cmsc-pb-download-tile__label">{label}</span>
    </a>
  );
}

const DownloadTileRender: PuckComponent<DownloadTileProps> = (props) => {
  const environment = useBlockRenderEnvironment();
  return <DownloadTileBody props={props as unknown as DownloadTileProps} preview={environment.preview || props.puck?.isEditing === true} />;
};

const DOWNLOAD_TILE_FIELDS = {
  fileAssetId: { type: 'text' as const, label: 'File (asset ID)' },
  title: { type: 'text' as const, label: 'Title' },
  subtitle: { type: 'text' as const, label: 'Subtitle' },
  linkLabel: { type: 'text' as const, label: 'Link label' },
  hoverImage: imageObjectField('Image shown on hover'),
  // T131: tags for the Carousel's filter.
  tags: ITEM_TAGS_FIELD,
};

const downloadTileConfig: ComponentConfig<{ props: DownloadTileProps }> = {
  label: 'Download tile',
  fields: DOWNLOAD_TILE_FIELDS as unknown as Fields<DownloadTileProps>,
  defaultProps: {
    fileAssetId: '',
    title: 'Document',
    subtitle: '',
    linkLabel: DEFAULT_LABEL,
  } as DownloadTileProps,
  render: DownloadTileRender,
};

export const DownloadTile = withHideOn(downloadTileConfig);
