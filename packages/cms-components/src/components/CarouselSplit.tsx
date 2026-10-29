'use client';

import { useRef, type ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { plainTextToInlineRichText, withHideOn, type BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { CarouselSplitProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { createRichTextDocField } from '../fields/rich-text-doc-field.js';
import { buttonsField, hoverZoomField, iconFields, SIDE_OPTIONS } from '../fields/section-block-fields.js';
import { useBreakpointVideo } from '../hooks/use-breakpoint-video.js';
import { InlineRich } from './InlineRich.js';
import { MEDIA_TEXT_MEDIA_FIELD, MediaTextMediaFrame } from './MediaText.js';
import { buttonWidthField } from './button-full-width.js';
import { ButtonRow, isEmptyInline, ItemIcon, plainTextToDoc, RichBody } from './section-parts.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';

/**
 * `cms.CarouselSplit` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US4, FR-020: a split slide of a Carousel. Media (an
 * image, or a video with its poster, exactly as `cms.MediaText`'s) on one side;
 * an icon, a title, rich text and up to two buttons on the other. The two
 * stack below the tablet tier, media first; the side applies from it up.
 */

const MAX_BUTTONS = 2;

function CarouselSplitBody({ props, tier }: { props: CarouselSplitProps; tier: BreakpointTier | null }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useBreakpointVideo(ref, '.cmsc-pb-media-text__video video[data-bp][data-autoplay]');
  const hasIcon = Boolean(props.icon || props.iconAssetId);
  return (
    <div
      className={props.hoverZoom === true ? 'cmsc-pb-carousel-split cmsc-hover-zoom' : 'cmsc-pb-carousel-split'}
      data-media-side={props.mediaSide === 'end' ? 'end' : 'start'} ref={ref}
      {...itemTagsAttribute(props.tags)}>
      <div className="cmsc-pb-carousel-split__media">
        <MediaTextMediaFrame media={props.media} />
      </div>
      <div className="cmsc-pb-carousel-split__text">
        {hasIcon ? (
          <span className="cmsc-pb-carousel-split__icon">
            <ItemIcon icon={props.icon} iconAssetId={props.iconAssetId} size={32} />
          </span>
        ) : null}
        {!isEmptyInline(props.title) ? (
          <h3 className="cmsc-pb-carousel-split__title cmsc-pb-block-heading cmsc-t--h4">
            <InlineRich value={props.title as never} />
          </h3>
        ) : null}
        <RichBody value={props.body} className="cmsc-pb-carousel-split__body cmsc-pb-rich" />
        <ButtonRow
          buttons={(props.buttons ?? []).slice(0, MAX_BUTTONS)}
          tier={tier}
          fullWidth={props.buttonsFullWidth}
          className="cmsc-pb-carousel-split__actions cmsc-pb-actions"
        />
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
  mediaSide: { type: 'select' as const, label: 'Media side (tablet and up)', options: SIDE_OPTIONS },
  ...iconFields(),
  title: createInlineRichTextField({ label: 'Title' }),
  body: createRichTextDocField({ label: 'Text' }),
  buttons: buttonsField('Buttons', MAX_BUTTONS),
  // T168: the buttons at the full width per breakpoint (Responsive tab); unset keeps today's.
  buttonsFullWidth: buttonWidthField('Button width'),
  hoverZoom: hoverZoomField(),
  // T131: tags for the Carousel's filter.
  tags: ITEM_TAGS_FIELD,
};

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
  render: (props) =>
    props.puck?.isEditing ? <CarouselSplitEditingRender {...props} /> : <CarouselSplitPublishedRender {...props} />,
};

export const CarouselSplit = withHideOn(carouselSplitConfig);
