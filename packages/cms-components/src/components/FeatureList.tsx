'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { createColorField, isResponsiveProp, PB_RESPONSIVE_METADATA, withHideOn, type BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { FeatureListIconSize, FeatureListItem, FeatureListProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import {
  alignField,
  gapField,
  gapPxField,
  iconFields,
  imageObjectField,
  levelField,
  sizeFieldWithDefault,
  sizePxField,
} from '../fields/section-block-fields.js';
import { InlineRich } from './InlineRich.js';
import { textWeightField } from './typography.js';
import { responsiveWeightProps, WeightSpan } from './item-text.js';
import { Picture } from './Picture.js';
import {
  BlockHeading,
  gapVars,
  hasImage,
  isDefaultSize,
  ItemIcon,
  plainTextToDoc,
  responsiveVars,
  RichBody,
  sizedTextProps,
  alignTierAttrs,
  responsiveAlign,
  usesCustom,
  blockHeadingStyle,
  blockHeadingStyleFields,
} from './section-parts.js';
import { iconColorProps } from '../utils/color-value.js';

/**
 * `cms.FeatureList` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US3, FR-017.
 *
 * A heading, then items of an icon, an inline rich title and a rich body in
 * 1–4 columns per breakpoint, then an optional image below the grid. The
 * columns and the gap are custom properties per breakpoint that the stylesheet
 * reads, so no script decides the layout (R-23) and nothing shifts on
 * hydration. An uploaded SVG icon (`iconAssetId`) is drawn as a mask filled
 * with `currentColor`, so it takes the icon colour, or the section's text
 * colour when none is set (US3 acceptance 2).
 *
 * Plan § *Extend, don't narrow*: every field of today's list has its
 * counterpart (the option-parity test). A list stored before keeps its fields
 * and renders through this renderer as it did ({@link featureListFromLegacy}):
 * its `description` is the item's body, its px gap and icon size are the
 * Custom (px) cases, its alignment the logical one, and with no title size its
 * titles keep today's look.
 */

// ── Stored before the reshape ────────────────────────────────────────

const LOGICAL: Record<string, 'start' | 'center' | 'end'> = { left: 'start', center: 'center', right: 'end' };

function isNumberOrResponsiveNumber(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (isResponsiveProp(value)) {
    return Object.values(value as Record<string, unknown>).every((inner) => inner === undefined || typeof inner === 'number');
  }
  return false;
}

/**
 * A feature list stored on `origin/master` in the reshaped shape, value for
 * value (the option-parity test holds it). Each legacy field is carried on its
 * own, so the function is idempotent: an item's `description` becomes its rich
 * `body`, a px `gap` (responsive or not) becomes `'custom'` with `gapPx`, a px
 * `iconSize` becomes `'custom'` with `iconSizePx`, and `left`/`right` become
 * `start`/`end`. `columns`, `iconColor` and the box are kept as they are.
 */
export function featureListFromLegacy(props: Record<string, unknown>): FeatureListProps {
  const next: Record<string, unknown> = { ...props };
  if (Array.isArray(props['items'])) {
    next['items'] = (props['items'] as Array<Record<string, unknown>>).map((item) => {
      if (!item || typeof item !== 'object' || !('description' in item)) return item;
      const { description, ...rest } = item;
      if (rest['body'] !== undefined || typeof description !== 'string' || description === '') return rest;
      return { ...rest, body: plainTextToDoc(description) };
    });
  }
  if (isNumberOrResponsiveNumber(props['gap'])) {
    next['gap'] = 'custom';
    next['gapPx'] = props['gap'];
  }
  if (typeof props['iconSize'] === 'number') {
    next['iconSize'] = 'custom';
    next['iconSizePx'] = props['iconSize'];
  }
  if (typeof props['align'] === 'string' && props['align'] in LOGICAL) next['align'] = LOGICAL[props['align']];
  return next as unknown as FeatureListProps;
}

// ── Render ───────────────────────────────────────────────────────────

const ICON_SIZE_PX: Record<Exclude<FeatureListIconSize, 'custom'>, number> = { small: 20, medium: 28, large: 40 };
/** Today's defaults: 3 columns, a 24 px gap, 28 px icons. */
const DEFAULT_COLUMNS = 3;
const DEFAULT_GAP_PX = 24;

function iconSizePx(props: FeatureListProps): number {
  const size = props.iconSize;
  if (typeof size === 'number') return size;
  if (size === 'custom') return typeof props.iconSizePx === 'number' && Number.isFinite(props.iconSizePx) ? props.iconSizePx : ICON_SIZE_PX.medium;
  return ICON_SIZE_PX[size ?? 'medium'] ?? ICON_SIZE_PX.medium;
}

function columnsCss(value: number): string {
  const n = Math.round(Number(value));
  return String(Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : DEFAULT_COLUMNS);
}

function ItemTitle({ item, props, tier }: { item: FeatureListItem; props: FeatureListProps; tier: BreakpointTier | null }): ReactNode {
  // T151: a chosen weight over the title's own; R17 (T211): per breakpoint.
  const weighed = responsiveWeightProps(props.titleWeight, tier);
  const weightStyle: Record<string, string> = weighed.inline;
  // No title size: today's title look (`.cmsc-pb-feature-list__title`).
  if (isDefaultSize(props.titleSize)) {
    return (
      <h3 className="cmsc-pb-feature-list__title" {...(Object.keys(weightStyle).length > 0 ? { style: weightStyle as CSSProperties } : {})}>
        <WeightSpan vars={weighed.span}>
          <InlineRich value={item.title as never} />
        </WeightSpan>
      </h3>
    );
  }
  const sized = sizedTextProps(props.titleSize!, props.titleSizePx, 'h6', tier);
  const style = { ...sized.style, ...weightStyle };
  return (
    <h3
      className={['cmsc-pb-feature-list__title', 'cmsc-pb-feature-list__title--token', ...sized.classes].join(' ')}
      {...(Object.keys(style).length > 0 ? { style: style as CSSProperties } : {})}
    >
      <WeightSpan vars={weighed.span}>
        <InlineRich value={item.title as never} />
      </WeightSpan>
    </h3>
  );
}

/** The body in today's description look (`.cmsc-pb-feature-list__desc`); a stored description arrives here as the body. */
function ItemBody({ item }: { item: FeatureListItem }): ReactNode {
  return <RichBody value={item.body} className="cmsc-pb-feature-list__desc cmsc-pb-feature-list__body" />;
}

function FeatureListBody({ props, tier }: { props: FeatureListProps; tier: BreakpointTier | null }): ReactNode {
  const items = (props.items ?? []).filter((item) => item && typeof item === 'object');
  const size = iconSizePx(props);
  const iconColor = iconColorProps(props.iconColor);
  const iconStyle: CSSProperties | undefined = iconColor.style ?? (iconColor.color ? { color: iconColor.color } : undefined);
  const { margin, padding, border } = props;
  // R17 (T206): the alignment per breakpoint; one alignment stays today's inline `text-align`.
  const aligned = responsiveAlign(props.align, tier, 'start');
  const gridStyle = {
    ...responsiveVars<number>('cmsc-fl-cols', props.columns, DEFAULT_COLUMNS, columnsCss, tier),
    ...gapVars('cmsc-fl-gap', props.gap, props.gapPx, DEFAULT_GAP_PX, tier),
    ...(aligned.tiers ? {} : { textAlign: aligned.align }),
  } as CSSProperties;

  return (
    <BoxStyled
      {...(margin !== undefined ? { margin } : {})}
      {...(padding !== undefined ? { padding } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(tier !== null ? { previewTier: tier } : {})}
    >
      <BlockHeading
        value={props.heading}
        level={props.headingLevel}
        size={isDefaultSize(props.headingSize) ? undefined : props.headingSize}
        sizePx={props.headingSizePx}
        {...blockHeadingStyle(props)}
        align={aligned.align}
        alignTiers={aligned.tiers}
        className="cmsc-pb-feature-list__heading"
        tier={tier}
      />
      <ul
        className={aligned.tiers ? 'cmsc-pb-feature-list cmsc-pb-text-align' : 'cmsc-pb-feature-list'}
        {...(aligned.tiers ? { 'data-align': aligned.align, ...alignTierAttrs(aligned.tiers) } : {})}
        style={gridStyle}
      >
        {items.map((item, index) => {
          const hasIcon = Boolean(item.iconAssetId) || Boolean(item.icon);
          return (
            <li key={index} className="cmsc-pb-feature-list__item">
              {hasIcon ? (
                <span className="cmsc-pb-feature-list__icon" {...(iconStyle ? { style: iconStyle } : {})}>
                  <ItemIcon icon={item.icon} iconAssetId={item.iconAssetId} size={size} />
                </span>
              ) : null}
              <ItemTitle item={item} props={props} tier={tier} />
              <ItemBody item={item} />
            </li>
          );
        })}
      </ul>
      {tier !== null && items.length === 0 ? (
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Add features in the Items tab.</p>
      ) : null}
      {hasImage(props.image) ? (
        <div className="cmsc-pb-feature-list__image">
          <Picture image={props.image} />
        </div>
      ) : null}
    </BoxStyled>
  );
}

function effectiveProps(props: FeatureListProps): FeatureListProps {
  return featureListFromLegacy(props as unknown as Record<string, unknown>);
}

const FeatureListEditingRender: PuckComponent<FeatureListProps> = (props) => (
  <FeatureListBody props={effectiveProps(props as unknown as FeatureListProps)} tier={usePreviewBreakpointTier()} />
);

const FeatureListPublishedRender: PuckComponent<FeatureListProps> = (props) => (
  <FeatureListBody props={effectiveProps(props as unknown as FeatureListProps)} tier={null} />
);

// ── Fields ───────────────────────────────────────────────────────────

const FEATURE_LIST_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeFieldWithDefault('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  items: {
    type: 'array' as const,
    label: 'Features',
    max: 24,
    getItemSummary: (item: { title?: unknown }) => (typeof item?.title === 'string' && item.title ? item.title : 'Feature'),
    arrayFields: {
      ...iconFields(),
      title: createInlineRichTextField({ label: 'Title' }),
      body: createRichTextDocField({ label: 'Text' }),
    },
    defaultItemProps: {
      icon: 'checkCircle2',
      title: 'Feature',
      body: plainTextToDoc('Short supporting copy.'),
    },
  },
  // R17 (T219): the image below the grid next to the features it follows.
  image: imageObjectField('Image below the grid'),
  columns: { type: 'number' as const, label: 'Columns', min: 1, max: 4, metadata: PB_RESPONSIVE_METADATA },
  gap: gapField('Gap'),
  gapPx: gapPxField('Custom gap (px)'),
  iconColor: createColorField({ label: 'Icon color' }),
  iconSize: {
    type: 'select' as const,
    label: 'Icon size',
    options: [
      { label: 'Small', value: 'small' },
      { label: 'Medium', value: 'medium' },
      { label: 'Large', value: 'large' },
      { label: 'Custom (px)', value: 'custom' },
    ],
  },
  iconSizePx: { type: 'number' as const, label: 'Custom icon size (px)', min: 12, max: 96 },
  // R17 (T206): per breakpoint.
  align: alignField(),
  titleSize: sizeFieldWithDefault('Title size'),
  titleSizePx: sizePxField('Custom title size (px)'),
  // T151: each item title's weight; Default keeps today's. R17 (T211): per breakpoint, beside the size.
  titleWeight: { ...textWeightField('Title weight'), metadata: PB_RESPONSIVE_METADATA },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

/** The literal fields shown once their select is on Custom. */
const CUSTOM_FIELDS: Record<string, keyof FeatureListProps> = {
  headingSizePx: 'headingSize',
  headingMaxWidthPx: 'headingMaxWidth',
  gapPx: 'gap',
  iconSizePx: 'iconSize',
  titleSizePx: 'titleSize',
};

const featureListConfig: ComponentConfig<{ props: FeatureListProps }> = {
  label: 'Feature list',
  fields: FEATURE_LIST_FIELDS as unknown as Fields<FeatureListProps>,
  // Today's look (plan § Extend, don't narrow, rule 3; T048): three items in
  // three columns 24 px apart, 28 px icons in today's teal — the secondary
  // brand colour, whose built-in value it is — left-aligned, today's title
  // look, no heading and no image.
  defaultProps: {
    items: [
      { icon: 'truck', title: 'Fast delivery', body: plainTextToDoc('Reliable logistics for every order.') },
      { icon: 'shieldCheck', title: 'Secure', body: plainTextToDoc('Account security built in.') },
      { icon: 'lifeBuoy', title: 'Support', body: plainTextToDoc('A team ready to help.') },
    ],
    headingLevel: 'h2',
    columns: 3,
    gap: 'custom',
    gapPx: DEFAULT_GAP_PX,
    iconColor: 'token:secondary',
    iconSize: 'medium',
    align: 'start',
    ...DEFAULT_BOX_PROPS,
  } as FeatureListProps,
  resolveFields: (data, params) => {
    const props = effectiveProps(data.props as FeatureListProps);
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? FEATURE_LIST_FIELDS)) {
      const select = CUSTOM_FIELDS[key];
      if (select !== undefined && !usesCustom(props[select])) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<FeatureListProps>;
  },
  // A list stored before the reshape is carried into it once, with no change to its render.
  resolveData: async (data) => ({ props: effectiveProps(data.props as unknown as FeatureListProps) as never }),
  render: (props) =>
    props.puck?.isEditing ? <FeatureListEditingRender {...props} /> : <FeatureListPublishedRender {...props} />,
};

export const FeatureList = withHideOn(featureListConfig);

