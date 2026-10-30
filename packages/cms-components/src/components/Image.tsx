'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import type { CSSProperties, ReactNode } from 'react';
import {
  buildResponsiveNumberVars,
  CORNER_RADIUS_PX,
  createAspectRatioField,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
  type Responsive,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ImageProps, ImageWidthMode } from '../schema/component-types.js';
import { imageUsesCustomWidth, shouldShowImageCustomWidthField } from './image-fields.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, useCmsRenderLocalizePath } from './render-context.js';
import { resolveImageUrl, type CmsAssetMap } from '../utils/resolve-image-url.js';
import { ratioVars, sanitizeRatio, uniformRatio } from '../utils/aspect-ratio.js';
import { pictureMobileMedia } from './Picture.js';
import { overlayStyle } from './Section.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { blockLink, blockLinkTarget, carriedBlockLink } from '../utils/link-href.js';
import { responsivePxVars } from './responsive-px.js';
import { textStyleAttrs, type TextStyleValues } from './text-style.js';
import { sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';

/**
 * R17 (T214): the source an image is edited with — the stored one; with none
 * stored, the URL when there is one (the renderer reads an unset source as the
 * URL), else the library, where a new image starts.
 */
function imageShownSource(props: { imageSource?: unknown; src?: unknown; mobileSrc?: unknown }): 'url' | 'library' {
  if (props.imageSource === 'url' || props.imageSource === 'library') return props.imageSource;
  const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';
  return filled(props.src) || filled(props.mobileSrc) ? 'url' : 'library';
}

function imageDimensions(
  widthMode: ImageProps['widthMode'],
  widthPx: ImageProps['widthPx'],
  tier: 'mobile' | 'tablet' | 'desktop',
): CSSProperties {
  const mode = resolveResponsive(widthMode, tier, 'auto' as ImageWidthMode);
  if (mode === 'full') return { width: '100%', maxWidth: '100%', height: 'auto' };
  if (mode === 'custom') {
    const px = resolveResponsiveNumber(widthPx, tier, 320);
    return { width: `${px}px`, maxWidth: '100%', height: 'auto' };
  }
  return { width: 'auto', maxWidth: '100%', height: 'auto' };
}

function imageStyle(
  props: Partial<Pick<ImageProps, 'objectFit' | 'opacity' | 'widthMode' | 'widthPx'>> & {
    cornerRadius?: ImageProps['cornerRadius'];
  },
  tier: 'mobile' | 'tablet' | 'desktop' | null,
): CSSProperties {
  return {
    ...imageDimensions(props.widthMode ?? 'auto', props.widthPx ?? 320, tier ?? 'mobile'),
    objectFit: props.objectFit ?? 'cover',
    opacity: (props.opacity ?? 100) / 100,
    ...(props.cornerRadius ? { borderRadius: `${CORNER_RADIUS_PX[props.cornerRadius]}px` } : {}),
    display: 'inline-block',
    verticalAlign: 'middle',
  };
}

/** The keys `ImageContent` renders; the rest of the props are the box's. */
const CONTENT_KEYS = [
  'imageSource',
  'src',
  'assetId',
  'mobileSrc',
  'mobileAssetId',
  'desktopFrom',
  'alt',
  'href',
  'linkTarget',
  'link',
  'objectFit',
  'opacity',
  'cornerRadius',
  'widthMode',
  'widthPx',
  'ratio',
  'overlay',
  'caption',
  'captionPlacement',
  'captionSize',
  'captionSizePx',
  'captionAlign',
  'captionMaxWidthPx',
] as const;

type ImageContentProps = Partial<Pick<ImageProps, (typeof CONTENT_KEYS)[number]>>;

/** Splits the props into what the image renders and what its box takes (`align` aside). */
function splitProps(props: ImageProps): { content: ImageContentProps; box: Record<string, unknown> } {
  const content: Record<string, unknown> = {};
  const box: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'align') continue;
    if ((CONTENT_KEYS as readonly string[]).includes(key)) {
      if (value !== undefined) content[key] = value;
    } else {
      box[key] = value;
    }
  }
  return { content: content as ImageContentProps, box };
}

/**
 * The image (`specs/163-page-builder-marketing-pages/` T127). With no new
 * option it is today's single `<img>`, its size, fit, opacity and radius
 * inline. Each option adds only its own wrapper:
 *
 * - a mobile image: a `<picture>` with a `<source>` below the tablet tier
 *   (the picture is `display: contents`, so the `<img>` lays out as before);
 * - a ratio other than `auto`, or an overlay: a frame (`.cmsc-pb-image__frame`)
 *   that takes the size, reserves the ratio per breakpoint, and holds the
 *   overlay layer;
 * - a caption: a `<figure>` with a `<figcaption>` below the image or beside it.
 *
 * The element that takes the width is the outermost of them in the flow: the
 * figure for a caption below, else the frame, else the image. The image is
 * lazy and decoded asynchronously; a link wraps the image, never the caption.
 */
function ImageContent({
  props,
  tier,
  editing,
  assets,
  mediaBaseUrl,
}: {
  props: ImageContentProps;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
  editing: boolean;
  assets: CmsAssetMap;
  mediaBaseUrl?: string;
}): ReactNode {
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  const desktopSrc = resolveImageUrl(props, tier, assets, mediaBaseUrl);
  const mobileSrc = resolveImageUrl(
    {
      ...(props.imageSource !== undefined ? { imageSource: props.imageSource } : {}),
      ...(props.mobileSrc ? { src: props.mobileSrc } : {}),
      ...(props.mobileAssetId ? { assetId: props.mobileAssetId } : {}),
    },
    tier,
    assets,
    mediaBaseUrl,
  );
  const resolvedSrc = desktopSrc || mobileSrc;

  if (!resolvedSrc) {
    return editing ? (
      <div className="cmsc:flex cmsc:min-h-[120px] cmsc:items-center cmsc:justify-center cmsc:rounded-[8px] cmsc:border cmsc:border-dashed cmsc:border-[#d9e0e7] cmsc:text-[#64748b] cmsc:text-sm">
        Add an image
      </div>
    ) : null;
  }

  const ratio = sanitizeRatio(props.ratio as Responsive<string> | undefined, undefined, true);
  const hasRatio = ratio !== undefined && uniformRatio(ratio) !== 'auto';
  const overlay = overlayStyle(props.overlay);
  const framed = hasRatio || overlay !== null;
  const caption = typeof props.caption === 'string' ? props.caption.trim() : '';
  // R19B (T251): a placement per breakpoint; the base one (in the editor, the previewed one) is today's attribute.
  const placements = captionPlacements(props.captionPlacement, tier);
  const placement = placements.base;
  const figureTakesWidth = caption !== '' && placement === 'below';

  const look = imageStyle(props, tier);
  const size: CSSProperties = { width: look.width, maxWidth: look.maxWidth, height: look.height };
  const widthClass = tier ? undefined : 'cmsc-pb-image-width';
  const fill: CSSProperties = { width: '100%', maxWidth: '100%', height: 'auto' };

  // The image: today's inline style when it takes the width itself, else it fills its wrapper.
  const imgStyle: CSSProperties = framed
    ? { objectFit: look.objectFit, opacity: look.opacity, display: 'block', ...fill, ...(hasRatio ? { height: '100%' } : {}) }
    : figureTakesWidth
      ? { ...look, ...fill }
      : look;
  const img = (
    <img
      src={resolvedSrc}
      alt={props.alt ?? ''}
      loading="lazy"
      decoding="async"
      className={!framed && !figureTakesWidth ? widthClass : undefined}
      style={imgStyle}
    />
  );
  let media: ReactNode =
    desktopSrc && mobileSrc && mobileSrc !== desktopSrc ? (
      <picture className="cmsc-pb-image__picture">
        <source media={pictureMobileMedia(props.desktopFrom)} srcSet={mobileSrc} />
        {img}
      </picture>
    ) : (
      img
    );

  if (framed) {
    media = (
      <span
        className={['cmsc-pb-image__frame', hasRatio ? 'cmsc-pb-image__frame--ratio' : '', !figureTakesWidth ? (widthClass ?? '') : '']
          .filter(Boolean)
          .join(' ')}
        style={{
          ...(figureTakesWidth ? fill : size),
          ...(look.borderRadius !== undefined ? { borderRadius: look.borderRadius } : {}),
          ...(hasRatio ? ratioVars(ratio) : {}),
        } as CSSProperties}
      >
        {media}
        {overlay ? <span className="cmsc-pb-image__overlay" aria-hidden="true" style={overlay} /> : null}
      </span>
    );
  }

  // R17 (T212): any kind of link; a URL stored before (`href`, `linkTarget`) renders as it always did.
  const link = blockLinkTarget(blockLink(props.link, props.href, props.linkTarget), {
    assets,
    ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}),
    localizePath,
  });
  if (link) {
    media = (
      <a
        href={link.href}
        target={link.target ?? '_self'}
        rel={link.target === '_blank' ? 'noreferrer' : undefined}
        className={figureTakesWidth ? 'cmsc:block' : 'cmsc:inline-block'}
      >
        {media}
      </a>
    );
  }

  if (caption === '') return media;
  const ownCaption = captionLook(props, tier);
  // R20E (T293): the caption's maximum width per breakpoint.
  const captionMeasure = captionMeasureVars(props, tier);
  const captionStyle = ownCaption || captionMeasure ? { ...(ownCaption?.style ?? {}), ...(captionMeasure ?? {}) } : null;
  // R20E (T293): below at the base and beside from a breakpoint up — the figure takes the image's width only
  // while the caption is below; beside, the image keeps that width in a wrapper and the caption gets its column.
  const tiered = figureTakesWidth && (placements.tablet !== undefined || placements.desktop !== undefined);
  return (
    <figure
      className={['cmsc-pb-image__figure', tiered ? 'cmsc-pb-image__figure--tiered' : figureTakesWidth ? (widthClass ?? '') : '']
        .filter(Boolean)
        .join(' ')}
      data-caption={placement}
      {...(placements.tablet ? { 'data-caption-md': placements.tablet } : {})}
      {...(placements.desktop ? { 'data-caption-lg': placements.desktop } : {})}
      {...(tiered
        ? { style: { '--pb-img-fig-w': String(size.width ?? 'auto') } as CSSProperties }
        : figureTakesWidth
          ? { style: size }
          : {})}
    >
      {tiered ? <span className="cmsc-pb-image__media">{media}</span> : media}
      <figcaption
        className={[
          'cmsc-pb-image__caption',
          ...(ownCaption?.classes ?? []),
          captionMeasure ? 'cmsc-pb-image__caption--measure' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        {...(captionStyle ? { style: captionStyle as CSSProperties } : {})}
      >
        {caption}
      </figcaption>
    </figure>
  );
}

type CaptionPlacement = 'below' | 'beside';
const CAPTION_ALIGNS = new Set(['start', 'center', 'end']);

/**
 * R19B (T251): the caption's placement at the base breakpoint, and at the
 * tablet and desktop ones **only where it changes** from the breakpoint below
 * (published); in the editor, the previewed breakpoint's alone.
 */
function captionPlacements(
  value: unknown,
  tier: 'mobile' | 'tablet' | 'desktop' | null,
): { base: CaptionPlacement; tablet?: CaptionPlacement; desktop?: CaptionPlacement } {
  const one = (entry: unknown): CaptionPlacement | undefined =>
    entry === 'beside' ? 'beside' : entry === 'below' ? 'below' : undefined;
  if (value === null || typeof value !== 'object') return { base: one(value) ?? 'below' };
  const stored = value as Record<string, unknown>;
  const base = one(stored['base']) ?? 'below';
  const tablet = one(stored['tablet']) ?? base;
  const desktop = one(stored['desktop']) ?? tablet;
  if (tier !== null) return { base: tier === 'desktop' ? desktop : tier === 'tablet' ? tablet : base };
  return {
    base,
    ...(tablet !== base ? { tablet } : {}),
    ...(desktop !== tablet ? { desktop } : {}),
  };
}

/** R19B (T251): the alignment per breakpoint as `--pb-img-caption-align(-md|-lg)`, only what is set. */
function captionAlignVars(value: unknown, tier: 'mobile' | 'tablet' | 'desktop' | null): Record<string, string> {
  const valid = (entry: unknown): string | undefined => (typeof entry === 'string' && CAPTION_ALIGNS.has(entry) ? entry : undefined);
  const stored = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : { base: value };
  const base = valid(stored['base']);
  const tablet = valid(stored['tablet']);
  const desktop = valid(stored['desktop']);
  if (tier !== null) {
    const at = tier === 'desktop' ? (desktop ?? tablet ?? base) : tier === 'tablet' ? (tablet ?? base) : base;
    return at ? { '--pb-img-caption-align': at } : {};
  }
  return {
    ...(base ? { '--pb-img-caption-align': base } : {}),
    ...(tablet ? { '--pb-img-caption-align-md': tablet } : {}),
    ...(desktop ? { '--pb-img-caption-align-lg': desktop } : {}),
  };
}

/** Today's caption (`.cmsc-pb-image__caption`): the small size at 1.5, read by a breakpoint left on Default. */
const CAPTION_TODAY = { size: 'var(--cmsb-t-small-size, 14px)', lineHeight: '1.5' };

/**
 * R23 (T446): the caption's size — a type token or Custom px (`captionSize`);
 * a Custom px stored by R19B without a size (`captionSizePx` alone) reads as Custom.
 */
export function captionSizeOf(props: Pick<ImageProps, 'captionSize' | 'captionSizePx'>): TextStyleValues['size'] {
  if (props.captionSize !== undefined && props.captionSize !== null) return props.captionSize as TextStyleValues['size'];
  return props.captionSizePx !== undefined && props.captionSizePx !== null ? 'custom' : undefined;
}

/**
 * R19B (T251): the caption's alignment per breakpoint; R23 (T446): its size (a
 * token, which brings its line height, weight and tracking, or Custom px). Its
 * colour and weight are the scheme's muted text (today's). Nothing when unset.
 */
function captionLook(props: ImageContentProps, tier: 'mobile' | 'tablet' | 'desktop' | null): { classes: string[]; style: Record<string, string> } | null {
  const size = textStyleAttrs({ size: captionSizeOf(props), sizePx: props.captionSizePx }, tier, CAPTION_TODAY);
  const align = captionAlignVars(props.captionAlign, tier);
  const style = { ...size.style, ...align };
  if (size.classes.length === 0 && Object.keys(style).length === 0) return null;
  return { classes: [...(Object.keys(align).length > 0 ? ['cmsc-pb-image__caption--styled'] : []), ...size.classes], style };
}

/** R20E (T293): `--pb-img-caption-max(-md|-lg)` in px, only what is set; `null` when unset. */
function captionMeasureVars(props: ImageContentProps, tier: 'mobile' | 'tablet' | 'desktop' | null): Record<string, string> | null {
  return responsivePxVars('img-caption-max', props.captionMaxWidthPx, tier, { min: 40, max: 1200 });
}

const ImageEditingRender: PuckComponent<ImageProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const { align } = props;
  const { content, box } = splitProps(props as unknown as ImageProps);
  const alignAttrs = textAlignDataAttrs(align, 'left');

  return (
    <BoxStyled previewTier={tier} {...box}>
      <div
        className="cmsc-pb-text-align"
        style={{ textAlign: resolveTextAlignForTier(align, tier, 'left') }}
        {...alignAttrs}
      >
        <ImageContent
          props={content}
          tier={tier}
          editing
          assets={assets}
          {...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {})}
        />
      </div>
    </BoxStyled>
  );
};

const ImagePublishedRender: PuckComponent<ImageProps> = (props) => {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const { align, widthMode, widthPx } = props;
  const { content, box } = splitProps(props as unknown as ImageProps);
  const usesCustomWidth = imageUsesCustomWidth(widthMode);
  const alignAttrs = textAlignDataAttrs(align, 'left');

  return (
    <BoxStyled
      {...box}
      {...(usesCustomWidth ? { style: buildResponsiveNumberVars('image-width', widthPx, 320) } : {})}
    >
      <div className={responsiveTextAlignClass(align, 'left')} {...alignAttrs}>
        <ImageContent
          props={content}
          tier={null}
          editing={false}
          assets={assets}
          {...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {})}
        />
      </div>
    </BoxStyled>
  );
};

const WIDTH_MODE_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: 'Full width', value: 'full' },
  { label: 'Custom (px)', value: 'custom' },
];

const imageConfig: ComponentConfig<ImageProps> = {
  label: 'Image',
  // R17 (T219): the image and its alt text together on the General tab (they were split
  // between Data and General); the library first, and a new image starts on it (T214).
  fields: {
    imageSource: {
      type: 'select',
      label: 'Image source',
      options: [
        { label: 'Asset library', value: 'library' },
        { label: 'URL', value: 'url' },
      ],
    },
    src: { type: 'text', label: 'Image URL' },
    assetId: { type: 'text', label: 'Image' },
    // T127: art direction — the image shown below the tablet tier, from the same source.
    mobileSrc: { type: 'text', label: 'Mobile image URL' },
    mobileAssetId: { type: 'text', label: 'Mobile image' },
    // R21G (T337): with a mobile image, where the desktop image starts (R19C's choice for image fields).
    desktopFrom: {
      type: 'select',
      label: 'Mobile image shown on',
      options: [
        { label: 'Phones (below 768 px)', value: 'tablet' },
        { label: 'Phones and tablets (below 1024 px)', value: 'desktop' },
      ],
    },
    alt: { type: 'text', label: 'Alt text' },
    caption: { type: 'textarea', label: 'Caption' },
    captionPlacement: {
      type: 'select',
      label: 'Caption placement',
      // R19B (T251): per breakpoint (Responsive tab); a placement stored as one value applies to all.
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Below the image', value: 'below' },
        { label: 'Beside the image', value: 'beside' },
      ],
    },
    // R19B (T251): the caption's look; unset is today's small muted text at the start.
    // R23 (T446): the size is a type token or Custom px (the established pattern).
    captionSize: sizeFieldWithDefault('Caption size') as never,
    captionSizePx: sizePxField('Custom caption size (px)', 8, 64) as never,
    captionAlign: {
      type: 'select',
      label: 'Caption alignment',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'start' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'end' },
      ],
    },
    // R20E (T293): the caption's maximum width per breakpoint (Responsive tab), e.g. a caption beside the image.
    captionMaxWidthPx: {
      type: 'number',
      label: 'Custom caption max width (px)',
      min: 40,
      max: 1200,
      metadata: PB_RESPONSIVE_METADATA,
    },
    // R17 (T212): the shared link (the admin gives it the page, product, category and file pickers).
    link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link (optional)' },
    objectFit: {
      type: 'select',
      label: 'Object fit',
      options: [
        { label: 'Cover', value: 'cover' },
        { label: 'Contain', value: 'contain' },
        { label: 'Fill', value: 'fill' },
        { label: 'None', value: 'none' },
      ],
    },
    opacity: {
      type: 'number',
      label: 'Opacity (%)',
      min: 0,
      max: 100,
      step: 5,
    },
    overlay: {
      type: 'object',
      label: 'Overlay',
      objectFields: {
        kind: {
          type: 'select',
          label: 'Type',
          options: [
            { label: 'None', value: 'none' },
            { label: 'Solid', value: 'solid' },
            { label: 'Gradient', value: 'gradient' },
          ],
        },
        direction: {
          type: 'select',
          label: 'Gradient direction',
          options: [
            { label: 'Darker at the bottom', value: 'to-top' },
            { label: 'Darker at the top', value: 'to-bottom' },
            { label: 'Darker on the right', value: 'to-left' },
            { label: 'Darker on the left', value: 'to-right' },
          ],
        },
        strength: { type: 'number', label: 'Strength (%)', min: 0, max: 100, step: 5 },
      },
    },
    cornerRadius: CORNER_RADIUS_FIELD,
    widthMode: {
      type: 'select',
      label: 'Width',
      metadata: PB_RESPONSIVE_METADATA,
      options: WIDTH_MODE_OPTIONS,
    },
    widthPx: {
      type: 'number',
      label: 'Custom width (px)',
      min: 16,
      max: 2000,
      step: 8,
      metadata: PB_RESPONSIVE_METADATA,
    },
    // T127: an aspect ratio per breakpoint (Responsive tab); `auto` is the image's own.
    ratio: createAspectRatioField({ label: 'Aspect ratio', defaultRatio: 'auto' }),
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    ...DEFAULT_BOX_PROPS,
    imageSource: 'library',
    src: '',
    assetId: '',
    alt: '',
    objectFit: 'cover',
    opacity: 100,
    widthMode: 'auto',
    widthPx: 320,
    align: 'left',
    mobileSrc: '',
    mobileAssetId: '',
    caption: '',
    captionPlacement: 'below',
    overlay: { kind: 'none', direction: 'to-top', strength: 40 },
  },
  // R17 (T212): a URL stored before is carried into `link` when the image is opened (the render is the same).
  // T214: an image stored with no source and a URL records the URL source it renders with.
  resolveData: ({ props }) => {
    const carried = carriedBlockLink(props);
    const source = props.imageSource === undefined && imageShownSource(props) === 'url' ? { imageSource: 'url' as const } : {};
    // R23 (T446): a caption Custom px stored by R19B without a size is shown as the Custom size it renders as.
    const captionSize = (props.captionSize === undefined || props.captionSize === null) && captionSizeOf(props) === 'custom' ? { captionSize: 'custom' as const } : {};
    return {
      props:
        carried || 'imageSource' in source || 'captionSize' in captionSize
          ? ({ ...props, ...(carried ?? {}), ...source, ...captionSize } as unknown as typeof props)
          : props,
    };
  },
  resolveFields: (data, { fields }) => {
    // T214: a stored image with no source shows the URL fields when it has a URL (it renders by URL).
    const source = imageShownSource(data.props);
    const next: Partial<typeof fields> = { ...fields };
    if (source === 'library') {
      delete next.src;
      delete next.mobileSrc;
    } else {
      delete next.assetId;
      delete next.mobileAssetId;
    }
    if (typeof data.props.caption !== 'string' || data.props.caption.trim() === '') {
      delete next.captionPlacement;
      delete next.captionSize;
      delete next.captionSizePx;
      delete next.captionAlign;
      delete next.captionMaxWidthPx;
    } else if (captionSizeOf(data.props) !== 'custom' && !Object.values(Object(data.props.captionSize)).includes('custom')) {
      delete next.captionSizePx;
    }
    // R21G (T337): the tier the desktop image starts at, with a mobile image only.
    const hasMobile = [data.props.mobileSrc, data.props.mobileAssetId].some((value) => typeof value === 'string' && value.trim() !== '');
    if (!hasMobile) delete next.desktopFrom;
    if (!shouldShowImageCustomWidthField(data.props.widthMode)) {
      delete next.widthPx;
    }
    return next as typeof fields;
  },
  render: (props) =>
    props.puck?.isEditing ? <ImageEditingRender {...props} /> : <ImagePublishedRender {...props} />,
};

export const Image = withHideOn(imageConfig);
