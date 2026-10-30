'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { createColorField, PB_RESPONSIVE_METADATA, withHideOn, type BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { StatsProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import {
  alignField,
  gapField,
  gapPxField,
  imageObjectField,
  levelField,
  SIDE_OPTIONS,
  sizeFieldWithDefault,
  sizePxField,
} from '../fields/section-block-fields.js';
import { Picture } from './Picture.js';
import {
  BlockHeading,
  gapVars,
  hasImage,
  isDefaultSize,
  responsiveVars,
  sizedTextProps,
  alignTierAttrs,
  responsiveAlign,
  usesCustom,
  blockHeadingStyle,
  blockHeadingStyleFields,
} from './section-parts.js';
import { resolveColorValue } from '../utils/color-value.js';
import { customOnlyLeading, lineHeightField, sizeUsesCustom, textStyleAttrs } from './text-style.js';
import { textWeightField } from './typography.js';
import { pxCss, tierVars } from './tier-vars.js';
import { tierLeading } from './tier-leading.js';
import { COLUMN_GAP_PX_FIELD, LAYOUT_ADVANCED_FIELD, layoutPresetField, presetSpans, usesAdvancedLayout, type TwelveColumnChoice } from './twelve-columns.js';

/**
 * `cms.Stats` — `specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * US3, FR-018.
 *
 * Key figures: big values with captions, in a grid of 1–6 columns per
 * breakpoint (custom properties the stylesheet reads — no script decides the
 * layout, R-23), with an optional heading and an optional image beside the
 * figures on the start or end side (stacked above them on mobile). The
 * contract's `grid` is today's `columns`, kept by name and range, so no stored
 * value moves.
 *
 * Plan § *Extend, don't narrow*: every field of today's block has its
 * counterpart (the option-parity test), and without a heading and an image the
 * render is today's ({@link statsFromLegacy} carries a stored px gap and
 * alignment).
 */

// ── Stored before the reshape ────────────────────────────────────────

const LOGICAL: Record<string, 'start' | 'center' | 'end'> = { left: 'start', center: 'center', right: 'end' };

/**
 * A stats block stored on `origin/master` in the reshaped shape, value for
 * value (the option-parity test holds it): a px `gap` becomes `'custom'` with
 * `gapPx`, and `left`/`right` become `start`/`end`. Idempotent.
 */
export function statsFromLegacy(props: Record<string, unknown>): StatsProps {
  const next: Record<string, unknown> = { ...props };
  if (typeof props['gap'] === 'number') {
    next['gap'] = 'custom';
    next['gapPx'] = props['gap'];
  }
  if (typeof props['align'] === 'string' && props['align'] in LOGICAL) next['align'] = LOGICAL[props['align']];
  return next as unknown as StatsProps;
}

// ── Render ───────────────────────────────────────────────────────────

/** Today's defaults: 4 columns, 24 px apart. */
const DEFAULT_COLUMNS = 4;
const DEFAULT_GAP_PX = 24;

/** Today's label (`.cmsc-pb-stats__label`): 0.9 rem, read by a breakpoint left on Default (R19A). */
const LABEL_TODAY = { size: '0.9rem', lineHeight: 'inherit' };

const FIGURES_ALIGN: ReadonlyArray<NonNullable<StatsProps['figuresAlign']>> = ['center', 'start', 'end', 'spread'];

function wholeColumns(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * R19A (T235): beside an image, from the tablet up, the image's and the
 * figures' places on a 12-column grid — the image `imageSpan` columns at its
 * side, `figuresOffset` columns between, the figures `figuresSpan` columns
 * (the rest by default), mirrored for an image at the end. Nothing set: none,
 * and today's two halves stay.
 */
/** R23 (T438): the raw numbers, shown and applied with the Advanced switch on. */
const STATS_RAW_COLUMN_KEYS = ['imageSpan', 'figuresSpan', 'figuresOffset'] as const;

/**
 * R23 (T438): the spans in use — the raw ones with the Advanced switch on (or
 * stored before it existed, with no preset), else the `layout` preset's
 * (image – between – figures), else none.
 */
function statsSpans(props: StatsProps): { imageSpan?: unknown; figuresSpan?: unknown; figuresOffset?: unknown } {
  if (usesAdvancedLayout(props as TwelveColumnChoice, STATS_RAW_COLUMN_KEYS)) {
    return { imageSpan: props.imageSpan, figuresSpan: props.figuresSpan, figuresOffset: props.figuresOffset };
  }
  const preset = presetSpans(props.layout);
  return preset ? { imageSpan: preset.mediaSpan, figuresOffset: preset.textOffset, figuresSpan: preset.textSpan } : {};
}

function figureColumns(props: StatsProps, tier: BreakpointTier | null = null): Record<string, string> | null {
  const spans = statsSpans(props);
  const image = wholeColumns(spans.imageSpan, 1, 11);
  const figures = wholeColumns(spans.figuresSpan, 1, 11);
  const offset = wholeColumns(spans.figuresOffset, 0, 10);
  if (image === undefined && figures === undefined && offset === undefined) return null;
  // R22I (T370): the columns' own gap per breakpoint, where chosen.
  const columnGap = tierVars<number>('cmsc-grid-gap', props.columnGapPx, tier, pxCss(200));
  const imageCols = image ?? 6;
  const gap = Math.min(offset ?? 0, 11 - imageCols);
  const figureCols = Math.max(1, Math.min(figures ?? 12 - imageCols - gap, 12 - imageCols - gap));
  if (props.imageSide === 'end') {
    const imageStart = 13 - imageCols;
    const figuresStart = imageStart - gap - figureCols;
    return {
      '--cmsc-stats-media-col': `${imageStart} / span ${imageCols}`,
      '--cmsc-stats-figures-col': `${Math.max(1, figuresStart)} / span ${figureCols}`,
      ...columnGap,
    };
  }
  return {
    '--cmsc-stats-media-col': `1 / span ${imageCols}`,
    '--cmsc-stats-figures-col': `${imageCols + gap + 1} / span ${figureCols}`,
    ...columnGap,
  };
}

function columnsCss(value: number): string {
  const n = Math.round(Number(value));
  return String(Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : DEFAULT_COLUMNS);
}

function StatsBody({ props, tier }: { props: StatsProps; tier: BreakpointTier | null }): ReactNode {
  const items = (props.items ?? []).filter((item) => item && typeof item === 'object');
  const valueColor = resolveColorValue(props.valueColor);
  const { margin, padding, border } = props;
  // R17 (T206): the alignment per breakpoint; one alignment stays today's inline `text-align`.
  const aligned = responsiveAlign(props.align, tier, 'center');
  const gridStyle = {
    ...responsiveVars<number>('cmsc-stats-cols', props.columns, DEFAULT_COLUMNS, columnsCss, tier),
    ...gapVars('cmsc-stats-gap', props.gap, props.gapPx, DEFAULT_GAP_PX, tier),
    ...(aligned.tiers ? {} : { textAlign: aligned.align }),
  } as CSSProperties;

  const valueSized = isDefaultSize(props.valueSize) ? null : sizedTextProps(props.valueSize!, props.valueSizePx, 'h2', tier);
  // R22I (T375): the value's line height per breakpoint; a breakpoint below the first set keeps its token's.
  // R23 (T435): only from a breakpoint sized in Custom px.
  const valueLeading = tierLeading(customOnlyLeading(props.valueSize, props.valueLineHeight), tier);
  const valueClass = [
    'cmsc-pb-stats__value',
    ...(valueSized ? ['cmsc-pb-stats__value--token', ...valueSized.classes] : []),
    ...valueLeading.classes,
  ].join(' ');
  const valueStyle = { ...(valueSized?.style ?? {}), ...valueLeading.style, ...(valueColor ? { color: valueColor } : {}) } as CSSProperties;

  // R19A (T235): the labels' own size and weight, written only when chosen. R20F (T319): and line height.
  // R23 (T435): the colour is the scheme's muted text (today's); `valueColor` stays the figures' accent.
  const label = textStyleAttrs(
    { size: props.labelSize, sizePx: props.labelSizePx, weight: props.labelWeight, lineHeight: props.labelLineHeight },
    tier,
    LABEL_TODAY,
  );
  const labelClass = ['cmsc-pb-stats__label', ...label.classes].join(' ');
  const labelStyle = Object.keys(label.style).length > 0 ? { style: label.style as CSSProperties } : {};

  const grid = (
    <ul
      className={aligned.tiers ? 'cmsc-pb-stats cmsc-pb-text-align' : 'cmsc-pb-stats'}
      {...(aligned.tiers ? { 'data-align': aligned.align, ...alignTierAttrs(aligned.tiers) } : {})}
      style={gridStyle}
    >
      {items.map((item, index) => (
        <li key={index} className="cmsc-pb-stats__item">
          <div className={valueClass} style={valueStyle}>
            {item.value}
          </div>
          <div className={labelClass} {...labelStyle}>
            {item.label}
          </div>
        </li>
      ))}
    </ul>
  );
  const columns = figureColumns(props, tier);
  const figuresAlign = FIGURES_ALIGN.includes(props.figuresAlign as never) && props.figuresAlign !== 'center' ? props.figuresAlign : undefined;
  const heading = (
    <BlockHeading
      value={props.heading}
      level={props.headingLevel}
      size={isDefaultSize(props.headingSize) ? undefined : props.headingSize}
      sizePx={props.headingSizePx}
      {...blockHeadingStyle(props)}
      align={aligned.align}
      alignTiers={aligned.tiers}
      className="cmsc-pb-stats__heading"
      tier={tier}
    />
  );

  return (
    <BoxStyled
      {...(margin !== undefined ? { margin } : {})}
      {...(padding !== undefined ? { padding } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(tier !== null ? { previewTier: tier } : {})}
    >
      {hasImage(props.image) ? (
        <div
          className={columns ? 'cmsc-pb-stats-block cmsc-pb-stats-block--columns' : 'cmsc-pb-stats-block'}
          data-image-side={props.imageSide === 'end' ? 'end' : 'start'}
          {...(figuresAlign ? { 'data-figures-align': figuresAlign } : {})}
          /* R21G (T335): side by side from the desktop only; unset, from the tablet (today's). */
          {...(props.sideBySide === 'desktop' ? { 'data-side-by-side': 'desktop' } : {})}
          {...(columns ? { style: columns as CSSProperties } : {})}
        >
          <div className="cmsc-pb-stats-block__media">
            <Picture image={{ fit: 'cover', ...props.image, ratio: props.image.ratio ?? '4:3' }} />
          </div>
          <div className="cmsc-pb-stats-block__figures">
            {heading}
            {grid}
          </div>
        </div>
      ) : (
        <>
          {heading}
          {grid}
        </>
      )}
    </BoxStyled>
  );
}

function effectiveProps(props: StatsProps): StatsProps {
  return statsFromLegacy(props as unknown as Record<string, unknown>);
}

const StatsEditingRender: PuckComponent<StatsProps> = (props) => (
  <StatsBody props={effectiveProps(props as unknown as StatsProps)} tier={usePreviewBreakpointTier()} />
);

const StatsPublishedRender: PuckComponent<StatsProps> = (props) => (
  <StatsBody props={effectiveProps(props as unknown as StatsProps)} tier={null} />
);

// ── Fields ───────────────────────────────────────────────────────────

const STATS_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeFieldWithDefault('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  items: {
    type: 'array' as const,
    label: 'Metrics',
    max: 12,
    getItemSummary: (item: { value?: string; label?: string }) => `${item.value || '—'} · ${item.label || 'Metric'}`,
    arrayFields: {
      value: { type: 'text' as const, label: 'Value' },
      label: { type: 'text' as const, label: 'Label' },
    },
    defaultItemProps: { value: '100+', label: 'Customers' },
  },
  // R17 (T219): the metrics first, then the image beside them and its side.
  image: imageObjectField('Image beside the figures'),
  imageSide: { type: 'select' as const, label: 'Image side (desktop)', options: SIDE_OPTIONS },
  // R21G (T335): the tier from which image and figures sit side by side; unset is the tablet (today's).
  sideBySide: {
    type: 'select' as const,
    label: 'Side by side from',
    options: [
      { label: 'Tablet (768 px)', value: 'tablet' },
      { label: 'Desktop (1024 px)', value: 'desktop' },
    ],
  },
  // R19A (T235): beside the image, from the tablet up: widths in columns of 12 and the figures' vertical position.
  // R23 (T438): a layout preset (image – figures); the raw columns behind the Advanced switch.
  layout: layoutPresetField('Layout (image – figures)'),
  layoutAdvanced: LAYOUT_ADVANCED_FIELD,
  imageSpan: { type: 'number' as const, label: 'Image width (columns of 12)', min: 1, max: 11, step: 1 },
  figuresSpan: { type: 'number' as const, label: 'Figures width (columns of 12)', min: 1, max: 11, step: 1 },
  figuresOffset: { type: 'number' as const, label: 'Columns between the image and the figures', min: 0, max: 10, step: 1 },
  // R22I (T370): the space between the columns of 12 per breakpoint; empty keeps today's.
  columnGapPx: COLUMN_GAP_PX_FIELD,
  figuresAlign: {
    type: 'select' as const,
    label: 'Figures vertical position',
    options: [
      { label: 'Center', value: 'center' },
      { label: 'Top', value: 'start' },
      { label: 'Bottom', value: 'end' },
      { label: 'Spread over the image height', value: 'spread' },
    ],
  },
  columns: { type: 'number' as const, label: 'Columns', min: 1, max: 6, metadata: PB_RESPONSIVE_METADATA },
  gap: gapField('Gap'),
  gapPx: gapPxField('Custom gap (px)'),
  // R17 (T206): per breakpoint.
  align: alignField(),
  valueColor: createColorField({ label: 'Value color' }),
  valueSize: sizeFieldWithDefault('Value size'),
  valueSizePx: sizePxField('Custom value size (px)'),
  // R22I (T375): the values' line height per breakpoint; empty keeps the size's own.
  valueLineHeight: lineHeightField('Value line height'),
  // R19A (T235): the labels' size, weight and colour; Default keeps today's muted 0.9 rem.
  labelSize: sizeFieldWithDefault('Label size'),
  labelSizePx: sizePxField('Custom label size (px)'),
  labelWeight: textWeightField('Label weight'),
  // R20F (T319): the labels' line height per breakpoint; empty keeps today's. R23: with a Custom px size only.
  labelLineHeight: lineHeightField('Label line height'),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const CUSTOM_FIELDS: Record<string, keyof StatsProps> = {
  headingSizePx: 'headingSize',
  headingMaxWidthPx: 'headingMaxWidth',
  gapPx: 'gap',
  valueSizePx: 'valueSize',
  labelSizePx: 'labelSize',
};

/** R19A (T235): the fields that place the figures beside an image. */
const IMAGE_ONLY_FIELDS = new Set([
  'imageSide',
  'sideBySide',
  'layout',
  'layoutAdvanced',
  'imageSpan',
  'figuresSpan',
  'figuresOffset',
  'figuresAlign',
]);

const statsConfig: ComponentConfig<{ props: StatsProps }> = {
  label: 'Stats',
  fields: STATS_FIELDS as unknown as Fields<StatsProps>,
  // Today's look (plan § Extend, don't narrow, rule 3; T048): four figures in
  // four columns 24 px apart, centred, the values in today's teal — the
  // secondary brand colour, whose built-in value it is — no heading, no image.
  defaultProps: {
    items: [
      { value: '2.5k+', label: 'Products online' },
      { value: '98%', label: 'On-time delivery' },
      { value: '40+', label: 'Markets' },
      { value: '24/7', label: 'Support' },
    ],
    headingLevel: 'h2',
    imageSide: 'start',
    columns: DEFAULT_COLUMNS,
    gap: 'custom',
    gapPx: DEFAULT_GAP_PX,
    align: 'center',
    valueColor: 'token:secondary',
    ...DEFAULT_BOX_PROPS,
  } as StatsProps,
  resolveFields: (data, params) => {
    const props = effectiveProps(data.props as StatsProps);
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? STATS_FIELDS)) {
      const select = CUSTOM_FIELDS[key];
      if (select !== undefined && !usesCustom(props[select])) continue;
      if (IMAGE_ONLY_FIELDS.has(key) && !hasImage(props.image)) continue;
      // R22I (T370): the column gap only with the columns of 12.
      if (key === 'columnGapPx' && (!hasImage(props.image) || figureColumns(props) === null)) continue;
      // R23 (T438): the raw columns with the Advanced switch on.
      if ((STATS_RAW_COLUMN_KEYS as readonly string[]).includes(key) && !usesAdvancedLayout(props as TwelveColumnChoice, STATS_RAW_COLUMN_KEYS)) continue;
      // R23 (T435): a line height with a Custom px size only.
      if (key === 'valueLineHeight' && !sizeUsesCustom(props.valueSize)) continue;
      if (key === 'labelLineHeight' && !sizeUsesCustom(props.labelSize)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<StatsProps>;
  },
  // A block stored before the reshape is carried into it once, with no change to its render.
  // R23 (T438): raw columns stored before the Advanced switch existed show it on, as they render.
  resolveData: async (data) => {
    const props = effectiveProps(data.props as unknown as StatsProps);
    if (props.layoutAdvanced === undefined && usesAdvancedLayout(props as TwelveColumnChoice, STATS_RAW_COLUMN_KEYS)) {
      return { props: { ...props, layoutAdvanced: true } as never };
    }
    return { props: props as never };
  },
  render: (props) => (props.puck?.isEditing ? <StatsEditingRender {...props} /> : <StatsPublishedRender {...props} />),
};

export const Stats = withHideOn(statsConfig);
