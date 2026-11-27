'use client';

import type { ComponentConfig } from '@puckeditor/core';
import {
  createButtonListField,
  createButtonSpecField,
  createFileAssetField,
  createImageAssetField,
  createLinkField,
  createResponsiveImageField,
} from '@endora-commerce/page-builder-admin';
import { createMediaTextMediaField } from './SectionBlockFields.js';

/**
 * Feature 163, T054 — the admin's fields of the Carousel (`cms.ContentSlider`)
 * and its four item blocks (`specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, research R-9, R-11, R-12): item images through the
 * responsive image field, a download tile's file through the asset picker
 * (any file type), a split slide's media through `cms.MediaText`'s control,
 * links through the link field, buttons through the button fields with their
 * link pickers.
 *
 * Every other field — and the order of the fields — is the block's own.
 */

// Stable: a field recreated on every merge loses its input focus.
const IMAGE_FIELD = createResponsiveImageField({ label: 'Image' });
const HOVER_IMAGE_FIELD = createResponsiveImageField({ label: 'Image shown on hover' });
const LINK_FIELD = createLinkField({ label: 'Link' });
const OPTIONAL_LINK_FIELD = createLinkField({ label: 'Link (optional)' });
const FILE_FIELD = createFileAssetField('File');
const ICON_ASSET_FIELD = createImageAssetField('Uploaded icon (SVG)');
const MEDIA_FIELD = createMediaTextMediaField();
const SPLIT_BUTTONS_FIELD = createButtonListField({ label: 'Buttons', max: 2, responsive: true });
const HEADER_BUTTON_FIELD = createButtonSpecField({ label: 'Button', responsive: true });

type FieldMap = Record<string, unknown>;
type ObjectLike = { type?: string; objectFields?: FieldMap };

/** `fields` with each named field replaced, where the block has it. */
function swap(fields: FieldMap, replacements: FieldMap): FieldMap {
  const next = { ...fields };
  for (const [key, field] of Object.entries(replacements)) if (key in next) next[key] = field;
  return next;
}

const SWAPS: Record<string, (fields: FieldMap) => FieldMap> = {
  'cms.ContentSlider': (fields) => {
    const header = fields['header'] as ObjectLike | undefined;
    if (header?.type !== 'object' || !header.objectFields) return fields;
    return swap(fields, { header: { ...header, objectFields: swap(header.objectFields, { button: HEADER_BUTTON_FIELD }) } });
  },
  'cms.CarouselImage': (fields) => swap(fields, { image: IMAGE_FIELD, link: OPTIONAL_LINK_FIELD }),
  'cms.CarouselSplit': (fields) => swap(fields, { media: MEDIA_FIELD, iconAssetId: ICON_ASSET_FIELD, buttons: SPLIT_BUTTONS_FIELD }),
  'cms.LinkTile': (fields) => swap(fields, { image: IMAGE_FIELD, link: LINK_FIELD }),
  // R20E (T303): the page link has the page, product, category and file pickers.
  'cms.DownloadTile': (fields) => swap(fields, { fileAssetId: FILE_FIELD, link: LINK_FIELD, hoverImage: HOVER_IMAGE_FIELD }),
};

/** The Carousel blocks this module gives library pickers to. */
export const CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS: readonly string[] = Object.keys(SWAPS);

/** `config` with the admin's pickers, when `name` is one of {@link CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS}; any other block as it is. */
export function withAdminCarouselFields(name: string, config: ComponentConfig): ComponentConfig {
  const apply = SWAPS[name];
  if (!apply) return config;
  return { ...config, fields: apply({ ...(config.fields ?? {}) }) } as ComponentConfig;
}
