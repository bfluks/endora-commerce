'use client';

import { createContext, useContext, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  DEFAULT_SECTION_SPACE,
  SECTION_ANCHOR_RE,
  SECTION_SPACE_FALLBACKS,
  SECTION_WIDTHS_WITH_CONTENT_WIDTH,
  SECTION_WIDTH_OPTIONS,
  FOCAL_TOKENS,
  backgroundSizeToCss,
  isBackgroundRepeat,
  isSpaceToken,
  normalizeResponsive,
  useSectionContext,
  type BreakpointTier,
  type FocalToken,
  type Responsive,
  type ResponsiveImage,
  type ResponsiveProp,
  type SectionBackgroundValue,
  type SectionContentPosition,
  type SectionContentWidth,
  type SectionWidth,
  type SectionDefaults,
  type SectionOverlay,
  type SectionSettingsValue,
  type SpaceValue,
} from '@endora-commerce/page-builder-core';
import { useBreakpointVideo } from '../hooks/use-breakpoint-video.js';
import { useReveal } from '../hooks/use-reveal.js';
import { colorValueToCss } from '../utils/color-value.js';
import { absolutizeMediaUrl, resolveImageUrl } from '../utils/resolve-image-url.js';
import { Picture, pictureMobileMedia } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';

export interface SectionFrameProps {
  /** The `cms.Section` block's settings — its own top-level props (T117). Ignored unless the block stands at the top level. */
  settings: SectionSettingsValue | undefined;
  /** Spacing defaults, where they differ from `'l'` (data-model §3.4). */
  defaults?: SectionDefaults;
  /** Extra classes and inline style for the `<section>` itself. */
  className?: string;
  style?: CSSProperties;
  /**
   * The editor's preview tier. With it, spacing and the custom width are
   * written for that tier inline; without it (the storefront), as custom
   * properties per breakpoint that the stylesheet reads in its media queries.
   */
  tier?: BreakpointTier;
  /** The editor canvas: no entrance reveal there (a `tier` implies it too). */
  editing?: boolean;
  children: ReactNode;
}

type Tiered = { base: string; md: string; lg: string };

/** The anchor of the top-level section a block renders in, or `null`. */
const SectionAnchorContext = createContext<string | null>(null);

/**
 * What a top-level `cms.SectionGroup` (T158) tells the Sections in its slot:
 * that they stand in it — so they render as top-level Sections — and, when it
 * paints (a scheme or a background), which scheme, so a Section with no
 * background of its own and no other scheme lets the group's paint through.
 */
interface SectionGroupInfo {
  scheme: string | undefined;
  paints: boolean;
  anchor: string | null;
}

const SectionGroupContext = createContext<SectionGroupInfo | null>(null);

/**
 * The anchor of the `cms.Section` the calling block stands in, or `null` —
 * where a block that sends the visitor back to the page (the newsletter
 * sign-up's no-JavaScript post) lands them (contracts/blocks.md `newsletter.Signup`).
 */
export function useSectionAnchor(): string | null {
  return useContext(SectionAnchorContext);
}

/** One spacing value as CSS for one tier: a token reads its brand variable, `{px}` is a literal. */
function spaceToCss(value: SpaceValue | undefined, desktop: boolean): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (isSpaceToken(value)) {
    const [mobilePx, desktopPx] = SECTION_SPACE_FALLBACKS[value];
    return `var(--cmsb-space-${value}, ${desktop ? desktopPx : mobilePx}px)`;
  }
  if (typeof value === 'object' && typeof value.px === 'number' && Number.isFinite(value.px)) {
    return `${Math.max(0, value.px)}px`;
  }
  return undefined;
}

/** A responsive value per tier, each tier inheriting the one below (`base` → `tablet` → `desktop`). */
function tiers<T>(value: T | Responsive<T> | undefined, fallback: T): { base: T; tablet: T; desktop: T } {
  const responsive = normalizeResponsive(value as T | ResponsiveProp<T> | undefined, fallback);
  const tablet = responsive.tablet ?? responsive.base;
  return { base: responsive.base, tablet, desktop: responsive.desktop ?? tablet };
}

function spacingTiers(value: SpaceValue | Responsive<SpaceValue> | undefined, fallback: SpaceValue): Tiered {
  const t = tiers<SpaceValue>(value, fallback);
  const fallbackCss = (desktop: boolean) => spaceToCss(fallback, desktop) ?? '0px';
  return {
    base: spaceToCss(t.base, false) ?? fallbackCss(false),
    md: spaceToCss(t.tablet, false) ?? fallbackCss(false),
    lg: spaceToCss(t.desktop, true) ?? fallbackCss(true),
  };
}

/** The custom max width: one px value (T117); a per-breakpoint one, should one be stored, is read too. */
function maxWidthTiers(value: number | Responsive<number> | undefined): Tiered {
  const t = tiers<number>(value, 1200);
  const px = (n: number) => `${Number.isFinite(n) ? Math.max(0, n) : 1200}px`;
  return { base: px(t.base), md: px(t.tablet), lg: px(t.desktop) };
}

/** Whether a spacing value is no space at all: `none` or `{px: 0}`. */
function isNoSpace(value: SpaceValue): boolean {
  return value === 'none' || (typeof value === 'object' && value !== null && !(value.px > 0));
}

/**
 * The overlap (T148) per tier, or `null` when it pulls nothing up at any tier
 * the caller renders — the published page reads all three, the editor canvas
 * its previewed one — so an unset or all-`none` overlap writes nothing.
 */
function overlapTiers(value: SpaceValue | Responsive<SpaceValue> | undefined, tier: BreakpointTier | undefined): Tiered | null {
  if (value === undefined || value === null) return null;
  const t = tiers<SpaceValue>(value, 'none');
  const used = tier === undefined ? [t.base, t.tablet, t.desktop] : [tier === 'desktop' ? t.desktop : tier === 'tablet' ? t.tablet : t.base];
  if (used.every(isNoSpace)) return null;
  return spacingTiers(value, 'none');
}

function pickTier(values: Tiered, tier: BreakpointTier): string {
  if (tier === 'desktop') return values.lg;
  if (tier === 'tablet') return values.md;
  return values.base;
}

function tierVars(name: string, values: Tiered): Record<string, string> {
  return { [`--cmsc-section-${name}`]: values.base, [`--cmsc-section-${name}-md`]: values.md, [`--cmsc-section-${name}-lg`]: values.lg };
}

/**
 * A colour as CSS: a `ColorValue` (hex or `token:<role>`), or — for a background
 * stored before feature 163 — any plain colour the old colour field wrote
 * (`rgb(…)`, a named colour). `transparent` and anything that could carry more
 * than a colour are dropped.
 */
function colorToCss(value: string | undefined): string | undefined {
  const fromValue = colorValueToCss(value);
  if (fromValue) return fromValue;
  if (!value || value === 'transparent') return undefined;
  return /^[#a-z0-9(),.%\s-]{1,64}$/i.test(value) ? value : undefined;
}

/** T167: a focal keyword as a CSS background position (`top` is the top centre). */
const FOCAL_BACKGROUND_POSITION: Record<FocalToken, string> = {
  center: 'center',
  top: 'top center',
  bottom: 'bottom center',
  left: 'left center',
  right: 'right center',
};

function focalPosition(value: unknown): string | null {
  return typeof value === 'string' && (FOCAL_TOKENS as readonly string[]).includes(value) ? FOCAL_BACKGROUND_POSITION[value as FocalToken] : null;
}

/**
 * T167: the decorative layer's size, repeat and position, chosen beside the
 * `decorative` toggle — written inline only for the values set (and valid),
 * so an unset one keeps the stylesheet's `cover`, `no-repeat`, `top center`.
 * Over a gradient the layer is the first of two background layers, so each
 * value is followed by the gradient's — today's, the stylesheet's.
 */
function decorativeLayoutStyle(background: SectionBackgroundValue, gradient: boolean): CSSProperties {
  if (background.decorative !== true) return {};
  const size = backgroundSizeToCss(background.decorativeSize);
  const repeat = isBackgroundRepeat(background.decorativeRepeat) ? background.decorativeRepeat : null;
  const position = focalPosition(background.decorativePosition);
  if (size === null && repeat === null && position === null) return {};
  const layers = (own: string | null, today: string): string => (gradient ? `${own ?? today}, ${today}` : (own ?? today));
  return {
    ...(size !== null || gradient ? { backgroundSize: layers(size, 'cover') } : {}),
    ...(repeat !== null || gradient ? { backgroundRepeat: layers(repeat, 'no-repeat') } : {}),
    ...(position !== null || gradient ? { backgroundPosition: layers(position, 'top center') } : {}),
  };
}

/**
 * A solid or gradient background, painted on the section itself. With the
 * decorative backdrop (R-8a, T091) a gradient is drawn as the layer beneath
 * `--cmsb-decorative` rather than as the `background` shorthand, which would
 * replace the backdrop the stylesheet paints; a solid colour sits under it as
 * it is. The decorative layer's own size, repeat and position (T167) follow.
 */
function paintStyle(background: SectionBackgroundValue | undefined): CSSProperties {
  if (!background) return {};
  if (background.kind === 'solid') {
    const color = colorToCss(background.color);
    return { ...(color ? { backgroundColor: color } : {}), ...decorativeLayoutStyle(background, false) };
  }
  if (background.kind === 'gradient') {
    const from = colorToCss(background.gradientFrom) ?? '#ffffff';
    const to = colorToCss(background.gradientTo) ?? '#000000';
    const angle = typeof background.gradientAngle === 'number' && Number.isFinite(background.gradientAngle) ? background.gradientAngle : 135;
    const gradient = `linear-gradient(${angle}deg, ${from}, ${to})`;
    return background.decorative === true
      ? { backgroundImage: `var(--cmsb-decorative, none), ${gradient}`, ...decorativeLayoutStyle(background, true) }
      : { background: gradient };
  }
  return decorativeLayoutStyle(background, false);
}

/** A URL as a quoted CSS string: a quote, a backslash or a line break cannot end it. */
function cssUrl(url: string): string {
  return `url("${url.replace(/[\\"]/g, (char) => `\\${char}`).replace(/[\n\r]/g, '')}")`;
}

/**
 * T167: an image background whose size or repeat a `<picture>` cannot draw —
 * a natural or fixed size (`auto`, px, %) or any repeat — is painted as a CSS
 * background of the media layer. `cover` and `contain` without a repeat stay
 * the `<picture>` (`object-fit`), unset byte for byte as before.
 */
function tiledImageLayout(background: SectionBackgroundValue): { size: string; repeat: string } | null {
  const size = backgroundSizeToCss(background.size);
  const repeat = isBackgroundRepeat(background.repeat) ? background.repeat : null;
  const fits = size === null || size === 'cover' || size === 'contain';
  if (fits && (repeat === null || repeat === 'no-repeat')) return null;
  return { size: size ?? 'cover', repeat: repeat ?? 'no-repeat' };
}

/**
 * The tiled image (T167): the desktop image as `--cmsc-tile-image` and, when
 * it differs, the mobile one as `--cmsc-tile-image-mobile`, which the
 * stylesheet shows below the tablet tier (the `<picture>`'s breakpoint); a
 * mobile-only image is used at every width. The size is the same at every
 * breakpoint.
 */
function SectionTile({ background, layout }: { background: SectionBackgroundValue; layout: { size: string; repeat: string } }): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const library = background.imageSource === 'library';
  const desktop = resolveImageUrl(
    library && background.imageAssetId ? { imageSource: 'library', assetId: background.imageAssetId } : { imageSource: 'url', src: library ? '' : (background.imageUrl ?? '') },
    null,
    assets,
    mediaBaseUrl,
  );
  const mobile = resolveImageUrl(
    background.mobileImageAssetId
      ? { imageSource: 'library', assetId: background.mobileImageAssetId }
      : { imageSource: 'url', src: background.mobileImageUrl ?? '' },
    null,
    assets,
    mediaBaseUrl,
  );
  const main = desktop || mobile;
  if (!main) return null;
  const style: Record<string, string> = {
    '--cmsc-tile-image': cssUrl(main),
    ...(desktop && mobile && mobile !== desktop ? { '--cmsc-tile-image-mobile': cssUrl(mobile) } : {}),
    backgroundSize: layout.size,
    backgroundRepeat: layout.repeat,
    backgroundPosition: focalPosition(background.position) ?? 'center',
  };
  return <div className="cmsc-section__tile" style={style as CSSProperties} />;
}

const OVERLAY_DIRECTION: Record<NonNullable<SectionOverlay['direction']>, string> = {
  'to-top': 'to top',
  'to-bottom': 'to bottom',
  'to-left': 'to left',
  'to-right': 'to right',
};

/** The overlay over an image or video: black at `strength` %, flat or fading out in `direction` (also `cms.Image`'s, T127). */
export function overlayStyle(overlay: SectionOverlay | undefined): CSSProperties | null {
  if (!overlay || overlay.kind === 'none') return null;
  const strength = Math.min(100, Math.max(0, Number(overlay.strength) || 0)) / 100;
  const shade = `rgba(0, 0, 0, ${strength})`;
  if (overlay.kind === 'solid') return { background: shade };
  const direction = OVERLAY_DIRECTION[overlay.direction ?? 'to-top'] ?? 'to top';
  return { background: `linear-gradient(${direction}, ${shade}, rgba(0, 0, 0, 0))` };
}

function SectionVideos({ background }: { background: SectionBackgroundValue }): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const assetUrl = (id: string | undefined): string =>
    id ? absolutizeMediaUrl(assets[id]?.url || `/assets/file/${id}`, mediaBaseUrl) : '';

  const desktop =
    background.videoSource === 'library' && background.videoAssetId
      ? assetUrl(background.videoAssetId)
      : absolutizeMediaUrl(background.videoUrl ?? '', mediaBaseUrl);
  const mobile = assetUrl(background.mobileVideoAssetId);
  const poster = assetUrl(background.videoPosterAssetId);

  const video = (src: string, breakpoint: 'mobile' | 'desktop' | 'all') => (
    <video
      key={breakpoint}
      className="cmsc-section__video"
      data-bp={breakpoint}
      src={src}
      muted
      playsInline
      loop
      preload="none"
      {...(poster ? { poster } : {})}
    />
  );

  if (desktop && mobile && desktop !== mobile) return [video(mobile, 'mobile'), video(desktop, 'desktop')];
  const only = desktop || mobile;
  return only ? video(only, 'all') : null;
}

/** The image or video layer and its overlay — absolutely placed, so it reserves no space and shifts nothing. */
function SectionMedia({ background }: { background: SectionBackgroundValue }): ReactNode {
  const overlay = overlayStyle(background.overlay);

  let media: ReactNode = null;
  const tiled = background.kind === 'image' ? tiledImageLayout(background) : null;
  if (tiled !== null) {
    const named = background.imageSource === 'library' ? background.imageAssetId : background.imageUrl;
    if (named || background.mobileImageAssetId || background.mobileImageUrl) media = <SectionTile background={background} layout={tiled} />;
  } else if (background.kind === 'image') {
    // `Picture` resolves each image as `resolveImageUrl` does — an asset id
    // through the asset map, else the URL — so each image is handed over with
    // whichever of the two it carries, under the `library` source.
    const library = background.imageSource === 'library';
    const image: ResponsiveImage = {
      imageSource: 'library',
      ...(library && background.imageAssetId ? { assetId: background.imageAssetId } : {}),
      ...(!library && background.imageUrl ? { src: background.imageUrl } : {}),
      ...(background.mobileImageAssetId
        ? { mobileAssetId: background.mobileImageAssetId }
        : background.mobileImageUrl
          ? { mobileSrc: background.mobileImageUrl }
          : {}),
      alt: '',
      // T167: `contain` shows the whole image; unset or `cover`, today's crop.
      fit: backgroundSizeToCss(background.size) === 'contain' ? 'contain' : 'cover',
      ...(background.position ? { position: background.position } : {}),
      // R19C (T263): the tier the desktop image starts at; unset, the tablet tier.
      ...(background.desktopFrom === 'desktop' ? { desktopFrom: 'desktop' as const } : {}),
    };
    if (image.assetId || image.src || image.mobileAssetId || image.mobileSrc) {
      media = <Picture className="cmsc-section__picture" image={image} />;
    }
  } else if (background.kind === 'video') {
    media = <SectionVideos background={background} />;
  }

  if (media === null) return null;
  // R19C (T263): the stylesheet keeps a tiled mobile image or the mobile video up to the desktop tier.
  // (A `<picture>` carries its own query.)
  const desktopFrom = background.desktopFrom === 'desktop' && (background.kind === 'video' || tiled !== null);
  return (
    <div className="cmsc-section__media" aria-hidden="true" {...(desktopFrom ? { 'data-desktop-from': 'desktop' } : {})}>
      {media}
      {overlay ? (
        <div className="cmsc-section__overlay" data-kind={background.overlay?.kind} style={overlay} />
      ) : null}
    </div>
  );
}

/** The page gutter, as every width rule of the stylesheet spells it. */
const GUTTER = 'var(--pb-page-padding, var(--cmsb-gutter, 24px))';
const CONTAINER = 'var(--cmsb-container, 1360px)';
const WIDE = 'var(--cmsb-wide, 1600px)';

function isSectionWidth(value: unknown): value is SectionWidth {
  return typeof value === 'string' && (SECTION_WIDTH_OPTIONS as readonly string[]).includes(value);
}

/** The width per tier; a value outside the grammar reads as `contained`, as an unset one does. */
function widthTiers(value: SectionSettingsValue['width']): { base: SectionWidth; tablet: SectionWidth; desktop: SectionWidth } {
  const t = tiers<SectionWidth>(value as SectionWidth | Responsive<SectionWidth> | undefined, 'contained');
  const valid = (width: unknown): SectionWidth => (isSectionWidth(width) ? width : 'contained');
  return { base: valid(t.base), tablet: valid(t.tablet), desktop: valid(t.desktop) };
}

/**
 * R19C (T260, T262): one tier of a section whose width differs per breakpoint —
 * its box (width, the margin that centres it, the minimum height) and its
 * content frame (max width, side padding), the same values the stylesheet's
 * `data-width` rules give that width. R23 (T449): no background outset.
 */
function tierLayout(
  width: SectionWidth,
  contentWidth: SectionContentWidth | undefined,
  customPx: number,
): Record<'w' | 'm' | 'mh' | 'fmax' | 'fpx', string> {
  const box =
    width === 'contained'
      ? '100%'
      : width === 'custom'
        ? `max(100%, min(${customPx}px, 100vw - 2 * ${GUTTER}))`
        : width === 'full'
          ? `calc(100% + 2 * ${GUTTER})`
          : '100vw';
  let frame: [string, string] =
    width === 'contained'
      ? [CONTAINER, '0px']
      : width === 'custom'
        ? [`${customPx}px`, '0px']
        : width === 'wide'
          ? [WIDE, GUTTER]
          : width === 'bleed'
            ? ['none', '0px']
            : [CONTAINER, GUTTER];
  if (contentWidth !== undefined && SECTION_WIDTHS_WITH_CONTENT_WIDTH.includes(width)) {
    frame =
      contentWidth === 'contained'
        ? [CONTAINER, GUTTER]
        : contentWidth === 'wide'
          ? [WIDE, GUTTER]
          : contentWidth === 'full'
            ? ['none', '0px']
            : [`${customPx}px`, GUTTER];
  }
  return {
    w: box,
    m: `calc((100% - ${box}) / 2)`,
    mh: width === 'viewport' ? '100svh' : 'auto',
    fmax: frame[0],
    fpx: frame[1],
  };
}

/** R19C (T260): the box and frame variables of a tiered width, each tier written (`-md`, `-lg` beside the base). */
function tieredVars(
  widths: { base: SectionWidth; tablet: SectionWidth; desktop: SectionWidth },
  settings: SectionSettingsValue | undefined,
): Record<string, string> {
  const custom = maxWidthTiers(settings?.customMaxWidthPx);
  const customPx = (css: string): number => Number.parseFloat(css);
  const contentWidth = settings?.contentWidth;
  const layouts = {
    '': tierLayout(widths.base, contentWidth, customPx(custom.base)),
    '-md': tierLayout(widths.tablet, contentWidth, customPx(custom.md)),
    '-lg': tierLayout(widths.desktop, contentWidth, customPx(custom.lg)),
  };
  const vars: Record<string, string> = {};
  const names = { w: 'box-w', m: 'box-m', mh: 'box-mh', fmax: 'frame-max', fpx: 'frame-px' } as const;
  for (const [suffix, layout] of Object.entries(layouts)) {
    for (const [key, name] of Object.entries(names)) vars[`--cmsc-section-${name}${suffix}`] = layout[key as keyof typeof names];
  }
  return vars;
}

/** Whether a background paints something of its own: a colour, a gradient, media or the decorative layer. */
function hasOwnBackground(background: SectionBackgroundValue | undefined): boolean {
  if (!background) return false;
  return background.decorative === true || ['solid', 'gradient', 'image', 'video'].includes(background.kind as string);
}

function SectionShell({
  settings,
  defaults,
  className,
  style,
  tier,
  editing,
  children,
  group,
}: SectionFrameProps & { group: SectionGroupInfo | null }): ReactNode {
  const ref = useRef<HTMLElement>(null);
  // Its own background pair only: a block inside it (a hero) plays its own media.
  useBreakpointVideo(ref, ':scope > .cmsc-section__media video[data-bp]', {
    mobileMedia: pictureMobileMedia(settings?.background?.desktopFrom),
  });
  // The section reveal fades its frame up (R-21); a word reveal is a block's, so it fades here too.
  useReveal(ref, settings?.reveal, { disabled: editing === true || tier !== undefined });

  const anchor = typeof settings?.anchor === 'string' && SECTION_ANCHOR_RE.test(settings.anchor) ? settings.anchor : undefined;
  const scheme = settings?.scheme && settings.scheme !== 'inherit' ? settings.scheme : undefined;
  // R19C (T260): the width per breakpoint. The editor canvas renders its tier's
  // as one value; the page, one value when the tiers agree (a stored single
  // width included), else `tiered`, each tier's box and frame as variables.
  const widths = widthTiers(settings?.width);
  const tiered = tier === undefined && !(widths.base === widths.tablet && widths.tablet === widths.desktop);
  const width: SectionWidth | 'tiered' = tiered ? 'tiered' : tier === undefined ? widths.base : widths[tier === 'mobile' ? 'base' : tier];
  const background = settings?.background && settings.background.kind ? settings.background : undefined;
  const hasMedia = background !== undefined && (background.kind === 'image' || background.kind === 'video');

  const position = settings?.contentPosition !== undefined ? tiers<SectionContentPosition>(settings.contentPosition, 'start') : null;
  const positionAttrs: Record<string, string> =
    position === null
      ? {}
      : tier === undefined
        ? { 'data-position': position.base, 'data-position-md': position.tablet, 'data-position-lg': position.desktop }
        : { 'data-position': tier === 'desktop' ? position.desktop : tier === 'tablet' ? position.tablet : position.base };

  const top = spacingTiers(settings?.spaceTop ?? defaults?.spaceTop, DEFAULT_SECTION_SPACE);
  const bottom = spacingTiers(settings?.spaceBottom ?? defaults?.spaceBottom, DEFAULT_SECTION_SPACE);
  // T124: a background wider than the page container may hold its content in another frame.
  const contentWidth =
    settings?.contentWidth !== undefined && width !== 'tiered' && SECTION_WIDTHS_WITH_CONTENT_WIDTH.includes(width)
      ? settings.contentWidth
      : undefined;
  const maxWidth = width === 'custom' || contentWidth === 'custom' ? maxWidthTiers(settings?.customMaxWidthPx) : null;
  const overlap = overlapTiers(settings?.overlap, tier);
  // T158: in a painting group, a Section with no background and no other scheme shows the group's paint.
  const transparent = group !== null && group.paints && !hasOwnBackground(background) && (scheme === undefined || scheme === group.scheme);

  const layoutVars: Record<string, string> =
    tier === undefined
      ? {
          ...tierVars('pt', top),
          ...tierVars('pb', bottom),
          ...(maxWidth ? tierVars('max', maxWidth) : {}),
          ...(overlap ? tierVars('overlap', overlap) : {}),
          ...(tiered ? tieredVars(widths, settings) : {}),
        }
      : {
          '--cmsc-section-pt': pickTier(top, tier),
          '--cmsc-section-pb': pickTier(bottom, tier),
          ...(maxWidth ? { '--cmsc-section-max': pickTier(maxWidth, tier) } : {}),
          ...(overlap ? { '--cmsc-section-overlap': pickTier(overlap, tier) } : {}),
        };

  return (
    <section
      ref={ref}
      className={['cmsc-section', tier !== undefined ? 'cmsc-section--tier' : '', className ?? ''].filter(Boolean).join(' ')}
      {...(anchor ? { id: anchor } : {})}
      {...(scheme ? { 'data-cmsb-scheme': scheme } : {})}
      data-width={width}
      {...(contentWidth ? { 'data-content-width': contentWidth } : {})}
      {...positionAttrs}
      {...(hasMedia ? { 'data-media': '1' } : {})}
      {...(background?.decorative ? { 'data-decorative': '1' } : {})}
      {...(overlap ? { 'data-overlap': '1' } : {})}
      {...(group !== null ? { 'data-in-group': '1' } : {})}
      {...(transparent ? { 'data-transparent': '1' } : {})}
      style={{ ...layoutVars, ...paintStyle(background), ...style } as CSSProperties}
    >
      {background ? <SectionMedia background={background} /> : null}
      <div className="cmsc-section__frame">
        <SectionAnchorContext.Provider value={anchor ?? group?.anchor ?? null}>{children}</SectionAnchorContext.Provider>
      </div>
    </section>
  );
}

/**
 * The frame `cms.Section` (`SectionBlock.tsx`) renders through —
 * `specs/163-page-builder-marketing-pages/` contracts/blocks.md, "`cms.Section`";
 * research R-8, R-8a, R-9; plan § *Owner ruling 2026-10-23*.
 *
 * At the top level of a page (`useSectionContext().topLevel`) it renders one
 * `<section class="cmsc-section">` with:
 *
 * - the anchor as its `id`, the colour scheme as `data-cmsb-scheme` (none for
 *   `inherit`) and the width as `data-width`;
 * - a solid or gradient background painted on itself, or an image (`Picture`,
 *   art-directed) or a video pair (`useBreakpointVideo`) in an absolutely
 *   placed media layer, with the overlay above it;
 * - `decorative`, which paints the dark scheme's `--cmsb-decorative` backdrop;
 * - the spacing as **padding** custom properties per breakpoint — never margin,
 *   so adjacent sections touch and two dark ones read as one dark area (FR-005);
 * - its content inside one `.cmsc-section__frame`, which the width sizes — or,
 *   for a `full`, `viewport` or `bleed` background, the `contentWidth` when set
 *   (`data-content-width`, T124) — and
 *   the content position per breakpoint as `data-position(-md|-lg)`;
 * - `reveal`, the entrance reveal of that frame (`useReveal`, R-21): nothing
 *   on the server, `pending` then `done` on the client when motion is allowed;
 * - `overlap` (T148), `data-overlap` and `--cmsc-section-overlap(-md|-lg)`:
 *   the stylesheet pulls the frame up into the previous section by that much
 *   and stacks the section above it; in the editor canvas a band shows the
 *   previewed tier's overlap instead, so the previous section stays editable.
 *   Nothing is written for an unset overlap or one that is `none` throughout.
 *
 * A published section whose blocks all render nothing drops its padding in
 * the stylesheet (`:has()`, T148) — nothing here decides it.
 *
 * Directly in the slot of a top-level `cms.SectionGroup` (T158) it renders as
 * at the top level, marked `data-in-group`, and `data-transparent` when the
 * group paints and it has no background of its own and no other scheme.
 *
 * Nested anywhere else — a Section stored inside a column, a slot or a
 * carousel, which the editor refuses — it renders its children only and
 * ignores the settings (FR-000).
 */
export function SectionFrame(props: SectionFrameProps): ReactNode {
  const { topLevel, depth } = useSectionContext();
  const group = useContext(SectionGroupContext);
  // T158: a Section directly in a top-level group's slot is a top-level Section too.
  const grouped = !topLevel && depth === 1 && group !== null;
  if (!topLevel && !grouped) return props.children;
  return <SectionShell {...props} group={grouped ? group : null} />;
}

/** `cms.SectionGroup`'s settings (T158): a Section's anchor, scheme, background and spacing. */
export type SectionGroupSettingsValue = Pick<SectionSettingsValue, 'anchor' | 'scheme' | 'background' | 'spaceTop' | 'spaceBottom'>;

export interface SectionGroupFrameProps {
  /** The `cms.SectionGroup` block's own top-level props. Ignored unless the block stands at the top level. */
  settings: SectionGroupSettingsValue | undefined;
  /** The editor's preview tier: the spacing for that tier inline, as {@link SectionFrameProps.tier}. */
  tier?: BreakpointTier;
  /** The editor canvas. */
  editing?: boolean;
  children: ReactNode;
}

/** A group adds no space of its own until asked: its Sections carry theirs. */
const GROUP_SPACE: SpaceValue = 'none';

function SectionGroupShell({ settings, tier, children }: SectionGroupFrameProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useBreakpointVideo(ref, ':scope > .cmsc-section-group__paint > .cmsc-section__media video[data-bp]', {
    mobileMedia: pictureMobileMedia(settings?.background?.desktopFrom),
  });

  const anchor = typeof settings?.anchor === 'string' && SECTION_ANCHOR_RE.test(settings.anchor) ? settings.anchor : undefined;
  const scheme = settings?.scheme && settings.scheme !== 'inherit' ? settings.scheme : undefined;
  const background = settings?.background && settings.background.kind ? settings.background : undefined;
  const hasMedia = background !== undefined && (background.kind === 'image' || background.kind === 'video');
  const paints = scheme !== undefined || hasOwnBackground(background);

  const top = spacingTiers(settings?.spaceTop, GROUP_SPACE);
  const bottom = spacingTiers(settings?.spaceBottom, GROUP_SPACE);
  const vars: Record<string, string> =
    tier === undefined
      ? {
          '--cmsc-group-pt': top.base,
          '--cmsc-group-pt-md': top.md,
          '--cmsc-group-pt-lg': top.lg,
          '--cmsc-group-pb': bottom.base,
          '--cmsc-group-pb-md': bottom.md,
          '--cmsc-group-pb-lg': bottom.lg,
        }
      : { '--cmsc-group-pt': pickTier(top, tier), '--cmsc-group-pb': pickTier(bottom, tier) };

  return (
    <div
      ref={ref}
      className={['cmsc-section-group', tier !== undefined ? 'cmsc-section-group--tier' : ''].filter(Boolean).join(' ')}
      {...(anchor ? { id: anchor } : {})}
      {...(scheme ? { 'data-cmsb-scheme': scheme } : {})}
      {...(paints ? { 'data-paint': '1' } : {})}
      {...(hasMedia ? { 'data-media': '1' } : {})}
      {...(background?.decorative ? { 'data-decorative': '1' } : {})}
      style={vars as CSSProperties}
    >
      {paints ? (
        <div className="cmsc-section-group__paint" aria-hidden="true" style={paintStyle(background)}>
          {background ? <SectionMedia background={background} /> : null}
        </div>
      ) : null}
      <div className="cmsc-section-group__frame">
        <SectionGroupContext.Provider value={{ scheme, paints, anchor: anchor ?? null }}>{children}</SectionGroupContext.Provider>
      </div>
    </div>
  );
}

/**
 * The frame `cms.SectionGroup` (`SectionGroupBlock.tsx`, T158) renders
 * through — `specs/163-page-builder-marketing-pages/` FR-005 as amended,
 * contracts/blocks.md "`cms.SectionGroup`", plan § *Owner ruling 2026-10-26*.
 *
 * At the top level of a page it renders one `<div class="cmsc-section-group">`
 * with its anchor as `id`, its scheme as `data-cmsb-scheme` (so the Sections
 * in it inherit the scheme's variables), its spacing as padding custom
 * properties per breakpoint (`--cmsc-group-p(t|b)(-md|-lg)`, `none` by
 * default) and — when it paints, i.e. has a scheme or a background — one
 * `.cmsc-section-group__paint` layer behind all its Sections: the scheme's
 * background colour, a solid or gradient paint, an image or video with its
 * overlay, and with `decorative` the dark scheme's decorative layer, once and
 * continuously (no seam at a Section boundary). The layer spans the window's
 * width, whatever the Sections' widths are.
 *
 * The Sections in its slot render as top-level Sections (`SectionFrame`),
 * marked `data-in-group`; one with no background of its own and the group's
 * scheme or none is marked `data-transparent`, which drops its scheme's
 * background colour so the group's paint shows through.
 *
 * Nested — stored inside a slot, which the editor refuses — it renders its
 * children only, and a Section in it is not a section.
 */
export function SectionGroupFrame(props: SectionGroupFrameProps): ReactNode {
  const { topLevel } = useSectionContext();
  if (!topLevel) return props.children;
  return <SectionGroupShell {...props} />;
}
