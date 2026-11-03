'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import { createToggleField, PB_DATA_METADATA, PB_RESPONSIVE_METADATA, resolveResponsive, withHideOn, type BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { LogoStripItem, LogoStripProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, useCmsRenderLocalizePath } from './render-context.js';
import { resolveImageUrl } from '../utils/resolve-image-url.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { blockLink, blockLinkTarget, carriedBlockLink } from '../utils/link-href.js';
import { GAP_OPTIONS, gapPxField } from '../fields/section-block-fields.js';
import { numericGapAsCustom, responsiveGapStyle, usesCustom } from './section-parts.js';

type LogoAlign = 'left' | 'center' | 'right';
const JUSTIFY: Record<LogoAlign, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

function logoAlignAt(value: unknown, tier: BreakpointTier): LogoAlign {
  const at = value !== null && typeof value === 'object' ? resolveResponsive<unknown>(value as never, tier, 'center') : value;
  return at === 'left' || at === 'right' ? at : 'center';
}

function normalizeLogoItem(item: LogoStripItem): LogoStripItem {
  const image = item.image;
  if (!image) return item;
  return {
    ...item,
    imageSource: image.imageSource ?? item.imageSource ?? 'url',
    src: image.src ?? item.src ?? '',
    assetId: image.assetId ?? item.assetId ?? '',
  };
}

function syncLogoItemImage(item: LogoStripItem): LogoStripItem {
  const imageSource = item.image?.imageSource ?? item.imageSource ?? 'url';
  const src = item.image?.src ?? item.src ?? '';
  const assetId = item.image?.assetId ?? item.assetId ?? '';
  return {
    ...item,
    image: { imageSource, src, assetId },
    imageSource,
    src,
    assetId,
  };
}

function LogoStripBody({
  props,
  editing,
  tier,
}: {
  props: LogoStripProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const {
    items = [],
    gap = 32,
    gapPx,
    logoMaxHeightPx = 48,
    grayscale = true,
    align = 'center',
    ...box
  } = props;
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  // R17 (T207): the gap, a size or a Custom px per breakpoint; a stored number is today's inline gap.
  const gapStyle = responsiveGapStyle(gap, gapPx, 32, editing ? tier : null);
  // R17 (T206): the alignment per breakpoint; one alignment is today's inline `justify-content`.
  const at = editing && tier ? tier : 'mobile';
  const alignBase = logoAlignAt(align, at);
  const alignMd = editing ? alignBase : logoAlignAt(align, 'tablet');
  const alignLg = editing ? alignBase : logoAlignAt(align, 'desktop');
  const alignTiers = alignMd !== alignBase || alignLg !== alignBase;

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <ul
        className={[
          'cmsc-pb-logo-strip',
          grayscale ? 'cmsc-pb-logo-strip--grayscale' : '',
          gapStyle.className ?? '',
          alignTiers ? 'cmsc-pb-logo-strip--align-tiers' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        {...(alignTiers ? { 'data-align': alignBase, 'data-align-md': alignMd, 'data-align-lg': alignLg } : {})}
        style={{
          ...gapStyle.style,
          ...(alignTiers ? {} : { justifyContent: JUSTIFY[alignBase] }),
        }}
      >
        {items.map((raw, index) => {
          const item = normalizeLogoItem(raw);
          const src = resolveImageUrl(
            {
              imageSource: item.imageSource ?? (item.assetId ? 'library' : 'url'),
              ...(item.src ? { src: item.src } : {}),
              ...(item.assetId ? { assetId: item.assetId } : {}),
            },
            null,
            assets,
            mediaBaseUrl,
          );
          if (!src && !editing) return null;
          const img = (
            <img
              src={src || undefined}
              alt={item.alt || 'Logo'}
              style={{ maxHeight: `${logoMaxHeightPx}px` }}
              className="cmsc-pb-logo-strip__img"
            />
          );
          // R17 (T212): any kind of link; a URL stored before opened a new tab and still does.
          const link = blockLinkTarget(blockLink(item.link, item.href, '_blank'), { assets, ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}), localizePath });
          return (
            <li key={`${item.alt ?? 'logo'}-${index}`}>
              {link ? (
                <a
                  href={link.href}
                  {...(link.target ? { target: link.target } : {})}
                  {...(link.target === '_blank' ? { rel: 'noopener noreferrer' } : {})}
                >
                  {src ? img : editing ? (
                    <span className="cmsc:text-xs cmsc:text-[#94a3b8]">Logo</span>
                  ) : null}
                </a>
              ) : src ? (
                img
              ) : editing ? (
                <span className="cmsc:text-xs cmsc:text-[#94a3b8]">Logo</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </BoxStyled>
  );
}

const LogoStripEditingRender: PuckComponent<LogoStripProps> = (props) => (
  <LogoStripBody props={props} editing tier={usePreviewBreakpointTier()} />
);

const LogoStripPublishedRender: PuckComponent<LogoStripProps> = (props) => (
  <LogoStripBody props={props} editing={false} tier={null} />
);

const logoStripConfig: ComponentConfig<LogoStripProps> = {
  label: 'Logo strip',
  fields: {
    items: {
      type: 'array',
      label: 'Logos',
      getItemSummary: (item, index) => item.alt?.trim() || `Logo ${(index ?? 0) + 1}`,
      arrayFields: {
        // R17 (T214): the library first.
        imageSource: {
          type: 'select',
          label: 'Image source',
          metadata: PB_DATA_METADATA,
          options: [
            { label: 'Asset library', value: 'library' },
            { label: 'URL', value: 'url' },
          ],
        },
        src: { type: 'text', label: 'Image URL', metadata: PB_DATA_METADATA },
        assetId: { type: 'text', label: 'Image', metadata: PB_DATA_METADATA },
        alt: { type: 'text', label: 'Alt text' },
        // R17 (T212): the shared link (the admin gives it the page, product, category and file pickers).
        link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link (optional)' },
      },
      defaultItemProps: {
        imageSource: 'library',
        src: '',
        assetId: '',
        image: { imageSource: 'library', src: '', assetId: '' },
        alt: '',
      },
    },
    logoMaxHeightPx: { type: 'number', label: 'Logo max height (px)', min: 16, max: 120 },
    grayscale: createToggleField({ label: 'Grayscale', defaultValue: true }),
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
    gapPx: { ...gapPxField('Custom gap (px)'), max: 80 },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [
      {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: 'Partner 1',
      },
      {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: 'Partner 2',
      },
      {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: 'Partner 3',
      },
    ],
    gap: 'custom',
    gapPx: 32,
    logoMaxHeightPx: 48,
    grayscale: true,
    align: 'center',
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }, { changed }) => {
    // R17 (T207, T212): a numeric gap reads as Custom, a logo's URL as its link (the render is the same).
    const gap = numericGapAsCustom(props.gap, props.gapPx);
    const stored: LogoStripItem[] = props.items ?? [];
    const carried = stored.map((item): LogoStripItem => {
      const link = carriedBlockLink(item, '_blank');
      return link ? ({ ...item, ...link } as unknown as LogoStripItem) : item;
    });
    const linksCarried = carried.some((item, index) => item !== stored[index]);
    if (!changed.items && !gap && !linksCarried) return { props };
    return {
      props: {
        ...props,
        ...(gap ?? {}),
        items: changed.items ? carried.map(syncLogoItemImage) : carried,
      } as never,
    };
  },
  resolveFields: (data, params) => {
    const fields: Record<string, unknown> = { ...((params?.fields as Record<string, unknown> | undefined) ?? {}) };
    if (!usesCustom(numericGapAsCustom(data.props.gap, data.props.gapPx)?.gap ?? data.props.gap)) delete fields['gapPx'];
    return fields as never;
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <LogoStripEditingRender {...props} />
    ) : (
      <LogoStripPublishedRender {...props} />
    ),
};

export const LogoStrip = withHideOn(logoStripConfig);
