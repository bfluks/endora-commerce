'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { JSONContent } from '@tiptap/core';
import {
  isSpaceToken,
  normalizeResponsive,
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  resolveResponsive,
  SECTION_SPACE_FALLBACKS,
  type BreakpointTier,
  type ButtonSpec,
  type ResponsiveImage,
  type ResponsiveProp,
  type SpaceToken,
} from '@endora-commerce/page-builder-core';
import type { BlockAlign, BlockHeadingStyleProps, ButtonListWidthProps, HeadingTag, TextMaxWidth, TypeToken } from '../schema/component-types.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';
import { splitHtmlWords } from '../utils/split-words.js';
import { specAtTier } from './Button.js';
import { ButtonView } from './ButtonView.js';
import { buttonWidthClasses } from './button-full-width.js';
import { resolveCmsIcon } from './icon-catalog.js';
import { InlineRich } from './InlineRich.js';
import { responsiveWeightProps, WeightSpan } from './item-text.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { htmlFromTiptap } from './rich-content-shared.js';
import { textMaxWidthAttrs, textMaxWidthField, textMaxWidthPxField } from './text-max-width.js';
import { isTypeToken, TYPE_SCALE_FALLBACKS, textWeightField, typeTokenSizeCss } from './typography.js';

/**
 * The parts the composition blocks of `specs/163-page-builder-marketing-pages/`
 * US3 share — `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`,
 * `cms.Statement`, and the reshaped `cms.FeatureList`, `cms.Stats` and
 * `cms.Testimonial` (contracts/blocks.md): a heading with its own level and
 * size, a rich body, a button list, an item icon (from the catalog or an
 * uploaded SVG), and responsive values written as custom properties.
 *
 * Every part renders on the server with its text in the HTML (SC-005), and
 * none decides a layout with script (R-23): a responsive value is one custom
 * property per breakpoint, which the stylesheet reads in its media queries.
 */

// ── Responsive values as custom properties ───────────────────────────

const TIER_SUFFIX: ReadonlyArray<[BreakpointTier, string]> = [
  ['mobile', ''],
  ['tablet', '-md'],
  ['desktop', '-lg'],
];

/**
 * A responsive value as `--<name>`, `--<name>-md` and `--<name>-lg`, each tier
 * inheriting the one below. In the editor canvas (`tier` set) only the base
 * property is written, with the previewed tier's value — the stylesheet's
 * media queries then fall back to it.
 */
export function responsiveVars<T>(
  name: string,
  value: T | ResponsiveProp<T> | undefined,
  fallback: T,
  toCss: (value: T, tier: BreakpointTier) => string,
  tier: BreakpointTier | null,
): Record<string, string> {
  if (tier !== null) return { [`--${name}`]: toCss(resolveResponsive<T>(value, tier, fallback), tier) };
  const responsive = normalizeResponsive<T>(value as T | ResponsiveProp<T> | undefined, fallback);
  const tablet = responsive.tablet ?? responsive.base;
  const desktop = responsive.desktop ?? tablet;
  const values: Record<BreakpointTier, T> = { mobile: responsive.base, tablet, desktop };
  const out: Record<string, string> = {};
  for (const [at, suffix] of TIER_SUFFIX) out[`--${name}${suffix}`] = toCss(values[at], at);
  return out;
}

/** A gap: a spacing token (its brand variable, with the built-in px) or **Custom** (`'custom'` with its px). */
export type GapValue = SpaceToken | 'custom';

/** The gap at a tier as CSS — a token's variable, the Custom px, or a stored plain number of px. */
export function gapCss(
  gap: GapValue | number | ResponsiveProp<GapValue | number> | undefined,
  gapPx: number | ResponsiveProp<number> | undefined,
  fallbackPx: number,
  tier: BreakpointTier,
): string {
  const value = resolveResponsive<GapValue | number>(gap, tier, 'custom');
  if (typeof value === 'number') return `${Number.isFinite(value) ? Math.max(0, value) : fallbackPx}px`;
  if (isSpaceToken(value)) {
    const [mobilePx, desktopPx] = SECTION_SPACE_FALLBACKS[value];
    return `var(--cmsb-space-${value}, ${tier === 'desktop' ? desktopPx : mobilePx}px)`;
  }
  const px = resolveResponsive<number>(gapPx, tier, fallbackPx);
  return `${Number.isFinite(px) ? Math.max(0, px) : fallbackPx}px`;
}

/** The gap per breakpoint as custom properties (see {@link responsiveVars}). */
export function gapVars(
  name: string,
  gap: GapValue | number | ResponsiveProp<GapValue | number> | undefined,
  gapPx: number | ResponsiveProp<number> | undefined,
  fallbackPx: number,
  tier: BreakpointTier | null,
): Record<string, string> {
  const at = (t: BreakpointTier) => gapCss(gap, gapPx, fallbackPx, t);
  if (tier !== null) return { [`--${name}`]: at(tier) };
  return { [`--${name}`]: at('mobile'), [`--${name}-md`]: at('tablet'), [`--${name}-lg`]: at('desktop') };
}

/**
 * R17 (T207): a gap stored as a number of pixels (before the size select) as
 * **Custom** with that px — per breakpoint where it is responsive — so the
 * select shows what renders. `null` when no tier holds a number. `gapCss`
 * reads either shape alike, so the render does not change.
 */
export function numericGapAsCustom(
  gap: unknown,
  gapPx: unknown,
): { gap: GapValue | ResponsiveProp<GapValue>; gapPx: number | ResponsiveProp<number> } | null {
  if (typeof gap === 'number') return { gap: 'custom', gapPx: gap };
  if (gap === null || typeof gap !== 'object') return null;
  const tiers = gap as Record<string, unknown>;
  if (!Object.values(tiers).some((value) => typeof value === 'number')) return null;
  const nextGap: Record<string, unknown> = {};
  const storedPx = gapPx !== null && typeof gapPx === 'object' ? (gapPx as Record<string, unknown>) : typeof gapPx === 'number' ? { base: gapPx } : {};
  const nextPx: Record<string, unknown> = { ...storedPx };
  for (const [tier, value] of Object.entries(tiers)) {
    if (typeof value === 'number') {
      nextGap[tier] = 'custom';
      nextPx[tier] = value;
    } else {
      nextGap[tier] = value;
    }
  }
  return { gap: nextGap as ResponsiveProp<GapValue>, gapPx: nextPx as ResponsiveProp<number> };
}

/**
 * R17 (T207): a gap that may differ per breakpoint, as the element's style: the
 * one `gap` it always had when it is the same at every width (in the editor,
 * the previewed tier's), else the class `cmsc-pb-gap-tiers` and its variables.
 */
export function responsiveGapStyle(
  gap: unknown,
  gapPx: unknown,
  fallbackPx: number,
  tier: BreakpointTier | null,
): { className?: string; style: Record<string, string> } {
  const at = (t: BreakpointTier) => gapCss(gap as GapValue, gapPx as number, fallbackPx, t);
  if (tier !== null) return { style: { gap: at(tier) } };
  const [mobile, tablet, desktop] = [at('mobile'), at('tablet'), at('desktop')];
  if (mobile === tablet && tablet === desktop) return { style: { gap: mobile } };
  return { className: 'cmsc-pb-gap-tiers', style: { '--pb-gap': mobile, '--pb-gap-md': tablet, '--pb-gap-lg': desktop } };
}

/** Whether a (responsive) select holds `'custom'` at any tier. */
export function usesCustom(value: unknown): boolean {
  if (value === 'custom') return true;
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(usesCustom);
  return false;
}

// ── Alignment ────────────────────────────────────────────────────────

const LOGICAL: Record<string, BlockAlign> = { left: 'start', start: 'start', center: 'center', right: 'end', end: 'end' };
const PHYSICAL: Record<BlockAlign, 'left' | 'center' | 'right'> = { start: 'left', center: 'center', end: 'right' };

/** Today's `left`/`center`/`right`, or the logical value, as the logical one. */
export function toLogicalAlign(value: unknown, fallback: BlockAlign): BlockAlign {
  return typeof value === 'string' ? (LOGICAL[value] ?? fallback) : fallback;
}

/** A logical alignment as the `text-align` value. */
export function toPhysicalAlign(value: unknown, fallback: BlockAlign): 'left' | 'center' | 'right' {
  return PHYSICAL[toLogicalAlign(value, fallback)];
}

/** An alignment that may hold one value per breakpoint (R17, T206), resolved at one tier as the physical value. */
export function physicalAlignAt(value: unknown, tier: BreakpointTier, fallback: BlockAlign): 'left' | 'center' | 'right' {
  const at = value !== null && typeof value === 'object' ? resolveResponsive<unknown>(value as ResponsiveProp<unknown>, tier, fallback) : value;
  return toPhysicalAlign(at, fallback);
}

/**
 * R17 (T206): a block's alignment per breakpoint, for rendering. `align` is
 * the previewed tier's in the editor and the phone's when published; `tiers`
 * holds the tablet's and the desktop's physical alignment, **only** when
 * published and different from the phone's — so a plain stored value, or one
 * the same at every width, renders exactly as before.
 */
export function responsiveAlign(
  value: unknown,
  tier: BreakpointTier | null,
  fallback: BlockAlign,
): { align: 'left' | 'center' | 'right'; tiers?: { md: 'left' | 'center' | 'right'; lg: 'left' | 'center' | 'right' } } {
  if (tier !== null) return { align: physicalAlignAt(value, tier, fallback) };
  const base = physicalAlignAt(value, 'mobile', fallback);
  const md = physicalAlignAt(value, 'tablet', fallback);
  const lg = physicalAlignAt(value, 'desktop', fallback);
  return md === base && lg === base ? { align: base } : { align: base, tiers: { md, lg } };
}

/** The `data-align-md` / `data-align-lg` attributes of {@link responsiveAlign}'s tiers. */
export function alignTierAttrs(tiers: { md: string; lg: string } | undefined): Record<string, string> {
  return tiers ? { 'data-align-md': tiers.md, 'data-align-lg': tiers.lg } : {};
}

// ── Assets ───────────────────────────────────────────────────────────

/** An asset id as its URL: the render-time map, else `/assets/file/<id>`, rebased on the API origin. */
export function useAssetUrl(): (id: string | undefined) => string {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  return (id) => (id ? absolutizeMediaUrl(assets[id]?.url || `/assets/file/${id}`, mediaBaseUrl) : '');
}

/** Whether a `ResponsiveImage` names any image at all. */
export function hasImage(image: Partial<ResponsiveImage> | null | undefined): image is Partial<ResponsiveImage> {
  return Boolean(image && (image.src || image.assetId || image.mobileSrc || image.mobileAssetId));
}

// ── Icons ────────────────────────────────────────────────────────────

/** A URL as a CSS string, quoted and escaped. */
function cssUrl(url: string): string {
  return `url("${url.replace(/[\\"]/g, (char) => `\\${char}`).replace(/[\n\r]/g, '')}")`;
}

export interface ItemIconProps {
  /** A name from the curated catalog (`icon-catalog.ts`). */
  icon?: string | undefined;
  /** An uploaded SVG; it wins over `icon`. */
  iconAssetId?: string | undefined;
  /** The icon's size in px. */
  size?: number;
}

/**
 * An item's icon. An uploaded SVG (`iconAssetId`) is drawn as a CSS mask
 * filled with `currentColor`, so it takes the text colour of whatever it sits
 * in — the section's scheme, or the block's icon colour (US3 acceptance 2). A
 * catalog icon strokes `currentColor` likewise. Decorative: hidden from
 * assistive technology, the item's title names it.
 */
export function ItemIcon({ icon, iconAssetId, size = 24 }: ItemIconProps): ReactNode {
  const assetUrl = useAssetUrl();
  if (iconAssetId) {
    const url = assetUrl(iconAssetId);
    const mask = cssUrl(url);
    return (
      <span
        className="cmsc-pb-icon-mask"
        aria-hidden="true"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: 'currentColor',
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    );
  }
  const Icon = resolveCmsIcon(icon);
  return Icon ? <Icon size={size} aria-hidden="true" /> : null;
}

// ── Texts ────────────────────────────────────────────────────────────

const LEVELS: readonly HeadingTag[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'];

export function tagOf(level: unknown, fallback: HeadingTag): HeadingTag {
  return typeof level === 'string' && (LEVELS as readonly string[]).includes(level) ? (level as HeadingTag) : fallback;
}

/** Whether an inline rich text (or a plain string stored before) holds no text. */
export function isEmptyInline(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  const content = (value as { content?: Array<{ content?: unknown[] }> }).content;
  return !Array.isArray(content) || content.every((paragraph) => !Array.isArray(paragraph?.content) || paragraph.content.length === 0);
}

/** A text size: a type token, **Custom** (`'custom'` with its px), or `'default'` — the block's own look. */
export type TextSize = TypeToken | 'custom' | 'default';

function sizeAt(
  size: TextSize | ResponsiveProp<TextSize>,
  sizePx: number | ResponsiveProp<number> | undefined,
  fallback: TypeToken,
  tier: BreakpointTier,
): { token: TypeToken } | { px: number } {
  const value = resolveResponsive<TextSize>(size, tier, fallback);
  if (isTypeToken(value)) return { token: value };
  if (value === 'default') return { token: fallback };
  const px = resolveResponsive<number>(sizePx, tier, TYPE_SCALE_FALLBACKS[fallback].mobilePx);
  return { px: Number.isFinite(px) ? px : TYPE_SCALE_FALLBACKS[fallback].mobilePx };
}

function sizeCss(size: { token: TypeToken } | { px: number }, tier: BreakpointTier): string {
  return 'token' in size ? typeTokenSizeCss(size.token, tier) : `${size.px}px`;
}

/** Whether a size leaves the block's own look in place (unset, or `'default'` at every tier). */
export function isDefaultSize(size: unknown): boolean {
  if (size === undefined || size === null || size === 'default') return true;
  if (typeof size === 'object') return Object.values(size as Record<string, unknown>).every((inner) => inner === undefined || inner === 'default');
  return false;
}

/**
 * The classes and the inline style of a text sized by a type token or a Custom
 * px, per breakpoint: the token's class (`cmsc-t--<token>`, which carries its
 * line height and weight), and the size itself inline for the previewed tier
 * or as `--pb-text-size(-md|-lg)` when it changes across breakpoints.
 */
export function sizedTextProps(
  size: TextSize | ResponsiveProp<TextSize>,
  sizePx: number | ResponsiveProp<number> | undefined,
  fallback: TypeToken,
  tier: BreakpointTier | null,
): { classes: string[]; style: Record<string, string> } {
  const sizes = {
    mobile: sizeAt(size, sizePx, fallback, 'mobile'),
    tablet: sizeAt(size, sizePx, fallback, 'tablet'),
    desktop: sizeAt(size, sizePx, fallback, 'desktop'),
  };
  const lead = sizes[tier ?? 'mobile'];
  const classes = [`cmsc-t--${'token' in lead ? lead.token : fallback}`];
  const style: Record<string, string> = {};
  if (tier !== null) {
    if (!('token' in lead)) style['fontSize'] = sizeCss(lead, tier);
    return { classes, style };
  }
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
  return { classes, style };
}

export interface BlockHeadingProps {
  value: unknown;
  level: HeadingTag | undefined;
  size: TextSize | ResponsiveProp<TextSize> | undefined;
  sizePx: number | ResponsiveProp<number> | undefined;
  /** The level and size when unset: a section heading is `h2` at the `h3` size (plan rule 3). */
  defaultLevel?: HeadingTag;
  defaultSize?: TypeToken;
  className: string;
  tier: BreakpointTier | null;
  /** The word reveal: split into words numbered from here (`InlineRich`'s `wordStart`). */
  wordStart?: number;
  /** Extra inline style (custom properties included), merged under the size's own. */
  style?: Record<string, string>;
  /** T151: a weight (300–800) over the size's own; `default` or unset keeps it. */
  weight?: unknown;
  /** T152: a maximum width per breakpoint (a named measure or Custom px); unset writes nothing. */
  maxWidth?: TextMaxWidth | ResponsiveProp<TextMaxWidth> | undefined;
  maxWidthPx?: number | ResponsiveProp<number> | undefined;
  /** The block's physical alignment, so a held heading sits where its text does. */
  align?: 'left' | 'center' | 'right';
  /** R17 (T206): the tablet's and desktop's alignment, when they differ from `align` (published only). */
  alignTiers?: { md: 'left' | 'center' | 'right'; lg: 'left' | 'center' | 'right' } | undefined;
}

/**
 * A block's heading (research R-10): inline rich text, its semantic level and
 * its visual size kept apart, in the brand's heading font. Nothing renders for
 * an empty heading.
 */
export function BlockHeading({
  value,
  level,
  size,
  sizePx,
  defaultLevel = 'h2',
  defaultSize = 'h3',
  className,
  tier,
  wordStart,
  style,
  weight,
  maxWidth,
  maxWidthPx,
  align,
  alignTiers,
}: BlockHeadingProps): ReactNode {
  if (isEmptyInline(value)) return null;
  const Tag = tagOf(level, defaultLevel);
  const sized = sizedTextProps(size ?? defaultSize, sizePx, defaultSize, tier);
  const measure = maxWidth === undefined ? null : textMaxWidthAttrs({ textMaxWidth: maxWidth, ...(maxWidthPx !== undefined ? { textMaxWidthPx: maxWidthPx } : {}) }, tier);
  // R17 (T211): the weight per breakpoint; one weight is the inline `font-weight` it was.
  const weighed = responsiveWeightProps(weight, tier);
  const merged: Record<string, string> = {
    ...(style ?? {}),
    ...(measure?.style ?? {}),
    ...sized.style,
    ...weighed.inline,
  };
  const classes = ['cmsc-pb-block-heading', className, ...sized.classes];
  if (measure) classes.push(measure.className);
  return (
    <Tag
      className={classes.join(' ')}
      {...(measure && (align === 'center' || align === 'right' || alignTiers) ? { 'data-align': align ?? 'left' } : {})}
      {...(measure ? alignTierAttrs(alignTiers) : {})}
      {...(Object.keys(merged).length > 0 ? { style: merged as CSSProperties } : {})}
    >
      <WeightSpan vars={weighed.span}>
        <InlineRich value={value as never} {...(wordStart !== undefined ? { wordStart } : {})} />
      </WeightSpan>
    </Tag>
  );
}

/**
 * A block heading's weight and maximum width (T151, T152), to spread into a
 * block's fields after its heading size: the weight beside the size, the
 * width (and its Custom px) per breakpoint, on the Responsive tab. With
 * `{ measure: false }` only the weight, for a block with a measure of its own.
 */
export function blockHeadingStyleFields({ measure = true }: { measure?: boolean } = {}) {
  return {
    // R17 (T211): per breakpoint, beside the size on the Responsive tab.
    headingWeight: { ...textWeightField('Heading weight'), metadata: PB_RESPONSIVE_METADATA },
    ...(measure
      ? {
          headingMaxWidth: textMaxWidthField('Heading max width'),
          headingMaxWidthPx: textMaxWidthPxField('Custom heading max width (px)'),
        }
      : {}),
  };
}

/** Whether a field is the heading's Custom max width while no breakpoint chose Custom — `resolveFields` drops it then. */
export function isUnusedHeadingMaxWidthPx(key: string, props: BlockHeadingStyleProps): boolean {
  return key === 'headingMaxWidthPx' && !usesCustom(props.headingMaxWidth);
}

/** The {@link BlockHeading} props of a block's heading weight and maximum width. */
export function blockHeadingStyle(props: BlockHeadingStyleProps): Pick<BlockHeadingProps, 'weight' | 'maxWidth' | 'maxWidthPx'> {
  return {
    ...(props.headingWeight !== undefined ? { weight: props.headingWeight } : {}),
    ...(props.headingMaxWidth !== undefined ? { maxWidth: props.headingMaxWidth } : {}),
    ...(props.headingMaxWidthPx !== undefined ? { maxWidthPx: props.headingMaxWidthPx } : {}),
  };
}

/** A TipTap document, or a plain string stored before (one paragraph), as sanitized HTML. */
export function richHtml(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return '';
    return htmlFromTiptap({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] });
  }
  const html = htmlFromTiptap(value as JSONContent);
  return html === '<p></p>' ? '' : html;
}

/**
 * A rich body; nothing for an empty one. With `wordStart` (the word reveal,
 * R-21) its words are split into numbered spans, the markup kept as it was.
 */
export function RichBody({
  value,
  className,
  wordStart,
  style,
}: {
  value: unknown;
  className: string;
  wordStart?: number;
  style?: Record<string, string>;
}): ReactNode {
  const html = richHtml(value);
  if (html === '') return null;
  const shown = wordStart === undefined ? html : splitHtmlWords(html, wordStart).html;
  return (
    <div className={className} {...(style ? { style: style as CSSProperties } : {})} dangerouslySetInnerHTML={{ __html: shown }} />
  );
}

/** A plain string as a one-paragraph TipTap document (the shape a rich field stores). */
export function plainTextToDoc(text: string): JSONContent {
  const inline = plainTextToInlineRichText(text) as unknown as JSONContent;
  return { type: 'doc', content: inline.content ?? [{ type: 'paragraph' }] };
}

// ── Buttons ──────────────────────────────────────────────────────────

/**
 * A list of `ButtonSpec`s through the shared `ButtonView`; nothing for an empty
 * list. T168: `fullWidth` (a block's `buttonsFullWidth`) stacks the buttons at
 * the full width per breakpoint; unset adds no class.
 */
export function ButtonRow({
  buttons,
  tier,
  className,
  buttonClassName,
  fullWidth,
}: {
  buttons: ButtonSpec[] | undefined;
  tier: BreakpointTier | null;
  className: string;
  buttonClassName?: string;
  fullWidth?: ButtonListWidthProps['buttonsFullWidth'];
}): ReactNode {
  const list = (buttons ?? []).filter((button) => button && typeof button === 'object');
  if (list.length === 0) return null;
  return (
    <div className={[className, ...buttonWidthClasses(fullWidth, tier, 'cmsc-btn-list')].join(' ')}>
      {list.map((button, index) => (
        <ButtonView
          key={index}
          button={tier !== null ? specAtTier(button, tier) : button}
          {...(buttonClassName ? { className: buttonClassName } : {})}
        />
      ))}
    </div>
  );
}
