'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  PB_RESPONSIVE_METADATA,
  createToggleField,
  plainTextToInlineRichText,
  withHideOn,
  type BreakpointTier,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { BackgroundPanelHeight, BackgroundPanelProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import {
  buttonsField,
  DEFAULT_SECTION_BUTTON,
  iconFields,
  imageObjectField,
  levelField,
  SIDE_OPTIONS,
  sizeField,
  sizePxField,
} from '../fields/section-block-fields.js';
import { Picture } from './Picture.js';
import { buttonWidthField } from './button-full-width.js';
import { BlockHeading, ButtonRow, hasImage, ItemIcon, plainTextToDoc, responsiveVars, RichBody, usesCustom, blockHeadingStyle, blockHeadingStyleFields, isUnusedHeadingMaxWidthPx } from './section-parts.js';

/**
 * `cms.BackgroundPanel` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US3, FR-014.
 *
 * A full-bleed image with the text in one half. From the tablet tier up the
 * image fills the panel and the text sits in a panel of the scheme's
 * background on the start or end half (`data-text-side`), the panel at least
 * the chosen height. Below it the image and the text stack, the text above or
 * below the image (`data-mobile-text`). The image is art-directed and lazy; a
 * missing image leaves a neutral placeholder layer, so the panel keeps its
 * shape. With `textBoxTransparent` (R19C) the text box paints no background of
 * its own (`data-text-box="transparent"`), so the image shows through it.
 *
 * R20F (T316), each unset writes nothing: below the tablet tier the text over
 * the image (`data-mobile-layout="overlay"`: one grid cell, the image at its
 * own height — a tall mobile art — and the text at its top or bottom by the
 * text position) instead of stacked with it; the text box's margin and
 * padding per breakpoint (`--cmsc-panel-box-m|p`).
 */

const MIN_HEIGHT: Record<BackgroundPanelHeight, string> = { medium: '50vh', tall: '75vh', screen: '100vh' };

function minHeightCss(value: BackgroundPanelHeight): string {
  return MIN_HEIGHT[value] ?? MIN_HEIGHT.tall;
}

function BackgroundPanelBody({ props, tier }: { props: BackgroundPanelProps; tier: BreakpointTier | null }): ReactNode {
  const image = props.image;
  // R23 (T449): the text box keeps its own spacing (R20F's per-breakpoint px margin and padding were removed).
  const style = responsiveVars<BackgroundPanelHeight>('cmsc-panel-min-h', props.minHeight, 'tall', minHeightCss, tier);
  return (
    <div
      className="cmsc-pb-panel"
      data-text-side={props.textSide === 'start' ? 'start' : 'end'}
      data-mobile-text={props.mobileTextPosition === 'bottom' ? 'bottom' : 'top'}
      {...(props.textBoxTransparent === true ? { 'data-text-box': 'transparent' } : {})}
      {...(props.mobileLayout === 'overlay' ? { 'data-mobile-layout': 'overlay' } : {})}
      style={style as CSSProperties}
    >
      <div className="cmsc-pb-panel__media">
        {hasImage(image) ? (
          <Picture className="cmsc-pb-panel__picture" image={{ fit: 'cover', ...image }} />
        ) : (
          <div className="cmsc-pb-panel__placeholder" aria-hidden="true" />
        )}
      </div>
      <div className="cmsc-pb-panel__content">
        {props.icon || props.iconAssetId ? (
          <span className="cmsc-pb-panel__icon">
            <ItemIcon icon={props.icon} iconAssetId={props.iconAssetId} size={32} />
          </span>
        ) : null}
        <BlockHeading
          value={props.heading}
          level={props.headingLevel}
          size={props.headingSize}
          sizePx={props.headingSizePx}
          {...blockHeadingStyle(props)}
          className="cmsc-pb-panel__heading"
          tier={tier}
        />
        <RichBody value={props.body} className="cmsc-pb-panel__body cmsc-pb-rich" />
        <ButtonRow buttons={props.buttons} tier={tier} fullWidth={props.buttonsFullWidth} className="cmsc-pb-panel__actions cmsc-pb-actions" />
      </div>
    </div>
  );
}

const BackgroundPanelEditingRender: PuckComponent<BackgroundPanelProps> = (props) => (
  <BackgroundPanelBody props={props as unknown as BackgroundPanelProps} tier={usePreviewBreakpointTier()} />
);

const BackgroundPanelPublishedRender: PuckComponent<BackgroundPanelProps> = (props) => (
  <BackgroundPanelBody props={props as unknown as BackgroundPanelProps} tier={null} />
);

const TEXT_BOX_TRANSPARENT_FIELD = createToggleField({ label: 'Transparent text box' });

const BACKGROUND_PANEL_FIELDS = {
  image: imageObjectField('Image'),
  ...iconFields(),
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeField('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  body: createRichTextDocField({ label: 'Text' }),
  buttons: buttonsField('Buttons', 3),
  // R17 (T219): where the text sits, after the content.
  textSide: { type: 'select' as const, label: 'Text side (desktop)', options: SIDE_OPTIONS },
  mobileTextPosition: {
    type: 'select' as const,
    label: 'Text on mobile',
    options: [
      { label: 'Above the image', value: 'top' },
      { label: 'Below the image', value: 'bottom' },
    ],
  },
  // R20F (T316): on phones, the text over the image instead of stacked with it.
  mobileLayout: {
    type: 'select' as const,
    label: 'Layout on mobile',
    options: [
      { label: 'Image and text stacked', value: 'stack' },
      { label: 'Text over the image', value: 'overlay' },
    ],
  },
  // R19C (T264): the text box without the scheme's background, so the image shows through; off by default.
  textBoxTransparent: TEXT_BOX_TRANSPARENT_FIELD,
  // T168: the buttons at the full width per breakpoint (Responsive tab); unset keeps today's.
  buttonsFullWidth: buttonWidthField('Button width'),
  minHeight: {
    type: 'select' as const,
    label: 'Minimum height',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Half the screen', value: 'medium' },
      { label: 'Three quarters of the screen', value: 'tall' },
      { label: 'Full screen', value: 'screen' },
    ],
  },
};

const backgroundPanelConfig: ComponentConfig<{ props: BackgroundPanelProps }> = {
  label: 'Background image panel',
  fields: BACKGROUND_PANEL_FIELDS as unknown as Fields<BackgroundPanelProps>,
  // Edge to edge is the enclosing `cms.Section`'s width (`bleed` or `full`), not the panel's own.
  defaultProps: {
    image: { imageSource: 'library', alt: '' },
    textSide: 'end',
    mobileTextPosition: 'top',
    heading: plainTextToInlineRichText('Heading'),
    headingLevel: 'h2',
    headingSize: 'h3',
    body: plainTextToDoc('Describe what this section is about in a sentence or two.'),
    buttons: [DEFAULT_SECTION_BUTTON],
    minHeight: 'tall',
  } as BackgroundPanelProps,
  resolveFields: (data, params) => {
    const props = data.props as BackgroundPanelProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? BACKGROUND_PANEL_FIELDS)) {
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (isUnusedHeadingMaxWidthPx(key, props)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<BackgroundPanelProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <BackgroundPanelEditingRender {...props} /> : <BackgroundPanelPublishedRender {...props} />,
};

export const BackgroundPanel = withHideOn(backgroundPanelConfig);
