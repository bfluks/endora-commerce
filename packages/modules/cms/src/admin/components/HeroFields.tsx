'use client';

import type { ReactElement } from 'react';
import { FieldLabel, type ComponentConfig, type CustomField } from '@puckeditor/core';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { createColorField, type Responsive, type ResponsiveImage } from '@endora-commerce/page-builder-core';
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

/**
 * Feature 163, T043 — the admin's fields of `cms.Hero`
 * (`specs/163-page-builder-marketing-pages/` contracts/blocks.md `cms.Hero`,
 * research R-9, R-11): the media picked from the asset library (an
 * art-directed image, or a video with its mobile video, poster and mobile poster —
 * T191: the posters follow a source of their own, the library or URLs), the
 * buttons through the shared list field and its link pickers, and the
 * social-proof image through the responsive image field. Today's solid and
 * gradient backgrounds stay media kinds (plan § *Extend, don't narrow*).
 */

type HeroMediaKind = 'none' | 'solid' | 'gradient' | 'image' | 'video';

interface HeroMediaValue {
  kind: HeroMediaKind;
  color?: string;
  from?: string;
  to?: string;
  angle?: number;
  image?: Partial<ResponsiveImage>;
  videoSource?: 'url' | 'library';
  videoUrl?: string;
  videoAssetId?: string;
  mobileVideoAssetId?: string;
  mobileVideoUrl?: string;
  posterSource?: 'library' | 'url';
  posterAssetId?: string;
  posterUrl?: string;
  mobilePosterAssetId?: string;
  mobilePosterUrl?: string;
  ratio?: Responsive<string> | undefined;
}

const filled = (value: string | undefined): boolean => typeof value === 'string' && value.trim() !== '';

/**
 * T191: the posters' source — the stored one, else the one the stored values
 * imply: a URL set and no library image is the URL source, anything else the
 * library (a new video's too).
 */
export function heroPosterSource(media: HeroMediaValue): 'library' | 'url' {
  if (media.posterSource === 'library' || media.posterSource === 'url') return media.posterSource;
  const url = filled(media.posterUrl) || filled(media.mobilePosterUrl);
  const library = filled(media.posterAssetId) || filled(media.mobilePosterAssetId);
  return url && !library ? 'url' : 'library';
}

const KIND_OPTIONS: { label: string; value: HeroMediaKind }[] = [
  { label: 'None', value: 'none' },
  { label: 'Solid color', value: 'solid' },
  { label: 'Gradient', value: 'gradient' },
  { label: 'Image', value: 'image' },
  { label: 'Video', value: 'video' },
];

const VIDEO_SOURCE_OPTIONS: { label: string; value: 'url' | 'library' }[] = [
  { label: 'Asset library', value: 'library' },
  { label: 'URL', value: 'url' },
];

/** What a kind starts from when it is chosen: nothing of the previous kind is kept. */
const KIND_START: Record<HeroMediaKind, HeroMediaValue> = {
  none: { kind: 'none' },
  solid: { kind: 'solid' },
  gradient: { kind: 'gradient', from: '#ffffff', to: '#334155', angle: 135 },
  image: { kind: 'image', image: { imageSource: 'library', alt: '' } },
  video: { kind: 'video', videoSource: 'library' },
};

// One field object each, so a re-render does not hand Puck a new field.
const SOLID_COLOR_FIELD = createColorField({ label: 'Color' });
const GRADIENT_FROM_FIELD = createColorField({ label: 'Gradient from' });
const GRADIENT_TO_FIELD = createColorField({ label: 'Gradient to' });
const VIDEO_ASSET_FIELD = createVideoAssetField('Video');
const VIDEO_URL_FIELD = createImageUrlField('Video URL');
const MOBILE_VIDEO_ASSET_FIELD = createVideoAssetField('Mobile video');
const MOBILE_VIDEO_URL_FIELD = createImageUrlField('Mobile video URL');
const POSTER_ASSET_FIELD = createImageAssetField('Poster image');
const POSTER_URL_FIELD = createImageUrlField('Poster URL');
const MOBILE_POSTER_ASSET_FIELD = createImageAssetField('Mobile poster image');
const MOBILE_POSTER_URL_FIELD = createImageUrlField('Mobile poster URL');

function HeroMediaControl({
  value,
  onChange,
  readOnly,
}: {
  value: HeroMediaValue | undefined;
  onChange: (value: HeroMediaValue) => void;
  readOnly?: boolean | undefined;
}): ReactElement {
  const t = useTranslation('cms');
  /** A bundle key, or the English beside it when the bundle has none. */
  const label = (key: string, fallback: string): string => {
    const translated = t(key);
    return translated === `cms.${key}` ? fallback : translated;
  };
  const current: HeroMediaValue = value?.kind ? value : { kind: 'none' };
  const posterSource = heroPosterSource(current);
  const set = (patch: Partial<HeroMediaValue>): void => onChange({ ...current, ...patch });
  const ro = readOnly === true ? { readOnly: true } : {};

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label={t('blocks.hero.fields.media.fields.kind.label')}
        className={inputClassName}
        disabled={readOnly === true}
        value={current.kind}
        onChange={(e): void => onChange(KIND_START[e.target.value as HeroMediaKind] ?? { kind: 'none' })}
      >
        {KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {label(`blocks.hero.fields.media.options.${option.value}`, option.label)}
          </option>
        ))}
      </select>

      {current.kind === 'solid' ? (
        <SOLID_COLOR_FIELD.render
          field={SOLID_COLOR_FIELD}
          id="pb-hero-media-color"
          name="media.color"
          value={current.color ?? 'transparent'}
          onChange={(color): void => set({ color: color ?? 'transparent' })}
          {...ro}
        />
      ) : null}

      {current.kind === 'gradient' ? (
        <div className="flex flex-col gap-2">
          <GRADIENT_FROM_FIELD.render
            field={GRADIENT_FROM_FIELD}
            id="pb-hero-media-from"
            name="media.from"
            value={current.from ?? '#ffffff'}
            onChange={(color): void => set({ from: color ?? '#ffffff' })}
            {...ro}
          />
          <GRADIENT_TO_FIELD.render
            field={GRADIENT_TO_FIELD}
            id="pb-hero-media-to"
            name="media.to"
            value={current.to ?? '#334155'}
            onChange={(color): void => set({ to: color ?? '#334155' })}
            {...ro}
          />
          <FieldLabel label="Angle (deg)" {...ro}>
            <input
              type="number"
              className={inputClassName}
              readOnly={readOnly === true}
              min={0}
              max={360}
              value={current.angle ?? 135}
              onChange={(e): void => set({ angle: Number(e.target.value) })}
            />
          </FieldLabel>
        </div>
      ) : null}

      {current.kind === 'image' ? (
        <div className="flex flex-col gap-1" role="group" aria-label={t('blocks.hero.fields.media.fields.image.label')}>
          <ResponsiveImageControl value={current.image} onChange={(image): void => set({ image })} readOnly={readOnly} />
        </div>
      ) : null}

      {current.kind === 'video' ? (
        <div className="flex flex-col gap-2">
          <select
            aria-label={t('blocks.hero.fields.media.fields.videoSource.label')}
            className={inputClassName}
            disabled={readOnly === true}
            value={current.videoSource ?? 'library'}
            onChange={(e): void => set({ videoSource: e.target.value as 'url' | 'library' })}
          >
            {VIDEO_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {label(`blocks.hero.fields.media.fields.videoSource.options.${option.value}`, option.label)}
              </option>
            ))}
          </select>
          {(current.videoSource ?? 'library') === 'library' ? (
            <VIDEO_ASSET_FIELD.render
              field={VIDEO_ASSET_FIELD}
              id="pb-hero-media-video"
              name="media.videoAssetId"
              value={current.videoAssetId ?? ''}
              onChange={(assetId): void => set({ videoAssetId: assetId })}
              {...ro}
            />
          ) : (
            <VIDEO_URL_FIELD.render
              field={VIDEO_URL_FIELD}
              id="pb-hero-media-video-url"
              name="media.videoUrl"
              value={current.videoUrl ?? ''}
              onChange={(url): void => set({ videoUrl: url })}
              {...ro}
            />
          )}
          {/* T142: the mobile video follows the source — a library video, or a URL. */}
          {(current.videoSource ?? 'library') === 'library' ? (
            <MOBILE_VIDEO_ASSET_FIELD.render
              field={MOBILE_VIDEO_ASSET_FIELD}
              id="pb-hero-media-mobile-video"
              name="media.mobileVideoAssetId"
              value={current.mobileVideoAssetId ?? ''}
              onChange={(assetId): void => set({ mobileVideoAssetId: assetId })}
              {...ro}
            />
          ) : (
            <MOBILE_VIDEO_URL_FIELD.render
              field={{ ...MOBILE_VIDEO_URL_FIELD, label: t('blocks.hero.fields.media.fields.mobileVideoUrl.label') }}
              id="pb-hero-media-mobile-video-url"
              name="media.mobileVideoUrl"
              value={current.mobileVideoUrl ?? ''}
              onChange={(url): void => set({ mobileVideoUrl: url })}
              {...ro}
            />
          )}
          {/* T191: one source for both posters — the library pickers, or the two URLs. */}
          <select
            aria-label={t('blocks.hero.fields.media.fields.posterSource.label')}
            className={inputClassName}
            disabled={readOnly === true}
            value={posterSource}
            onChange={(e): void => set({ posterSource: e.target.value as 'url' | 'library' })}
          >
            {VIDEO_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {label(`blocks.hero.fields.media.fields.posterSource.options.${option.value}`, option.label)}
              </option>
            ))}
          </select>
          {posterSource === 'library' ? (
            <>
              <POSTER_ASSET_FIELD.render
                field={POSTER_ASSET_FIELD}
                id="pb-hero-media-poster"
                name="media.posterAssetId"
                value={current.posterAssetId ?? ''}
                onChange={(assetId): void => set({ posterAssetId: assetId })}
                {...ro}
              />
              {/* T162: the mobile video's own poster. */}
              <MOBILE_POSTER_ASSET_FIELD.render
                field={{ ...MOBILE_POSTER_ASSET_FIELD, label: t('blocks.hero.fields.media.fields.mobilePosterAssetId.label') }}
                id="pb-hero-media-mobile-poster"
                name="media.mobilePosterAssetId"
                value={current.mobilePosterAssetId ?? ''}
                onChange={(assetId): void => set({ mobilePosterAssetId: assetId })}
                {...ro}
              />
            </>
          ) : (
            <>
              <POSTER_URL_FIELD.render
                field={{ ...POSTER_URL_FIELD, label: t('blocks.hero.fields.media.fields.posterUrl.label') }}
                id="pb-hero-media-poster-url"
                name="media.posterUrl"
                value={current.posterUrl ?? ''}
                onChange={(url): void => set({ posterUrl: url })}
                {...ro}
              />
              <MOBILE_POSTER_URL_FIELD.render
                field={{ ...MOBILE_POSTER_URL_FIELD, label: t('blocks.hero.fields.media.fields.mobilePosterUrl.label') }}
                id="pb-hero-media-mobile-poster-url"
                name="media.mobilePosterUrl"
                value={current.mobilePosterUrl ?? ''}
                onChange={(url): void => set({ mobilePosterUrl: url })}
                {...ro}
              />
            </>
          )}
          {/* T126: the frame's ratio above the content, per breakpoint; unset is 16:9. */}
          <ResponsiveRatioControl
            label={t('blocks.hero.fields.media.fields.ratio.label')}
            value={current.ratio}
            defaultRatio="16:9"
            allowAuto={false}
            readOnly={readOnly}
            onChange={(ratio): void => set({ ratio })}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The hero's `media` field, picking images and videos from the asset library. */
export function createHeroMediaField(): CustomField<HeroMediaValue | undefined> {
  return {
    type: 'custom',
    label: 'Media',
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldLabel label={field.label ?? 'Media'} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
        <HeroMediaControl value={value} onChange={onChange} readOnly={readOnly} />
      </FieldLabel>
    ),
  };
}

// Stable: a field recreated on every merge loses its input focus.
const HERO_MEDIA_FIELD = createHeroMediaField();
const HERO_BUTTONS_FIELD = createButtonListField({ label: 'Buttons', max: 6, responsive: true });
const HERO_PROOF_IMAGE_FIELD = createResponsiveImageField({ label: 'Image' });

/**
 * `cms.Hero` with the admin's pickers. Every other field — and the order of
 * the fields — is the block's own.
 */
export function withAdminHeroFields(config: ComponentConfig): ComponentConfig {
  const fields = { ...(config.fields ?? {}) } as Record<string, unknown>;
  if ('media' in fields) fields['media'] = HERO_MEDIA_FIELD;
  if ('buttons' in fields) fields['buttons'] = HERO_BUTTONS_FIELD;
  const proof = fields['socialProof'] as { type?: string; objectFields?: Record<string, unknown> } | undefined;
  if (proof?.type === 'object') {
    fields['socialProof'] = { ...proof, objectFields: { ...proof.objectFields, image: HERO_PROOF_IMAGE_FIELD } };
  }
  return { ...config, fields } as ComponentConfig;
}
