import type { CSSProperties } from 'react';
import {
  buildResponsiveCSSValueVars,
  buildResponsiveNumberVars,
  resolveColorValue,
  resolveResponsiveNumber,
  type BreakpointTier,
} from '@endora-commerce/page-builder-core';
import type {
  HeadingLevel,
  TextFontFamily,
  TextFontStyle,
  TypeToken,
  TypographyProps,
} from '../schema/component-types.js';

/**
 * `sans` is the brand's body font (feature 163, research R-3), with today's
 * stack as its fallback so a page with no brand tokens renders as before.
 */
export const FONT_FAMILY_CSS: Record<TextFontFamily, string> = {
  sans: 'var(--cmsb-font-body, Inter, system-ui, -apple-system, sans-serif)',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

export const FONT_WEIGHT_OPTIONS = [
  { label: 'Light (300)', value: 300 },
  { label: 'Regular (400)', value: 400 },
  { label: 'Medium (500)', value: 500 },
  { label: 'Semibold (600)', value: 600 },
  { label: 'Bold (700)', value: 700 },
  { label: 'Extra bold (800)', value: 800 },
];

export const HEADING_DEFAULT_SIZE_PX: Record<HeadingLevel, number> = {
  h1: 48,
  h2: 40,
  h3: 32,
  h4: 26,
  h5: 22,
  h6: 18,
};

/**
 * The class giving a heading its level's default size: the brand type scale's
 * `--cmsb-t-<level>-size`, with {@link HEADING_DEFAULT_SIZE_PX} as the fallback
 * (`styles/cms-components.css`). A heading with its own size uses the
 * responsive size variables instead.
 */
export function headingSizeClass(level: HeadingLevel): string {
  return `cmsc-pb-heading-size-${level}`;
}

/**
 * Feature 163 (research R-10) — the brand type scale with no brand tokens set:
 * `DEFAULT_BRAND_TOKENS.typeScale` (`@endora-commerce/contracts`), restated
 * because every `--cmsb-*` use carries its literal (standing rule 9) and a
 * renderer does not load the schemas. `h1`–`h6` are today's
 * {@link HEADING_DEFAULT_SIZE_PX} at today's 1.12 / 700 on both tiers.
 * `styles/cms-components.css` writes the same literals into `.cmsc-t--<token>`.
 */
export const TYPE_TOKENS: readonly TypeToken[] = ['display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'small'];

export const TYPE_SCALE_FALLBACKS: Readonly<
  Record<TypeToken, { mobilePx: number; desktopPx: number; lineHeight: number; weight: number }>
> = {
  display: { mobilePx: 40, desktopPx: 56, lineHeight: 1.08, weight: 700 },
  h1: { mobilePx: 48, desktopPx: 48, lineHeight: 1.12, weight: 700 },
  h2: { mobilePx: 40, desktopPx: 40, lineHeight: 1.12, weight: 700 },
  h3: { mobilePx: 32, desktopPx: 32, lineHeight: 1.12, weight: 700 },
  h4: { mobilePx: 26, desktopPx: 26, lineHeight: 1.12, weight: 700 },
  h5: { mobilePx: 22, desktopPx: 22, lineHeight: 1.12, weight: 700 },
  h6: { mobilePx: 18, desktopPx: 18, lineHeight: 1.12, weight: 700 },
  lead: { mobilePx: 18, desktopPx: 20, lineHeight: 1.6, weight: 400 },
  body: { mobilePx: 16, desktopPx: 16, lineHeight: 1.65, weight: 400 },
  small: { mobilePx: 14, desktopPx: 14, lineHeight: 1.5, weight: 400 },
};

export function isTypeToken(value: unknown): value is TypeToken {
  return typeof value === 'string' && (TYPE_TOKENS as readonly string[]).includes(value);
}

/** A type token's size at a tier: its brand variable, with the built-in literal for that tier. */
export function typeTokenSizeCss(token: TypeToken, tier: BreakpointTier): string {
  const fallback = TYPE_SCALE_FALLBACKS[token];
  return `var(--cmsb-t-${token}-size, ${tier === 'desktop' ? fallback.desktopPx : fallback.mobilePx}px)`;
}

/** The brand's heading font, with today's heading stack as its fallback. */
export const HEADING_FONT_CSS = 'var(--cmsb-font-heading, Inter, system-ui, -apple-system, sans-serif)';

/**
 * A text's weight (`specs/163-page-builder-marketing-pages/` T151): `Default`
 * first — the block's own weight, today's — then 300–800, the weights the
 * Heading and Text blocks already offer. One value, not per breakpoint.
 */
export function textWeightField(label: string) {
  return {
    type: 'select' as const,
    label,
    options: [{ label: 'Default', value: 'default' }, ...FONT_WEIGHT_OPTIONS],
  };
}

const TEXT_WEIGHTS: readonly number[] = FONT_WEIGHT_OPTIONS.map((option) => option.value);

/** A chosen weight as a number for `font-weight`, or `undefined` for `default`, unset or anything unknown. */
export function textWeightCss(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return TEXT_WEIGHTS.includes(n) ? n : undefined;
}

export function typographyStyle(props: {
  fontFamily?: TextFontFamily;
  fontStyle?: TextFontStyle;
  color?: string | undefined;
}): CSSProperties {
  return {
    fontFamily: FONT_FAMILY_CSS[props.fontFamily ?? 'sans'],
    fontStyle: props.fontStyle === 'italic' ? 'italic' : 'normal',
    ...(colorStyle(props.color)),
  };
}

/** A colour prop as an inline `color`: a brand token resolves to its variable (T040); `transparent` sets nothing. */
function colorStyle(color: string | undefined): CSSProperties {
  if (!color || color === 'transparent') return {};
  const resolved = resolveColorValue(color);
  return resolved ? { color: resolved } : {};
}

export function responsiveTypographyVars(
  props: Pick<TypographyProps, 'fontSize' | 'fontWeight' | 'lineHeight'>,
  defaults: { fontSize: number; fontWeight: number; lineHeight: number },
): CSSProperties {
  return {
    ...buildResponsiveNumberVars('text-size', props.fontSize, defaults.fontSize),
    ...buildResponsiveCSSValueVars('text-weight', props.fontWeight, defaults.fontWeight),
    ...buildResponsiveCSSValueVars('text-leading', props.lineHeight, defaults.lineHeight),
  };
}

export function editingTypographyStyle(
  props: TypographyProps,
  tier: BreakpointTier,
  defaults: { fontSize: number; fontWeight: number; lineHeight: number },
): CSSProperties {
  return {
    ...typographyStyle({
      ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
      ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
      color: props.color,
    }),
    fontSize: `${resolveResponsiveNumber(props.fontSize, tier, defaults.fontSize)}px`,
    fontWeight: resolveResponsiveNumber(props.fontWeight, tier, defaults.fontWeight),
    lineHeight: resolveResponsiveNumber(props.lineHeight, tier, defaults.lineHeight),
  };
}

export function hasCustomFontSize(fontSize: TypographyProps['fontSize']): boolean {
  return fontSize !== undefined && fontSize !== null;
}
