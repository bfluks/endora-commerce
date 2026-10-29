import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import { CmsProductCardView, productCardLayoutStyle } from './CmsProductCard.js';

describe('productCardLayoutStyle', () => {
  it('applies max width and image height when set', () => {
    const layout = productCardLayoutStyle(
      { maxWidthPx: 320, imageHeightPx: 200, imageObjectFit: 'cover' },
      'desktop',
    );
    expect(layout.card.maxWidth).toBe('320px');
    expect(layout.media.height).toBe('200px');
    expect(layout.img.objectFit).toBe('cover');
  });

  it('skips max width when 0', () => {
    const layout = productCardLayoutStyle({ maxWidthPx: 0 }, 'mobile');
    expect(layout.card.maxWidth).toBeUndefined();
  });
});

/**
 * Feature 163 (T070, R-16, FR-027) — the `showcase` card: the image on a
 * neutral backdrop, the name, the summary and a "more" link labelled by
 * `ctaLabel`. Price, SKU and stock are the default card's, not this one's.
 */
describe('CmsProductCardView — showcase variant', () => {
  const product: CmsProductSummary = {
    id: 'p1',
    slug: 'oak-shelf',
    name: 'Oak shelf',
    sku: 'OAK-1',
    primaryAssetUrl: 'https://cdn.example.com/oak.jpg',
    price: { amount: 120, currency: 'EUR' },
    stockLevel: 4,
    summary: 'A modular shelf in solid oak.',
  };

  function render(props: Record<string, unknown>): string {
    return renderToStaticMarkup(createElement(CmsProductCardView, { product, locale: 'en-US', ...props } as never));
  }

  it('renders the image on the neutral backdrop, the name, the summary and the more link', () => {
    const html = render({ variant: 'showcase', ctaLabel: 'Discover' });
    expect(html).toContain('cmsc-pb-product-card--showcase');
    expect(html).toContain('cmsc-pb-product-card__media');
    expect(html).toContain('src="https://cdn.example.com/oak.jpg"');
    expect(html).toContain('>Oak shelf<');
    expect(html).toMatch(/class="cmsc-pb-product-card__summary"[^>]*>A modular shelf in solid oak\.</);
    expect(html).toMatch(/<a href="\/p\/oak-shelf" class="cmsc-pb-product-card__more"[^>]*>Discover<\/a>/);
    expect(html).not.toContain('cmsc-pb-product-card__price');
    expect(html).not.toContain('OAK-1');
  });

  it('labels the more link "More" when no label is set, and leaves the summary out when there is none', () => {
    const html = renderToStaticMarkup(
      createElement(CmsProductCardView, { product: { ...product, summary: null }, variant: 'showcase', locale: 'en-US' }),
    );
    expect(html).toMatch(/class="cmsc-pb-product-card__more"[^>]*>More</);
    expect(html).not.toContain('cmsc-pb-product-card__summary');
  });

  it('leaves the default card as it was: price and SKU, no summary', () => {
    const html = render({});
    expect(html).toContain('cmsc-pb-product-card--default');
    expect(html).toContain('cmsc-pb-product-card__price');
    expect(html).toContain('OAK-1');
    expect(html).not.toContain('cmsc-pb-product-card__summary');
  });
});

/**
 * T135 (R5, owner gap list (a)13): a listing chooses the one line of text its
 * cards show under the name — the summary, the SKU or none. `default` (unset)
 * keeps each card style's own line as today: the SKU on the default, compact
 * and horizontal cards, the summary on `showcase`.
 */
describe('CmsProductCardView — the text line (T135)', () => {
  const product: CmsProductSummary = {
    id: 'p1',
    slug: 'oak-shelf',
    name: 'Oak shelf',
    sku: 'OAK-1',
    primaryAssetUrl: null,
    price: { amount: 120, currency: 'EUR' },
    stockLevel: null,
    summary: 'A modular shelf in solid oak.',
  };

  function render(props: Record<string, unknown>): string {
    return renderToStaticMarkup(createElement(CmsProductCardView, { product, locale: 'en-US', ...props } as never));
  }

  it('`default` keeps today\'s line of each card style', () => {
    for (const textLine of [undefined, 'default']) {
      const card = render({ ...(textLine ? { textLine } : {}) });
      expect(card).toContain('OAK-1');
      expect(card).not.toContain('cmsc-pb-product-card__summary');
      const showcase = render({ variant: 'showcase', ...(textLine ? { textLine } : {}) });
      expect(showcase).toContain('cmsc-pb-product-card__summary');
      expect(showcase).not.toContain('OAK-1');
    }
    // Today's SKU switch still applies to the default line.
    expect(render({ showSku: false })).not.toContain('OAK-1');
  });

  it('`summary` shows the summary under the name on every card style, and no SKU', () => {
    for (const variant of ['default', 'compact', 'horizontal', 'showcase']) {
      const html = render({ variant, textLine: 'summary' });
      expect(html, variant).toMatch(/class="cmsc-pb-product-card__name"[^>]*>Oak shelf<\/a><p class="cmsc-pb-product-card__summary">A modular shelf in solid oak\.<\/p>/);
      expect(html, variant).not.toContain('OAK-1');
    }
  });

  it('`sku` shows the SKU on every card style, and no summary', () => {
    for (const variant of ['default', 'compact', 'horizontal', 'showcase']) {
      const html = render({ variant, textLine: 'sku' });
      expect(html, variant).toContain('<span class="cmsc-pb-product-card__sku">OAK-1</span>');
      expect(html, variant).not.toContain('cmsc-pb-product-card__summary');
    }
  });

  it('`none` shows neither', () => {
    for (const variant of ['default', 'showcase']) {
      const html = render({ variant, textLine: 'none' });
      expect(html, variant).not.toContain('OAK-1');
      expect(html, variant).not.toContain('cmsc-pb-product-card__summary');
      expect(html, variant).toContain('>Oak shelf<');
    }
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T168 (R10): the card's image box
 * background (a brand token or a hex, over the card style's own neutral) and a
 * divider line under the card. Nothing chosen writes nothing: today's markup.
 */
describe('CmsProductCardView — image box background and divider (T168)', () => {
  const product: CmsProductSummary = {
    id: 'p1',
    slug: 'oak-shelf',
    name: 'Oak shelf',
    sku: 'OAK-1',
    primaryAssetUrl: null,
    price: null,
    stockLevel: null,
    summary: 'A modular shelf in solid oak.',
  };

  function render(props: Record<string, unknown>): string {
    return renderToStaticMarkup(createElement(CmsProductCardView, { product, locale: 'en-US', ...props } as never));
  }

  function mediaTag(html: string): string {
    return /<a [^>]*class="cmsc-pb-product-card__media[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
  }

  function articleTag(html: string): string {
    return /<article [^>]*>/.exec(html)?.[0] ?? '';
  }

  it('unset keeps today\'s markup on every card style: no background, no divider class or property', () => {
    for (const variant of ['default', 'compact', 'horizontal', 'showcase']) {
      const html = render({ variant });
      expect(mediaTag(html), variant).not.toContain('background');
      expect(articleTag(html), variant).not.toContain('divider');
      expect(render({ variant, imageBackground: '', divider: 'none' }), variant).toBe(html);
    }
  });

  it('a hex or a brand token colours the image box of every card style; anything else is ignored', () => {
    for (const variant of ['default', 'showcase']) {
      expect(mediaTag(render({ variant, imageBackground: '#eef2f7' })), variant).toContain('background:#eef2f7');
      expect(mediaTag(render({ variant, imageBackground: 'token:secondary' })), variant).toContain('background:var(--cmsb-color-secondary, #0f766e)');
      expect(mediaTag(render({ variant, imageBackground: 'url(x)' })), variant).not.toContain('background');
    }
  });

  it('a line divider marks the card, its colour a property when chosen', () => {
    for (const variant of ['default', 'showcase']) {
      const plain = articleTag(render({ variant, divider: 'line' }));
      expect(plain, variant).toContain('cmsc-pb-product-card--divider');
      expect(plain, variant).not.toContain('--pb-card-divider');
      const coloured = articleTag(render({ variant, divider: 'line', dividerColor: '#1d4ed8' }));
      expect(coloured, variant).toContain('--pb-card-divider:#1d4ed8');
      // A colour with no line draws nothing.
      expect(articleTag(render({ variant, dividerColor: '#1d4ed8' })), variant).not.toContain('divider');
    }
  });
});
