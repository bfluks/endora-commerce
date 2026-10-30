'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  CORNER_RADIUS_PX,
  createColorField,
  PB_RESPONSIVE_METADATA,
  withHideOn,
  type BreakpointTier,
  type ResponsiveImage,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type {
  CarouselCaptionPlacement,
  CarouselCaptionScrim,
  CarouselCaptionStyle,
  CarouselImageProps,
} from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { hoverZoomField, imageObjectField, sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { CORNER_RADIUS_FIELD } from '../fields/shared-fields.js';
import { colorValueToCss, resolveColorValue } from '../utils/color-value.js';
import { resolveLinkHref } from '../utils/link-href.js';
import { DEFAULT_MEDIA_CORNER_RADIUS, mediaRadiusVars } from '../utils/media-radius.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { InlineRich } from './InlineRich.js';
import { Picture } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, useCmsRenderLocalizePath } from './render-context.js';
import { hasImage, isEmptyInline, usesCustom, type TextSize } from './section-parts.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';
import { ItemText, itemFontField } from './item-text.js';
import { textWeightField } from './typography.js';
import { createIconPickerField } from './IconPickerField.js';
import { resolveCmsIcon } from './icon-catalog.js';

/**
 * `cms.CarouselImage` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US4, FR-020: a wide image or a gallery photo, one item
 * of a Carousel's `slides`.
 *
 * The image is art-directed (`Picture`, lazy) in a frame that reserves its
 * ratio. The caption sits at any corner or the centre over the image — every
 * placement the image slider's title had — or below it, styled by the five
 * title style fields that block had plus a colour (plan § *Extend, don't
 * narrow*). With no style set, the caption keeps that block's look. A link
 * makes the whole image one link; `hoverZoom` scales it on hover (never under
 * reduced motion, see the stylesheet).
 *
 * R5: an optional scrim behind an overlay caption (T129) — a gradient from the
 * caption's edge or a uniform tint, of a chosen strength — and `tags` for the
 * Carousel's filter (T131), written on the figure as `data-pb-tags`.
 *
 * R6 (T140): the frame's corners are an option (`mediaCornerRadius`, today's
 * 8 px by default), and inside a colour scheme the frame's light backdrop
 * gives way to the scheme's (see the stylesheet).
 *
 * R7 (T144): the caption's size per breakpoint (a type token or Custom px,
 * Responsive tab) and its font role (the brand's heading or body font). With
 * neither set the caption is today's 14 px semibold.
 */

const DEFAULT_RATIO = '4:3';

export const CAPTION_PLACEMENT_OPTIONS: Array<{ label: string; value: CarouselCaptionPlacement }> = [
  { label: 'Hidden', value: 'none' },
  { label: 'Top left', value: 'top-left' },
  { label: 'Top center', value: 'top-center' },
  { label: 'Top right', value: 'top-right' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom left', value: 'bottom-left' },
  { label: 'Bottom center', value: 'bottom-center' },
  { label: 'Bottom right', value: 'bottom-right' },
  { label: 'Below the image', value: 'below' },
];

const PLACEMENTS = new Set<string>(CAPTION_PLACEMENT_OPTIONS.map((option) => option.value));

/** R19B (T249): the corners the read-more label may take; the bottom right by default. */
export type CarouselMoreLabelPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const MORE_LABEL_OPTIONS: Array<{ label: string; value: CarouselMoreLabelPlacement }> = [
  { label: 'Bottom right', value: 'bottom-right' },
  { label: 'Bottom left', value: 'bottom-left' },
  { label: 'Top right', value: 'top-right' },
  { label: 'Top left', value: 'top-left' },
];
const MORE_CORNERS = new Set<string>(MORE_LABEL_OPTIONS.map((option) => option.value));

/** The caption's inline style: only what the editor set, so an unstyled caption keeps the stylesheet's look. */
export function captionStyleCss(style: CarouselCaptionStyle | undefined): CSSProperties {
  if (!style) return {};
  const radius = style.borderRadius ? CORNER_RADIUS_PX[style.borderRadius] : undefined;
  const borderWidth = typeof style.borderWidth === 'number' && Number.isFinite(style.borderWidth) ? style.borderWidth : 0;
  const background = resolveColorValue(style.background);
  const color = resolveColorValue(style.color);
  return {
    ...(background ? { background } : {}),
    ...(color ? { color } : {}),
    ...(typeof style.paddingPx === 'number' && Number.isFinite(style.paddingPx) ? { padding: `${Math.max(0, style.paddingPx)}px` } : {}),
    ...(radius != null ? { borderRadius: `${radius}px` } : {}),
    ...(borderWidth > 0
      ? { borderStyle: 'solid', borderWidth: `${borderWidth}px`, borderColor: resolveColorValue(style.borderColor) ?? '#ffffff' }
      : {}),
  };
}

/**
 * What an item of the removed image slider held, as a `cms.CarouselImage`
 * (plan § *Extend, don't narrow*, rule 5): the image (URL or library), its
 * title as the caption and the image's alternative text (today's alt), the
 * placement and the five title style fields. Stored sliders are not migrated
 * (FR-041a); this is the field-for-field record of what the new item carries.
 */
export function carouselImageFromImageSliderItem(item: Record<string, unknown>): CarouselImageProps {
  const nested = (item['image'] ?? {}) as Record<string, unknown>;
  const source = (nested['imageSource'] ?? item['imageSource'] ?? 'url') === 'library' ? 'library' : 'url';
  const src = String(nested['src'] ?? item['src'] ?? '');
  const assetId = String(nested['assetId'] ?? item['assetId'] ?? '');
  const title = typeof item['title'] === 'string' ? item['title'].trim() : '';
  const placement = typeof item['titlePlacement'] === 'string' && PLACEMENTS.has(item['titlePlacement'])
    ? (item['titlePlacement'] as CarouselCaptionPlacement)
    : 'bottom-center';
  const style: CarouselCaptionStyle = {};
  const copy = <K extends keyof CarouselCaptionStyle>(key: K, from: string): void => {
    const value = item[from];
    if (value !== undefined && value !== null && value !== '') style[key] = value as CarouselCaptionStyle[K];
  };
  copy('background', 'titleBackground');
  copy('color', 'titleColor');
  copy('borderColor', 'titleBorderColor');
  copy('borderWidth', 'titleBorderWidth');
  copy('borderRadius', 'titleBorderRadius');
  copy('paddingPx', 'titlePaddingPx');
  return {
    image: source === 'library' ? { imageSource: 'library', assetId, alt: title } : { imageSource: 'url', src, alt: title },
    ...(title ? { caption: title } : {}),
    captionPlacement: placement,
    captionStyle: style,
  };
}

const DEFAULT_SCRIM_STRENGTH = 60;

/** The scrim's class and strength, or `null` when there is none (no overlay caption, or switched off). */
function scrimFor(
  scrim: CarouselCaptionScrim | undefined,
  placement: CarouselCaptionPlacement,
  showCaption: boolean,
): { className: string; strength: number } | null {
  const kind = scrim?.kind;
  if (!showCaption || placement === 'none' || placement === 'below') return null;
  if (kind !== 'gradient' && kind !== 'solid') return null;
  const raw = typeof scrim?.strength === 'number' && Number.isFinite(scrim.strength) ? scrim.strength : DEFAULT_SCRIM_STRENGTH;
  const strength = Math.min(90, Math.max(0, Math.round(raw)));
  const edge = placement.startsWith('top-') ? 'top' : placement.startsWith('bottom-') ? 'bottom' : null;
  const variant = kind === 'gradient' && edge ? `gradient-${edge}` : 'solid';
  return { className: `cmsc-pb-carousel-image__scrim cmsc-pb-carousel-image__scrim--${variant}`, strength };
}

function CarouselImageBody({
  props,
  preview,
  tier,
}: {
  props: CarouselImageProps;
  preview: boolean;
  tier: BreakpointTier | null;
}): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  const placement: CarouselCaptionPlacement = PLACEMENTS.has(props.captionPlacement ?? '')
    ? (props.captionPlacement as CarouselCaptionPlacement)
    : 'bottom-center';
  const showCaption = placement !== 'none' && !isEmptyInline(props.caption);
  const link = resolveLinkHref(props.link, { assets, mediaBaseUrl, localizePath });
  const image = props.image;

  const media = hasImage(image) ? (
    <Picture
      className="cmsc-pb-carousel-image__picture"
      image={{ fit: 'cover', ...image, ratio: image.ratio ?? DEFAULT_RATIO } as Partial<ResponsiveImage>}
    />
  ) : (
    // No image yet: a frame of the same ratio, so nothing shifts once it is chosen.
    <div className="cmsc-pb-carousel-image__placeholder" aria-hidden="true">
      {preview ? 'Add an image' : null}
    </div>
  );

  const captionCss = captionStyleCss(props.captionStyle);
  // R19B (T249): a second line over the image, in a corner of its own (e.g. "Read more"), in the caption's
  // colour. R23 (T445): its own size, colour, icon colour and weight, and the caption's padding per
  // breakpoint, were removed — the label keeps the stylesheet's 14 px / 600, 12 px from the corner.
  const moreText = props.moreLabel?.trim() ?? '';
  const moreCorner = MORE_CORNERS.has(props.moreLabelPlacement ?? '') ? (props.moreLabelPlacement as CarouselMoreLabelPlacement) : 'bottom-right';
  const MoreIcon = moreText ? resolveCmsIcon(props.moreLabelIcon) : null;
  const moreColor = resolveColorValue(props.captionStyle?.color);
  const moreStyle: CSSProperties = moreColor ? { color: moreColor } : {};
  const moreLabel = moreText ? (
    <span
      className={`cmsc-pb-carousel-image__more cmsc-pb-carousel-image__more--${moreCorner}`}
      {...(Object.keys(moreStyle).length > 0 ? { style: moreStyle } : {})}
    >
      {moreText}
      {MoreIcon ? (
        <MoreIcon className="cmsc-pb-carousel-image__more-icon" aria-hidden="true" focusable="false" />
      ) : null}
    </span>
  ) : null;

  const scrim = scrimFor(props.captionScrim, placement, showCaption);
  // A scrim replaces the caption's own box, unless the editor gave the caption a background.
  const onScrim = scrim !== null && !resolveColorValue(props.captionStyle?.background);
  const scrimLayer = scrim ? (
    <span aria-hidden="true" className={scrim.className} style={{ ['--pb-scrim' as string]: String(scrim.strength / 100) }} />
  ) : null;

  const caption = showCaption ? (
    <figcaption
      className={`cmsc-pb-carousel-image__caption cmsc-pb-carousel-image__caption--${placement}${onScrim ? ' cmsc-pb-carousel-image__caption--on-scrim' : ''}`}
      style={captionCss}
    >
      <ItemText
        className="cmsc-pb-carousel-image__caption-text"
        size={props.captionSize as TextSize | ResponsiveProp<TextSize> | undefined}
        sizePx={props.captionSizePx}
        font={props.captionFont}
        weight={props.captionWeight}
        fallback="small"
        tier={tier}
      >
        <InlineRich value={props.caption as never} />
      </ItemText>
    </figcaption>
  ) : null;

  // T172: the caption's colour on hover and focus — a hex or a known token only; unset, nothing is written.
  const hoverColor = showCaption ? colorValueToCss(props.captionHoverColor) : undefined;
  const classes = [
    'cmsc-pb-carousel-image',
    props.hoverZoom === true ? 'cmsc-pb-carousel-image--zoom' : '',
    placement === 'below' ? 'cmsc-pb-carousel-image--caption-below' : '',
    hoverColor ? 'cmsc-pb-carousel-image--hover-caption' : '',
    // R20E (T292): a caption on the read-more label's edge is lifted above the label's line.
    moreText && showCaption && placement !== 'below' && placement.startsWith(moreCorner.split('-')[0]!)
      ? `cmsc-pb-carousel-image--more-clear-${moreCorner.split('-')[0]}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const baseStyle = hoverColor ? { ...mediaRadiusVars(props.mediaCornerRadius), ['--pb-caption-hover' as string]: hoverColor } : mediaRadiusVars(props.mediaCornerRadius);
  const figureStyle = baseStyle;

  const frame = (
    <div className="cmsc-pb-carousel-image__media">
      {media}
      {moreLabel}
    </div>
  );
  return (
    <figure className={classes} style={figureStyle} {...itemTagsAttribute(props.tags)}>
      {link ? (
        <a className="cmsc-pb-carousel-image__link" href={link.href} {...(link.target ? { target: link.target } : {})} {...(link.rel ? { rel: link.rel } : {})}>
          {frame}
          {scrimLayer}
          {placement !== 'below' ? caption : null}
        </a>
      ) : (
        <>
          {frame}
          {scrimLayer}
          {placement !== 'below' ? caption : null}
        </>
      )}
      {placement === 'below' ? caption : null}
    </figure>
  );
}

const CarouselImageRender: PuckComponent<CarouselImageProps> = (props) => {
  const environment = useBlockRenderEnvironment();
  const previewTier = usePreviewBreakpointTier();
  const editing = props.puck?.isEditing === true;
  return (
    <CarouselImageBody
      props={props as unknown as CarouselImageProps}
      preview={environment.preview || editing}
      tier={editing ? previewTier : null}
    />
  );
};

/** The caption's style, today's five title style fields plus a colour. */
export const CAPTION_STYLE_FIELD = {
  type: 'object' as const,
  label: 'Caption style',
  objectFields: {
    background: createColorField({ label: 'Background' }),
    color: createColorField({ label: 'Text color' }),
    borderColor: createColorField({ label: 'Border color' }),
    borderWidth: { type: 'number' as const, label: 'Border width (px)', min: 0, max: 12 },
    // R17 (T210): the block has two corner settings, so each says whose.
    borderRadius: { ...CORNER_RADIUS_FIELD, label: 'Caption – rounded corners' },
    paddingPx: { type: 'number' as const, label: 'Padding (px)', min: 0, max: 48 },
  },
};

const CAROUSEL_IMAGE_FIELDS = {
  image: imageObjectField('Image'),
  caption: createInlineRichTextField({ label: 'Caption' }),
  // R17 (T219): the link with the content, right after the caption.
  link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link (optional)' },
  // T140: the image frame's corners, today's 8 px by default.
  mediaCornerRadius: { ...CORNER_RADIUS_FIELD, label: 'Image – rounded corners' },
  captionPlacement: { type: 'select' as const, label: 'Caption placement', options: CAPTION_PLACEMENT_OPTIONS },
  // T144: the caption's size per breakpoint (Responsive tab) and its font; today's 14 px semibold by default.
  captionSize: sizeFieldWithDefault('Caption size'),
  captionSizePx: sizePxField('Custom caption size (px)', 10, 120),
  captionFont: itemFontField('Caption font'),
  // T151: the caption's weight; Default keeps today's. T188: per breakpoint (Responsive tab).
  captionWeight: { ...textWeightField('Caption weight'), metadata: PB_RESPONSIVE_METADATA },
  captionStyle: CAPTION_STYLE_FIELD,
  // T172: the caption's colour while the item is hovered or focused; unset keeps today's.
  captionHoverColor: createColorField({ label: 'Caption hover color' }),
  // T129: a scrim behind an overlay caption, for legibility over a busy image.
  captionScrim: {
    type: 'object' as const,
    label: 'Caption scrim',
    objectFields: {
      kind: {
        type: 'select' as const,
        label: 'Scrim',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Gradient from the caption’s edge', value: 'gradient' },
          { label: 'Even tint', value: 'solid' },
        ],
      },
      strength: { type: 'number' as const, label: 'Strength (%)', min: 0, max: 90 },
    },
  },
  // R19B (T249): a second line over the image in a corner of its own, e.g. a "read more" label.
  moreLabel: { type: 'text' as const, label: 'Read-more label' },
  moreLabelPlacement: { type: 'select' as const, label: 'Read-more label placement', options: MORE_LABEL_OPTIONS },
  moreLabelIcon: createIconPickerField('Read-more label icon'),
  hoverZoom: hoverZoomField(),
  tags: ITEM_TAGS_FIELD,
};

/** R19B (T249): the read-more label's look, once it has text. */
const MORE_LOOK_KEYS = new Set(['moreLabelPlacement', 'moreLabelIcon']);

/** The caption's look (R17, T219): offered once the item has a caption. */
const CAPTION_LOOK_KEYS = new Set([
  'captionPlacement',
  'captionSize',
  'captionSizePx',
  'captionFont',
  'captionWeight',
  'captionStyle',
  'captionHoverColor',
  'captionScrim',
]);

const carouselImageConfig: ComponentConfig<{ props: CarouselImageProps }> = {
  label: 'Carousel image',
  fields: CAROUSEL_IMAGE_FIELDS as unknown as Fields<CarouselImageProps>,
  // Today's ImageSlider item defaults: the caption bottom centre, small corners, 8 px padding.
  defaultProps: {
    image: { imageSource: 'library', alt: '', ratio: DEFAULT_RATIO },
    mediaCornerRadius: DEFAULT_MEDIA_CORNER_RADIUS,
    captionPlacement: 'bottom-center',
    captionStyle: { borderWidth: 0, borderRadius: 'small', paddingPx: 8 },
    captionScrim: { kind: 'none', strength: DEFAULT_SCRIM_STRENGTH },
    hoverZoom: false,
  } as CarouselImageProps,
  // Filters the host's field set, so the admin's pickers survive; the Custom px show once Custom is chosen.
  resolveFields: (data, params) => {
    const props = data.props as CarouselImageProps;
    const fields: Record<string, unknown> = {};
    // R17 (T219): the caption's look only with a caption.
    const captioned = !isEmptyInline(props.caption);
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? CAROUSEL_IMAGE_FIELDS)) {
      if (key === 'captionSizePx' && !usesCustom(props.captionSize)) continue;
      if (!captioned && CAPTION_LOOK_KEYS.has(key)) continue;
      if (MORE_LOOK_KEYS.has(key) && !(props.moreLabel?.trim())) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<CarouselImageProps>;
  },
  render: CarouselImageRender,
};

export const CarouselImage = withHideOn(carouselImageConfig);
