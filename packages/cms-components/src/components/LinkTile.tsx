'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  createColorField,
  createResponsiveColorField,
  isAspectToken,
  isResponsiveProp,
  normalizeResponsive,
  PB_RESPONSIVE_METADATA,
  plainTextToInlineRichText,
  withHideOn,
  type BreakpointTier,
  type ResponsiveImage,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { LinkTileProps } from '../schema/component-types.js';
import { createInlineRichTextField } from '../fields/inline-rich-text-field.js';
import { hoverZoomField, imageObjectField, sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import { CORNER_RADIUS_FIELD } from '../fields/shared-fields.js';
import { DEFAULT_MEDIA_CORNER_RADIUS, mediaRadiusVars } from '../utils/media-radius.js';
import { colorValueToCss } from '../utils/color-value.js';
import { resolveLinkHref } from '../utils/link-href.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { InlineRich } from './InlineRich.js';
import { Picture } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { hasImage, isEmptyInline, usesCustom, type TextSize } from './section-parts.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';
import { ItemText, itemFontField } from './item-text.js';
import { textWeightField } from './typography.js';

/**
 * `cms.LinkTile` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US4, FR-020: an image, a title and a "more" label, the
 * whole tile one link to wherever its `LinkValue` points (a page, a product, a
 * category, a file, a section of the page or a URL). Its accessible name is
 * its content: the image's alternative text, the title and the label. A link
 * that resolves to nothing renders the same tile with no link.
 *
 * R5: the image ratio is a value per breakpoint (T130, Responsive tab) — the
 * frame and its empty placeholder read `--pb-ratio(-md|-lg)` — and `tags`
 * feed the Carousel's filter (T131).
 *
 * R6 (T140): the image frame's corners are an option (`mediaCornerRadius`,
 * today's 8 px by default), and inside a colour scheme the frame's light
 * backdrop gives way to the scheme's (see the stylesheet).
 *
 * R7 (T144): the title and the label each take a size per breakpoint (a type
 * token or Custom px, Responsive tab) and a font role; the label is a text
 * link with an arrow (today), a button look or not shown. A button look is a
 * `span` styled as the primary button: the tile stays the one link, with no
 * control nested in it.
 *
 * R12 (T178): the title and the text-link label each take a resting colour
 * (a brand colour token or a hex), so a hover colour (T172) has something to
 * change from. Unset, the tile renders exactly as before.
 *
 * R13 (T181): each resting colour is a value per breakpoint (Responsive tab),
 * so a tile can rest light on touch widths and darker on desktop. A single
 * stored colour renders as in T178; a tier with a colour of its own writes
 * `--pb-title-color-md` / `-lg` (and the label's) with a class that applies
 * it from that breakpoint up, and a tier with none keeps the tile's own look
 * (a value without `base`, T170). The editor shows the previewed tier.
 *
 * R14 (T188): the title's and the label's weight are values per breakpoint
 * too (Responsive tab), written by the shared item text (`ItemText`): a
 * single stored weight renders as in T151, weights that differ go on the
 * text's span per tier, today's weight where a tier has none.
 */

const DEFAULT_RATIO = '4:3';

export const TILE_RATIO_OPTIONS = [
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '16:9', value: '16:9' },
];

/** The ratio per breakpoint, each tier a known `w:h` (else the default), each inheriting the one below. */
function tileRatio(value: LinkTileProps['ratio']): ResponsiveProp<string> {
  const responsive = normalizeResponsive<string>(value as string | ResponsiveProp<string> | undefined, DEFAULT_RATIO);
  const valid = (entry: string | undefined): string | undefined =>
    typeof entry === 'string' && isAspectToken(entry) ? entry : undefined;
  const base = valid(responsive.base) ?? DEFAULT_RATIO;
  const tablet = responsive.tablet === undefined ? base : (valid(responsive.tablet) ?? DEFAULT_RATIO);
  const desktop = responsive.desktop === undefined ? tablet : (valid(responsive.desktop) ?? DEFAULT_RATIO);
  return { base, tablet, desktop };
}

/** `--pb-ratio(-md|-lg)` for the empty frame, as `Picture` writes them for the image. */
function ratioVars(ratio: ResponsiveProp<string>): CSSProperties {
  const css = (token: string | undefined) => (token ?? DEFAULT_RATIO).replace(':', ' / ');
  return {
    ['--pb-ratio' as string]: css(ratio.base),
    ['--pb-ratio-md' as string]: css(ratio.tablet),
    ['--pb-ratio-lg' as string]: css(ratio.desktop),
  } as CSSProperties;
}

type Sized = TextSize | ResponsiveProp<TextSize> | undefined;

type RestingColor = string | ResponsiveProp<string> | undefined;

/** T181: a resting colour as CSS per tier — `base` from the narrowest width, `md`/`lg` from 768/1024 px up. */
interface TierColors {
  base?: string;
  md?: string;
  lg?: string;
}

/**
 * T181: the CSS of each tier with a valid colour of its own (a hex or a known
 * token). A single colour is the base. While editing, the previewed tier's
 * colour — its own, else the nearest one below — is the base.
 */
function restingColors(value: RestingColor, tier: BreakpointTier | null): TierColors {
  if (typeof value === 'string') {
    const css = colorValueToCss(value);
    return css ? { base: css } : {};
  }
  if (!isResponsiveProp<string>(value)) return {};
  const base = colorValueToCss(value.base);
  const md = colorValueToCss(value.tablet);
  const lg = colorValueToCss(value.desktop);
  if (tier !== null) {
    const shown = tier === 'desktop' ? (lg ?? md ?? base) : tier === 'tablet' ? (md ?? base) : base;
    return shown ? { base: shown } : {};
  }
  return { ...(base ? { base } : {}), ...(md ? { md } : {}), ...(lg ? { lg } : {}) };
}

/** T181: the classes and variables of a resting colour (`title` or `label`), none for a tier without one. */
function restingColorParts(part: 'title' | 'label', colors: TierColors): { classes: string; vars: Record<string, string> } {
  const tiers = [
    ['base', ''],
    ['md', '-md'],
    ['lg', '-lg'],
  ] as const;
  let classes = '';
  const vars: Record<string, string> = {};
  for (const [key, suffix] of tiers) {
    const css = colors[key];
    if (!css) continue;
    classes += ` cmsc-pb-link-tile--${part}-color${suffix}`;
    vars[`--pb-${part}-color${suffix}`] = css;
  }
  return { classes, vars };
}

function LinkTileBody({ props, tier }: { props: LinkTileProps; tier: BreakpointTier | null }): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const link = resolveLinkHref(props.link, { assets, mediaBaseUrl });
  const ratio = tileRatio(props.ratio);
  const image = props.image;
  const label = props.labelStyle === 'none' ? '' : (props.linkLabel?.trim() ?? '');
  const labelStyle = props.labelStyle === 'button' ? 'button' : 'link';

  const content = (
    <>
      <span className="cmsc-pb-link-tile__media">
        {hasImage(image) ? (
          <Picture className="cmsc-pb-link-tile__picture" image={{ fit: 'cover', ...image, ratio } as Partial<ResponsiveImage>} />
        ) : (
          <span className="cmsc-pb-link-tile__placeholder cmsc-picture--ratio" aria-hidden="true" style={ratioVars(ratio)} />
        )}
      </span>
      <span className="cmsc-pb-link-tile__text">
        {!isEmptyInline(props.title) ? (
          <span className="cmsc-pb-link-tile__title">
            <ItemText
              className="cmsc-pb-link-tile__title-text"
              size={props.titleSize as Sized}
              sizePx={props.titleSizePx}
              font={props.titleFont}
              weight={props.titleWeight}
              fallback="h6"
              tier={tier}
            >
              <InlineRich value={props.title as never} />
            </ItemText>
          </span>
        ) : null}
        {label && labelStyle === 'button' ? (
          // A button look, not a control: the whole tile is already the one link.
          <span className="cmsc-btn cmsc-btn--primary-solid cmsc-btn--medium cmsc-pb-link-tile__button">
            <ItemText
              className="cmsc-pb-link-tile__label-text"
              size={props.labelSize as Sized}
              sizePx={props.labelSizePx}
              font={props.labelFont}
              weight={props.labelWeight}
              fallback="body"
              tier={tier}
            >
              {label}
            </ItemText>
          </span>
        ) : null}
        {label && labelStyle === 'link' ? (
          <span className="cmsc-pb-link-tile__label">
            <ItemText
              className="cmsc-pb-link-tile__label-text"
              size={props.labelSize as Sized}
              sizePx={props.labelSizePx}
              font={props.labelFont}
              weight={props.labelWeight}
              fallback="body"
              tier={tier}
            >
              {label}
              <span aria-hidden="true" className="cmsc-pb-link-tile__arrow">
                {' →'}
              </span>
            </ItemText>
          </span>
        ) : null}
      </span>
    </>
  );

  const zoom = props.hoverZoom === true ? ' cmsc-hover-zoom' : '';
  const tags = itemTagsAttribute(props.tags);
  // T172: the title's and the text-link label's colours on hover and focus — a hex or a known token only.
  const titleHover = !isEmptyInline(props.title) ? colorValueToCss(props.titleHoverColor) : undefined;
  const labelHover = label && labelStyle === 'link' ? colorValueToCss(props.labelHoverColor) : undefined;
  // T178: the title's and the text-link label's resting colours, on the same terms; per breakpoint since T181.
  const titleColor = restingColorParts('title', !isEmptyInline(props.title) ? restingColors(props.titleColor as RestingColor, tier) : {});
  const labelColor = restingColorParts('label', label && labelStyle === 'link' ? restingColors(props.labelColor as RestingColor, tier) : {});
  const hover = [
    titleColor.classes,
    labelColor.classes,
    titleHover ? ' cmsc-pb-link-tile--hover-title' : '',
    labelHover ? ' cmsc-pb-link-tile--hover-label' : '',
  ].join('');
  const radius = {
    ...mediaRadiusVars(props.mediaCornerRadius),
    ...titleColor.vars,
    ...labelColor.vars,
    ...(titleHover ? { ['--pb-title-hover' as string]: titleHover } : {}),
    ...(labelHover ? { ['--pb-label-hover' as string]: labelHover } : {}),
  };
  if (!link) return <div className={`cmsc-pb-link-tile${zoom}${hover}`} style={radius} {...tags}>{content}</div>;
  return (
    <a
      className={`cmsc-pb-link-tile cmsc-pb-link-tile--link${zoom}${hover}`}
      style={radius}
      {...tags}
      href={link.href}
      {...(link.target ? { target: link.target } : {})}
      {...(link.rel ? { rel: link.rel } : {})}
    >
      {content}
    </a>
  );
}

const LinkTileRender: PuckComponent<LinkTileProps> = (props) => {
  const previewTier = usePreviewBreakpointTier();
  return <LinkTileBody props={props as unknown as LinkTileProps} tier={props.puck?.isEditing === true ? previewTier : null} />;
};

// R17 (T219): the content first — image, title, link label, link — then the look, then the tags.
const LINK_TILE_FIELDS = {
  image: imageObjectField('Image'),
  title: createInlineRichTextField({ label: 'Title' }),
  linkLabel: { type: 'text' as const, label: 'Link label' },
  link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link' },
  // T130: a ratio per breakpoint, on the Responsive tab.
  ratio: { type: 'select' as const, label: 'Image ratio', options: TILE_RATIO_OPTIONS, metadata: PB_RESPONSIVE_METADATA },
  // T140: the image frame's corners, today's 8 px by default (R17, T210: the block's one corner setting).
  mediaCornerRadius: { ...CORNER_RADIUS_FIELD, label: 'Rounded corners' },
  // T144: the title's size per breakpoint (Responsive tab) and font; today's 18 px semibold by default.
  titleSize: sizeFieldWithDefault('Title size'),
  titleSizePx: sizePxField('Custom title size (px)', 10, 120),
  titleFont: itemFontField('Title font'),
  // T151: the title's and the label's weight; Default keeps today's. T188: per breakpoint (Responsive tab).
  titleWeight: { ...textWeightField('Title weight'), metadata: PB_RESPONSIVE_METADATA },
  // T178: the title's and the label's resting colours; unset keeps today's. T181: per breakpoint (Responsive tab).
  titleColor: createResponsiveColorField({ label: 'Title color' }),
  // T172: the title's and the label's colours while the tile is hovered or focused; unset keeps today's.
  titleHoverColor: createColorField({ label: 'Title hover color' }),
  // T144: the label as a text link with an arrow (today), a button look or not shown; its size and font.
  labelStyle: {
    type: 'select' as const,
    label: 'Label style',
    options: [
      { label: 'Text link with an arrow', value: 'link' },
      { label: 'Button', value: 'button' },
      { label: 'None', value: 'none' },
    ],
  },
  labelSize: sizeFieldWithDefault('Label size'),
  labelSizePx: sizePxField('Custom label size (px)', 10, 120),
  labelFont: itemFontField('Label font'),
  labelWeight: { ...textWeightField('Label weight'), metadata: PB_RESPONSIVE_METADATA },
  labelColor: createResponsiveColorField({ label: 'Label color' }),
  labelHoverColor: createColorField({ label: 'Label hover color' }),
  hoverZoom: hoverZoomField(),
  // T131: tags for the Carousel's filter.
  tags: ITEM_TAGS_FIELD,
};

const linkTileConfig: ComponentConfig<{ props: LinkTileProps }> = {
  label: 'Link tile',
  fields: LINK_TILE_FIELDS as unknown as Fields<LinkTileProps>,
  defaultProps: {
    image: { imageSource: 'library', alt: '' },
    ratio: DEFAULT_RATIO,
    mediaCornerRadius: DEFAULT_MEDIA_CORNER_RADIUS,
    title: plainTextToInlineRichText('Title'),
    linkLabel: 'Learn more',
    link: { kind: 'url', href: '/' },
    hoverZoom: false,
  } as LinkTileProps,
  // Filters the host's field set, so the admin's pickers survive; the Custom px show once Custom is chosen.
  resolveFields: (data, params) => {
    const props = data.props as LinkTileProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? LINK_TILE_FIELDS)) {
      if (key === 'titleSizePx' && !usesCustom(props.titleSize)) continue;
      if (key === 'labelSizePx' && !usesCustom(props.labelSize)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<LinkTileProps>;
  },
  render: LinkTileRender,
};

export const LinkTile = withHideOn(linkTileConfig);
