'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  createToggleField,
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  withHideOn,
  type BreakpointTier,
  type Responsive,
  type ResponsiveImage,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { IconTextItem, MediaTextMedia, MediaTextProps, MediaTextRow } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import {
  VERTICAL_ALIGN_OPTIONS,
  buttonsField,
  iconFields,
  imageObjectField,
  levelField,
  SIDE_OPTIONS,
  sizeField,
  sizeFieldWithDefault,
  sizePxField,
} from '../fields/section-block-fields.js';
import { useBreakpointVideo } from '../hooks/use-breakpoint-video.js';
import { ratioVars, sanitizeRatio } from '../utils/aspect-ratio.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';
import { pickBySource } from '../utils/media-source.js';
import { useCmsRenderMediaBaseUrl } from './render-context.js';
import { InlineRich } from './InlineRich.js';
import { ItemText } from './item-text.js';
import { textWeightField } from './typography.js';
import { Picture } from './Picture.js';
import { buttonWidthField } from './button-full-width.js';
import { BlockHeading, ButtonRow, hasImage, isEmptyInline, ItemIcon, plainTextToDoc, RichBody, useAssetUrl, usesCustom, blockHeadingStyle, blockHeadingStyleFields, isUnusedHeadingMaxWidthPx } from './section-parts.js';

/**
 * `cms.MediaText` — `specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * US3, FR-013.
 *
 * Media beside text. The media side (`data-media-side`) and the split
 * (`data-split`) apply from the tablet tier up; below it the two stack, media
 * first unless `mobileOrder` says text first (`data-mobile-order`). The text
 * holds a heading, rich text, an icon-item list and buttons. Further `rows`
 * repeat the pattern, flipping the media side row by row when `alternate` is
 * on; a footnote closes the block. Everything is layout in CSS: no script
 * decides a breakpoint (R-23).
 *
 * Media frames reserve their space: an image keeps its ratio (4:3 unless the
 * editor picks one), a video its ratio per breakpoint (16:9 unless the editor
 * picks one, T126), and a missing image a placeholder of
 * the same ratio. Images are lazy; a video loads nothing before it plays
 * (`preload="none"`, a poster). An autoplaying video is muted, inline and
 * looped, and is started only on screen and never under reduced motion
 * (`useBreakpointVideo`); otherwise the visitor starts it with its controls.
 * A video may come from the library or by URL, with an optional mobile video
 * of either kind (T142): a pair per breakpoint, of which the stylesheet shows
 * one. The mobile video may have its own poster (T162), a library image or a
 * URL; one video with its own mobile poster is a pair of the same file.
 */

const DEFAULT_RATIO = '4:3';

/** A `MediaTextMedia` in its frame; shared with `cms.CarouselSplit`. */
/**
 * T142: a video's sources — the library videos, or with `videoSource: 'url'`
 * the URLs; each side falls back to the other kind when its own is not set.
 */
function videoSources(
  media: Extract<MediaTextMedia, { kind: 'video' }>,
  assetUrl: (id: string | undefined) => string,
  mediaBaseUrl: string | undefined,
): { desktop: string; mobile: string } {
  const url = (value: string | undefined): string => absolutizeMediaUrl(value?.trim() ?? '', mediaBaseUrl);
  const byUrl = media.videoSource === 'url';
  const pick = (asset: string, link: string): string => (byUrl ? link || asset : asset || link);
  return {
    desktop: pick(assetUrl(media.videoAssetId), url(media.videoUrl)),
    mobile: pick(assetUrl(media.mobileVideoAssetId), url(media.mobileVideoUrl)),
  };
}

export function MediaTextMediaFrame({ media }: { media: MediaTextMedia | undefined }): ReactNode {
  const assetUrl = useAssetUrl();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const sources = media?.kind === 'video' ? videoSources(media, assetUrl, mediaBaseUrl) : null;
  if (media?.kind === 'video' && sources && (sources.desktop || sources.mobile)) {
    // R17 (T217): the poster source picks each poster — unset, the library image before a URL (today's).
    const fromUrl = (value: string | undefined): string => absolutizeMediaUrl(value?.trim() ?? '', mediaBaseUrl);
    const poster = pickBySource(media.posterSource, assetUrl(media.posterAssetId), fromUrl(media.posterUrl));
    // T162: the mobile video's own poster; unset, the poster.
    const mobilePoster = pickBySource(media.posterSource, assetUrl(media.mobilePosterAssetId), fromUrl(media.mobilePosterUrl)) || poster;
    const autoplay = media.autoplay === true;
    // A pair per breakpoint (the stylesheet shows one) — two videos, or one video with its own mobile
    // poster (each `preload="none"`, so nothing loads twice) — or one video for every breakpoint.
    const pair = Boolean(sources.desktop && sources.mobile && sources.desktop !== sources.mobile) || mobilePoster !== poster;
    const video = (src: string, breakpoint: 'mobile' | 'desktop' | 'all', still: string): ReactNode => {
      const common = {
        key: breakpoint,
        src,
        preload: 'none' as const,
        playsInline: true,
        ...(still ? { poster: still } : {}),
      };
      // Autoplay: muted, looped, started on screen by `useBreakpointVideo` (never under reduced motion).
      if (autoplay) return <video {...common} muted loop data-bp={breakpoint} data-autoplay="" aria-hidden="true" />;
      // Otherwise the visitor starts it; only a pair needs the breakpoint mark, for the stylesheet.
      return <video {...common} controls {...(pair ? { 'data-bp': breakpoint } : {})} />;
    };
    // T126: the frame's ratio per breakpoint; none keeps 16:9.
    const vars = ratioVars(sanitizeRatio(media.ratio as Responsive<string> | undefined, undefined, false));
    return (
      <div className="cmsc-pb-media-text__video" {...(Object.keys(vars).length > 0 ? { style: vars as CSSProperties } : {})}>
        {pair
          ? [video(sources.mobile || sources.desktop, 'mobile', mobilePoster), video(sources.desktop || sources.mobile, 'desktop', poster)]
          : video(sources.desktop || sources.mobile, 'all', poster)}
      </div>
    );
  }
  const image = media?.kind === 'image' ? media.image : undefined;
  if (hasImage(image)) {
    const framed: Partial<ResponsiveImage> = { fit: 'cover', ...image, ratio: image.ratio ?? DEFAULT_RATIO };
    return <Picture className="cmsc-pb-media-text__picture" image={framed} />;
  }
  // No media chosen yet: a frame of the same ratio, so nothing shifts once it is.
  return <div className="cmsc-pb-media-text__placeholder" aria-hidden="true" />;
}

/**
 * T160: a feature title's size (a type token or Custom px, per breakpoint) and
 * weight, the same for every row. Nothing chosen: today's 16 px / 600 title,
 * the text straight in its heading; a choice wraps the text in one span
 * (`ItemText`), whose own class sizes it.
 */
type FeatureTitleStyle = Pick<MediaTextProps, 'featureTitleSize' | 'featureTitleSizePx' | 'featureTitleWeight'>;

function Features({
  features,
  titleStyle,
  tier,
}: {
  features: IconTextItem[] | undefined;
  titleStyle: FeatureTitleStyle;
  tier: BreakpointTier | null;
}): ReactNode {
  const list = (features ?? []).filter((item) => item && typeof item === 'object');
  if (list.length === 0) return null;
  return (
    <ul className="cmsc-pb-media-text__features">
      {list.map((item, index) => (
        <li key={index} className="cmsc-pb-media-text__feature">
          {item.icon || item.iconAssetId ? (
            <span className="cmsc-pb-media-text__feature-icon">
              <ItemIcon icon={item.icon} iconAssetId={item.iconAssetId} size={24} />
            </span>
          ) : null}
          <div className="cmsc-pb-media-text__feature-text">
            {!isEmptyInline(item.title) ? (
              <h3 className="cmsc-pb-media-text__feature-title">
                <ItemText
                  className="cmsc-pb-media-text__feature-title-text"
                  size={titleStyle.featureTitleSize}
                  sizePx={titleStyle.featureTitleSizePx}
                  font={undefined}
                  weight={titleStyle.featureTitleWeight}
                  fallback="body"
                  tier={tier}
                >
                  <InlineRich value={item.title as never} />
                </ItemText>
              </h3>
            ) : null}
            {item.body?.trim() ? <p className="cmsc-pb-media-text__feature-body">{item.body}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface RowContent extends MediaTextRow {
  side: 'start' | 'end';
}

function Row({ row, props, tier }: { row: RowContent; props: MediaTextProps; tier: BreakpointTier | null }): ReactNode {
  return (
    <div
      className="cmsc-pb-media-text__row"
      data-media-side={row.side}
      data-mobile-order={props.mobileOrder ?? 'media-first'}
      data-split={props.split ?? '5-5'}
      data-valign={props.verticalAlign ?? 'center'}
    >
      <div className="cmsc-pb-media-text__media">
        <MediaTextMediaFrame media={row.media} />
      </div>
      <div className="cmsc-pb-media-text__text">
        <BlockHeading
          value={row.heading}
          level={props.headingLevel}
          size={props.headingSize}
          sizePx={props.headingSizePx}
          {...blockHeadingStyle(props)}
          className="cmsc-pb-media-text__heading"
          tier={tier}
        />
        <RichBody value={row.body} className="cmsc-pb-media-text__body cmsc-pb-rich" />
        <Features features={row.features} titleStyle={props} tier={tier} />
        <ButtonRow buttons={row.buttons} tier={tier} fullWidth={props.buttonsFullWidth} className="cmsc-pb-media-text__actions cmsc-pb-actions" />
      </div>
    </div>
  );
}

function flip(side: 'start' | 'end'): 'start' | 'end' {
  return side === 'start' ? 'end' : 'start';
}

function MediaTextBody({ props, tier }: { props: MediaTextProps; tier: BreakpointTier | null }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useBreakpointVideo(ref, '.cmsc-pb-media-text__video video[data-bp][data-autoplay]');
  const side = props.mediaSide === 'end' ? 'end' : 'start';
  const alternate = props.alternate !== false;
  const first: RowContent = {
    side,
    ...(props.media !== undefined ? { media: props.media } : {}),
    ...(props.heading !== undefined ? { heading: props.heading } : {}),
    ...(props.body !== undefined ? { body: props.body } : {}),
    ...(props.features !== undefined ? { features: props.features } : {}),
    ...(props.buttons !== undefined ? { buttons: props.buttons } : {}),
  };
  const rows: RowContent[] = [
    first,
    ...(props.rows ?? [])
      .filter((row) => row && typeof row === 'object')
      .map((row, index) => ({ ...row, side: alternate && (index + 1) % 2 === 1 ? flip(side) : side })),
  ];

  return (
    <div className="cmsc-pb-media-text" ref={ref}>
      {rows.map((row, index) => (
        <div key={index} className="cmsc-pb-media-text__group">
          {index > 0 && props.divider === true ? <hr className="cmsc-pb-media-text__divider" /> : null}
          <Row row={row} props={props} tier={tier} />
        </div>
      ))}
      <RichBody value={props.footnote} className="cmsc-pb-media-text__footnote cmsc-pb-rich" />
    </div>
  );
}

const MediaTextEditingRender: PuckComponent<MediaTextProps> = (props) => (
  <MediaTextBody props={props as unknown as MediaTextProps} tier={usePreviewBreakpointTier()} />
);

const MediaTextPublishedRender: PuckComponent<MediaTextProps> = (props) => (
  <MediaTextBody props={props as unknown as MediaTextProps} tier={null} />
);

// ── Fields ───────────────────────────────────────────────────────────

/** The media as plain fields; the admin replaces it with a control picking images and videos from the library. */
export const MEDIA_TEXT_MEDIA_FIELD = {
  type: 'object' as const,
  label: 'Media',
  objectFields: {
    kind: {
      type: 'select' as const,
      label: 'Type',
      options: [
        { label: 'Image', value: 'image' },
        { label: 'Video', value: 'video' },
      ],
    },
    image: imageObjectField('Image'),
    // T142: library videos (today's) or URLs; each kind is the other's fallback.
    videoSource: {
      type: 'select' as const,
      label: 'Video source',
      options: [
        { label: 'Asset library', value: 'library' },
        { label: 'URL', value: 'url' },
      ],
    },
    videoAssetId: { type: 'text' as const, label: 'Video (asset ID)' },
    videoUrl: { type: 'text' as const, label: 'Video URL' },
    mobileVideoAssetId: { type: 'text' as const, label: 'Mobile video (asset ID)' },
    mobileVideoUrl: { type: 'text' as const, label: 'Mobile video URL' },
    // R17 (T217): where both posters come from, as the hero's and the video block's.
    posterSource: {
      type: 'select' as const,
      label: 'Poster source',
      options: [
        { label: 'Asset library', value: 'library' },
        { label: 'URL', value: 'url' },
      ],
    },
    posterAssetId: { type: 'text' as const, label: 'Poster image (asset ID)' },
    posterUrl: { type: 'text' as const, label: 'Poster URL' },
    // T162: the mobile video's own poster, from the poster source.
    mobilePosterAssetId: { type: 'text' as const, label: 'Mobile poster image (asset ID)' },
    mobilePosterUrl: { type: 'text' as const, label: 'Mobile poster URL' },
    // T126: the video frame's ratio, `w:h` (the admin control sets it per breakpoint).
    ratio: { type: 'text' as const, label: 'Video aspect ratio' },
    autoplay: createToggleField({ label: 'Play automatically (muted, looped)' }),
  },
};

const FEATURE_FIELDS = {
  ...iconFields(),
  title: createInlineRichTextField({ label: 'Title' }),
  body: { type: 'textarea' as const, label: 'Text' },
};

function featuresField(label: string) {
  return {
    type: 'array' as const,
    label,
    max: 8,
    arrayFields: FEATURE_FIELDS,
    defaultItemProps: { icon: 'checkCircle2', title: plainTextToInlineRichText('Item'), body: 'Short supporting text.' },
    getItemSummary: (item: { title?: unknown }) =>
      typeof item?.title === 'string' && item.title ? item.title : 'Item',
  };
}

const MEDIA_TEXT_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeField('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  media: MEDIA_TEXT_MEDIA_FIELD,
  body: createRichTextDocField({ label: 'Text' }),
  features: featuresField('Items'),
  // T160: every feature title's size per breakpoint and weight; Default keeps today's 16 px / 600.
  // R17 (T211): the weight per breakpoint too, beside the size.
  featureTitleSize: sizeFieldWithDefault('Item title size'),
  featureTitleSizePx: sizePxField('Custom item title size (px)'),
  featureTitleWeight: { ...textWeightField('Item title weight'), metadata: PB_RESPONSIVE_METADATA },
  buttons: buttonsField('Buttons', 4),
  // T168: every row's buttons at the full width per breakpoint (Responsive tab); unset keeps today's.
  buttonsFullWidth: buttonWidthField('Button width'),
  footnote: createRichTextDocField({ label: 'Footnote' }),
  // R17 (T219): the layout after the content, before more rows.
  mediaSide: { type: 'select' as const, label: 'Media side (desktop)', options: SIDE_OPTIONS },
  mobileOrder: {
    type: 'select' as const,
    label: 'Order on mobile',
    options: [
      { label: 'Media first', value: 'media-first' },
      { label: 'Text first', value: 'text-first' },
    ],
  },
  split: {
    type: 'select' as const,
    label: 'Split (media – text)',
    options: [
      { label: '5 – 5', value: '5-5' },
      { label: '6 – 6', value: '6-6' },
      { label: '5 – 6', value: '5-6' },
      { label: '4 – 7', value: '4-7' },
      { label: '7 – 4', value: '7-4' },
    ],
  },
  verticalAlign: { type: 'select' as const, label: 'Vertical alignment', options: VERTICAL_ALIGN_OPTIONS },
  rows: {
    type: 'array' as const,
    label: 'More rows',
    max: 12,
    arrayFields: {
      media: MEDIA_TEXT_MEDIA_FIELD,
      heading: createInlineRichTextField({ label: 'Heading' }),
      body: createRichTextDocField({ label: 'Text' }),
      features: featuresField('Items'),
      buttons: buttonsField('Buttons', 4),
    },
    defaultItemProps: {
      media: { kind: 'image', image: { imageSource: 'library', alt: '' } },
      heading: plainTextToInlineRichText('Heading'),
      body: plainTextToDoc('Describe this part in a sentence or two.'),
      features: [],
      buttons: [],
    },
    getItemSummary: (_item: unknown, index?: number) => `Row ${(index ?? 0) + 2}`,
  },
  alternate: createToggleField({ label: 'Alternate the media side row by row', defaultValue: true }),
  divider: createToggleField({ label: 'Rule between rows' }),
};

const mediaTextConfig: ComponentConfig<{ props: MediaTextProps }> = {
  label: 'Media and text',
  fields: MEDIA_TEXT_FIELDS as unknown as Fields<MediaTextProps>,
  // Neutral (plan § Extend, don't narrow, rule 3): an h2 at the h3 size, the
  // media first on the start side, an even split, centred vertically.
  defaultProps: {
    heading: plainTextToInlineRichText('Heading'),
    headingLevel: 'h2',
    headingSize: 'h3',
    media: { kind: 'image', image: { imageSource: 'library', alt: '' } },
    mediaSide: 'start',
    mobileOrder: 'media-first',
    split: '5-5',
    verticalAlign: 'center',
    body: plainTextToDoc('Describe what this section is about in a sentence or two.'),
    features: [],
    buttons: [],
    rows: [],
    alternate: true,
    divider: false,
  } as MediaTextProps,
  // Filters the host's field set, so the admin's pickers survive; the Custom px shows once Custom is chosen.
  resolveFields: (data, params) => {
    const props = data.props as MediaTextProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? MEDIA_TEXT_FIELDS)) {
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (key === 'featureTitleSizePx' && !usesCustom(props.featureTitleSize)) continue;
      if (isUnusedHeadingMaxWidthPx(key, props)) continue;
      if ((key === 'alternate' || key === 'divider') && (props.rows ?? []).length === 0) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<MediaTextProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <MediaTextEditingRender {...props} /> : <MediaTextPublishedRender {...props} />,
};

export const MediaText = withHideOn(mediaTextConfig);
