'use client';

import { renderContext, type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import { useContext, useRef, type CSSProperties, type ReactNode } from 'react';
import type { JSONContent } from '@tiptap/core';
import {
  buildResponsiveSpacingVars,
  createColorField,
  isSpaceToken,
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  resolveResponsive,
  SECTION_SPACE_FALLBACKS,
  spacingStyleForTier,
  useSectionContext,
  withHideOn,
  type BackgroundProp,
  type BackgroundValue,
  type BreakpointTier,
  type ButtonSpec,
  type Responsive,
  type ResponsiveImage,
  type ResponsiveProp,
  type SectionOverlay,
  type SpaceToken,
  type SpacingValue,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type {
  BlockAlign,
  HeadingTag,
  HeroElement,
  HeroMedia,
  HeroMinHeight,
  HeroOrderItem,
  HeroProps,
  HeroSpaceAfter,
  HeroTextSize,
  TypeToken,
} from '../schema/component-types.js';
import { useBreakpointVideo } from '../hooks/use-breakpoint-video.js';
import { useReveal } from '../hooks/use-reveal.js';
import { splitHtmlWords } from '../utils/split-words.js';
import { alignField, GAP_OPTIONS, revealField } from '../fields/section-block-fields.js';
import { alignTierAttrs, responsiveAlign } from './section-parts.js';
import { colorValueToCss, resolveColorValue } from '../utils/color-value.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';
import { pickBySource } from '../utils/media-source.js';
import { ratioVars, sanitizeRatio } from '../utils/aspect-ratio.js';
import { BoxStyled } from './box-styles.js';
import { BUTTON_SPEC_OBJECT_FIELDS, buttonFromLegacy, specAtTier } from './Button.js';
import { ButtonView } from './ButtonView.js';
import { buttonWidthClasses, buttonWidthField } from './button-full-width.js';
import { TYPE_SIZE_OPTIONS } from './Heading.js';
import { countInlineRichWords, InlineRich } from './InlineRich.js';
import { Picture } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { htmlFromTiptap } from './rich-content-shared.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { isTypeToken, TYPE_SCALE_FALLBACKS, textWeightField, typeTokenSizeCss } from './typography.js';
import { responsiveWeightProps, WeightSpan } from './item-text.js';
import { textMaxWidthAttrs, textMaxWidthField, textMaxWidthPxField } from './text-max-width.js';

/**
 * `cms.Hero` (`specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * US2, FR-011, FR-012; research R-9 to R-11, R-23).
 *
 * Media — today's solid and gradient backgrounds, an art-directed image
 * (`Picture`) or a video pair per breakpoint with a poster
 * (`useBreakpointVideo`: muted, inline, looped, `preload="none"`, never under
 * reduced motion) — behind the content or above it; an eyebrow; a title, a
 * subheading and a statement, each with its own level and size; rich text; a
 * list of buttons (`ButtonView`); a social-proof line. The page's lead hero —
 * its first top-level block, or the first block of a first top-level
 * `cms.Section` — loads its image eagerly with a high fetch priority.
 *
 * Plan § *Extend, don't narrow*: every field today's hero has keeps its
 * counterpart (the option-parity test). A hero stored before the reshape keeps
 * its fields and renders through this renderer exactly as it did
 * ({@link heroFromLegacy}): its title and subtitle keep today's look while they
 * have no size token, and its texts today's spacing while it has no `gaps`.
 *
 * R7: a video's mobile alternative may be a URL as well as a library video
 * (T142); the space after any element may be set on its own (`spaceAfter`,
 * T145), the others keeping `gaps` or today's spacing.
 *
 * Owner review 2026-10-27: the posters have a source of their own, a library
 * image or a URL (`posterSource`, `posterUrl`, T191); the overlay offers only
 * the settings its type uses (T192); the order of the elements and the space
 * after each are one list (`order[].space`, T193), a stored `spaceAfter` still
 * read for an element whose item has none.
 */

// ── Stored before the reshape ────────────────────────────────────────

const LEGACY_KEYS = [
  'heading',
  'subtitle',
  'buttonLabel',
  'buttonLinkType',
  'buttonLinkSlug',
  'buttonHref',
  'buttonTarget',
  'buttonVariant',
  'buttonBackgroundColor',
  'buttonTextColor',
  'background',
  'overlayOpacity',
  'contentAlign',
] as const;

const LOGICAL_ALIGN: Record<string, BlockAlign> = { left: 'start', center: 'center', right: 'end' };

/** Today's render defaults (`HeroBody` on origin/master): 40 % overlay, white text, left, 320 px. */
const LEGACY_OVERLAY_PERCENT = 40;
const LEGACY_TEXT_COLOR = '#ffffff';
const LEGACY_MIN_HEIGHT_PX = 320;

function clampPercent(value: unknown, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, number));
}

/** Today's `background` as the hero's media, kind for kind. */
function mediaFromBackground(background: BackgroundProp): HeroMedia {
  if (background === undefined || background === null || background === '' || background === 'transparent') return { kind: 'none' };
  if (typeof background === 'string') return { kind: 'solid', color: background };
  const value = background as BackgroundValue;
  switch (value.kind) {
    case 'solid':
      return { kind: 'solid', ...(value.color !== undefined ? { color: value.color } : {}) };
    case 'gradient':
      return {
        kind: 'gradient',
        ...(value.gradientFrom !== undefined ? { from: value.gradientFrom } : {}),
        ...(value.gradientTo !== undefined ? { to: value.gradientTo } : {}),
        ...(value.gradientAngle !== undefined ? { angle: value.gradientAngle } : {}),
      };
    case 'image': {
      // As `backgroundToStyle` read it: the library asset when there is one, else the URL.
      const library = value.imageSource === 'library' && Boolean(value.imageAssetId);
      const image: Partial<ResponsiveImage> = library
        ? { imageSource: 'library', assetId: value.imageAssetId!, alt: '', fit: 'cover' }
        : { imageSource: 'url', src: value.imageUrl ?? '', alt: '', fit: 'cover' };
      return { kind: 'image', image };
    }
    case 'video': {
      const library = value.videoSource === 'library' && Boolean(value.videoAssetId);
      return library
        ? { kind: 'video', videoSource: 'library', videoAssetId: value.videoAssetId! }
        : { kind: 'video', videoSource: 'url', videoUrl: value.videoUrl ?? '' };
    }
    default:
      return { kind: 'none' };
  }
}

/**
 * A hero stored on `origin/master` in the reshaped shape, value for value (plan
 * § *Extend, don't narrow*; the option-parity test holds it): the heading and
 * subtitle as the title (`h2`, as today) and subheading, the button and its
 * overrides as the first of the buttons, the background as the media, the
 * overlay opacity as a solid overlay, the alignment as the logical one, and
 * the min height as its Custom (px) case. Today's render defaults are written
 * out (white text, a 40 % overlay, 320 px), and no size token or gap is set, so
 * its render does not change.
 */
export function heroFromLegacy(props: Record<string, unknown>): HeroProps {
  const legacy = props as HeroProps;
  const rest: Record<string, unknown> = { ...props };
  for (const key of LEGACY_KEYS) delete rest[key];

  const label = legacy.buttonLabel ?? '';
  const buttons: ButtonSpec[] = label
    ? [
        buttonFromLegacy({
          label,
          linkType: legacy.buttonLinkType,
          linkSlug: legacy.buttonLinkSlug,
          href: legacy.buttonHref,
          target: legacy.buttonTarget,
          variant: legacy.buttonVariant,
          backgroundColor: legacy.buttonBackgroundColor,
          textColor: legacy.buttonTextColor,
        }),
      ]
    : [];

  return {
    ...rest,
    media: mediaFromBackground(legacy.background),
    overlay: { kind: 'solid', strength: clampPercent(legacy.overlayOpacity, LEGACY_OVERLAY_PERCENT) },
    textColor: legacy.textColor ?? LEGACY_TEXT_COLOR,
    title: plainTextToInlineRichText(legacy.heading ?? ''),
    titleLevel: 'h2',
    ...(legacy.subtitle ? { subheading: plainTextToInlineRichText(legacy.subtitle) } : {}),
    subheadingLevel: 'p',
    buttons,
    align: LOGICAL_ALIGN[legacy.contentAlign ?? 'left'] ?? 'start',
    minHeight: 'custom',
    minHeightPx: legacy.minHeightPx ?? LEGACY_MIN_HEIGHT_PX,
  } as HeroProps;
}

/** A hero stored before the reshape: none of the new shape's required props. */
function isStoredBeforeReshape(props: HeroProps): boolean {
  return props.title === undefined && props.buttons === undefined && props.media === undefined;
}

function effectiveProps(props: HeroProps): HeroProps {
  return isStoredBeforeReshape(props) ? heroFromLegacy(props as unknown as Record<string, unknown>) : props;
}

// ── Lead block ───────────────────────────────────────────────────────

/**
 * Whether this block leads the page — its media is then the page's lead image
 * (R-23): eager, with a high fetch priority. It leads when it is the page's
 * first top-level block, or the first block inside a `cms.Section` that is
 * the page's first top-level block (plan § *Owner ruling 2026-10-23*: the
 * section settings live on a container, so a hero usually sits in one), or
 * the first block of the first Section of a `cms.SectionGroup` that is the
 * page's first top-level block (T158).
 *
 * The depth comes from `useSectionContext()` (R-8). The position comes from
 * Puck's public `renderContext`, which `<Render>` fills with the tree it
 * renders. Nothing has to be stored or threaded through the render sites, and
 * the editor canvas (which `<Render>` does not draw) simply loads lazily.
 */
function useIsLeadBlock(id: unknown): boolean {
  const { depth } = useSectionContext();
  const { data } = useContext(renderContext);
  if (typeof id !== 'string' || id === '') return false;
  type Stored = { type?: unknown; props?: { id?: unknown; content?: unknown } };
  const first = (data?.content as Stored[] | undefined)?.[0];
  if (depth === 0) return first?.props?.id === id;
  if (depth === 1 && first?.type === 'cms.Section' && Array.isArray(first.props?.content)) {
    return (first.props.content as Stored[])[0]?.props?.id === id;
  }
  // T158: through a first top-level `cms.SectionGroup` to its first Section.
  if (depth === 2 && first?.type === 'cms.SectionGroup' && Array.isArray(first.props?.content)) {
    const firstSection = (first.props.content as Stored[])[0];
    if (firstSection?.type !== 'cms.Section' || !Array.isArray(firstSection.props?.content)) return false;
    return (firstSection.props.content as Stored[])[0]?.props?.id === id;
  }
  return false;
}

// ── Media ────────────────────────────────────────────────────────────

const OVERLAY_DIRECTION: Record<NonNullable<SectionOverlay['direction']>, string> = {
  'to-top': 'to top',
  'to-bottom': 'to bottom',
  'to-left': 'to left',
  'to-right': 'to right',
};

/**
 * The overlay, in today's slate (`rgb(15 23 42)`): flat at `strength` %, as
 * today's `overlayOpacity`, or fading out towards `direction`.
 */
function overlayStyle(overlay: SectionOverlay | undefined): CSSProperties | null {
  if (!overlay || overlay.kind === 'none') return null;
  const alpha = clampPercent(overlay.strength, 0) / 100;
  if (overlay.kind === 'solid') return { ['--cmsc-hero-overlay' as string]: String(alpha) } as CSSProperties;
  const direction = OVERLAY_DIRECTION[overlay.direction ?? 'to-top'] ?? 'to top';
  return { background: `linear-gradient(${direction}, rgb(15 23 42 / ${alpha}), rgb(15 23 42 / 0))` };
}

function hasVisualMedia(media: HeroMedia | undefined): media is Extract<HeroMedia, { kind: 'image' | 'video' }> {
  return media?.kind === 'image' || media?.kind === 'video';
}

/** A solid or gradient media, painted on the hero's box as today's background was. */
function paintOf(media: HeroMedia | undefined): BackgroundValue | undefined {
  if (media?.kind === 'solid') return { kind: 'solid', ...(media.color !== undefined ? { color: media.color } : {}) };
  if (media?.kind === 'gradient') {
    return {
      kind: 'gradient',
      ...(media.from !== undefined ? { gradientFrom: media.from } : {}),
      ...(media.to !== undefined ? { gradientTo: media.to } : {}),
      ...(media.angle !== undefined ? { gradientAngle: media.angle } : {}),
    };
  }
  return undefined;
}

function HeroVideos({ media }: { media: Extract<HeroMedia, { kind: 'video' }> }): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const assetUrl = (id: string | undefined): string =>
    id ? absolutizeMediaUrl(assets[id]?.url || `/assets/file/${id}`, mediaBaseUrl) : '';

  const library = media.videoSource === 'library' || (media.videoSource === undefined && Boolean(media.videoAssetId));
  const desktop = library ? assetUrl(media.videoAssetId) : absolutizeMediaUrl(media.videoUrl ?? '', mediaBaseUrl);
  // T142: the mobile video follows the source — a URL with the URL source, the library video with the
  // library — and takes the other one when its own is not set.
  const mobileFromUrl = absolutizeMediaUrl(media.mobileVideoUrl?.trim() ?? '', mediaBaseUrl);
  const mobileFromLibrary = assetUrl(media.mobileVideoAssetId);
  const mobile = library ? mobileFromLibrary || mobileFromUrl : mobileFromUrl || mobileFromLibrary;
  // T191: the posters follow their source — unset or the library: the library image before a URL; the
  // URL source: the URL before the library image. T162: the mobile video's own poster; unset, the poster.
  const pick = (assetId: string | undefined, url: string | undefined): string =>
    pickBySource(media.posterSource, assetUrl(assetId), absolutizeMediaUrl(url?.trim() ?? '', mediaBaseUrl));
  const poster = pick(media.posterAssetId, media.posterUrl);
  const mobilePoster = pick(media.mobilePosterAssetId, media.mobilePosterUrl) || poster;

  const video = (src: string, breakpoint: 'mobile' | 'desktop' | 'all', still: string): ReactNode => (
    <video
      key={breakpoint}
      className="cmsc-pb-hero__video"
      data-bp={breakpoint}
      src={src}
      muted
      playsInline
      loop
      preload="none"
      aria-hidden="true"
      {...(still ? { poster: still } : {})}
    />
  );

  const only = desktop || mobile;
  if (!only) return null;
  // Two videos, or one with its own mobile poster (each `preload="none"`, so nothing loads twice): a pair.
  if ((desktop && mobile && desktop !== mobile) || mobilePoster !== poster) {
    return [video(mobile || desktop, 'mobile', mobilePoster), video(desktop || mobile, 'desktop', poster)];
  }
  return video(only, 'all', poster);
}

function HeroMediaLayer({
  media,
  placement,
  priority,
}: {
  media: Extract<HeroMedia, { kind: 'image' | 'video' }>;
  placement: 'background' | 'above';
  priority: boolean;
}): ReactNode {
  let content: ReactNode = null;
  if (media.kind === 'image') {
    const image = media.image ?? {};
    if (!image.src && !image.assetId && !image.mobileSrc && !image.mobileAssetId) return null;
    // Above the content the frame reserves its ratio (no layout shift); behind it, it fills the hero.
    const framed: Partial<ResponsiveImage> =
      placement === 'above' ? { fit: 'cover', ...image, ratio: image.ratio ?? '16:9' } : { fit: 'cover', ...image };
    content = <Picture className="cmsc-pb-hero__picture" image={framed} priority={priority} />;
  } else {
    content = <HeroVideos media={media} />;
  }
  if (content === null) return null;
  // T126: a video above the content takes its ratio per breakpoint; none keeps the 16:9 frame.
  const videoRatio =
    media.kind === 'video' && placement === 'above'
      ? ratioVars(sanitizeRatio(media.ratio as Responsive<string> | undefined, undefined, false))
      : {};
  return (
    <div
      className={`cmsc-pb-hero__media${placement === 'above' ? ' cmsc-pb-hero__media--above' : ''}`}
      data-kind={media.kind}
      {...(Object.keys(videoRatio).length > 0 ? { style: videoRatio as CSSProperties } : {})}
    >
      {content}
    </div>
  );
}

// ── Texts ────────────────────────────────────────────────────────────

const LEVELS: readonly HeadingTag[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'];

function tagOf(level: unknown, fallback: HeadingTag): HeadingTag {
  return typeof level === 'string' && (LEVELS as readonly string[]).includes(level) ? (level as HeadingTag) : fallback;
}

type HeroTextRole = 'title' | 'subheading' | 'statement';

/** Today's look of a text with no size token: the stored title and subtitle. */
const LEGACY_TEXT_CLASS: Record<HeroTextRole, string | null> = {
  title: 'cmsc-pb-hero__heading',
  subheading: 'cmsc-pb-hero__subtitle',
  statement: null,
};

const DEFAULT_TEXT: Record<HeroTextRole, { level: HeadingTag; size: TypeToken }> = {
  title: { level: 'h1', size: 'h1' },
  subheading: { level: 'p', size: 'lead' },
  statement: { level: 'p', size: 'h4' },
};

function isEmptyInline(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  const content = (value as { content?: Array<{ content?: unknown[] }> }).content;
  return !Array.isArray(content) || content.every((paragraph) => !Array.isArray(paragraph?.content) || paragraph.content.length === 0);
}

/** A size at one tier: a token, or a literal px (`'custom'` with its `…SizePx`). */
function sizeAt(
  size: HeroTextSize | ResponsiveProp<HeroTextSize>,
  sizePx: number | ResponsiveProp<number> | undefined,
  fallback: TypeToken,
  tier: BreakpointTier,
): { token: TypeToken } | { px: number } {
  const value = resolveResponsive<HeroTextSize>(size, tier, fallback);
  if (isTypeToken(value)) return { token: value };
  const px = resolveResponsive<number>(sizePx, tier, TYPE_SCALE_FALLBACKS[fallback].mobilePx);
  return { px: Number.isFinite(px) ? px : TYPE_SCALE_FALLBACKS[fallback].mobilePx };
}

function sizeCss(size: { token: TypeToken } | { px: number }, tier: BreakpointTier): string {
  return 'token' in size ? typeTokenSizeCss(size.token, tier) : `${size.px}px`;
}

function HeroText({
  role,
  value,
  level,
  size,
  sizePx,
  tier,
  revealTarget = false,
  wordStart,
  weight,
  maxWidth,
  maxWidthPx,
  align,
  alignTiers,
}: {
  role: HeroTextRole;
  value: unknown;
  level: HeadingTag | undefined;
  size: HeroTextSize | ResponsiveProp<HeroTextSize> | undefined;
  sizePx: number | ResponsiveProp<number> | undefined;
  tier: BreakpointTier | null;
  /** A fade-and-rise target of the hero's reveal. */
  revealTarget?: boolean;
  /** The word reveal: split into words numbered from here. */
  wordStart?: number;
  /** T151: a weight (300–800) over the size's own; `default` or unset keeps it. */
  weight?: unknown;
  /** T152: a maximum width per breakpoint; unset writes nothing. */
  maxWidth?: HeroProps['titleMaxWidth'];
  maxWidthPx?: HeroProps['titleMaxWidthPx'];
  /** The hero's alignment, so a held text sits where the others do. */
  align?: 'left' | 'center' | 'right';
  /** R17 (T206): the tablet's and desktop's alignment, when they differ (published only). */
  alignTiers?: { md: 'left' | 'center' | 'right'; lg: 'left' | 'center' | 'right' } | undefined;
}): ReactNode {
  if (isEmptyInline(value)) return null;
  const defaults = DEFAULT_TEXT[role];
  const Tag = tagOf(level, defaults.level);
  const classes = [`cmsc-pb-hero__${role}`];
  if (revealTarget) classes.push('cmsc-reveal-target');
  const style: Record<string, string> = {};

  const legacy = LEGACY_TEXT_CLASS[role];
  if (size === undefined && legacy !== null) {
    classes.push(legacy);
  } else {
    const chosen = size ?? defaults.size;
    const sizes = {
      mobile: sizeAt(chosen, sizePx, defaults.size, 'mobile'),
      tablet: sizeAt(chosen, sizePx, defaults.size, 'tablet'),
      desktop: sizeAt(chosen, sizePx, defaults.size, 'desktop'),
    };
    const lead = sizes[tier ?? 'mobile'];
    // The token's line height and weight; a literal px keeps the role's token for them.
    classes.push('cmsc-pb-hero__text--token', `cmsc-t--${'token' in lead ? lead.token : defaults.size}`);
    if (tier !== null) {
      style['fontSize'] = sizeCss(lead, tier);
    } else {
      const uniform =
        'token' in sizes.mobile &&
        'token' in sizes.tablet &&
        'token' in sizes.desktop &&
        sizes.mobile.token === sizes.tablet.token &&
        sizes.tablet.token === sizes.desktop.token;
      if (!uniform) {
        classes.push('cmsc-pb-text-size');
        style['--pb-text-size'] = sizeCss(sizes.mobile, 'mobile');
        style['--pb-text-size-md'] = sizeCss(sizes.tablet, 'tablet');
        style['--pb-text-size-lg'] = sizeCss(sizes.desktop, 'desktop');
      }
    }
  }

  const measure = maxWidth === undefined ? null : textMaxWidthAttrs({ textMaxWidth: maxWidth, ...(maxWidthPx !== undefined ? { textMaxWidthPx: maxWidthPx } : {}) }, tier);
  if (measure) {
    classes.push(measure.className);
    Object.assign(style, measure.style);
  }
  // R17 (T211): the weight per breakpoint; one weight is the inline `font-weight` it was.
  const weighed = responsiveWeightProps(weight, tier);
  Object.assign(style, weighed.inline);

  return (
    <Tag
      className={classes.join(' ')}
      {...(measure && (align === 'center' || align === 'right' || alignTiers) ? { 'data-align': align ?? 'left' } : {})}
      {...(measure ? alignTierAttrs(alignTiers) : {})}
      {...(Object.keys(style).length > 0 ? { style: style as CSSProperties } : {})}
    >
      <WeightSpan vars={weighed.span}>
        <InlineRich value={value as never} {...(wordStart !== undefined ? { wordStart } : {})} />
      </WeightSpan>
    </Tag>
  );
}

function HeroBodyText({
  body,
  revealTarget = false,
  wordStart,
}: {
  body: HeroProps['body'];
  revealTarget?: boolean;
  wordStart?: number | undefined;
}): ReactNode {
  const value = body as unknown;
  if (value === undefined || value === null) return null;
  const className = revealTarget ? 'cmsc-pb-hero__body cmsc-reveal-target' : 'cmsc-pb-hero__body';
  // A plain string (a seeder may write one) is one paragraph.
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    if (wordStart !== undefined) {
      const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return <div className={className} dangerouslySetInnerHTML={{ __html: `<p>${splitHtmlWords(escaped, wordStart).html}</p>` }} />;
    }
    return (
      <div className={className}>
        <p>{value}</p>
      </div>
    );
  }
  const html = htmlFromTiptap(value as JSONContent);
  if (html === '' || html === '<p></p>') return null;
  const shown = wordStart === undefined ? html : splitHtmlWords(html, wordStart).html;
  return <div className={className} dangerouslySetInnerHTML={{ __html: shown }} />;
}

// ── Layout values ────────────────────────────────────────────────────

const MIN_HEIGHT_CSS: Record<Exclude<HeroMinHeight, 'custom'>, string> = {
  auto: 'auto',
  half: '50vh',
  tall: '75vh',
  screen: '100vh',
};

function minHeightAt(props: HeroProps, tier: BreakpointTier): string {
  const value = resolveResponsive<HeroMinHeight>(props.minHeight, tier, 'auto');
  if (value === 'custom') {
    const px = resolveResponsive<number>(props.minHeightPx, tier, LEGACY_MIN_HEIGHT_PX);
    return `${Number.isFinite(px) ? Math.max(0, px) : LEGACY_MIN_HEIGHT_PX}px`;
  }
  return MIN_HEIGHT_CSS[value] ?? 'auto';
}

function gapAt(gaps: HeroProps['gaps'], tier: BreakpointTier): string {
  const token = resolveResponsive<SpaceToken>(gaps, tier, 'm');
  const safe: SpaceToken = isSpaceToken(token) ? token : 'm';
  const [mobilePx, desktopPx] = SECTION_SPACE_FALLBACKS[safe];
  return `var(--cmsb-space-${safe}, ${tier === 'desktop' ? desktopPx : mobilePx}px)`;
}

/** The min height and the gap as one value for the previewed tier, or per breakpoint as custom properties. */
function layoutStyle(props: HeroProps, tier: BreakpointTier | null): CSSProperties {
  const style: Record<string, string> = {};
  const tiers: Array<[BreakpointTier, string]> = [
    ['mobile', ''],
    ['tablet', '-md'],
    ['desktop', '-lg'],
  ];
  if (tier !== null) {
    style['minHeight'] = minHeightAt(props, tier);
    if (props.gaps !== undefined) style['--cmsc-hero-gap'] = gapAt(props.gaps, tier);
    return style as CSSProperties;
  }
  for (const [at, suffix] of tiers) {
    style[`--cmsc-hero-min-h${suffix}`] = minHeightAt(props, at);
    if (props.gaps !== undefined) style[`--cmsc-hero-gap${suffix}`] = gapAt(props.gaps, at);
  }
  return style as CSSProperties;
}

/** The CSS of one `spaceAfter` entry at a tier: a token with its built-in px, or the Custom px. */
function spaceAfterCss(entry: HeroSpaceAfter, tier: BreakpointTier): string {
  if (entry.space === 'custom') {
    const px = typeof entry.spacePx === 'number' && Number.isFinite(entry.spacePx) ? Math.max(0, entry.spacePx) : 0;
    return `${px}px`;
  }
  const token = entry.space as SpaceToken;
  const [mobilePx, desktopPx] = SECTION_SPACE_FALLBACKS[token];
  return `var(--cmsb-space-${token}, ${tier === 'desktop' ? desktopPx : mobilePx}px)`;
}

function isHeroElement(element: unknown): element is HeroElement {
  return typeof element === 'string' && (HERO_ELEMENTS as readonly string[]).includes(element);
}

function hasSpace(entry: { space?: unknown } | null | undefined): boolean {
  return entry?.space === 'custom' || isSpaceToken(entry?.space);
}

/**
 * The space after each element: T193, the space of its item in `order` (the
 * first item per element, as the order reads it); else, as T145 read it, the
 * first stored `spaceAfter` entry for it with a known space. An item or an
 * entry with no, `default` or an unknown space gives none.
 */
export function heroElementSpaces(order: HeroProps['order'], spaceAfter: HeroProps['spaceAfter']): Map<HeroElement, HeroSpaceAfter> {
  const chosen = new Map<HeroElement, HeroSpaceAfter>();
  const listed = new Set<HeroElement>();
  for (const item of Array.isArray(order) ? order : []) {
    const element = item?.element;
    if (!isHeroElement(element) || listed.has(element)) continue;
    listed.add(element);
    if (hasSpace(item)) chosen.set(element, item as HeroSpaceAfter);
  }
  const legacy = new Set<HeroElement>();
  for (const entry of Array.isArray(spaceAfter) ? spaceAfter : []) {
    const element = entry?.element;
    if (!isHeroElement(element) || legacy.has(element) || !hasSpace(entry)) continue;
    legacy.add(element);
    if (!chosen.has(element)) chosen.set(element, entry);
  }
  return chosen;
}

/**
 * T145: the elements given a space of their own, in the default element order,
 * as the content's `data-space-after` and one custom property per element — the
 * previewed tier's in the editor, else the value below the desktop tier and the
 * desktop one (`-lg`). Nothing spaced: nothing. T193: the spaces come from
 * {@link heroElementSpaces}.
 */
function spaceAfterAttrs(
  chosen: Map<HeroElement, HeroSpaceAfter>,
  tier: BreakpointTier | null,
): { names: string; style: Record<string, string> } | null {
  if (chosen.size === 0) return null;
  const style: Record<string, string> = {};
  const names = HERO_ELEMENTS.filter((element) => chosen.has(element));
  for (const element of names) {
    const entry = chosen.get(element)!;
    if (tier !== null) {
      style[`--cmsc-hero-after-${element}`] = spaceAfterCss(entry, tier);
    } else {
      style[`--cmsc-hero-after-${element}`] = spaceAfterCss(entry, 'mobile');
      style[`--cmsc-hero-after-${element}-lg`] = spaceAfterCss(entry, 'desktop');
    }
  }
  return { names: names.join(' '), style };
}

function contentPaddingStyle(
  padding: SpacingValue | ResponsiveProp<SpacingValue> | undefined,
  tier: BreakpointTier | null,
): CSSProperties {
  if (tier) return spacingStyleForTier(padding, tier, 'padding');
  return buildResponsiveSpacingVars('padding', padding);
}

// ── Element order ────────────────────────────────────────────────────

/** Today's order of the hero's elements, which an unset `order` keeps (T133). */
export const HERO_ELEMENTS: readonly HeroElement[] = ['eyebrow', 'title', 'subheading', 'statement', 'body', 'buttons', 'socialProof'];

/**
 * The elements in the order to render them: the listed ones first, each once,
 * then the rest in today's order — so a stored list that misses an element, or
 * names one this version does not know, never hides content.
 */
export function heroElementOrder(order: HeroProps['order']): HeroElement[] {
  const chosen: HeroElement[] = [];
  for (const item of Array.isArray(order) ? order : []) {
    const element = item?.element;
    if (isHeroElement(element) && !chosen.includes(element)) chosen.push(element);
  }
  return [...chosen, ...HERO_ELEMENTS.filter((element) => !chosen.includes(element))];
}

/**
 * T193: a stored `spaceAfter` carried into `order` — once, in the editor. The
 * list becomes the full effective order (an empty or partial one means "these
 * first, then the rest in today's order", so expanding it moves nothing), each
 * item keeping what it had and taking the space {@link heroElementSpaces}
 * reads for its element when it has none of its own. `undefined` when there is
 * nothing to carry.
 */
export function carrySpaceAfterIntoOrder(props: HeroProps): HeroProps | undefined {
  if (!Array.isArray(props.spaceAfter)) return undefined;
  const spaces = heroElementSpaces(props.order, props.spaceAfter);
  const own = new Map<HeroElement, HeroOrderItem>();
  for (const item of Array.isArray(props.order) ? props.order : []) {
    if (isHeroElement(item?.element) && !own.has(item.element)) own.set(item.element, item);
  }
  const order = heroElementOrder(props.order).map((element): HeroOrderItem => {
    const item: HeroOrderItem = { ...(own.get(element) ?? {}), element };
    const space = spaces.get(element);
    if (!hasSpace(item) && space) {
      item.space = space.space!;
      if (space.space !== 'custom') delete item.spacePx;
      else if (space.spacePx !== undefined) item.spacePx = space.spacePx;
      else delete item.spacePx;
    }
    return item;
  });
  const next: HeroProps = { ...props, order };
  delete next.spaceAfter;
  return next;
}

// ── Render ───────────────────────────────────────────────────────────

function HeroBody({ props: stored, tier }: { props: HeroProps; tier: BreakpointTier | null }): ReactNode {
  const props = effectiveProps(stored);
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lead = useIsLeadBlock((stored as { id?: unknown }).id);
  useBreakpointVideo(frameRef, ':scope > .cmsc-pb-hero__media video[data-bp]');
  // The reveal applies to the statement and the body (contracts/blocks.md); never in the editor canvas.
  useReveal(contentRef, props.reveal, { disabled: tier !== null });
  const fadeUp = props.reveal?.effect === 'fade-up';
  const words = props.reveal?.effect === 'words';

  const media = props.media;
  const placement = props.mediaPlacement ?? 'background';
  // Over whatever is behind the content, as today's overlay was; media placed above has none.
  const overlay = placement === 'background' ? overlayStyle(props.overlay) : null;
  // R17 (T206): the alignment per breakpoint; one alignment renders as before.
  const aligned = responsiveAlign(props.align, tier, 'center');
  const align = aligned.align;
  const textColor = props.textColor ? (colorValueToCss(props.textColor) ?? resolveColorValue(props.textColor)) : undefined;
  const paint = paintOf(media);
  const buttons = (props.buttons ?? []).filter((button) => button && typeof button === 'object');
  const proof = props.socialProof;
  const proofImage = proof?.image;
  const hasProofImage = Boolean(proofImage && (proofImage.src || proofImage.assetId || proofImage.mobileSrc || proofImage.mobileAssetId));
  const caption = proof?.caption?.trim() ?? '';
  // Image or video media may reach the window's edges (T133); a solid or gradient paint is the hero's own box.
  const wideMedia = props.mediaWidth === 'viewport' && hasVisualMedia(media);
  const spaced = spaceAfterAttrs(heroElementSpaces(props.order, props.spaceAfter), tier);

  const elements: Record<HeroElement, ReactNode> = {
    eyebrow: props.eyebrow?.trim() ? <p key="eyebrow" className="cmsc-pb-hero__eyebrow">{props.eyebrow}</p> : null,
    title: (
      <HeroText
        key="title"
        role="title"
        value={props.title}
        level={props.titleLevel}
        size={props.titleSize}
        sizePx={props.titleSizePx}
        tier={tier}
        weight={props.titleWeight}
        maxWidth={props.titleMaxWidth}
        maxWidthPx={props.titleMaxWidthPx}
        align={align}
        alignTiers={aligned.tiers}
      />
    ),
    subheading: (
      <HeroText
        key="subheading"
        role="subheading"
        value={props.subheading}
        level={props.subheadingLevel}
        size={props.subheadingSize}
        sizePx={props.subheadingSizePx}
        tier={tier}
      />
    ),
    statement: (
      <HeroText
        key="statement"
        role="statement"
        value={props.statement}
        level={props.statementLevel}
        size={props.statementSize}
        sizePx={props.statementSizePx}
        tier={tier}
        revealTarget={fadeUp}
        {...(words ? { wordStart: 0 } : {})}
      />
    ),
    body: (
      <HeroBodyText
        key="body"
        body={props.body}
        revealTarget={fadeUp}
        wordStart={words ? (isEmptyInline(props.statement) ? 0 : countInlineRichWords(props.statement as never)) : undefined}
      />
    ),
    buttons:
      buttons.length > 0 ? (
        <div key="buttons" className={['cmsc-pb-hero__actions', ...buttonWidthClasses(props.buttonsFullWidth, tier, 'cmsc-btn-list')].join(' ')}>
          {buttons.map((button, index) => (
            <ButtonView key={index} button={tier !== null ? specAtTier(button, tier) : button} className="cmsc-pb-hero__button" />
          ))}
        </div>
      ) : null,
    socialProof:
      hasProofImage || caption !== '' ? (
        <div key="socialProof" className="cmsc-pb-hero__proof">
          {hasProofImage ? <Picture className="cmsc-pb-hero__proof-image" image={proofImage!} /> : null}
          {caption !== '' ? <p className="cmsc-pb-hero__proof-caption">{caption}</p> : null}
        </div>
      ) : null,
  };

  return (
    <BoxStyled
      {...(props.margin !== undefined ? { margin: props.margin } : {})}
      {...(props.border !== undefined ? { border: props.border } : {})}
      {...(paint !== undefined ? { background: paint } : {})}
      {...(props.cornerRadius !== undefined ? { cornerRadius: props.cornerRadius } : {})}
      {...(props.shadow !== undefined ? { shadow: props.shadow } : {})}
      {...(tier !== null ? { previewTier: tier } : {})}
      className={wideMedia ? 'cmsc-pb-hero cmsc-pb-hero--media-viewport' : 'cmsc-pb-hero'}
      style={{ ...layoutStyle(props, tier), ...(textColor ? { color: textColor } : {}) }}
    >
      <div className="cmsc-pb-hero__frame" ref={frameRef}>
        {hasVisualMedia(media) ? <HeroMediaLayer media={media} placement={placement} priority={lead} /> : null}
        {overlay ? <div className="cmsc-pb-hero__overlay" aria-hidden style={overlay} /> : null}
        <div
          ref={contentRef}
          className={[
            'cmsc-pb-hero__content',
            tier === null ? 'cmsc-pb-padding' : '',
            props.gaps !== undefined ? 'cmsc-pb-hero__stack' : '',
            aligned.tiers ? 'cmsc-pb-text-align' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-align={align}
          {...alignTierAttrs(aligned.tiers)}
          {...(spaced ? { 'data-space-after': spaced.names } : {})}
          style={{ ...(aligned.tiers ? {} : { textAlign: align }), ...contentPaddingStyle(props.padding, tier), ...(spaced?.style ?? {}) }}
        >
          {heroElementOrder(props.order).map((element) => elements[element])}
        </div>
      </div>
    </BoxStyled>
  );
}

const HeroEditingRender: PuckComponent<HeroProps> = (props) => (
  <HeroBody props={props as unknown as HeroProps} tier={usePreviewBreakpointTier()} />
);

const HeroPublishedRender: PuckComponent<HeroProps> = (props) => <HeroBody props={props as unknown as HeroProps} tier={null} />;

// ── Fields ───────────────────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { label: 'H1', value: 'h1' },
  { label: 'H2', value: 'h2' },
  { label: 'H3', value: 'h3' },
  { label: 'H4', value: 'h4' },
  { label: 'H5', value: 'h5' },
  { label: 'H6', value: 'h6' },
  { label: 'Paragraph (not a heading)', value: 'p' },
];

const HERO_ELEMENT_LABELS: Record<string, string> = {
  eyebrow: 'Eyebrow',
  title: 'Title',
  subheading: 'Subheading',
  statement: 'Statement',
  body: 'Text',
  buttons: 'Buttons',
  socialProof: 'Social proof',
};

function levelField(label: string) {
  return { type: 'select' as const, label, options: LEVEL_OPTIONS };
}

function sizeField(label: string) {
  return { type: 'select' as const, label, metadata: PB_RESPONSIVE_METADATA, options: TYPE_SIZE_OPTIONS };
}

function sizePxField(label: string) {
  return { type: 'number' as const, label, min: 10, max: 200, step: 1, metadata: PB_RESPONSIVE_METADATA };
}

// R17 (T214): the library first, as every image and video source of the page builder.
const SOURCE_OPTIONS = [
  { label: 'Asset library', value: 'library' },
  { label: 'URL', value: 'url' },
];

/** A `ResponsiveImage` as plain fields; the admin replaces it with the asset-picking image field. */
const IMAGE_OBJECT_FIELD = {
  type: 'object' as const,
  label: 'Image',
  objectFields: {
    imageSource: { type: 'select' as const, label: 'Source', options: SOURCE_OPTIONS },
    src: { type: 'text' as const, label: 'Image URL' },
    assetId: { type: 'text' as const, label: 'Image (asset ID)' },
    mobileSrc: { type: 'text' as const, label: 'Mobile image URL' },
    mobileAssetId: { type: 'text' as const, label: 'Mobile image (asset ID)' },
    alt: { type: 'text' as const, label: 'Alt text' },
    fit: {
      type: 'select' as const,
      label: 'Fit',
      options: [
        { label: 'Cover', value: 'cover' },
        { label: 'Contain', value: 'contain' },
      ],
    },
  },
};

/**
 * The media as plain fields, as this package can offer them. The admin replaces
 * `media` with a control that picks images and videos from the asset library
 * (`HeroMediaField`, `PageBuilderEditor.tsx`).
 */
const MEDIA_FIELD = {
  type: 'object' as const,
  label: 'Media',
  objectFields: {
    kind: {
      type: 'select' as const,
      label: 'Type',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Solid color', value: 'solid' },
        { label: 'Gradient', value: 'gradient' },
        { label: 'Image', value: 'image' },
        { label: 'Video', value: 'video' },
      ],
    },
    color: createColorField({ label: 'Color' }),
    from: createColorField({ label: 'Gradient from' }),
    to: createColorField({ label: 'Gradient to' }),
    angle: { type: 'number' as const, label: 'Gradient angle (deg)', min: 0, max: 360, step: 1 },
    image: IMAGE_OBJECT_FIELD,
    videoSource: { type: 'select' as const, label: 'Video source', options: SOURCE_OPTIONS },
    videoUrl: { type: 'text' as const, label: 'Video URL' },
    videoAssetId: { type: 'text' as const, label: 'Video (asset ID)' },
    mobileVideoAssetId: { type: 'text' as const, label: 'Mobile video (asset ID)' },
    // T142: the mobile video by URL, as the desktop one may be.
    mobileVideoUrl: { type: 'text' as const, label: 'Mobile video URL' },
    // T191: where both posters come from; unset, the source the stored values imply (the admin control shows it).
    posterSource: { type: 'select' as const, label: 'Poster source', options: SOURCE_OPTIONS },
    posterAssetId: { type: 'text' as const, label: 'Poster image (asset ID)' },
    posterUrl: { type: 'text' as const, label: 'Poster URL' },
    // T162: the mobile video's own poster, from the poster source.
    mobilePosterAssetId: { type: 'text' as const, label: 'Mobile poster image (asset ID)' },
    mobilePosterUrl: { type: 'text' as const, label: 'Mobile poster URL' },
    // T126: the video frame's ratio above the content, `w:h` (the admin control sets it per breakpoint).
    ratio: { type: 'text' as const, label: 'Video aspect ratio' },
  },
};

/**
 * The overlay: its type, a gradient's direction and the strength. T192: the
 * block's `resolveFields` offers the direction for a gradient only and the
 * strength for a solid or gradient overlay ({@link overlayFieldFor}).
 */
const OVERLAY_FIELD = {
  type: 'object' as const,
  label: 'Overlay (darkens the background media)',
  objectFields: {
    kind: {
      type: 'select' as const,
      label: 'Type',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Solid', value: 'solid' },
        { label: 'Gradient', value: 'gradient' },
      ],
    },
    direction: {
      type: 'select' as const,
      label: 'Gradient direction',
      options: [
        // R17 (T220): worded as the image's overlay is; the values are unchanged.
        { label: 'Darker at the bottom', value: 'to-top' },
        { label: 'Darker at the top', value: 'to-bottom' },
        { label: 'Darker on the right', value: 'to-left' },
        { label: 'Darker on the left', value: 'to-right' },
      ],
    },
    strength: { type: 'number' as const, label: 'Strength (%)', min: 0, max: 100, step: 5 },
  },
};

const HERO_FIELDS = {
  media: MEDIA_FIELD,
  mediaPlacement: {
    type: 'select' as const,
    label: 'Media placement',
    options: [
      { label: 'Behind the content', value: 'background' },
      { label: 'Above the content', value: 'above' },
    ],
  },
  mediaWidth: {
    type: 'select' as const,
    label: 'Media width',
    options: [
      { label: 'Within the hero', value: 'content' },
      { label: 'Full window width', value: 'viewport' },
    ],
  },
  overlay: OVERLAY_FIELD,
  textColor: createColorField({ label: 'Text color' }),
  eyebrow: { type: 'text' as const, label: 'Eyebrow' },
  title: createInlineRichTextField({ label: 'Title' }),
  titleLevel: levelField('Title level'),
  titleSize: sizeField('Title size'),
  titleSizePx: sizePxField('Custom title size (px)'),
  // T151/T152: the title's weight and its maximum width per breakpoint. R17 (T211): the weight too.
  titleWeight: { ...textWeightField('Title weight'), metadata: PB_RESPONSIVE_METADATA },
  titleMaxWidth: textMaxWidthField('Title max width'),
  titleMaxWidthPx: textMaxWidthPxField('Custom title max width (px)'),
  subheading: createInlineRichTextField({ label: 'Subheading' }),
  subheadingLevel: levelField('Subheading level'),
  subheadingSize: sizeField('Subheading size'),
  subheadingSizePx: sizePxField('Custom subheading size (px)'),
  statement: createInlineRichTextField({ label: 'Statement' }),
  statementLevel: levelField('Statement level'),
  statementSize: sizeField('Statement size'),
  statementSizePx: sizePxField('Custom statement size (px)'),
  body: createRichTextDocField({ label: 'Text' }),
  buttons: {
    type: 'array' as const,
    label: 'Buttons',
    max: 6,
    arrayFields: BUTTON_SPEC_OBJECT_FIELDS,
    defaultItemProps: { label: 'Button', link: { kind: 'url', href: '/' }, style: 'primary', fill: 'solid', size: 'medium' },
    getItemSummary: (item: { label?: string }) => item?.label || 'Button',
  },
  // T168: the buttons at the full width per breakpoint (Responsive tab); unset keeps today's.
  buttonsFullWidth: buttonWidthField('Button width'),
  socialProof: {
    type: 'object' as const,
    label: 'Social proof',
    objectFields: {
      image: IMAGE_OBJECT_FIELD,
      caption: { type: 'text' as const, label: 'Caption' },
    },
  },
  // T133: the order of the elements; T193: with the space after each (the former `spaceAfter` list).
  order: {
    type: 'array' as const,
    label: 'Elements: order and spacing',
    max: HERO_ELEMENTS.length,
    // The admin summarises an item by this select's translated option (`page-builder-i18n.ts`).
    metadata: { pageBuilder: { summaryField: 'element' } },
    arrayFields: {
      element: {
        type: 'select' as const,
        label: 'Element',
        options: HERO_ELEMENTS.map((value) => ({ label: HERO_ELEMENT_LABELS[value]!, value })),
      },
      // `default` (or none): the space between items (`gaps`), or today's.
      space: { type: 'select' as const, label: 'Space after', options: [{ label: 'Default (space between items)', value: 'default' }, ...GAP_OPTIONS] },
      spacePx: { type: 'number' as const, label: 'Custom space (px)', min: 0, max: 400, step: 1 },
    },
    defaultItemProps: { element: 'buttons' },
    // The admin translates this through the select's option labels (`page-builder-i18n.ts`).
    getItemSummary: (item: { element?: string }) => HERO_ELEMENT_LABELS[item?.element ?? ''] ?? 'Element',
  },
  // R17 (T206): per breakpoint.
  align: alignField(),
  minHeight: {
    type: 'select' as const,
    label: 'Minimum height',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Auto', value: 'auto' },
      { label: 'Half the screen', value: 'half' },
      { label: 'Three quarters of the screen', value: 'tall' },
      { label: 'Full screen', value: 'screen' },
      { label: 'Custom (px)', value: 'custom' },
    ],
  },
  minHeightPx: {
    type: 'number' as const,
    label: 'Custom minimum height (px)',
    min: 160,
    max: 900,
    step: 8,
    metadata: PB_RESPONSIVE_METADATA,
  },
  gaps: {
    type: 'select' as const,
    label: 'Space between items',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'None', value: 'none' },
      { label: 'XS', value: 'xs' },
      { label: 'S', value: 's' },
      { label: 'M', value: 'm' },
      { label: 'L', value: 'l' },
      { label: 'XL', value: 'xl' },
      { label: 'XXL', value: 'xxl' },
    ],
  },
  reveal: revealField(),
  cornerRadius: CORNER_RADIUS_FIELD,
  shadow: SHADOW_FIELD,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

/** Whether a (responsive) select holds `'custom'` at any tier. */
function usesCustom(value: unknown): boolean {
  if (value === 'custom') return true;
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(usesCustom);
  return false;
}

/** The literal px fields shown once their select is on Custom, as `customMaxWidthPx` is on the Row. */
const CUSTOM_PX_FIELDS: Record<string, keyof HeroProps> = {
  titleSizePx: 'titleSize',
  titleMaxWidthPx: 'titleMaxWidth',
  subheadingSizePx: 'subheadingSize',
  statementSizePx: 'statementSize',
  minHeightPx: 'minHeight',
};

/** The overlay sub-fields each type uses (T192): the type alone for none, the strength, a gradient's direction. */
const OVERLAY_KEYS: Record<'none' | 'solid' | 'gradient', readonly string[]> = {
  none: ['kind'],
  solid: ['kind', 'strength'],
  gradient: ['kind', 'direction', 'strength'],
};

// Per host field object and type, so `resolveFields` hands Puck the same object every time (focus is kept).
const overlayFieldCache = new WeakMap<object, Map<string, unknown>>();

/**
 * T192: the host's overlay field (the block's own, or a translated copy) with
 * only the sub-fields its type uses. Anything that is not an object field is
 * handed back as it is.
 */
function overlayFieldFor(field: unknown, kind: unknown): unknown {
  const source = field as { type?: string; objectFields?: Record<string, unknown> } | null;
  if (!source || source.type !== 'object' || !source.objectFields) return field;
  const type = kind === 'solid' || kind === 'gradient' ? kind : 'none';
  let byType = overlayFieldCache.get(source);
  if (!byType) {
    byType = new Map();
    overlayFieldCache.set(source, byType);
  }
  const cached = byType.get(type);
  if (cached) return cached;
  const objectFields = Object.fromEntries(OVERLAY_KEYS[type].filter((key) => key in source.objectFields!).map((key) => [key, source.objectFields![key]]));
  const next = { ...source, objectFields };
  byType.set(type, next);
  return next;
}

const DEFAULT_BUTTON: ButtonSpec = {
  label: 'Get started',
  link: { kind: 'url', href: '/' },
  style: 'primary',
  fill: 'solid',
  size: 'medium',
};

const heroConfig: ComponentConfig<{ props: HeroProps }> = {
  label: 'Hero / CTA banner',
  fields: HERO_FIELDS as unknown as Fields<HeroProps>,
  // Neutral and consistent with today's hero (plan § Extend, don't narrow, rule
  // 3, coordinator ruling 2026-10-23): no media and so no overlay, start-aligned
  // (today's `contentAlign: 'left'`), an h1-sized title, one primary button, the
  // scheme's colours, and no `gaps` — today's spacing between the texts (12 px
  // under the title, 20 px under the subheading) until an editor picks a gap.
  defaultProps: {
    media: { kind: 'none' },
    mediaPlacement: 'background',
    eyebrow: '',
    title: plainTextToInlineRichText('Page title'),
    titleLevel: 'h1',
    titleSize: 'h1',
    subheadingLevel: 'p',
    subheadingSize: 'lead',
    statementLevel: 'p',
    statementSize: 'h4',
    buttons: [DEFAULT_BUTTON],
    align: 'start',
    minHeight: 'auto',
    ...DEFAULT_BOX_PROPS,
    padding: { mode: 'uniform', value: 48 },
  } as HeroProps,
  // Filters the host's field set (`params.fields`), not this file's: the admin
  // replaces the media, the buttons and the social-proof image with its pickers.
  resolveFields: (data, params) => {
    const props = data.props as HeroProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? HERO_FIELDS)) {
      const select = CUSTOM_PX_FIELDS[key];
      if (select !== undefined && !usesCustom(props[select])) continue;
      fields[key] = key === 'overlay' ? overlayFieldFor(field, props.overlay?.kind) : field;
    }
    return fields as unknown as Fields<HeroProps>;
  },
  resolveData: async (data, params) => {
    let props = data.props as unknown as HeroProps;
    // A hero stored before the reshape is carried into it once, with no change to its render.
    if (isStoredBeforeReshape(props)) props = heroFromLegacy(props as unknown as Record<string, unknown>);
    // T193: a stored `spaceAfter` is carried into the element list once, with no change to its render.
    // Puck merges the resolved props over the stored ones, so the list is cleared explicitly
    // (`undefined`, which the saved JSON drops) rather than only left out.
    const carried = carrySpaceAfterIntoOrder(props);
    if (carried) props = { ...carried, spaceAfter: undefined } as unknown as HeroProps;
    // The first image or video chosen gets a 40 % solid overlay proposed (contracts/blocks.md); a chosen overlay is kept.
    if (params?.changed?.media === true && hasVisualMedia(props.media) && props.overlay === undefined) {
      props = { ...props, overlay: { kind: 'solid', strength: 40 } };
    }
    return { props: props as never };
  },
  render: (props) =>
    props.puck?.isEditing ? <HeroEditingRender {...props} /> : <HeroPublishedRender {...props} />,
};

export const Hero = withHideOn(heroConfig);

