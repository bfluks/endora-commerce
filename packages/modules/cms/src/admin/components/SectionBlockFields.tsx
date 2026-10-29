'use client';

import type { ReactElement } from 'react';
import { FieldLabel, type ComponentConfig, type CustomField } from '@puckeditor/core';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ToggleSwitch, type Responsive, type ResponsiveImage } from '@endora-commerce/page-builder-core';
import { impliedMediaSource } from '@endora-commerce/cms-components';
import {
  createButtonListField,
  createImageAssetField,
  createImageUrlField,
  createResponsiveImageField,
  createVideoAssetField,
  inputClassName,
  ResponsiveImageControl,
  ResponsiveRatioControl,
} from '@endora-commerce/page-builder-admin';
import { createAdminBackgroundField } from './BackgroundFields.js';

/**
 * Feature 163, T047 and T049 — the admin's fields of the section blocks of US3
 * (`specs/163-page-builder-marketing-pages/` contracts/blocks.md, research R-9,
 * R-11): images through the responsive image field, a `cms.MediaText` media
 * (an art-directed image, or a video — from the library or, T142, by URL, each
 * with its mobile video — with its poster, mobile poster and the autoplay choice), uploaded SVG icons through the image asset picker, and button lists
 * through the shared list field and its link pickers. A `cms.Testimonial`'s
 * card background keeps the library background field it had.
 *
 * Every other field — and the order of the fields — is the block's own; the
 * blocks' `resolveFields` filter the host's field set, so the swaps survive.
 */

interface MediaTextMediaValue {
  kind: 'image' | 'video';
  image?: Partial<ResponsiveImage>;
  videoSource?: 'library' | 'url';
  videoAssetId?: string;
  videoUrl?: string;
  mobileVideoAssetId?: string;
  mobileVideoUrl?: string;
  posterSource?: 'library' | 'url';
  posterAssetId?: string;
  posterUrl?: string;
  mobilePosterAssetId?: string;
  mobilePosterUrl?: string;
  autoplay?: boolean;
  ratio?: Responsive<string> | undefined;
}

/**
 * R17 (T217): the poster source shown — the stored one, else the one the
 * stored posters imply (a URL and no library image: URL), as the hero's and
 * the video block's control do.
 */
export function mediaTextPosterSource(media: MediaTextMediaValue): 'library' | 'url' {
  return impliedMediaSource(media.posterSource, [media.posterUrl, media.mobilePosterUrl], [media.posterAssetId, media.mobilePosterAssetId]);
}

/** What a kind starts from when it is chosen: nothing of the previous kind is kept. */
const KIND_START: Record<MediaTextMediaValue['kind'], MediaTextMediaValue> = {
  image: { kind: 'image', image: { imageSource: 'library', alt: '' } },
  video: { kind: 'video', autoplay: false },
};

// One field object each, so a re-render does not hand Puck a new field.
const VIDEO_ASSET_FIELD = createVideoAssetField('Video');
const VIDEO_URL_FIELD = createImageUrlField('Video URL');
const MOBILE_VIDEO_ASSET_FIELD = createVideoAssetField('Mobile video');
const MOBILE_VIDEO_URL_FIELD = createImageUrlField('Mobile video URL');
const POSTER_ASSET_FIELD = createImageAssetField('Poster image');
const POSTER_URL_FIELD = createImageUrlField('Poster URL');
const MOBILE_POSTER_ASSET_FIELD = createImageAssetField('Mobile poster image');
const MOBILE_POSTER_URL_FIELD = createImageUrlField('Mobile poster URL');

function MediaTextMediaControl({
  value,
  onChange,
  readOnly,
}: {
  value: MediaTextMediaValue | undefined;
  onChange: (value: MediaTextMediaValue) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const t = useTranslation('cms');
  const current: MediaTextMediaValue = value?.kind === 'video' || value?.kind === 'image' ? value : KIND_START.image;
  const set = (patch: Partial<MediaTextMediaValue>): void => onChange({ ...current, ...patch });
  const ro = readOnly === true ? { readOnly: true } : {};
  const key = (name: string): string => `blocks.mediaText.fields.media.fields.${name}`;

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label={t(key('kind.label'))}
        className={inputClassName}
        disabled={readOnly === true}
        value={current.kind}
        onChange={(e): void => onChange(KIND_START[e.target.value as MediaTextMediaValue['kind']] ?? KIND_START.image)}
      >
        <option value="image">{t(key('kind.options.image'))}</option>
        <option value="video">{t(key('kind.options.video'))}</option>
      </select>

      {current.kind === 'image' ? (
        <div className="flex flex-col gap-1" role="group" aria-label={t(key('image.label'))}>
          <ResponsiveImageControl value={current.image} onChange={(image): void => set({ image })} readOnly={readOnly} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* T142: library videos (today's) or URLs, each with a mobile video. */}
          <select
            aria-label={t(key('videoSource.label'))}
            className={inputClassName}
            disabled={readOnly === true}
            value={current.videoSource ?? 'library'}
            onChange={(e): void => set({ videoSource: e.target.value as 'library' | 'url' })}
          >
            <option value="library">{t(key('videoSource.options.library'))}</option>
            <option value="url">{t(key('videoSource.options.url'))}</option>
          </select>
          {(current.videoSource ?? 'library') === 'library' ? (
            <>
              <VIDEO_ASSET_FIELD.render
                field={{ ...VIDEO_ASSET_FIELD, label: t(key('videoAssetId.label')) }}
                id="pb-media-text-video"
                name="media.videoAssetId"
                value={current.videoAssetId ?? ''}
                onChange={(assetId): void => set({ videoAssetId: assetId })}
                {...ro}
              />
              <MOBILE_VIDEO_ASSET_FIELD.render
                field={{ ...MOBILE_VIDEO_ASSET_FIELD, label: t(key('mobileVideoAssetId.label')) }}
                id="pb-media-text-mobile-video"
                name="media.mobileVideoAssetId"
                value={current.mobileVideoAssetId ?? ''}
                onChange={(assetId): void => set({ mobileVideoAssetId: assetId })}
                {...ro}
              />
            </>
          ) : (
            <>
              <VIDEO_URL_FIELD.render
                field={{ ...VIDEO_URL_FIELD, label: t(key('videoUrl.label')) }}
                id="pb-media-text-video-url"
                name="media.videoUrl"
                value={current.videoUrl ?? ''}
                onChange={(url): void => set({ videoUrl: url })}
                {...ro}
              />
              <MOBILE_VIDEO_URL_FIELD.render
                field={{ ...MOBILE_VIDEO_URL_FIELD, label: t(key('mobileVideoUrl.label')) }}
                id="pb-media-text-mobile-video-url"
                name="media.mobileVideoUrl"
                value={current.mobileVideoUrl ?? ''}
                onChange={(url): void => set({ mobileVideoUrl: url })}
                {...ro}
              />
            </>
          )}
          {/* R17 (T217): the poster source governs both posters, as the hero's does (T191). */}
          <select
            aria-label={t(key('posterSource.label'))}
            className={inputClassName}
            disabled={readOnly === true}
            value={mediaTextPosterSource(current)}
            onChange={(e): void => set({ posterSource: e.target.value as 'library' | 'url' })}
          >
            <option value="library">{t(key('posterSource.options.library'))}</option>
            <option value="url">{t(key('posterSource.options.url'))}</option>
          </select>
          {mediaTextPosterSource(current) === 'library' ? (
            <>
              <POSTER_ASSET_FIELD.render
                field={{ ...POSTER_ASSET_FIELD, label: t(key('posterAssetId.label')) }}
                id="pb-media-text-poster"
                name="media.posterAssetId"
                value={current.posterAssetId ?? ''}
                onChange={(assetId): void => set({ posterAssetId: assetId })}
                {...ro}
              />
              {/* T162: the mobile video's own poster. */}
              <MOBILE_POSTER_ASSET_FIELD.render
                field={{ ...MOBILE_POSTER_ASSET_FIELD, label: t(key('mobilePosterAssetId.label')) }}
                id="pb-media-text-mobile-poster"
                name="media.mobilePosterAssetId"
                value={current.mobilePosterAssetId ?? ''}
                onChange={(assetId): void => set({ mobilePosterAssetId: assetId })}
                {...ro}
              />
            </>
          ) : (
            <>
              <POSTER_URL_FIELD.render
                field={{ ...POSTER_URL_FIELD, label: t(key('posterUrl.label')) }}
                id="pb-media-text-poster-url"
                name="media.posterUrl"
                value={current.posterUrl ?? ''}
                onChange={(url): void => set({ posterUrl: url })}
                {...ro}
              />
              <MOBILE_POSTER_URL_FIELD.render
                field={{ ...MOBILE_POSTER_URL_FIELD, label: t(key('mobilePosterUrl.label')) }}
                id="pb-media-text-mobile-poster-url"
                name="media.mobilePosterUrl"
                value={current.mobilePosterUrl ?? ''}
                onChange={(url): void => set({ mobilePosterUrl: url })}
                {...ro}
              />
            </>
          )}
          {/* T126: the frame's ratio per breakpoint; unset is 16:9. */}
          <ResponsiveRatioControl
            label={t(key('ratio.label'))}
            value={current.ratio}
            defaultRatio="16:9"
            allowAuto={false}
            readOnly={readOnly}
            onChange={(ratio): void => set({ ratio })}
          />
          {/* R17 (T204): the page builder's one true/false control. */}
          <ToggleSwitch
            size="sm"
            label={t(key('autoplay.label'))}
            checked={current.autoplay === true}
            readOnly={readOnly === true}
            onChange={(autoplay): void => set({ autoplay })}
          />
        </div>
      )}
    </div>
  );
}

/** A `cms.MediaText` media (and each row's), picking images and videos from the asset library. */
export function createMediaTextMediaField(): CustomField<MediaTextMediaValue | undefined> {
  return {
    type: 'custom',
    label: 'Media',
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? 'Media'} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <MediaTextMediaControl value={value} onChange={onChange} readOnly={readOnly} />
      </FieldLabel>
    ),
  };
}

// Stable: a field recreated on every merge loses its input focus.
const MEDIA_FIELD = createMediaTextMediaField();
const IMAGE_FIELD = createResponsiveImageField({ label: 'Image' });
const AVATAR_FIELD = createResponsiveImageField({ label: 'Avatar' });
const ICON_ASSET_FIELD = createImageAssetField('Uploaded icon (SVG)');
const BACKGROUND_FIELD = createAdminBackgroundField();
const BUTTONS_FIELDS: Record<number, ReturnType<typeof createButtonListField>> = {
  3: createButtonListField({ label: 'Buttons', max: 3, responsive: true }),
  4: createButtonListField({ label: 'Buttons', max: 4, responsive: true }),
};

type FieldMap = Record<string, unknown>;
type NestedField = { type?: string; arrayFields?: FieldMap; objectFields?: FieldMap };

/** `fields` with each named field replaced, where the block has it. */
function swap(fields: FieldMap, replacements: FieldMap): FieldMap {
  const next = { ...fields };
  for (const [key, field] of Object.entries(replacements)) if (key in next) next[key] = field;
  return next;
}

/** An array field whose item fields are swapped. */
function swapItems(field: unknown, replacements: FieldMap): unknown {
  const array = field as NestedField | undefined;
  if (array?.type !== 'array' || !array.arrayFields) return field;
  return { ...array, arrayFields: swap(array.arrayFields, replacements) };
}

/** An object field whose properties are swapped. */
function swapObject(field: unknown, replacements: FieldMap): unknown {
  const object = field as NestedField | undefined;
  if (object?.type !== 'object' || !object.objectFields) return field;
  return { ...object, objectFields: swap(object.objectFields, replacements) };
}

const ICON_ITEMS = { iconAssetId: ICON_ASSET_FIELD };

const SWAPS: Record<string, (fields: FieldMap) => FieldMap> = {
  'cms.MediaText': (fields) => {
    const rows = fields['rows'] as NestedField | undefined;
    return swap(fields, {
      media: MEDIA_FIELD,
      buttons: BUTTONS_FIELDS[4],
      features: swapItems(fields['features'], ICON_ITEMS),
      ...(rows
        ? {
            rows: swapItems(rows, {
              media: MEDIA_FIELD,
              buttons: BUTTONS_FIELDS[4],
              features: swapItems(rows.arrayFields?.['features'], ICON_ITEMS),
            }),
          }
        : {}),
    });
  },
  'cms.BackgroundPanel': (fields) => swap(fields, { image: IMAGE_FIELD, iconAssetId: ICON_ASSET_FIELD, buttons: BUTTONS_FIELDS[3] }),
  'cms.CtaCard': (fields) => swap(fields, { image: IMAGE_FIELD, buttons: BUTTONS_FIELDS[3] }),
  'cms.Statement': (fields) => swap(fields, { background: swapObject(fields['background'], { image: IMAGE_FIELD }) }),
  'cms.FeatureList': (fields) => swap(fields, { image: IMAGE_FIELD, items: swapItems(fields['items'], ICON_ITEMS) }),
  'cms.Stats': (fields) => swap(fields, { image: IMAGE_FIELD }),
  'cms.Testimonial': (fields) => swap(fields, { image: IMAGE_FIELD, avatar: AVATAR_FIELD, background: BACKGROUND_FIELD }),
};

/** The blocks this module gives library pickers to. */
export const SECTION_BLOCKS_WITH_ADMIN_FIELDS: readonly string[] = Object.keys(SWAPS);

/** `config` with the admin's pickers, when `name` is one of {@link SECTION_BLOCKS_WITH_ADMIN_FIELDS}; any other block as it is. */
export function withAdminSectionBlockFields(name: string, config: ComponentConfig): ComponentConfig {
  const apply = SWAPS[name];
  if (!apply) return config;
  return { ...config, fields: apply({ ...(config.fields ?? {}) }) } as ComponentConfig;
}
