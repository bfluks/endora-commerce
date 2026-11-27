'use client';

import { isValidElement, type CSSProperties } from 'react';
import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import {
  buildResponsiveCSSValueVars,
  normalizeResponsive,
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  resolveResponsive,
  resolveResponsiveNumber,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  createToggleField,
  withHideOn,
  type BreakpointTier,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type {
  HeadingFont,
  HeadingLevel,
  HeadingProps,
  HeadingSize,
  HeadingTag,
  TypeToken,
} from '../schema/component-types.js';
import { logicalAlign, physicalAlign } from './block-align.js';
import { BoxStyled } from './box-styles.js';
import { InlineRich } from './InlineRich.js';
import { isEmptyInline, tokensOf } from './section-parts.js';
import { textMaxWidthAttrs, textMaxWidthFields, usesCustomTextMaxWidth } from './text-max-width.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  TEXT_COLOR_FIELD,
} from '../fields/shared-fields.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import {
  FONT_FAMILY_CSS,
  FONT_WEIGHT_OPTIONS,
  HEADING_DEFAULT_SIZE_PX,
  HEADING_FONT_CSS,
  isTypeToken,
  TYPE_SCALE_FALLBACKS,
  tokenTierStyle,
  typeTokenSizeCss,
  typographyStyle,
} from './typography.js';

/**
 * `cms.Heading` (`specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * research R-10): the semantic level (`h1`–`h6`, or `p`) and the visual size (a
 * type token) are separate props, and the text is inline rich text — bold,
 * italic, links, line breaks and the `emphasis` mark.
 *
 * Plan § *Extend, don't narrow*: today's free typography is kept as the
 * **Custom** overrides of the tokens — a literal px size (`size: 'custom'` +
 * `fontSize`, responsive as before), any font family (`font: 'custom'`), and
 * weight, style, line height and colour. A heading stored before the reshape
 * has no `font` and no `size`; it renders exactly as it did, and the editor
 * carries it into the new shape once ({@link headingFromLegacy}).
 */

const LEVELS: readonly HeadingLevel[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function normalizeHeadingTag(level: unknown): HeadingTag {
  if (level === 'p') return 'p';
  if (typeof level === 'string' && (LEVELS as readonly string[]).includes(level)) return level as HeadingLevel;
  if (typeof level === 'number' && level >= 1 && level <= 6) return `h${level}` as HeadingLevel;
  return 'h2';
}

/** The size a heading has when it sets none: its level's (today's behaviour); a paragraph reads as body text. */
function levelToken(tag: HeadingTag): TypeToken {
  return tag === 'p' ? 'body' : tag;
}

/** The literal px a Custom size falls back to: the level's own size, as today's free size did. */
function levelPx(tag: HeadingTag): number {
  return tag === 'p' ? TYPE_SCALE_FALLBACKS.body.mobilePx : HEADING_DEFAULT_SIZE_PX[tag];
}

// ── Size ─────────────────────────────────────────────────────────────

type TierSize = { token: TypeToken } | { px: number };

function hasLegacySize(props: HeadingProps): boolean {
  return props.size === undefined && props.fontSize !== undefined && props.fontSize !== null;
}

/** The heading's size at a tier: a type token or a literal px. */
function sizeAt(props: HeadingProps, tag: HeadingTag, tier: BreakpointTier): TierSize {
  const fallbackPx = levelPx(tag);
  const custom = (): TierSize => ({ px: resolveResponsiveNumber(props.fontSize, tier, fallbackPx) });
  if (props.size === undefined) return hasLegacySize(props) ? custom() : { token: levelToken(tag) };
  const value = resolveResponsive<HeadingSize>(props.size, tier, levelToken(tag));
  if (isTypeToken(value)) return { token: value };
  if (value === 'custom') return custom();
  if (value !== null && typeof value === 'object' && typeof value.px === 'number') return { px: value.px };
  return { token: levelToken(tag) };
}

function sizeCss(size: TierSize, tier: BreakpointTier): string {
  return 'token' in size ? typeTokenSizeCss(size.token, tier) : `${size.px}px`;
}

function sameSize(a: TierSize, b: TierSize): boolean {
  return 'token' in a ? 'token' in b && a.token === b.token : 'px' in b && a.px === b.px;
}

// ── Font ─────────────────────────────────────────────────────────────

/** A free font family, kept to the characters a family list uses. */
function safeFontFamily(value: string | undefined): string | null {
  const cleaned = (value ?? '').replace(/[^\w\s,'"-]/g, '').trim().slice(0, 200);
  return cleaned === '' ? null : cleaned;
}

function fontFamilyCss(props: HeadingProps): string {
  switch (props.font) {
    case 'heading':
      return HEADING_FONT_CSS;
    case 'body':
      return FONT_FAMILY_CSS.sans;
    default:
      // `custom`, and a heading stored before the reshape (no `font`): the literal family, as today.
      return safeFontFamily(props.customFontFamily) ?? FONT_FAMILY_CSS[props.fontFamily ?? 'sans'];
  }
}

// ── Render ───────────────────────────────────────────────────────────

const BASE_CLASSES = 'cmsc-t cmsc:m-0 cmsc:text-[color:var(--cmsb-fg,#15202b)]';

interface HeadingLook {
  className: string;
  style: CSSProperties;
}

/**
 * The classes and inline style of a heading. A token size is the
 * `cmsc-t--<token>` class (size, line height, weight and tracking from the brand
 * type scale); a literal px or a size that changes across breakpoints sets the
 * responsive size variables. Weight and line height are the token's unless the
 * heading sets its own — or its size is a literal, where today's 700 / 1.12
 * apply as before. With `tier` (the editor canvas) everything is resolved for
 * that tier inline.
 */
function headingLook(props: HeadingProps, tag: HeadingTag, tier: BreakpointTier | null): HeadingLook {
  const sizes = {
    mobile: sizeAt(props, tag, 'mobile'),
    tablet: sizeAt(props, tag, 'tablet'),
    desktop: sizeAt(props, tag, 'desktop'),
  };
  const lead = tier === null ? sizes.mobile : sizes[tier];
  const token = 'token' in lead ? lead.token : null;
  const literal = token === null;
  const defaults = literal
    ? { fontWeight: tag === 'p' ? TYPE_SCALE_FALLBACKS.body.weight : 700, lineHeight: tag === 'p' ? TYPE_SCALE_FALLBACKS.body.lineHeight : 1.12 }
    : { fontWeight: TYPE_SCALE_FALLBACKS[token].weight, lineHeight: TYPE_SCALE_FALLBACKS[token].lineHeight };
  const ownWeight = literal || (props.fontWeight !== undefined && props.fontWeight !== null);
  const ownLeading = literal || (props.lineHeight !== undefined && props.lineHeight !== null);

  const classes = [BASE_CLASSES, token ? `cmsc-t--${token}` : ''];
  const style: CSSProperties = {
    ...typographyStyle({
      ...(props.fontStyle !== undefined ? { fontStyle: props.fontStyle } : {}),
      color: props.color,
    }),
    fontFamily: fontFamilyCss(props),
  };

  if (tier !== null) {
    style.fontSize = sizeCss(lead, tier);
    if (ownWeight) style.fontWeight = resolveResponsiveNumber(props.fontWeight, tier, defaults.fontWeight);
    if (ownLeading) style.lineHeight = resolveResponsiveNumber(props.lineHeight, tier, defaults.lineHeight);
    return { className: classes.filter(Boolean).join(' '), style };
  }

  const uniform = token !== null && sameSize(sizes.mobile, sizes.tablet) && sameSize(sizes.tablet, sizes.desktop);
  if (!uniform) {
    // Every tier is written: a token's literal differs between mobile and desktop (`display`, `lead`).
    classes.push('cmsc-pb-text-size');
    Object.assign(style, {
      '--pb-text-size': sizeCss(sizes.mobile, 'mobile'),
      '--pb-text-size-md': sizeCss(sizes.tablet, 'tablet'),
      '--pb-text-size-lg': sizeCss(sizes.desktop, 'desktop'),
    });
    // R21H (T350): each tier's token's line height, weight and tracking (a token size only;
    // a literal size has its own weight and line height below).
    if (token !== null) {
      const tiered = tokenTierStyle(tokensOf(sizes), token);
      classes.push(...tiered.classes);
      Object.assign(style, tiered.style);
    }
  }
  if (ownWeight) {
    classes.push('cmsc-pb-text-weight');
    Object.assign(style, buildResponsiveCSSValueVars('text-weight', props.fontWeight, defaults.fontWeight));
  }
  if (ownLeading) {
    classes.push('cmsc-pb-text-leading');
    Object.assign(style, buildResponsiveCSSValueVars('text-leading', props.lineHeight, defaults.lineHeight));
  }
  return { className: classes.filter(Boolean).join(' '), style };
}

/** `textAlign` (today's) wins over the deprecated `align`, as before; both read through {@link physicalAlign}. */
function renderAlign(props: HeadingProps): ResponsiveProp<string> | string | undefined {
  return physicalAlign(props.textAlign ?? props.align);
}

// Puck widens the stored document's one-paragraph tuple to an array; the props are the stored shape.
const HeadingEditingRender: PuckComponent<HeadingProps> = (puckProps) => {
  const props = puckProps as unknown as HeadingProps;
  const tier = usePreviewBreakpointTier();
  const { level, text, ...box } = props;
  const Tag = normalizeHeadingTag(level);
  const align = renderAlign(props);
  const look = headingLook(props, Tag, tier);
  // R21G (T337): the measure, the previewed tier's inline, moved with a centred or right-aligned text.
  const measure = textMaxWidthAttrs(props, tier);
  const editingAlign = resolveTextAlignForTier(align, tier, 'left');
  const measureStyle: CSSProperties = measure
    ? {
        ...measure.style,
        ...(editingAlign === 'center' ? { marginLeft: 'auto', marginRight: 'auto' } : {}),
        ...(editingAlign === 'right' ? { marginLeft: 'auto' } : {}),
      }
    : {};

  return (
    <BoxStyled previewTier={tier} {...box}>
      <Tag
        className={`${look.className} cmsc-pb-text-align${measure ? ` ${measure.className}` : ''}`}
        style={{ ...look.style, ...measureStyle, textAlign: editingAlign }}
        {...textAlignDataAttrs(align, 'left')}
      >
        {/* On the editor canvas `text` arrives as its in-place editor (`INLINE_RICH_TEXT_FIELD_TRANSFORMS`). */}
        {isValidElement(text) ? text : <InlineRich value={text} hangingIcon={props.hangingIcon === true} />}
      </Tag>
    </BoxStyled>
  );
};

const HeadingPublishedRender: PuckComponent<HeadingProps> = (puckProps) => {
  const props = puckProps as unknown as HeadingProps;
  const { level, text, ...box } = props;
  const Tag = normalizeHeadingTag(level);
  const align = renderAlign(props);
  const look = headingLook(props, Tag, null);
  // R21G (T337): the measure per breakpoint (the class reads the tier variables; alignment moves it).
  const measure = textMaxWidthAttrs(props, null);
  // R20E (T294): a heading left empty writes no empty heading element; its box (spacing, background) stays.
  if (isEmptyInline(text)) return <BoxStyled {...box}>{null}</BoxStyled>;

  return (
    <BoxStyled {...box}>
      <Tag
        className={`${look.className} ${responsiveTextAlignClass(align, 'left')}${measure ? ` ${measure.className}` : ''}`}
        style={measure ? { ...look.style, ...(measure.style as CSSProperties) } : look.style}
        {...textAlignDataAttrs(align, 'left')}
      >
        <InlineRich value={text} hangingIcon={props.hangingIcon === true} />
      </Tag>
    </BoxStyled>
  );
};

// ── Migration ────────────────────────────────────────────────────────

/**
 * `{px}` tiers of a stored size as the editor's `'custom'` + `fontSize`, so the
 * size select can show them (a seeder may write `{px}`).
 */
function splitLiteralSize(
  size: HeadingProps['size'],
  fontSize: HeadingProps['fontSize'],
): Pick<HeadingProps, 'size' | 'fontSize'> {
  const normalized = normalizeResponsive<HeadingSize>(size, 'h2');
  const tiers = (['base', 'tablet', 'desktop'] as const).filter((key) => normalized[key] !== undefined);
  if (!tiers.some((key) => typeof normalized[key] === 'object')) {
    return { ...(size !== undefined ? { size } : {}), ...(fontSize !== undefined ? { fontSize } : {}) };
  }
  const nextSize: ResponsiveProp<HeadingSize> = { base: 'h2' };
  const sizes = normalizeResponsive<number>(fontSize, 16);
  const nextFontSize: ResponsiveProp<number> = { base: sizes.base };
  for (const key of tiers) {
    const value = normalized[key]!;
    if (typeof value === 'object') {
      nextSize[key] = 'custom';
      nextFontSize[key] = value.px;
    } else {
      nextSize[key] = value;
      if (key !== 'base' && sizes[key] !== undefined) nextFontSize[key] = sizes[key]!;
    }
  }
  const flatSize = nextSize.tablet === undefined && nextSize.desktop === undefined ? nextSize.base : nextSize;
  const flatFontSize = nextFontSize.tablet === undefined && nextFontSize.desktop === undefined ? nextFontSize.base : nextFontSize;
  return { size: flatSize, fontSize: flatFontSize };
}

/**
 * A heading stored on `origin/master` in the reshaped shape, value for value
 * (plan § *Extend, don't narrow*; the option-parity test holds it): the text as
 * a one-paragraph document, the literal family as `font: 'custom'`, a literal
 * size as `size: 'custom'` + `fontSize` (or the level's token when it had
 * none), and `textAlign` / the deprecated `align` as the logical `align`. Its
 * render does not change.
 */
export function headingFromLegacy(props: Record<string, unknown>): HeadingProps {
  const { textAlign, align, ...rest } = props as unknown as HeadingProps;
  const tag = normalizeHeadingTag(rest.level);
  const text = typeof rest.text === 'string' ? plainTextToInlineRichText(rest.text) : rest.text;
  const font: HeadingFont = rest.font ?? 'custom';
  const legacySize = rest.size === undefined && rest.fontSize !== undefined && rest.fontSize !== null;
  const sized = splitLiteralSize(rest.size ?? (legacySize ? 'custom' : levelToken(tag)), rest.fontSize);
  const nextAlign = logicalAlign(textAlign ?? align);
  return {
    ...rest,
    level: tag,
    text: text ?? plainTextToInlineRichText(''),
    font,
    ...sized,
    ...(nextAlign !== undefined ? { align: nextAlign } : {}),
  } as HeadingProps;
}

// ── Config ───────────────────────────────────────────────────────────

export const TYPE_SIZE_OPTIONS = [
  { label: 'Display', value: 'display' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Heading 4', value: 'h4' },
  { label: 'Heading 5', value: 'h5' },
  { label: 'Heading 6', value: 'h6' },
  { label: 'Lead', value: 'lead' },
  { label: 'Body', value: 'body' },
  { label: 'Small', value: 'small' },
  { label: 'Custom (px)', value: 'custom' },
];

const HEADING_FIELDS = {
  // Typed on the canvas as well as in the side bar, as before the reshape (plan § Extend, don't narrow).
  text: createInlineRichTextField({ label: 'Text', canvas: true }),
  level: {
    type: 'select' as const,
    label: 'Level',
    options: [
      { label: 'H1', value: 'h1' },
      { label: 'H2', value: 'h2' },
      { label: 'H3', value: 'h3' },
      { label: 'H4', value: 'h4' },
      { label: 'H5', value: 'h5' },
      { label: 'H6', value: 'h6' },
      { label: 'Paragraph (not a heading)', value: 'p' },
    ],
  },
  size: { type: 'select' as const, label: 'Size', metadata: PB_RESPONSIVE_METADATA, options: TYPE_SIZE_OPTIONS },
  fontSize: {
    type: 'number' as const,
    label: 'Custom size (px)',
    min: 10,
    max: 160,
    step: 1,
    metadata: PB_RESPONSIVE_METADATA,
  },
  // R17 (T211): the weight next to the size.
  fontWeight: {
    type: 'select' as const,
    label: 'Font weight',
    metadata: PB_RESPONSIVE_METADATA,
    options: FONT_WEIGHT_OPTIONS,
  },
  align: {
    type: 'select' as const,
    label: 'Align',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Left', value: 'start' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'end' },
    ],
  },
  // R21G (T337): a maximum width per breakpoint, as the other texts'; unset keeps today's full width.
  ...textMaxWidthFields(),
  color: TEXT_COLOR_FIELD,
  // R19A (T226): a text led by an inline icon hangs beside it (wrapped lines align with the text).
  // R23 (T439): the space after the icon is the indent's own (0.35 em); no px field.
  hangingIcon: createToggleField({ label: 'Hanging indent after a leading icon' }),
  // Advanced: the Custom overrides of the type tokens (plan § Extend, don't narrow, rule 2).
  font: {
    type: 'select' as const,
    label: 'Advanced: font',
    options: [
      { label: 'Heading font', value: 'heading' },
      { label: 'Body font', value: 'body' },
      { label: 'Custom', value: 'custom' },
    ],
  },
  fontFamily: {
    type: 'select' as const,
    label: 'Advanced: custom font',
    options: [
      { label: 'Sans-serif', value: 'sans' },
      { label: 'Serif', value: 'serif' },
      { label: 'Monospace', value: 'mono' },
    ],
  },
  customFontFamily: { type: 'text' as const, label: 'Advanced: custom font family (CSS)' },
  fontStyle: {
    type: 'select' as const,
    label: 'Advanced: style',
    options: [
      { label: 'Normal', value: 'normal' },
      { label: 'Italic', value: 'italic' },
    ],
  },
  lineHeight: {
    type: 'number' as const,
    label: 'Advanced: line height',
    min: 1,
    max: 2.5,
    step: 0.05,
    metadata: PB_RESPONSIVE_METADATA,
  },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

function usesCustomSize(size: unknown): boolean {
  if (size === 'custom') return true;
  if (size !== null && typeof size === 'object') {
    if ('px' in size) return true;
    return Object.values(size as Record<string, unknown>).some(usesCustomSize);
  }
  return false;
}

const headingConfig: ComponentConfig<{ props: HeadingProps }> = {
  label: 'Heading',
  fields: HEADING_FIELDS as unknown as Fields<HeadingProps>,
  defaultProps: {
    level: 'h2',
    size: 'h2',
    font: 'heading',
    text: plainTextToInlineRichText('Section heading'),
    align: 'start',
    ...DEFAULT_BOX_PROPS,
  },
  // Filters the host's field set in its order (R17: the weight stays next to the size).
  resolveFields: (data, params) => {
    const props = data.props as HeadingProps;
    const showSize = usesCustomSize(props.size) || hasLegacySize(props);
    const showFont = props.font === 'custom' || props.font === undefined;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? HEADING_FIELDS)) {
      if (key === 'fontSize' && !showSize) continue;
      if ((key === 'fontFamily' || key === 'customFontFamily') && !showFont) continue;
      if (key === 'textMaxWidthPx' && !usesCustomTextMaxWidth(props.textMaxWidth)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<HeadingProps>;
  },
  resolveData: async (data) => {
    const props = data.props as unknown as HeadingProps;
    // A heading stored before the reshape is carried into it once, with no change to its render.
    const stored =
      props.font === undefined || typeof props.text === 'string' || props.textAlign !== undefined || usesLiteralSizeObject(props.size);
    const next: HeadingProps = stored ? headingFromLegacy(props as unknown as Record<string, unknown>) : props;
    return { props: next };
  },
  render: (props) =>
    props.puck?.isEditing ? <HeadingEditingRender {...props} /> : <HeadingPublishedRender {...props} />,
};

function usesLiteralSizeObject(size: unknown): boolean {
  if (size === null || typeof size !== 'object') return false;
  if ('px' in size) return true;
  return Object.values(size as Record<string, unknown>).some((inner) => inner !== null && typeof inner === 'object');
}

export const Heading = withHideOn(headingConfig);
