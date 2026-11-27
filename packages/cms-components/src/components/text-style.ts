import {
  isResponsiveProp,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  type BreakpointTier,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { colorValueToCss, resolveColorValue } from '../utils/color-value.js';
import { isTypeToken, TYPE_SCALE_FALLBACKS, textWeightCss, typeTokenSizeCss } from './typography.js';
import { isDefaultSize, type TextSize } from './section-parts.js';

/**
 * A block text's own size, weight, line height and colour
 * (`specs/163-page-builder-marketing-pages/` R19A, T223): a feature's text, a
 * hero's body, a statement's supporting text, a figure's label, a link row's
 * title.
 *
 * Each option is optional and writes nothing while it is unset, so a block
 * stored before keeps its markup byte for byte and its own stylesheet look.
 * Set, the text element carries the value itself:
 *
 * - one value for every breakpoint (or the editor's previewed tier) is an
 *   inline declaration (`font-size`, `font-weight`, `line-height`,
 *   `letter-spacing`, `color`);
 * - values that differ per breakpoint add `cmsc-pb-ts-size`, `-weight`,
 *   `-leading` or `-tracking` and one custom property per tier (`--pb-ts-size`,
 *   `-md`, `-lg`), every tier written — a tier left on Default reads the
 *   block's own value (`today`). The rules sit at the end of the stylesheet, so
 *   they win over a block's own single-class rule.
 *
 * R23 (T435), the typography rule:
 *
 * - a **type token** size carries the token's own line height, weight and
 *   letter spacing (the brand's `--cmsb-t-<token>-lh|-w|-ls`, the built-in
 *   values as fallbacks), as `cms.Heading` and T350's `tokenTierStyle` do;
 * - the **line height** option applies only at a breakpoint sized in Custom
 *   px — a token brings its own, and the block's own size keeps the block's;
 * - the **weight** is one value for every breakpoint and wins over the
 *   token's; a weight stored per breakpoint (R19–R22) reads as its desktop
 *   value, else its base ({@link singleWeight}).
 */

export interface TextStyleValues {
  size?: TextSize | ResponsiveProp<TextSize> | undefined;
  sizePx?: number | ResponsiveProp<number> | undefined;
  weight?: unknown;
  lineHeight?: number | ResponsiveProp<number> | undefined;
  color?: string | undefined;
}

/** The block's own values, read by a breakpoint left on Default when another one is set. */
export interface TextStyleToday {
  size: string;
  /** Unset: `initial`, which leaves the declaration invalid, so the text inherits its weight as it did. */
  weight?: string;
  lineHeight: string;
  /** Unset: `normal`. */
  letterSpacing?: string;
}

const TIERS: readonly BreakpointTier[] = ['mobile', 'tablet', 'desktop'];
const SUFFIX: Record<BreakpointTier, string> = { mobile: '', tablet: '-md', desktop: '-lg' };

export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 3;

/** A line height field (a multiplier of the font size), per breakpoint; empty keeps the block's own. */
export function lineHeightField(label: string) {
  return { type: 'number' as const, label, min: MIN_LINE_HEIGHT, max: MAX_LINE_HEIGHT, step: 0.05, metadata: PB_RESPONSIVE_METADATA };
}

/**
 * R23 (T435): one weight for every breakpoint. A stored per-breakpoint weight
 * (`{ base, tablet, desktop }`, written by R19–R22's fields) reads as its
 * desktop value, else its base; one value reads as it is.
 */
export function singleWeight(value: unknown): unknown {
  if (!isResponsiveProp(value)) return value;
  const responsive = value as ResponsiveProp<unknown>;
  return responsive.desktop ?? responsive.base ?? undefined;
}

/** The size at a tier: a type token, `'custom'`, or `null` for the block's own (Default, unset). */
function sizeAt(values: TextStyleValues, tier: BreakpointTier): TextSize | null {
  if (isDefaultSize(values.size)) return null;
  const value = resolveResponsive<TextSize>(values.size as TextSize | ResponsiveProp<TextSize>, tier, 'default');
  return isTypeToken(value) || value === 'custom' ? value : null;
}

function sizeCssAt(values: TextStyleValues, tier: BreakpointTier): string | undefined {
  const size = sizeAt(values, tier);
  if (size === null) return undefined;
  if (isTypeToken(size)) return typeTokenSizeCss(size, tier);
  const px = resolveResponsive<number>(values.sizePx, tier, Number.NaN);
  return Number.isFinite(px) && px > 0 ? `${px}px` : undefined;
}

function weightAt(values: TextStyleValues, tier: BreakpointTier): string | undefined {
  const weight = textWeightCss(singleWeight(values.weight));
  if (weight !== undefined) return String(weight);
  const size = sizeAt(values, tier);
  return isTypeToken(size) ? `var(--cmsb-t-${size}-w, ${TYPE_SCALE_FALLBACKS[size].weight})` : undefined;
}

function lineHeightAt(values: TextStyleValues, tier: BreakpointTier): string | undefined {
  const size = sizeAt(values, tier);
  if (isTypeToken(size)) return `var(--cmsb-t-${size}-lh, ${TYPE_SCALE_FALLBACKS[size].lineHeight})`;
  if (size !== 'custom') return undefined;
  const value = resolveResponsive<number>(values.lineHeight, tier, Number.NaN);
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_LINE_HEIGHT && value <= MAX_LINE_HEIGHT ? String(value) : undefined;
}

function trackingAt(values: TextStyleValues, tier: BreakpointTier): string | undefined {
  const size = sizeAt(values, tier);
  return isTypeToken(size) ? `var(--cmsb-t-${size}-ls, 0em)` : undefined;
}

type Reader = (values: TextStyleValues, tier: BreakpointTier) => string | undefined;

const PROPERTIES: ReadonlyArray<{ read: Reader; css: string; name: string; today: (today: TextStyleToday) => string }> = [
  { read: sizeCssAt, css: 'fontSize', name: 'size', today: (today) => today.size },
  { read: weightAt, css: 'fontWeight', name: 'weight', today: (today) => today.weight ?? 'initial' },
  { read: lineHeightAt, css: 'lineHeight', name: 'leading', today: (today) => today.lineHeight },
  { read: trackingAt, css: 'letterSpacing', name: 'tracking', today: (today) => today.letterSpacing ?? 'normal' },
];

/**
 * The classes and the inline style of a text with its own size, weight, line
 * height and colour, or nothing at all while none is set. `tier` is the
 * editor's previewed breakpoint, `null` on the storefront.
 */
export function textStyleAttrs(
  values: TextStyleValues,
  tier: BreakpointTier | null,
  today: TextStyleToday,
): { classes: string[]; style: Record<string, string> } {
  const classes: string[] = [];
  const style: Record<string, string> = {};
  for (const property of PROPERTIES) {
    if (tier !== null) {
      const value = property.read(values, tier);
      if (value !== undefined) style[property.css] = value;
      continue;
    }
    const at = TIERS.map((t) => property.read(values, t));
    if (at.every((value) => value === undefined)) continue;
    if (at.every((value) => value === at[0])) {
      style[property.css] = at[0]!;
      continue;
    }
    classes.push(`cmsc-pb-ts-${property.name}`);
    TIERS.forEach((t, index) => {
      style[`--pb-ts-${property.name}${SUFFIX[t]}`] = at[index] ?? property.today(today);
    });
  }
  const color = values.color ? (colorValueToCss(values.color) ?? resolveColorValue(values.color)) : undefined;
  if (color) style['color'] = color;
  return { classes, style };
}

/** Whether any text option is set — a block then adds its classes and style, and nothing otherwise. */
export function hasTextStyle(values: TextStyleValues): boolean {
  const { classes, style } = textStyleAttrs(values, null, { size: 'inherit', lineHeight: 'normal' });
  return classes.length > 0 || Object.keys(style).length > 0;
}

/**
 * R23 (T435): the line height of a text whose size another helper writes (a
 * block heading's `sizedTextProps`), applied only from its first breakpoint
 * sized in Custom px ({@link customOnlyLeading}); `todayLineHeight` is read by
 * a breakpoint below it when the value differs per breakpoint.
 */
export function customLeadingAttrs(
  size: unknown,
  lineHeight: number | ResponsiveProp<number> | undefined,
  tier: BreakpointTier | null,
  todayLineHeight: string,
): { classes: string[]; style: Record<string, string> } {
  return textStyleAttrs({ size: 'custom', lineHeight: customOnlyLeading(size, lineHeight) }, tier, { size: 'inherit', lineHeight: todayLineHeight });
}

/**
 * R23 (T435): whether a size uses Custom px at some breakpoint — a line height
 * field is offered only then (a token brings its own line height).
 */
export function sizeUsesCustom(value: unknown): boolean {
  if (value === 'custom') return true;
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((inner) => inner === 'custom');
  return false;
}

/**
 * R23 (T435): a heading's line height kept only where its size is Custom px —
 * for a text whose size another helper writes (`sizedTextProps`, a hero text),
 * so its token brings its own line height. `undefined` unless some breakpoint
 * is Custom; otherwise the stored value from the first Custom breakpoint up
 * (the breakpoints below it keep their token's).
 */
export function customOnlyLeading(
  size: unknown,
  lineHeight: number | ResponsiveProp<number> | undefined,
): number | ResponsiveProp<number> | undefined {
  if (lineHeight === undefined || lineHeight === null || isDefaultSize(size)) return undefined;
  const at = TIERS.map((t) => resolveResponsive<TextSize>(size as TextSize | ResponsiveProp<TextSize>, t, 'default'));
  const first = at.indexOf('custom');
  if (first < 0) return undefined;
  if (first === 0) return lineHeight;
  const value = (t: BreakpointTier): number | undefined => {
    const v = resolveResponsive<number>(lineHeight, t, Number.NaN);
    return Number.isFinite(v) ? v : undefined;
  };
  // No `base`: the breakpoints below the first Custom one read as unset (`normalizeResponsive`).
  const out: Partial<ResponsiveProp<number>> = {};
  if (first <= 1) {
    const tablet = value('tablet');
    if (tablet !== undefined) out.tablet = tablet;
  }
  const desktop = value('desktop');
  if (desktop !== undefined && (first === 2 || desktop !== out.tablet)) out.desktop = desktop;
  return Object.keys(out).length > 0 ? (out as ResponsiveProp<number>) : undefined;
}
