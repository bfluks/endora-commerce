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
  const valueClass = ['cmsc-pb-stats__value', ...(valueSized ? ['cmsc-pb-stats__value--token', ...valueSized.classes] : [])].join(' ');
  const valueStyle = { ...(valueSized?.style ?? {}), ...(valueColor ? { color: valueColor } : {}) } as CSSProperties;

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
          <div className="cmsc-pb-stats__label">{item.label}</div>
        </li>
      ))}
    </ul>
  );
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
        <div className="cmsc-pb-stats-block" data-image-side={props.imageSide === 'end' ? 'end' : 'start'}>
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
  columns: { type: 'number' as const, label: 'Columns', min: 1, max: 6, metadata: PB_RESPONSIVE_METADATA },
  gap: gapField('Gap'),
  gapPx: gapPxField('Custom gap (px)'),
  // R17 (T206): per breakpoint.
  align: alignField(),
  valueColor: createColorField({ label: 'Value color' }),
  valueSize: sizeFieldWithDefault('Value size'),
  valueSizePx: sizePxField('Custom value size (px)'),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const CUSTOM_FIELDS: Record<string, keyof StatsProps> = {
  headingSizePx: 'headingSize',
  headingMaxWidthPx: 'headingMaxWidth',
  gapPx: 'gap',
  valueSizePx: 'valueSize',
};

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
      if (key === 'imageSide' && !hasImage(props.image)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<StatsProps>;
  },
  // A block stored before the reshape is carried into it once, with no change to its render.
  resolveData: async (data) => ({ props: effectiveProps(data.props as unknown as StatsProps) as never }),
  render: (props) => (props.puck?.isEditing ? <StatsEditingRender {...props} /> : <StatsPublishedRender {...props} />),
};

export const Stats = withHideOn(statsConfig);
