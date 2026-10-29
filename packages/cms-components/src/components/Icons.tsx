'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import {
  createColorField,
  PB_RESPONSIVE_METADATA,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { IconsProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { createIconPickerField } from './IconPickerField.js';
import { resolveCmsIcon } from './icon-catalog.js';
import { iconColorProps } from '../utils/color-value.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { blockLink, blockLinkTarget, carriedBlockLink } from '../utils/link-href.js';

function IconsBody({
  props,
  tier,
  editing,
}: {
  props: IconsProps;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
  editing: boolean;
}): React.ReactElement {
  const { name, size = 32, color = '#15202b', strokeWidth = 2, align, href, linkTarget, link: storedLink, ...box } =
    props;
  const Icon = resolveCmsIcon(name);
  const alignAttrs = textAlignDataAttrs(align, 'left');
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // R17 (T212): any kind of link; a URL stored before (`href`, `linkTarget`) renders as it always did.
  const link = blockLinkTarget(blockLink(storedLink, href, linkTarget), { assets, ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}) });

  const iconNode = Icon ? (
    <Icon size={size} {...iconColorProps(color)} strokeWidth={strokeWidth} aria-hidden={!link} />
  ) : editing ? (
    <span className="cmsc:text-sm cmsc:text-[#64748b]">Select an icon</span>
  ) : null;

  const content =
    link && Icon ? (
      <a
        href={link.href}
        target={link.target ?? '_self'}
        rel={link.target === '_blank' ? 'noreferrer' : undefined}
        className="cmsc:inline-flex"
        aria-label={name}
      >
        {iconNode}
      </a>
    ) : (
      <span className="cmsc:inline-flex">{iconNode}</span>
    );

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <div
        className={tier ? 'cmsc-pb-text-align' : responsiveTextAlignClass(align, 'left')}
        style={tier ? { textAlign: resolveTextAlignForTier(align, tier, 'left') } : undefined}
        {...alignAttrs}
      >
        {content}
      </div>
    </BoxStyled>
  );
}

const IconsEditingRender: PuckComponent<IconsProps> = (props) => (
  <IconsBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const IconsPublishedRender: PuckComponent<IconsProps> = (props) => (
  <IconsBody props={props} tier={null} editing={false} />
);

const iconsConfig: ComponentConfig<IconsProps> = {
  label: 'Icons',
  fields: {
    name: createIconPickerField('Icon'),
    size: { type: 'number', label: 'Size (px)', min: 12, max: 128, step: 2 },
    color: createColorField({ label: 'Color', inherit: true }),
    strokeWidth: { type: 'number', label: 'Stroke width', min: 1, max: 3, step: 0.25 },
    // R17 (T212): the shared link (the admin gives it the page, product, category and file pickers).
    link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link (optional)' },
    // R17 (T206): per breakpoint.
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    name: 'star',
    size: 32,
    // R17 (T216): a new icon follows the section's text colour.
    color: 'currentColor',
    strokeWidth: 2,
    align: 'left',
    ...DEFAULT_BOX_PROPS,
  },
  // R17 (T212): a URL stored before is carried into `link` when the icon is opened (the render is the same).
  resolveData: ({ props }) => {
    const carried = carriedBlockLink(props);
    return { props: carried ? ({ ...props, ...carried } as unknown as typeof props) : props };
  },
  render: (props) =>
    props.puck?.isEditing ? <IconsEditingRender {...props} /> : <IconsPublishedRender {...props} />,
};

export const Icons = withHideOn(iconsConfig);
