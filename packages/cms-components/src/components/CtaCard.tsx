'use client';

import type { ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { createToggleField, plainTextToInlineRichText, withHideOn, type BreakpointTier } from '@endora-commerce/page-builder-core';
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
  sizePxField,
} from '../fields/section-block-fields.js';
import { createIconPickerField } from './IconPickerField.js';
import { Picture } from './Picture.js';
import { buttonWidthField } from './button-full-width.js';
import { BlockHeading, ButtonRow, hasImage, ItemIcon, plainTextToDoc, RichBody, usesCustom, blockHeadingStyle, blockHeadingStyleFields, isUnusedHeadingMaxWidthPx } from './section-parts.js';

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
 */

const CARD_SCHEMES = ['muted', 'dark', 'light'] as const;

function CtaCardBody({ props, tier }: { props: CtaCardProps; tier: BreakpointTier | null }): ReactNode {
  const scheme = (CARD_SCHEMES as readonly string[]).includes(props.cardScheme ?? '') ? props.cardScheme! : 'muted';
  const list = (props.list ?? []).filter((item) => item && typeof item === 'object' && item.text?.trim());
  const image = props.image;
  const withImage = hasImage(image);
  return (
    <div
      className="cmsc-pb-cta-card"
      data-cmsb-scheme={scheme}
      {...(props.decorative === true ? { 'data-decorative': '1' } : {})}
      {...(withImage ? { 'data-image-side': props.imageSide === 'start' ? 'start' : 'end' } : {})}
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
        <RichBody value={props.body} className="cmsc-pb-cta-card__body cmsc-pb-rich" />
        {list.length > 0 ? (
          <ul className="cmsc-pb-cta-card__list" data-columns={props.listColumns === 1 ? '1' : '2'}>
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
};

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
      if (key === 'imageSide' && !hasImage(props.image)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<CtaCardProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <CtaCardEditingRender {...props} /> : <CtaCardPublishedRender {...props} />,
};

export const CtaCard = withHideOn(ctaCardConfig);
