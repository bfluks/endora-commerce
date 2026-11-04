'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { withHideOn, type BreakpointTier, createToggleField } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { LinkListItem, LinkListProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { DEFAULT_SECTION_BUTTON, levelField, sizeField, sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { lineHeightField, sizeUsesCustom, textStyleAttrs } from './text-style.js';
import { textWeightField } from './typography.js';

/** Today's row title (`.cmsc-pb-link-list__title`): the inherited size at weight 600 (R19A). */
const TITLE_TODAY = { size: 'inherit', weight: '600', lineHeight: 'inherit' };
import { BUTTON_SPEC_OBJECT_FIELDS, specAtTier } from './Button.js';
import { ButtonView } from './ButtonView.js';
import { BlockHeading, usesCustom, blockHeadingStyle, blockHeadingStyleFields, isUnusedHeadingMaxWidthPx } from './section-parts.js';

/**
 * `cms.LinkList` — `specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * US6, FR-028.
 *
 * Rows of a title, an optional description and a button that links anywhere
 * (a page, a product, a category, a file, an anchor or any URL), for example
 * open positions that each point to an external posting. An optional heading
 * sits above, and a divider can separate the rows. A row without a title is
 * not rendered.
 */

/** Most rows one list holds (contracts/blocks.md). */
export const LINK_LIST_MAX_ITEMS = 50;

function LinkListBody({ props, tier }: { props: LinkListProps; tier: BreakpointTier | null }): ReactNode {
  const items = (props.items ?? []).filter(
    (item): item is LinkListItem => !!item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim() !== '',
  );
  // R19A (T236): the row titles' size and weight, written only when chosen.
  // R22I (T379): and their line height per breakpoint.
  const title = textStyleAttrs(
    { size: props.titleSize, sizePx: props.titleSizePx, weight: props.titleWeight, lineHeight: props.titleLineHeight },
    tier,
    TITLE_TODAY,
  );
  const titleAttrs = {
    className: ['cmsc-pb-link-list__title', ...title.classes].join(' '),
    ...(Object.keys(title.style).length > 0 ? { style: title.style as CSSProperties } : {}),
  };
  return (
    <div
      className={[
        'cmsc-pb-link-list',
        props.divider === false ? '' : 'cmsc-pb-link-list--divided',
        // R20F (T320): a rule under the last row too, only with the rules between rows on.
        props.divider !== false && props.dividerAfterLast === true ? 'cmsc-pb-link-list--divided-end' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <BlockHeading
        value={props.heading}
        level={props.headingLevel}
        size={props.headingSize}
        sizePx={props.headingSizePx}
        {...blockHeadingStyle(props)}
        className="cmsc-pb-link-list__heading"
        tier={tier}
      />
      {items.length > 0 ? (
        <ul className="cmsc-pb-link-list__items">
          {items.map((item, index) => {
            const description = item.description?.trim() ?? '';
            const button = item.button && item.button.label?.trim() ? item.button : null;
            return (
              <li key={index} className="cmsc-pb-link-list__item">
                <div className="cmsc-pb-link-list__text">
                  <p {...titleAttrs}>{item.title}</p>
                  {description ? <p className="cmsc-pb-link-list__description">{description}</p> : null}
                </div>
                {button ? (
                  <div className="cmsc-pb-link-list__action">
                    <ButtonView button={tier !== null ? specAtTier(button, tier) : button} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

const LinkListEditingRender: PuckComponent<LinkListProps> = (props) => (
  <LinkListBody props={props as unknown as LinkListProps} tier={usePreviewBreakpointTier()} />
);

const LinkListPublishedRender: PuckComponent<LinkListProps> = (props) => (
  <LinkListBody props={props as unknown as LinkListProps} tier={null} />
);

const DEFAULT_ROW_BUTTON = { ...DEFAULT_SECTION_BUTTON, label: 'View', fill: 'outline' as const };

const LINK_LIST_FIELDS = {
  heading: createInlineRichTextField({ label: 'Heading' }),
  headingLevel: levelField('Heading level'),
  headingSize: sizeField('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  items: {
    type: 'array' as const,
    label: 'Rows',
    min: 1,
    max: LINK_LIST_MAX_ITEMS,
    arrayFields: {
      title: { type: 'text' as const, label: 'Title' },
      description: { type: 'textarea' as const, label: 'Description' },
      button: { type: 'object' as const, label: 'Button', objectFields: BUTTON_SPEC_OBJECT_FIELDS },
    },
    defaultItemProps: { title: 'Row title', description: '', button: DEFAULT_ROW_BUTTON },
    getItemSummary: (item: { title?: string }) => item?.title || 'Row',
  },
  // R19A (T236): the row titles' size per breakpoint and weight; Default keeps today's.
  titleSize: sizeFieldWithDefault('Row title size'),
  titleSizePx: sizePxField('Custom row title size (px)'),
  // R23 (T435): one weight; the line height with a Custom px size only.
  titleWeight: textWeightField('Row title weight'),
  // R22I (T379): the row titles' line height per breakpoint; empty keeps today's.
  titleLineHeight: lineHeightField('Row title line height'),
  divider: createToggleField({ label: 'Divider between rows', defaultValue: true }),
  // R20F (T320): a rule under the last row too; off by default.
  dividerAfterLast: createToggleField({ label: 'Divider after the last row' }),
};

const linkListConfig: ComponentConfig<{ props: LinkListProps }> = {
  label: 'Link list',
  fields: LINK_LIST_FIELDS as unknown as Fields<LinkListProps>,
  defaultProps: {
    headingLevel: 'h2',
    headingSize: 'h3',
    items: [
      { title: 'First row', description: 'A short description of where the button leads.', button: DEFAULT_ROW_BUTTON },
      { title: 'Second row', description: '', button: DEFAULT_ROW_BUTTON },
    ],
    divider: true,
  } as LinkListProps,
  resolveFields: (data, params) => {
    const props = data.props as LinkListProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? LINK_LIST_FIELDS)) {
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (key === 'titleSizePx' && !usesCustom(props.titleSize)) continue;
      if (key === 'titleLineHeight' && !sizeUsesCustom(props.titleSize)) continue;
      if (key === 'dividerAfterLast' && props.divider === false) continue;
      if (isUnusedHeadingMaxWidthPx(key, props)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<LinkListProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <LinkListEditingRender {...props} /> : <LinkListPublishedRender {...props} />,
};

export const LinkList = withHideOn(linkListConfig);
