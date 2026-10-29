'use client';

import { useRef, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { plainTextToInlineRichText, resolveResponsive, withHideOn, type BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { StatementProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { alignField, imageObjectField, levelField, revealField, sizeField, sizePxField } from '../fields/section-block-fields.js';
import { useReveal } from '../hooks/use-reveal.js';
import { countInlineRichWords } from './InlineRich.js';
import { Picture } from './Picture.js';
import { BlockHeading, blockHeadingStyle, blockHeadingStyleFields, hasImage, RichBody, usesCustom } from './section-parts.js';
import { textMaxWidthAttrs, textMaxWidthFields, usesCustomTextMaxWidth } from './text-max-width.js';

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
  return (
    <div
      ref={rootRef}
      className={['cmsc-pb-statement', bleed ? 'cmsc-pb-statement--bleed' : ''].filter(Boolean).join(' ')}
      data-align={align}
      {...alignTiers}
      {...(bleed ? { 'data-text-position': props.background?.textPosition === 'center' ? 'center' : 'bottom' } : {})}
    >
      {bleed ? (
        <div className="cmsc-pb-statement__media" aria-hidden="true">
          <Picture className="cmsc-pb-statement__picture" image={{ fit: 'cover', ...image, alt: image.alt ?? '' }} />
        </div>
      ) : null}
      <div className="cmsc-pb-statement__content">
        <BlockHeading
          {...(measure ? { style: measure.style } : {})}
          value={props.heading}
          level={props.headingLevel}
          size={props.headingSize}
          sizePx={props.headingSizePx}
          {...blockHeadingStyle(props)}
          className={`cmsc-pb-statement__heading${target}${measure ? ` ${measure.className}` : ''}`}
          tier={tier}
          {...(words ? { wordStart: 0 } : {})}
        />
        <RichBody
          value={props.body}
          className={`cmsc-pb-statement__body cmsc-pb-rich${target}${measure ? ` ${measure.className}` : ''}`}
          {...(measure ? { style: measure.style } : {})}
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
  body: createRichTextDocField({ label: 'Supporting text' }),
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
      fields[key] = field;
    }
    return fields as unknown as Fields<StatementProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <StatementEditingRender {...props} /> : <StatementPublishedRender {...props} />,
};

export const Statement = withHideOn(statementConfig);
