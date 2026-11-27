'use client';

import { type CSSProperties } from 'react';
import {
  CORNER_RADIUS_PX,
  resolveResponsiveNumber,
  type BreakpointTier,
} from '@endora-commerce/page-builder-core';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import { unitPriceFractionDigits } from '@endora-commerce/contracts';
import type { CmsProductCardProps, ProductCardDivider, ProductCardTextLine } from '../schema/component-types.js';
import { useBlockData } from '../hooks/use-block-data.js';
import { colorValueToCss } from '../utils/color-value.js';
import { productCardDataRequest } from '../utils/block-data.js';
import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import { useCmsRenderLocalizePath } from './render-context.js';

/**
 * A product's price is a unit price: its significant places, up to four, at
 * least two (owner ruling of 2026-10-25; `unitPriceFractionDigits`).
 */
function formatPrice(product: CmsProductSummary, locale: string): string | null {
  if (!product.price) return null;
  const amount = product.price.amount;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: product.price.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: Number.isFinite(amount) ? unitPriceFractionDigits(amount) : 2,
  }).format(amount);
}

function mediaRatioClass(imageRatio: CmsProductCardProps['imageRatio']): string {
  if (imageRatio === '4:3') return 'cmsc-pb-product-card__media--43';
  if (imageRatio === '16:9') return 'cmsc-pb-product-card__media--169';
  if (imageRatio === 'auto') return 'cmsc-pb-product-card__media--auto';
  return 'cmsc-pb-product-card__media--square';
}

export function productCardLayoutStyle(
  props: {
    maxWidthPx?: CmsProductCardProps['maxWidthPx'];
    imageHeightPx?: CmsProductCardProps['imageHeightPx'];
    imageObjectFit?: CmsProductCardProps['imageObjectFit'];
    cornerRadius?: CmsProductCardProps['cornerRadius'];
  },
  tier: BreakpointTier = 'desktop',
): { card: CSSProperties; media: CSSProperties; img: CSSProperties } {
  const maxWidth = resolveResponsiveNumber(props.maxWidthPx, tier, 0);
  const imageHeight = resolveResponsiveNumber(props.imageHeightPx, tier, 0);
  return {
    card: {
      ...(maxWidth > 0 ? { maxWidth: `${maxWidth}px`, width: '100%' } : {}),
      ...(props.cornerRadius
        ? { borderRadius: `${CORNER_RADIUS_PX[props.cornerRadius]}px` }
        : {}),
    },
    media: {
      ...(imageHeight > 0 ? { height: `${imageHeight}px`, aspectRatio: 'unset' } : {}),
    },
    img: {
      objectFit: props.imageObjectFit ?? 'contain',
      ...(props.imageObjectFit && props.imageObjectFit !== 'contain'
        ? { maxWidth: '100%', maxHeight: '100%' }
        : {}),
    },
  };
}

export function CmsProductCardView({
  product,
  locale: explicitLocale,
  showPrice = true,
  showSku = true,
  showStock = true,
  imageRatio = 'square',
  imageObjectFit = 'contain',
  maxWidthPx,
  imageHeightPx,
  cornerRadius,
  variant = 'default',
  ctaLabel,
  textLine = 'default',
  nameWeight,
  imageBackground,
  divider,
  dividerColor,
  previewTier = 'desktop',
}: {
  product: CmsProductSummary;
  locale?: string;
  showPrice?: boolean;
  showSku?: boolean;
  showStock?: boolean;
  imageRatio?: CmsProductCardProps['imageRatio'];
  imageObjectFit?: CmsProductCardProps['imageObjectFit'];
  maxWidthPx?: CmsProductCardProps['maxWidthPx'];
  imageHeightPx?: CmsProductCardProps['imageHeightPx'];
  cornerRadius?: CmsProductCardProps['cornerRadius'];
  variant?: CmsProductCardProps['variant'];
  ctaLabel?: string;
  /** The line under the name (T135); `default` keeps the card style's own. */
  textLine?: ProductCardTextLine;
  /** The name's weight (T151, 300–800); unset keeps the card style's own. */
  nameWeight?: number;
  /** T168: the image box background (`#rrggbb` or `token:<role>`); unset keeps the card style's own. */
  imageBackground?: string;
  /** T168: a line under the card; unset or `none` draws none (today's). */
  divider?: ProductCardDivider;
  /** T168: the line's colour (`#rrggbb` or `token:<role>`); read only with a line. */
  dividerColor?: string;
  previewTier?: BreakpointTier;
}): React.ReactElement {
  // Feature 167 — the product link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  // An explicit prop wins; otherwise the language the host renders this tree
  // in — on the storefront the request's locale, for every Page Builder tree
  // (issue #249). This was a hard-coded `pl-PL`, which `ProductGrid` and
  // `ProductSlider` never overrode, so an English storefront showed Polish
  // prices.
  const { language } = useBlockRenderEnvironment();
  const locale = explicitLocale ?? language;
  const ratioClass = mediaRatioClass(imageRatio);
  const price = showPrice ? formatPrice(product, locale) : null;
  const layout = productCardLayoutStyle(
    {
      ...(maxWidthPx !== undefined ? { maxWidthPx } : {}),
      ...(imageHeightPx !== undefined ? { imageHeightPx } : {}),
      ...(imageObjectFit !== undefined ? { imageObjectFit } : {}),
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    },
    previewTier,
  );

  // T135: the line under the name — the card style's own (`default`), the summary, the SKU or none.
  const line: Exclude<ProductCardTextLine, 'default'> =
    textLine === 'summary' || textLine === 'sku' || textLine === 'none' ? textLine : variant === 'showcase' ? 'summary' : 'sku';
  const summaryText = line === 'summary' ? (product.summary?.trim() ?? '') : '';
  const summaryLine = summaryText ? <p className="cmsc-pb-product-card__summary">{summaryText}</p> : null;
  // Today's SKU switch still governs the default line.
  const showSkuLine = line === 'sku' && (textLine === 'sku' || showSku) && Boolean(product.sku);
  const skuLine = showSkuLine ? <span className="cmsc-pb-product-card__sku">{product.sku}</span> : null;
  // T151: the name's weight, when the listing chose one.
  const nameStyle = nameWeight !== undefined ? { style: { fontWeight: nameWeight } } : {};
  // T168: the image box background and a line under the card; nothing chosen writes nothing.
  const mediaBackground = colorValueToCss(imageBackground);
  const mediaStyle: CSSProperties = mediaBackground ? { ...layout.media, background: mediaBackground } : layout.media;
  const lined = divider === 'line';
  const lineColor = lined ? colorValueToCss(dividerColor) : undefined;
  const cardStyle = (lineColor ? { ...layout.card, '--pb-card-divider': lineColor } : layout.card) as CSSProperties;
  const lineClass = lined ? ' cmsc-pb-product-card--divider' : '';

  // Feature 163 (R-16, FR-027): the image on a neutral backdrop, the name, the
  // summary and a "more" link — no price, SKU or stock.
  if (variant === 'showcase') {
    const href = localizePath(`/p/${product.slug}`);
    const moreLabel = ctaLabel?.trim() || 'More';
    return (
      <article className={`cmsc-pb-product-card cmsc-pb-product-card--showcase${lineClass}`} style={cardStyle}>
        <a href={href} className={`cmsc-pb-product-card__media ${ratioClass}`} style={mediaStyle} tabIndex={-1} aria-hidden="true">
          {product.primaryAssetUrl ? (
            <img src={product.primaryAssetUrl} alt="" loading="lazy" style={layout.img} />
          ) : (
            <span className="cmsc-pb-product-card__placeholder" aria-hidden />
          )}
        </a>
        <div className="cmsc-pb-product-card__body">
          {skuLine}
          <a href={href} className="cmsc-pb-product-card__name" {...nameStyle}>
            {product.name}
          </a>
          {summaryLine}
          <a href={href} className="cmsc-pb-product-card__more" aria-label={`${moreLabel}: ${product.name}`}>
            {moreLabel}
          </a>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`cmsc-pb-product-card cmsc-pb-product-card--${variant}${lineClass}`}
      style={cardStyle}
    >
      <a
        href={localizePath(`/p/${product.slug}`)}
        className={`cmsc-pb-product-card__media ${ratioClass}`}
        style={mediaStyle}
      >
        {product.primaryAssetUrl ? (
          <img
            src={product.primaryAssetUrl}
            alt={product.name}
            loading="lazy"
            style={layout.img}
          />
        ) : (
          <span className="cmsc-pb-product-card__placeholder" aria-hidden />
        )}
      </a>
      <div className="cmsc-pb-product-card__body">
        {skuLine}
        <a href={localizePath(`/p/${product.slug}`)} className="cmsc-pb-product-card__name" {...nameStyle}>
          {product.name}
        </a>
        {summaryLine}
        {showStock && product.stockLevel != null ? (
          <span className="cmsc-pb-product-card__stock">{String(product.stockLevel)}</span>
        ) : null}
        {price ? <span className="cmsc-pb-product-card__price">{price}</span> : null}
        {ctaLabel ? (
          <a href={localizePath(`/p/${product.slug}`)} className="cmsc-pb-product-card__cta">
            {ctaLabel}
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function CmsProductCardLoader(
  props: CmsProductCardProps & { locale?: string; editing?: boolean; previewTier?: BreakpointTier },
): React.ReactElement {
  const { productSlug, editing = false, locale, previewTier, ...viewProps } = props;
  // Provided by the page's server render on the storefront; fetched from an effect only in
  // the editor preview, which is the one caller that ever sees `loading`.
  const { loading, data } = useBlockData<CmsProductSummary[]>(productCardDataRequest({ productSlug }));
  const product = data?.[0] ?? null;

  if (!productSlug) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Select a product</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Loading product…</p>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="cmsc-pb-product-card cmsc-pb-product-card--placeholder">
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          {editing ? 'Product not found' : 'Product unavailable'}
        </p>
      </div>
    );
  }
  return (
    <CmsProductCardView
      product={product}
      {...(locale !== undefined ? { locale } : {})}
      {...(previewTier !== undefined ? { previewTier } : {})}
      {...viewProps}
    />
  );
}
