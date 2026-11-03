'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import {
  createColorField,
  createToggleField,
  isSafeLinkUrl,
  PB_RESPONSIVE_METADATA,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { SocialNetwork, SocialProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import {
  SOCIAL_BRAND_COLORS,
  SOCIAL_NETWORK_ICONS,
  SOCIAL_NETWORK_LABELS,
  socialItemSummary,
} from './social-networks.js';
import { iconColorProps } from '../utils/color-value.js';
import { GAP_OPTIONS, gapPxField } from '../fields/section-block-fields.js';
import { numericGapAsCustom, responsiveGapStyle, usesCustom } from './section-parts.js';

/**
 * R18 (T221): a profile URL passes the shared safe-URL rule; an unsafe one is
 * treated as a missing one (the block's `#` placeholder).
 */
function profileHref(url: string | undefined): string {
  const href = url?.trim() ?? '';
  return href && isSafeLinkUrl(href) ? href : '#';
}

function SocialBody({
  props,
  tier,
  editing,
}: {
  props: SocialProps;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
  editing: boolean;
}): React.ReactElement {
  const {
    items = [],
    layout = 'icons-with-labels',
    size = 22,
    gap = 12,
    gapPx,
    color = '#15202b',
    useBrandColors = false,
    align,
    ...box
  } = props;
  const alignAttrs = textAlignDataAttrs(align, 'left');

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          {editing ? 'Add social links in the Items tab.' : null}
        </p>
      </BoxStyled>
    );
  }

  // R17 (T207): a size or a Custom px per breakpoint; a stored number is today's inline gap.
  const gapStyle = responsiveGapStyle(gap, gapPx, 12, editing ? tier : null);
  const listClass = ['cmsc-pb-social', `cmsc-pb-social--${layout}`, ...(gapStyle.className ? [gapStyle.className] : [])].join(' ');

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <div
        className={tier ? 'cmsc-pb-text-align' : responsiveTextAlignClass(align, 'left')}
        style={tier ? { textAlign: resolveTextAlignForTier(align, tier, 'left') } : undefined}
        {...alignAttrs}
      >
        <ul className={listClass} style={gapStyle.style}>
          {items.map((item, index) => {
            const network = (item.network in SOCIAL_NETWORK_ICONS
              ? item.network
              : 'website') as SocialNetwork;
            const Icon = SOCIAL_NETWORK_ICONS[network];
            const label = item.label?.trim() || SOCIAL_NETWORK_LABELS[network];
            const iconColor = useBrandColors ? SOCIAL_BRAND_COLORS[network] : color;
            const showLabel = layout !== 'icons-only';
            return (
              <li key={`${network}-${index}`}>
                <a
                  href={profileHref(item.url)}
                  className="cmsc-pb-social__link"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                >
                  <Icon size={size} {...iconColorProps(iconColor)} aria-hidden />
                  {showLabel ? <span className="cmsc-pb-social__label">{label}</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </BoxStyled>
  );
}

const SocialEditingRender: PuckComponent<SocialProps> = (props) => (
  <SocialBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const SocialPublishedRender: PuckComponent<SocialProps> = (props) => (
  <SocialBody props={props} tier={null} editing={false} />
);

const socialConfig: ComponentConfig<SocialProps> = {
  label: 'Social',
  fields: {
    items: {
      type: 'array',
      label: 'Links',
      getItemSummary: (item, index) => socialItemSummary(item, index),
      arrayFields: {
        network: {
          type: 'select',
          label: 'Network',
          options: [
            { label: 'Facebook', value: 'facebook' },
            { label: 'X', value: 'x' },
            { label: 'Instagram', value: 'instagram' },
            { label: 'LinkedIn', value: 'linkedin' },
            { label: 'YouTube', value: 'youtube' },
            { label: 'TikTok', value: 'tiktok' },
            { label: 'Website', value: 'website' },
            { label: 'Email', value: 'email' },
          ],
        },
        label: { type: 'text', label: 'Label (optional)' },
        url: { type: 'text', label: 'URL' },
      },
      defaultItemProps: {
        network: 'linkedin',
        label: '',
        url: '',
      },
    },
    layout: {
      type: 'select',
      label: 'Layout',
      options: [
        { label: 'Icons only', value: 'icons-only' },
        { label: 'Icons with labels', value: 'icons-with-labels' },
        { label: 'Vertical list', value: 'vertical-list' },
        { label: 'Pills', value: 'pills' },
      ],
    },
    size: { type: 'number', label: 'Icon size (px)', min: 14, max: 48 },
    // R17 (T219): the networks' own colours first; the icon colour only while they are off.
    useBrandColors: createToggleField({ label: 'Use brand colors' }),
    color: createColorField({ label: 'Icon color', inherit: true }),
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
    // R17 (T207): the gap as every other block's — a size or a Custom px, per breakpoint.
    gap: { type: 'select', label: 'Gap', metadata: PB_RESPONSIVE_METADATA, options: GAP_OPTIONS },
    gapPx: { ...gapPxField('Custom gap (px)'), max: 48 },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [
      { network: 'linkedin', label: '', url: 'https://www.linkedin.com/' },
      { network: 'facebook', label: '', url: 'https://www.facebook.com/' },
    ],
    layout: 'icons-with-labels',
    size: 22,
    gap: 'custom',
    gapPx: 12,
    // R17 (T216): a new list follows the section's text colour.
    color: 'currentColor',
    useBrandColors: true,
    align: 'left',
    ...DEFAULT_BOX_PROPS,
  },
  resolveFields: (data, params) => {
    const props = data.props as SocialProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? {})) {
      if (key === 'color' && props.useBrandColors === true) continue;
      if (key === 'gapPx' && !usesCustom(numericGapAsCustom(props.gap, props.gapPx)?.gap ?? props.gap)) continue;
      fields[key] = field;
    }
    return fields as never;
  },
  // R17 (T207): a gap stored as a number reads as Custom with that px (the render is the same).
  resolveData: ({ props }) => {
    const carried = numericGapAsCustom(props.gap, props.gapPx);
    return { props: carried ? { ...props, ...carried } : props };
  },
  render: (props) =>
    props.puck?.isEditing ? <SocialEditingRender {...props} /> : <SocialPublishedRender {...props} />,
};

export const Social = withHideOn(socialConfig);
