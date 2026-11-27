'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  CORNER_RADIUS_PX,
  createToggleField,
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  withHideOn,
  type BreakpointTier,
  type CornerRadius,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { CtaCardProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import {
  buttonsField,
  DEFAULT_SECTION_BUTTON,
  imageObjectField,
  levelField,
  SIDE_OPTIONS,
  sizeField,
  sizeFieldWithDefault,
  sizePxField,
} from '../fields/section-block-fields.js';
import { createIconPickerField } from './IconPickerField.js';
import { Picture } from './Picture.js';
import { buttonWidthField } from './button-full-width.js';
import { BlockHeading, ButtonRow, hasImage, ItemIcon, plainTextToDoc, RichBody, usesCustom, blockHeadingStyle, blockHeadingStyleFields, isUnusedHeadingMaxWidthPx } from './section-parts.js';
import { tierVars } from './tier-vars.js';
import { singleWeight, textStyleAttrs } from './text-style.js';
import { spaceTokenField, spaceTokenVars } from './space-token.js';
import { LAYOUT_ADVANCED_FIELD, layoutPresetField, presetSpans, TWO_TRACK_PRESETS } from './twelve-columns.js';
import { textMaxWidthAttrs, textMaxWidthField, textMaxWidthPxField, usesCustomTextMaxWidth } from './text-max-width.js';
import { textWeightField } from './typography.js';

/**
 * `cms.CtaCard` — `specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * US3, FR-015.
 *
 * A boxed call to action. The card carries its own colour scheme
 * (`data-cmsb-scheme`: muted, dark or light), so its text, links and buttons
 * take that scheme's colours whatever the section around it uses; `decorative`
 * paints the brand's dark decorative backdrop. Inside: a heading, rich text, an
 * icon list in one or two columns, buttons, and an optional image beside the
 * text on the start or end side (stacked above the text on mobile).
 *
 * R20F (T318), each unset writes nothing: the card's padding per breakpoint
 * (`--cmsc-cta-pad`, which the image inset then measures from), and with an
 * image its width in columns of 12 from the tablet up (`--cmsc-cta-cols-md|lg`,
 * the grid's two tracks, mirrored for an image at the start).
 */

const CARD_SCHEMES = ['muted', 'dark', 'light'] as const;

function pxOf(value: unknown, max: number): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.min(max, Math.max(0, value))}px` : null;
}

/** R19A (T237): the card's corners — a radius token; unset, `default` or unknown: today's 12 px (nothing written). */
function cardRadiusCss(props: CtaCardProps): string | null {
  const value = props.cardRadius;
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(CORNER_RADIUS_PX, value)) {
    return `${CORNER_RADIUS_PX[value as CornerRadius]}px`;
  }
  return null;
}

/**
 * R19A (T237): the space between the image and the card's edges — flush
 * (`none`), or Custom px; unset or `default`: the card's padding. R21G (T334):
 * the Custom px per breakpoint, each variable written only where a value is
 * set (`--cmsc-cta-image-inset`, `-md`, `-lg`; the stylesheet reads the one
 * below where a tier has none). R23 (T440): one number again, for every
 * breakpoint — a value stored per breakpoint reads as its desktop value, else
 * its base (`singleWeight`'s rule).
 */
function imageInsetVars(props: CtaCardProps): Record<string, string> | null {
  if (props.imageInset === 'none') return { '--cmsc-cta-image-inset': '0px' };
  if (props.imageInset !== 'custom') return null;
  const px = pxOf(singleWeight(props.imageInsetPx), 96);
  return px === null ? null : { '--cmsc-cta-image-inset': px };
}

/**
 * R23 (T440): the image's width in columns of 12 from the tablet up — the
 * `layout` preset's (image – text), or with the Advanced switch on (or stored
 * before it existed, with no preset) the raw `imageColumns` per breakpoint.
 */
function imageColumnsOf(props: CtaCardProps): CtaCardProps['imageColumns'] {
  if (usesRawImageColumns(props)) return props.imageColumns;
  return presetSpans(props.layout)?.mediaSpan;
}

function usesRawImageColumns(props: CtaCardProps): boolean {
  if (props.layoutAdvanced === true) return true;
  if (props.layoutAdvanced === false) return false;
  return presetSpans(props.layout) === null && props.imageColumns !== undefined && props.imageColumns !== null;
}

/** R21G (T334): the text's and the list's own size; `inherit` where a breakpoint is left on Default. */
const TEXT_TODAY = { size: 'inherit', lineHeight: 'inherit' };

/** R20F (T318): the two tracks for an image `n` columns of 12 wide, text first unless the image is at the start. */
function imageTracks(columns: number, imageStart: boolean): string | undefined {
  if (typeof columns !== 'number' || !Number.isFinite(columns)) return undefined;
  const image = Math.min(10, Math.max(2, Math.round(columns)));
  const text = 12 - image;
  return imageStart ? `minmax(0, ${image}fr) minmax(0, ${text}fr)` : `minmax(0, ${text}fr) minmax(0, ${image}fr)`;
}

function CtaCardBody({ props, tier }: { props: CtaCardProps; tier: BreakpointTier | null }): ReactNode {
  const scheme = (CARD_SCHEMES as readonly string[]).includes(props.cardScheme ?? '') ? props.cardScheme! : 'muted';
  const list = (props.list ?? []).filter((item) => item && typeof item === 'object' && item.text?.trim());
  const image = props.image;
  const withImage = hasImage(image);
  // R19A (T237): the card's corners and the image's inset, written only when chosen.
  const radius = cardRadiusCss(props);
  const inset = withImage ? imageInsetVars(props) : null;
  // R20F (T318): the padding, and with an image its columns from the tablet up (no phone value: stacked there).
  // R23 (T437, T440): the padding is one spacing step; the columns a layout preset (or the raw ones, Advanced).
  const padding = spaceTokenVars('cmsc-cta-pad', props.cardPadding, tier);
  const imageStart = props.imageSide === 'start';
  const tracks = withImage
    ? Object.fromEntries(
        Object.entries(tierVars<number>('cmsc-cta-cols', imageColumnsOf(props), tier, (n) => imageTracks(n, imageStart))).filter(
          ([name]) => name !== '--cmsc-cta-cols',
        ),
      )
    : {};
  // R22I (T374): the space below the heading, where chosen. R23 (T437): one spacing step.
  const headingSpaceVars = spaceTokenVars('cmsc-cta-heading-space', props.headingSpace, tier);
  const headingSpace = {
    classes: Object.keys(headingSpaceVars).length > 0 ? ['cmsc-pb-cta-card--heading-space'] : [],
    vars: headingSpaceVars,
  };
  const style: Record<string, string> = {
    ...(radius !== null ? { borderRadius: radius } : {}),
    ...(inset ?? {}),
    ...padding,
    ...tracks,
    ...headingSpace.vars,
  };
  // R21G (T334): the text's size per breakpoint, written only when chosen; R23 (T440): the list follows it.
  // R22I (T374): and the text's weight and its measure.
  const bodyText = textStyleAttrs({ size: props.bodySize, sizePx: props.bodySizePx, weight: props.bodyWeight }, tier, TEXT_TODAY);
  const bodyMeasure = textMaxWidthAttrs(props, tier);
  const bodyStyle = { ...(bodyMeasure?.style ?? {}), ...bodyText.style };
  const listText = textStyleAttrs({ size: props.bodySize, sizePx: props.bodySizePx }, tier, TEXT_TODAY);
  const className = [
    'cmsc-pb-cta-card',
    inset !== null ? 'cmsc-pb-cta-card--image-inset' : '',
    Object.keys(padding).length > 0 ? 'cmsc-pb-cta-card--padding' : '',
    Object.keys(tracks).length > 0 ? 'cmsc-pb-cta-card--image-cols' : '',
    ...headingSpace.classes,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={className}
      {...(Object.keys(style).length > 0 ? { style: style as CSSProperties } : {})}
      data-cmsb-scheme={scheme}
      {...(props.decorative === true ? { 'data-decorative': '1' } : {})}
      {...(withImage ? { 'data-image-side': props.imageSide === 'start' ? 'start' : 'end' } : {})}
      /* R21G (T334): with an image, below the text while stacked; stacked up to the desktop. Unset, today's. */
      {...(withImage && props.mobileImagePosition === 'below' ? { 'data-mobile-image': 'below' } : {})}
      {...(withImage && props.sideBySide === 'desktop' ? { 'data-side-by-side': 'desktop' } : {})}
    >
      <div className="cmsc-pb-cta-card__text">
        <BlockHeading
          value={props.heading}
          level={props.headingLevel}
          size={props.headingSize}
          sizePx={props.headingSizePx}
          {...blockHeadingStyle(props)}
          className="cmsc-pb-cta-card__heading"
          tier={tier}
        />
        <RichBody
          value={props.body}
          className={['cmsc-pb-cta-card__body cmsc-pb-rich', ...bodyText.classes, ...(bodyMeasure ? [bodyMeasure.className] : [])].join(' ')}
          {...(Object.keys(bodyStyle).length > 0 ? { style: bodyStyle } : {})}
        />
        {list.length > 0 ? (
          <ul
            className={['cmsc-pb-cta-card__list', ...listText.classes].join(' ')}
            data-columns={props.listColumns === 1 ? '1' : '2'}
            {...(Object.keys(listText.style).length > 0 ? { style: listText.style as CSSProperties } : {})}
          >
            {list.map((item, index) => (
              <li key={index} className="cmsc-pb-cta-card__item">
                {item.icon ? (
                  <span className="cmsc-pb-cta-card__item-icon">
                    <ItemIcon icon={item.icon} size={20} />
                  </span>
                ) : null}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <ButtonRow buttons={props.buttons} tier={tier} fullWidth={props.buttonsFullWidth} className="cmsc-pb-cta-card__actions cmsc-pb-actions" />
      </div>
      {withImage ? (
        <div className="cmsc-pb-cta-card__media">
          <Picture className="cmsc-pb-cta-card__picture" image={{ fit: 'cover', ...image, ratio: image.ratio ?? '4:3' }} />
        </div>
      ) : null}
    </div>
  );
}

const CtaCardEditingRender: PuckComponent<CtaCardProps> = (props) => (
  <CtaCardBody props={props as unknown as CtaCardProps} tier={usePreviewBreakpointTier()} />
);

const CtaCardPublishedRender: PuckComponent<CtaCardProps> = (props) => (
  <CtaCardBody props={props as unknown as CtaCardProps} tier={null} />
);

const CTA_CARD_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeField('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  body: createRichTextDocField({ label: 'Text' }),
  list: {
    type: 'array' as const,
    label: 'List',
    max: 12,
    arrayFields: {
      icon: createIconPickerField('Icon'),
      text: { type: 'text' as const, label: 'Text' },
    },
    defaultItemProps: { icon: 'checkCircle2', text: 'List item' },
    getItemSummary: (item: { text?: string }) => item?.text || 'List item',
  },
  listColumns: {
    type: 'radio' as const,
    label: 'List columns',
    options: [
      { label: '1', value: 1 },
      { label: '2', value: 2 },
    ],
  },
  buttons: buttonsField('Buttons', 3),
  // T168: the buttons at the full width per breakpoint (Responsive tab); unset keeps today's.
  buttonsFullWidth: buttonWidthField('Button width'),
  image: imageObjectField('Image'),
  imageSide: { type: 'select' as const, label: 'Image side (desktop)', options: SIDE_OPTIONS },
  // R23 (T440): the image's width as a layout preset (image – text); the raw columns per breakpoint behind Advanced.
  layout: layoutPresetField('Layout (image – text)', TWO_TRACK_PRESETS),
  layoutAdvanced: LAYOUT_ADVANCED_FIELD,
  // R20F (T318): the image's width from the tablet up, per breakpoint; empty keeps half the card.
  imageColumns: { type: 'number' as const, label: 'Image width (columns of 12)', min: 2, max: 10, step: 1, metadata: PB_RESPONSIVE_METADATA },
  // R21G (T334): the image's place while stacked, and the tier from which image and text sit side by side.
  mobileImagePosition: {
    type: 'select' as const,
    label: 'Image position when stacked',
    options: [
      { label: 'Above the text', value: 'above' },
      { label: 'Below the text', value: 'below' },
    ],
  },
  sideBySide: {
    type: 'select' as const,
    label: 'Side by side from',
    options: [
      { label: 'Tablet (768 px)', value: 'tablet' },
      { label: 'Desktop (1024 px)', value: 'desktop' },
    ],
  },
  // R17 (T219): the card's look after its content.
  cardScheme: {
    type: 'select' as const,
    label: 'Card color scheme',
    options: [
      { label: 'Muted', value: 'muted' },
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' },
    ],
  },
  decorative: createToggleField({ label: 'Decorative backdrop' }),
  // R21G (T334): the text's size per breakpoint (the list follows it); Default keeps today's.
  bodySize: sizeFieldWithDefault('Text size'),
  bodySizePx: sizePxField('Custom text size (px)'),
  // R22I (T374): the text's weight (R23: one value) and its maximum width per breakpoint; empty keeps today's.
  bodyWeight: textWeightField('Text weight'),
  textMaxWidth: textMaxWidthField('Max text width'),
  textMaxWidthPx: textMaxWidthPxField('Custom max text width (px)'),
  // R19A (T237): the card's corners and the image's inset; Default keeps today's.
  cardRadius: {
    type: 'select' as const,
    label: 'Rounded corners',
    options: [
      { label: 'Default', value: 'default' },
      { label: 'None', value: 'none' },
      { label: 'Small', value: 'small' },
      { label: 'Medium', value: 'medium' },
      { label: 'Large', value: 'large' },
    ],
  },
  imageInset: {
    type: 'select' as const,
    label: 'Image inset',
    options: [
      { label: 'Default (the card padding)', value: 'default' },
      { label: 'None (to the card edges)', value: 'none' },
      { label: 'Custom (px)', value: 'custom' },
    ],
  },
  // R23 (T440): one number for every breakpoint.
  imageInsetPx: { type: 'number' as const, label: 'Custom image inset (px)', min: 0, max: 96, step: 1 },
  // R23 (T437): the card's padding and the space below the heading, one spacing step each; Default keeps today's.
  cardPadding: spaceTokenField('Card padding'),
  headingSpace: spaceTokenField('Space below the heading'),
};

/** R17 (T219), R20F, R21G: the image's settings only with an image. */
const IMAGE_ONLY_KEYS = new Set([
  'imageSide',
  'imageInset',
  'imageInsetPx',
  'layout',
  'layoutAdvanced',
  'imageColumns',
  'mobileImagePosition',
  'sideBySide',
]);

const ctaCardConfig: ComponentConfig<{ props: CtaCardProps }> = {
  label: 'Call-to-action card',
  fields: CTA_CARD_FIELDS as unknown as Fields<CtaCardProps>,
  defaultProps: {
    cardScheme: 'muted',
    decorative: false,
    heading: plainTextToInlineRichText('Heading'),
    headingLevel: 'h2',
    headingSize: 'h3',
    body: plainTextToDoc('A short sentence that invites the visitor to act.'),
    list: [],
    listColumns: 2,
    buttons: [DEFAULT_SECTION_BUTTON],
    imageSide: 'end',
  } as CtaCardProps,
  resolveFields: (data, params) => {
    const props = data.props as CtaCardProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? CTA_CARD_FIELDS)) {
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (isUnusedHeadingMaxWidthPx(key, props)) continue;
      // R17 (T219): the image's side only with an image.
      if (IMAGE_ONLY_KEYS.has(key) && !hasImage(props.image)) continue;
      if (key === 'bodySizePx' && !usesCustom(props.bodySize)) continue;
      // R23 (T440): the raw columns with the Advanced switch on.
      if (key === 'imageColumns' && !usesRawImageColumns(props)) continue;
      if (key === 'textMaxWidthPx' && !usesCustomTextMaxWidth(props.textMaxWidth)) continue;
      if (key === 'imageInsetPx' && props.imageInset !== 'custom') continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<CtaCardProps>;
  },
  // R23 (T440): raw columns stored before the Advanced switch existed show it on, as they render.
  resolveData: async (data) => {
    const props = data.props as CtaCardProps;
    if (props.layoutAdvanced === undefined && usesRawImageColumns(props)) return { props: { ...props, layoutAdvanced: true } as never };
    return { props: props as never };
  },
  render: (props) =>
    props.puck?.isEditing ? <CtaCardEditingRender {...props} /> : <CtaCardPublishedRender {...props} />,
};

export const CtaCard = withHideOn(ctaCardConfig);
