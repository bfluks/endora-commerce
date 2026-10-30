'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  resolveResponsive,
  withHideOn,
  type BreakpointTier,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { StatementProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import {
  alignField,
  imageObjectField,
  levelField,
  revealField,
  sizeField,
  sizeFieldWithDefault,
  sizePxField,
} from '../fields/section-block-fields.js';
import { useReveal } from '../hooks/use-reveal.js';
import { countInlineRichWords } from './InlineRich.js';
import { Picture } from './Picture.js';
import { BlockHeading, blockHeadingStyle, blockHeadingStyleFields, hasImage, RichBody, usesCustom } from './section-parts.js';
import { textMaxWidthAttrs, textMaxWidthFields, usesCustomTextMaxWidth } from './text-max-width.js';
import { customLeadingAttrs, lineHeightField, sizeUsesCustom, textStyleAttrs } from './text-style.js';
import { textWeightField } from './typography.js';

/** Today's supporting text (`.cmsc-pb-statement__body`): 18 px at 1.6 (R19A). */
const BODY_TODAY = { size: '18px', lineHeight: '1.6' };

/** R19A (T231): the minimum heights of a statement over an image; `default` is today's 60vh. */
const MIN_HEIGHT_CSS: Record<string, string> = { default: '60vh', auto: 'auto', half: '50vh', tall: '75vh', screen: '100vh' };
const DEFAULT_CUSTOM_MIN_HEIGHT_PX = 480;

function minHeightCss(props: StatementProps, tier: BreakpointTier): string {
  const value = resolveResponsive<string>(props.minHeight as never, tier, 'default');
  if (value === 'custom') {
    const px = resolveResponsive<number>(props.minHeightPx, tier, DEFAULT_CUSTOM_MIN_HEIGHT_PX);
    return `${typeof px === 'number' && Number.isFinite(px) ? Math.max(0, px) : DEFAULT_CUSTOM_MIN_HEIGHT_PX}px`;
  }
  return MIN_HEIGHT_CSS[value] ?? MIN_HEIGHT_CSS['default']!;
}

/**
 * `cms.Statement` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US3, FR-016.
 *
 * A large heading whose continuation an editor marks with the `muted` emphasis
 * (research R-10), with supporting text rendered muted. With a background
 * image it is full bleed: the image fills the block — spanning the viewport
 * is the enclosing `cms.Section`'s width (`bleed`) — a shade keeps the text legible, and the text
 * sits at the bottom or in the centre (`data-text-position`). The image is
 * lazy; the block reserves a minimum height, so nothing shifts when it loads.
 *
 * `reveal` (US10, research R-21) applies to the heading and the body: a
 * fade-and-rise marks both as reveal targets, a word reveal splits both into
 * one stagger of words. The server HTML holds the full text either way; the
 * pending state is the client's (`useReveal`), never in the editor canvas.
 */

function StatementBody({ props, tier }: { props: StatementProps; tier: BreakpointTier | null }): ReactNode {
  const image = props.background?.image;
  const bleed = hasImage(image);
  // R17 (T206): the alignment per breakpoint; one alignment is today's `data-align`.
  const alignAt = (at: BreakpointTier): 'center' | 'start' =>
    resolveResponsive<unknown>(props.align as never, at, 'start') === 'center' ? 'center' : 'start';
  const align = alignAt(tier ?? 'mobile');
  const alignMd = tier === null ? alignAt('tablet') : align;
  const alignLg = tier === null ? alignAt('desktop') : align;
  const alignTiers = alignMd !== align || alignLg !== align ? { 'data-align-md': alignMd, 'data-align-lg': alignLg } : {};
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef, props.reveal, { disabled: tier !== null });
  const effect = props.reveal?.effect;
  const target = effect === 'fade-up' ? ' cmsc-reveal-target' : '';
  const words = effect === 'words';
  // T134: the heading and the body held to the chosen measure (centred with a centred statement).
  const measure = textMaxWidthAttrs(props, tier);
  // R19A (T231): over an image, the minimum height per breakpoint, written only when chosen.
  const minHeight: Record<string, string> = {};
  if (bleed && props.minHeight !== undefined) {
    if (tier !== null) minHeight['--cmsc-statement-min-h'] = minHeightCss(props, tier);
    else {
      minHeight['--cmsc-statement-min-h'] = minHeightCss(props, 'mobile');
      minHeight['--cmsc-statement-min-h-md'] = minHeightCss(props, 'tablet');
      minHeight['--cmsc-statement-min-h-lg'] = minHeightCss(props, 'desktop');
    }
  }
  // R19A (T231): the heading's line height; the supporting text's size, weight and line height.
  // R23 (T435): a line height only with a Custom px size, one weight, no colour of its own.
  const headingLeading = customLeadingAttrs(props.headingSize, props.headingLineHeight, tier, 'inherit');
  const bodyText = textStyleAttrs(
    { size: props.bodySize, sizePx: props.bodySizePx, weight: props.bodyWeight, lineHeight: props.bodyLineHeight },
    tier,
    BODY_TODAY,
  );
  const headingStyle = { ...(measure?.style ?? {}), ...headingLeading.style };
  const bodyStyle = { ...(measure?.style ?? {}), ...bodyText.style };
  return (
    <div
      ref={rootRef}
      className={['cmsc-pb-statement', bleed ? 'cmsc-pb-statement--bleed' : ''].filter(Boolean).join(' ')}
      data-align={align}
      {...alignTiers}
      {...(bleed ? { 'data-text-position': props.background?.textPosition === 'center' ? 'center' : 'bottom' } : {})}
      {...(Object.keys(minHeight).length > 0 ? { style: minHeight as CSSProperties } : {})}
    >
      {bleed ? (
        <div className="cmsc-pb-statement__media" aria-hidden="true">
          <Picture className="cmsc-pb-statement__picture" image={{ fit: 'cover', ...image, alt: image.alt ?? '' }} />
        </div>
      ) : null}
      <div className="cmsc-pb-statement__content">
        <BlockHeading
          {...(Object.keys(headingStyle).length > 0 ? { style: headingStyle } : {})}
          value={props.heading}
          level={props.headingLevel}
          size={props.headingSize}
          sizePx={props.headingSizePx}
          {...blockHeadingStyle(props)}
          className={[`cmsc-pb-statement__heading${target}${measure ? ` ${measure.className}` : ''}`, ...headingLeading.classes].join(' ')}
          tier={tier}
          {...(words ? { wordStart: 0 } : {})}
        />
        <RichBody
          value={props.body}
          className={[`cmsc-pb-statement__body cmsc-pb-rich${target}${measure ? ` ${measure.className}` : ''}`, ...bodyText.classes].join(' ')}
          {...(Object.keys(bodyStyle).length > 0 ? { style: bodyStyle } : {})}
          {...(words ? { wordStart: countInlineRichWords(props.heading as never) } : {})}
        />
      </div>
    </div>
  );
}

const StatementEditingRender: PuckComponent<StatementProps> = (props) => (
  <StatementBody props={props as unknown as StatementProps} tier={usePreviewBreakpointTier()} />
);

const StatementPublishedRender: PuckComponent<StatementProps> = (props) => (
  <StatementBody props={props as unknown as StatementProps} tier={null} />
);

const STATEMENT_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeField('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151: the heading's weight; its measure is the block's own `textMaxWidth`.
  ...blockHeadingStyleFields({ measure: false }),
  // R19A (T231): the heading's line height.
  headingLineHeight: lineHeightField('Heading line height'),
  body: createRichTextDocField({ label: 'Supporting text' }),
  // R19A (T231): the supporting text's size (Default: today's 18 px), weight and line height.
  bodySize: sizeFieldWithDefault('Supporting text size'),
  bodySizePx: sizePxField('Custom supporting text size (px)'),
  bodyWeight: textWeightField('Supporting text weight'),
  bodyLineHeight: lineHeightField('Supporting text line height'),
  // R17 (T206): per breakpoint, worded Left / Center.
  align: alignField('Align', [
    { label: 'Left', value: 'start' },
    { label: 'Center', value: 'center' },
  ]),
  background: {
    type: 'object' as const,
    label: 'Background image',
    objectFields: {
      image: imageObjectField('Image'),
      textPosition: {
        type: 'select' as const,
        label: 'Text position',
        options: [
          { label: 'Bottom', value: 'bottom' },
          { label: 'Center', value: 'center' },
        ],
      },
    },
  },
  // R19A (T231): over a background image, a minimum height per breakpoint; Default is today's 60vh.
  minHeight: {
    type: 'select' as const,
    label: 'Minimum height',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Default', value: 'default' },
      { label: 'Auto', value: 'auto' },
      { label: 'Half the screen', value: 'half' },
      { label: 'Three quarters of the screen', value: 'tall' },
      { label: 'Full screen', value: 'screen' },
      { label: 'Custom (px)', value: 'custom' },
    ],
  },
  minHeightPx: { type: 'number' as const, label: 'Custom minimum height (px)', min: 0, max: 2000, step: 1, metadata: PB_RESPONSIVE_METADATA },
  reveal: revealField(),
  ...textMaxWidthFields(),
};

const statementConfig: ComponentConfig<{ props: StatementProps }> = {
  label: 'Statement',
  fields: STATEMENT_FIELDS as unknown as Fields<StatementProps>,
  defaultProps: {
    heading: plainTextToInlineRichText('A short statement about what you do.'),
    headingLevel: 'h2',
    headingSize: 'h3',
    align: 'start',
  } as StatementProps,
  resolveFields: (data, params) => {
    const props = data.props as StatementProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? STATEMENT_FIELDS)) {
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (key === 'textMaxWidthPx' && !usesCustomTextMaxWidth(props.textMaxWidth)) continue;
      if (key === 'bodySizePx' && !usesCustom(props.bodySize)) continue;
      // R23 (T435): a line height with a Custom px size only.
      if (key === 'headingLineHeight' && !sizeUsesCustom(props.headingSize)) continue;
      if (key === 'bodyLineHeight' && !sizeUsesCustom(props.bodySize)) continue;
      // R19A (T231): the minimum height applies over a background image only.
      if ((key === 'minHeight' || key === 'minHeightPx') && !hasImage(props.background?.image)) continue;
      if (key === 'minHeightPx' && !usesCustom(props.minHeight)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<StatementProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <StatementEditingRender {...props} /> : <StatementPublishedRender {...props} />,
};

export const Statement = withHideOn(statementConfig);
