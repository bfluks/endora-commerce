'use client';

import type { ComponentType } from 'react';
import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import { DEFAULT_SPACING, withHideOn } from '@endora-commerce/page-builder-core';
import type { SlideProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { SLIDE_CONTENT_SLOT_EDIT_PROPS } from '../editor/slot-edit-props.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';

const SlideRender: PuckComponent<SlideProps> = (props) => {
  const { content: Content, puck, tags, ...box } = props;
  const editing = puck?.isEditing === true;
  const Slot = Content as ComponentType<typeof SLIDE_CONTENT_SLOT_EDIT_PROPS>;

  return (
    <BoxStyled
      {...box}
      className={`cmsc-pb-slide cmsc:h-full cmsc:w-full${editing ? ' cmsc-pb-slide--editing' : ''}`}
      {...(editing ? { previewTier: 'desktop' as const } : {})}
      attributes={itemTagsAttribute(tags)}
    >
      {editing ? (
        <Slot {...SLIDE_CONTENT_SLOT_EDIT_PROPS} />
      ) : (
        <Content />
      )}
    </BoxStyled>
  );
};

const slideConfig: ComponentConfig<SlideProps> = {
  label: 'Slide',
  fields: {
    content: {
      type: 'slot',
      label: 'Content',
      // Row is the layout primitive inside a slide; Column only via Row.
      // A Section stands only at the top level of a page (feature 163, FR-000).
      disallow: ['cms.Column', 'cms.ContentSlider', 'cms.Slide', 'cms.Section', 'cms.SectionGroup'],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
    // Feature 163, T131: tags for the Carousel's filter.
    tags: ITEM_TAGS_FIELD,
  },
  defaultProps: {
    content: [],
    ...DEFAULT_BOX_PROPS,
    margin: DEFAULT_SPACING,
  },
  render: SlideRender,
};

/** Virtual slide wrapper for Content slider — not listed in the component drawer. */
export const Slide = withHideOn(slideConfig);
