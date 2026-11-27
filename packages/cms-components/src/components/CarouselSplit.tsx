'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  CORNER_RADIUS_PX,
  createToggleField,
  plainTextToInlineRichText,
  withHideOn,
  type BreakpointTier,
  type CornerRadius,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { CarouselSplitProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { buttonsField, hoverZoomField, iconFields, SIDE_OPTIONS, sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { CORNER_RADIUS_FIELD } from '../fields/shared-fields.js';
import { useBreakpointVideo } from '../hooks/use-breakpoint-video.js';
import { InlineRich } from './InlineRich.js';
import { MEDIA_TEXT_MEDIA_FIELD, MediaTextMediaFrame } from './MediaText.js';
import { buttonWidthField } from './button-full-width.js';
import { ButtonRow, isEmptyInline, ItemIcon, plainTextToDoc, RichBody, usesCustom } from './section-parts.js';
import { lineHeightField, sizeUsesCustom, textStyleAttrs } from './text-style.js';
import { textWeightField } from './typography.js';
import { pxCss, tierVars } from './tier-vars.js';
import { spaceTokenField, spaceTokenOf, spaceTokenVars } from './space-token.js';
import {
  chosenSpans,
  COLUMN_GAP_PX_FIELD,
  COLUMNS_ANCHOR_FIELD,
  LAYOUT_ADVANCED_FIELD,
  layoutPresetField,
  TWELVE_COLUMN_KEYS,
  twelveColumns,
  usesAdvancedLayout,
} from './twelve-columns.js';
import { leadsWithInlineIcon } from './InlineRich.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';
import { CarouselSlideControls } from './carousel/CarouselShell.js';

/**
 * `cms.CarouselSplit` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US4, FR-020: a split slide of a Carousel. Media (an
 * image, or a video with its poster, exactly as `cms.MediaText`'s) on one side;
 * an icon, a title, rich text and up to two buttons on the other. The two
 * stack below the tablet tier, media first; the side applies from it up.
 *
 * R20F (T310–T312), each unset writes nothing: the tier from which the two sit
 * side by side (`data-side-by-side="desktop"`), their widths on a 12-column
 * grid with columns between them (`--cmsc-split-media-col|text-col`), the
 * media's corners, the title's and the text's size, weight and line height,
 * and a hanging indent after an icon leading the title.
 */

const MAX_BUTTONS = 2;

/**
 * R20F (T310): the media's and the text's places on a 12-column grid
 * (`twelveColumns`, shared with `cms.MediaText`), mirrored for media at the
 * end. Nothing set: `null`, today's two halves. R23 (T438): a layout preset, or
 * the raw columns with the Advanced switch on.
 */
function splitColumns(props: CarouselSplitProps, tier: BreakpointTier | null): Record<string, string> | null {
  const columns = twelveColumns(chosenSpans(props), props.mediaSide === 'end' ? 'end' : 'start');
  // R22I (T370): and their own gap per breakpoint, where chosen.
  return columns
    ? {
        '--cmsc-split-media-col': columns.media,
        '--cmsc-split-text-col': columns.text,
        ...tierVars<number>('cmsc-grid-gap', props.columnGapPx, tier, pxCss(200)),
      }
    : null;
}

/** R20F (T310): the media's corners — a radius token; unset or unknown: today's 8 px (nothing written). */
function mediaRadiusStyle(value: unknown): CSSProperties | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CORNER_RADIUS_PX, value)
    ? { borderRadius: `${CORNER_RADIUS_PX[value as CornerRadius]}px` }
    : null;
}

/** Today's title (the h4 token) and text, read by a breakpoint left on Default when another is set. */
const TITLE_TODAY = { size: 'var(--cmsb-t-h4-size, 26px)', weight: 'var(--cmsb-t-h4-w, 700)', lineHeight: 'var(--cmsb-t-h4-lh, 1.12)' };
const BODY_TODAY = { size: 'inherit', lineHeight: 'inherit' };

function styleOrNothing(style: Record<string, string>): { style?: CSSProperties } {
  return Object.keys(style).length > 0 ? { style: style as CSSProperties } : {};
}

function CarouselSplitBody({ props, tier }: { props: CarouselSplitProps; tier: BreakpointTier | null }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useBreakpointVideo(ref, '.cmsc-pb-media-text__video video[data-bp][data-autoplay]');
  const hasIcon = Boolean(props.icon || props.iconAssetId);
  const columns = splitColumns(props, tier);
  const mediaRadius = mediaRadiusStyle(props.mediaCornerRadius);
  const title = textStyleAttrs(
    { size: props.titleSize, sizePx: props.titleSizePx, weight: props.titleWeight, lineHeight: props.titleLineHeight },
    tier,
    TITLE_TODAY,
  );
  // R23 (T439): the space after the leading icon is the hanging indent's own (0.35 em), no field.
  const hanging = props.titleHangingIcon === true;
  const hangGap: Record<string, string> = {};
  const body = textStyleAttrs(
    { size: props.bodySize, sizePx: props.bodySizePx, weight: props.bodyWeight, lineHeight: props.bodyLineHeight },
    tier,
    BODY_TODAY,
  );
  // R21G (T336): the text indented to a hanging title's text — only for a title led by an icon, hanging.
  const bodyIndent = props.bodyIndent === 'title' && hanging && leadsWithInlineIcon(props.title);
  // R21G (T336): the stacked gap, the space below the title and above the controls, where chosen.
  // R23 (T437): one spacing step for the text's spaces (below the title, above the controls), one for the stacked gap.
  const innerSpace = spaceTokenOf(props.innerSpace);
  const spaces = [
    { classes: ['cmsc-pb-carousel-split--stacked-gap'], vars: spaceTokenVars('cmsc-split-stacked-gap', props.stackedGap, tier) },
    { classes: ['cmsc-pb-carousel-split--title-space'], vars: spaceTokenVars('cmsc-split-title-space', innerSpace, tier) },
    { classes: ['cmsc-pb-carousel-split--controls-space'], vars: spaceTokenVars('cmsc-split-controls-space', innerSpace, tier) },
  ].filter((space) => Object.keys(space.vars).length > 0);
  const rootClass = [
    'cmsc-pb-carousel-split',
    props.hoverZoom === true ? 'cmsc-hover-zoom' : '',
    columns ? 'cmsc-pb-carousel-split--columns' : '',
    bodyIndent ? 'cmsc-pb-carousel-split--body-indent' : '',
    ...spaces.flatMap((space) => space.classes),
  ]
    .filter(Boolean)
    .join(' ');
  const rootStyle = Object.assign({}, columns ?? {}, ...spaces.map((space) => space.vars)) as Record<string, string>;
  return (
    <div
      className={rootClass}
      data-media-side={props.mediaSide === 'end' ? 'end' : 'start'} ref={ref}
      {...(props.sideBySide === 'desktop' ? { 'data-side-by-side': 'desktop' } : {})}
      {...styleOrNothing(rootStyle)}
      {...itemTagsAttribute(props.tags)}>
      <div className="cmsc-pb-carousel-split__media" {...(mediaRadius ? { style: mediaRadius } : {})}>
        <MediaTextMediaFrame media={props.media} />
      </div>
      {/* R21G (T336): with the indent, the icon's gap is the text column's (the title and the text share its grid). */}
      <div className="cmsc-pb-carousel-split__text" {...(bodyIndent ? styleOrNothing(hangGap) : {})}>
        {hasIcon ? (
          <span className="cmsc-pb-carousel-split__icon">
            <ItemIcon icon={props.icon} iconAssetId={props.iconAssetId} size={32} />
          </span>
        ) : null}
        {!isEmptyInline(props.title) ? (
          <h3
            className={['cmsc-pb-carousel-split__title cmsc-pb-block-heading cmsc-t--h4', ...title.classes].join(' ')}
            {...styleOrNothing({ ...title.style, ...hangGap })}
          >
            <InlineRich value={props.title as never} hangingIcon={hanging} />
          </h3>
        ) : null}
        <RichBody
          value={props.body}
          className={['cmsc-pb-carousel-split__body cmsc-pb-rich', ...body.classes].join(' ')}
          {...(Object.keys(body.style).length > 0 ? { style: body.style } : {})}
        />
        <ButtonRow
          buttons={(props.buttons ?? []).slice(0, MAX_BUTTONS)}
          tier={tier}
          fullWidth={props.buttonsFullWidth}
          className="cmsc-pb-carousel-split__actions cmsc-pb-actions"
        />
        {/* R19B (T253): the carousel's controls, when it places them inside its slides. */}
        <CarouselSlideControls />
      </div>
    </div>
  );
}

const CarouselSplitEditingRender: PuckComponent<CarouselSplitProps> = (props) => (
  <CarouselSplitBody props={props as unknown as CarouselSplitProps} tier={usePreviewBreakpointTier()} />
);

const CarouselSplitPublishedRender: PuckComponent<CarouselSplitProps> = (props) => (
  <CarouselSplitBody props={props as unknown as CarouselSplitProps} tier={null} />
);

const CAROUSEL_SPLIT_FIELDS = {
  media: MEDIA_TEXT_MEDIA_FIELD,
  ...iconFields(),
  title: createInlineRichTextField({ label: 'Title' }),
  body: createRichTextDocField({ label: 'Text' }),
  buttons: buttonsField('Buttons', MAX_BUTTONS),
  // T168: the buttons at the full width per breakpoint (Responsive tab); unset keeps today's.
  buttonsFullWidth: buttonWidthField('Button width'),
  hoverZoom: hoverZoomField(),
  // T131: tags for the Carousel's filter.
  tags: ITEM_TAGS_FIELD,
  // R20F (T310): the layout after the content — the media's side, the tier from which the two sit side by side, their columns of 12.
  mediaSide: { type: 'select' as const, label: 'Media side (tablet and up)', options: SIDE_OPTIONS },
  sideBySide: {
    type: 'select' as const,
    label: 'Side by side from',
    options: [
      { label: 'Tablet (768 px)', value: 'tablet' },
      { label: 'Desktop (1024 px)', value: 'desktop' },
    ],
  },
  // R23 (T438): a layout preset; the raw columns of 12 behind the Advanced switch.
  layout: layoutPresetField('Layout (media – text)'),
  layoutAdvanced: LAYOUT_ADVANCED_FIELD,
  mediaSpan: { type: 'number' as const, label: 'Media width (columns of 12)', min: 1, max: 11, step: 1 },
  textSpan: { type: 'number' as const, label: 'Text width (columns of 12)', min: 1, max: 11, step: 1 },
  textOffset: { type: 'number' as const, label: 'Columns between the media and the text', min: 0, max: 10, step: 1 },
  // R22I (T371, T370): with the columns of 12, where the pair sits and the gap between the columns.
  columnsAnchor: COLUMNS_ANCHOR_FIELD,
  columnGapPx: COLUMN_GAP_PX_FIELD,
  // R20F (T310–T312): the style — the media's corners, the title's and the text's type, the hanging indent.
  mediaCornerRadius: { ...CORNER_RADIUS_FIELD, label: 'Rounded corners' },
  titleSize: sizeFieldWithDefault('Title size'),
  titleSizePx: sizePxField('Custom title size (px)'),
  titleWeight: textWeightField('Title weight'),
  titleLineHeight: lineHeightField('Title line height'),
  titleHangingIcon: createToggleField({ label: 'Hanging indent after a leading icon' }),
  // R21G (T336): with the hanging indent, the text indented to the title's text.
  bodyIndent: {
    type: 'select' as const,
    label: 'Text indent',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Aligned with the title text', value: 'title' },
    ],
  },
  bodySize: sizeFieldWithDefault('Text size'),
  bodySizePx: sizePxField('Custom text size (px)'),
  bodyWeight: textWeightField('Text weight'),
  bodyLineHeight: lineHeightField('Text line height'),
  // R23 (T437): one spacing step below the title and above the slide's controls, one between stacked media and text.
  innerSpace: spaceTokenField('Space between the title, the text and the controls'),
  stackedGap: spaceTokenField('Space between media and text when stacked'),
};

/** R23 (T438): the raw 12-column numbers, shown with the Advanced switch on. */
const RAW_COLUMN_KEYS: ReadonlySet<string> = new Set(['mediaSpan', 'textSpan', 'textOffset', 'columnsAnchor']);

/** R20F: a Custom px shown once its size is on Custom; the icon space with the hanging indent on. */
function shownField(key: string, props: CarouselSplitProps): boolean {
  if (key === 'titleSizePx') return usesCustom(props.titleSize);
  if (key === 'bodySizePx') return usesCustom(props.bodySize);
  if (key === 'bodyIndent') return props.titleHangingIcon === true;
  // R23 (T435): a line height with a Custom px size only.
  if (key === 'titleLineHeight') return sizeUsesCustom(props.titleSize);
  if (key === 'bodyLineHeight') return sizeUsesCustom(props.bodySize);
  // R23 (T438): the raw columns with the Advanced switch on.
  if (RAW_COLUMN_KEYS.has(key) && !usesAdvancedLayout(props)) return false;
  // R22I (T370, T371): the pair's anchor and the column gap only with the columns of 12.
  if (TWELVE_COLUMN_KEYS.has(key)) return twelveColumns(chosenSpans(props), 'start') !== null;
  return true;
}

const carouselSplitConfig: ComponentConfig<{ props: CarouselSplitProps }> = {
  label: 'Carousel split slide',
  fields: CAROUSEL_SPLIT_FIELDS as unknown as Fields<CarouselSplitProps>,
  defaultProps: {
    media: { kind: 'image', image: { imageSource: 'library', alt: '' } },
    mediaSide: 'start',
    title: plainTextToInlineRichText('Title'),
    body: plainTextToDoc('Describe this slide in a sentence or two.'),
    buttons: [],
    hoverZoom: false,
  } as CarouselSplitProps,
  // Filters the host's field set (the admin's pickers survive); each field object is kept as it is, so Puck keeps focus.
  resolveFields: (data, params) => {
    const props = data.props as CarouselSplitProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? CAROUSEL_SPLIT_FIELDS)) {
      if (shownField(key, props)) fields[key] = field;
    }
    return fields as unknown as Fields<CarouselSplitProps>;
  },
  // R23 (T438): raw columns stored before the Advanced switch existed show it on, as they render.
  resolveData: async (data) => {
    const props = data.props as CarouselSplitProps;
    if (props.layoutAdvanced === undefined && usesAdvancedLayout(props)) return { props: { ...props, layoutAdvanced: true } as never };
    return { props: props as never };
  },
  render: (props) =>
    props.puck?.isEditing ? <CarouselSplitEditingRender {...props} /> : <CarouselSplitPublishedRender {...props} />,
};

export const CarouselSplit = withHideOn(carouselSplitConfig);
