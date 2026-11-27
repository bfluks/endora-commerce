import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CmsProductCardView } from './CmsProductCard.js';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * Issue #249 (2) — a CMS product card formats its price in the locale of the
 * request rendering it.
 *
 * `CmsProductCardView` defaulted to a hard-coded `pl-PL`, and neither
 * `ProductGrid` nor `ProductSlider` passed a locale, so a storefront switched to
 * English showed `1 234,50 zł` beside English chrome. The card now reads the
 * block render environment, whose `language` the storefront's root layout sets
 * to the request's locale for every Page Builder tree.
 */

const product = {
  id: '00000000-0000-4000-8000-000000000249',
  slug: 'demo-product',
  name: 'Demo product',
  sku: 'DEMO-1',
  primaryAssetUrl: null,
  stockLevel: null,
  price: { amount: 1234.5, currency: 'PLN' },
} as unknown as CmsProductSummary;

function formatted(locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'PLN' }).format(1234.5);
}

function renderCard(locale: string | undefined, explicit?: string): string {
  const card = (
    <CmsProductCardView product={product} {...(explicit !== undefined ? { locale: explicit } : {})} />
  );
  return renderToString(
    locale === undefined ? (
      card
    ) : (
      <BlockRenderEnvironmentProvider value={{ language: locale, preview: false }}>
        {card}
      </BlockRenderEnvironmentProvider>
    ),
  );
}

/** Intl separates with (narrow) no-break spaces; compare on plain ones. */
function text(html: string): string {
  return html.replace(/\u00a0|\u202f/g, ' ');
}

describe('CmsProductCardView — the price locale', () => {
  it('formats in the render environment\'s language', () => {
    expect(text(renderCard('en-US'))).toContain(text(formatted('en-US')));
    expect(text(renderCard('pl-PL'))).toContain(text(formatted('pl-PL')));
  });

  it('is not Polish for an English request', () => {
    expect(text(renderCard('en-US'))).not.toContain(text(formatted('pl-PL')));
  });

  it('lets an explicit locale prop win over the environment', () => {
    expect(text(renderCard('en-US', 'de-DE'))).toContain(text(formatted('de-DE')));
  });

  it('falls back to the environment default (en), not pl-PL, where no host set one', () => {
    expect(text(renderCard(undefined))).toContain(text(formatted('en')));
  });
});

describe('CmsProductCardView — a sub-cent price (§10.18)', () => {
  it('shows a unit price with its significant places, up to four', () => {
    const html = renderToString(
      <BlockRenderEnvironmentProvider value={{ language: 'pl-PL', preview: false }}>
        <CmsProductCardView product={{ ...product, price: { amount: 0.0125, currency: 'PLN' } } as CmsProductSummary} />
      </BlockRenderEnvironmentProvider>,
    );
    expect(text(html)).toContain('0,0125 zł');
  });
});

/** Feature 167 (FR-020) — the card's product links take the page language's prefix. */
describe('CmsProductCardView — the product link', () => {
  const localizePath = (path: string): string => `/en${path}`;

  it.each(['default', 'showcase'] as const)('localizes the %s card through the render context', (variant) => {
    const html = renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} localizePath={localizePath}>
        <CmsProductCardView product={product} variant={variant} />
      </CmsRenderProvider>,
    );
    expect(html).toContain('href="/en/p/demo-product"');
    expect(html).not.toContain('href="/p/demo-product"');
  });

  it('renders the logical path without a provider (the editor)', () => {
    expect(renderToString(<CmsProductCardView product={product} />)).toContain('href="/p/demo-product"');
  });
});
