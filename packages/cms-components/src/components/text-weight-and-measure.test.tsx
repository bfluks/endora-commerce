// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { getResponsiveFields, PB_RESPONSIVE_METADATA } from '@endora-commerce/page-builder-core';
import { defaultPageBuilderConfig } from '../index.js';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import { CmsProductCardView } from './CmsProductCard.js';
import { CmsRenderProvider } from './render-context.js';
import { listingCardTitleWeight, PRODUCT_LISTING_CARD_FIELDS } from './catalog/product-listing-parts.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R8 (owner request 2026-10-26):
 *
 * - **T151** — a text weight: block headings and item texts (carousel
 *   captions, tile titles and labels, feature titles, product card names) can
 *   choose a weight, `Default` (the block's own, today's) or 300–800.
 * - **T152** — a maximum width for the hero title and every block heading
 *   drawn by `BlockHeading`: a named measure or a Custom px, per breakpoint,
 *   on the Responsive tab; unset, nothing is written.
 * - **T153** — the Carousel's controls may line up with the first slide
 *   (`controlsAlignTo`), the content edge being today's.
 *
 * Nothing is added to any `defaultProps`, so a stored or new block renders as
 * before (plan § *Extend, don't narrow*).
 */

const config = defaultPageBuilderConfig as Config;
const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
const WEIGHTS = ['default', 300, 400, 500, 600, 700, 800];
const MEASURES = ['none', 'narrow', 'medium', 'wide', 'custom'];

type FieldMap = Record<string, { type?: string; options?: Array<{ value: unknown }>; metadata?: unknown; objectFields?: FieldMap }>;

async function resolvedFields(type: string, props: Record<string, unknown> = {}): Promise<FieldMap> {
  const component = config.components[type]!;
  const fields = component.fields as FieldMap;
  if (!component.resolveFields) return fields;
  return (await component.resolveFields(
    { props: { ...(component.defaultProps ?? {}), id: 'x', ...props } } as never,
    { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
  )) as FieldMap;
}

const values = (field: { options?: Array<{ value: unknown }> } | undefined): unknown[] => (field?.options ?? []).map((option) => option.value);

function block(type: string, props: Record<string, unknown> = {}): Data['content'][number] {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  return { type, props: { ...defaults, id: `${type}-1`, ...props } } as Data['content'][number];
}

function dom(content: Data['content']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

function find(host: HTMLElement, selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`${selector} not rendered:\n${host.innerHTML}`);
  return found;
}

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

// ── T151 + T152: block headings ──────────────────────────────────────

/** Every block whose heading is a `BlockHeading` with its own size: weight and max width. */
const HEADING_BLOCKS = [
  'cms.CtaCard',
  'cms.MediaText',
  'cms.BackgroundPanel',
  'cms.LinkList',
  'cms.FeatureList',
  'cms.Stats',
  'cms.ContentSlider',
  'catalog.ProductGrid',
  'catalog.ProductSlider',
  'blog.LatestPosts',
] as const;

/** The props that give each renderable block a heading. */
const HEADING_PROPS: Record<string, Record<string, unknown>> = {
  'cms.CtaCard': { heading: 'Heading' },
  'cms.MediaText': { heading: 'Heading', body: doc('Body') },
  'cms.BackgroundPanel': { heading: 'Heading' },
  'cms.LinkList': { heading: 'Heading' },
  'cms.FeatureList': { heading: 'Heading', items: [{ title: 'Fast', body: doc('Body') }] },
  'cms.Stats': { heading: 'Heading' },
  'cms.Statement': { heading: 'Heading' },
  'cms.ContentSlider': { header: { heading: 'Heading' } },
};

const RENDERED = Object.keys(HEADING_PROPS);

describe('block headings: a weight and a maximum width (T151, T152)', () => {
  it.each(HEADING_BLOCKS)('%s offers the heading weight, and a max width per breakpoint with Custom px only when chosen', async (type) => {
    const fields = await resolvedFields(type);
    expect(values(fields['headingWeight']), type).toEqual(WEIGHTS);
    expect(values(fields['headingMaxWidth']), type).toEqual(MEASURES);
    expect(fields['headingMaxWidth']?.metadata, type).toEqual(PB_RESPONSIVE_METADATA);
    expect(Object.keys(fields), type).not.toContain('headingMaxWidthPx');
    const custom = await resolvedFields(type, { headingMaxWidth: { base: 'none', desktop: 'custom' } });
    expect(custom['headingMaxWidthPx']?.metadata, type).toEqual(PB_RESPONSIVE_METADATA);
    expect(getResponsiveFields(config.components[type] as ComponentConfig), type).toEqual(
      expect.arrayContaining(['headingMaxWidth', 'headingMaxWidthPx']),
    );
    const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['headingWeight', 'headingMaxWidth', 'headingMaxWidthPx']) expect(defaults, `${type}.${key}`).not.toHaveProperty(key);
  });

  it('cms.Statement offers the heading weight; its measure stays the block\'s own text width', async () => {
    const fields = await resolvedFields('cms.Statement');
    expect(values(fields['headingWeight'])).toEqual(WEIGHTS);
    expect(Object.keys(fields)).not.toContain('headingMaxWidth');
    expect(Object.keys(fields)).toContain('textMaxWidth');
  });

  it.each(RENDERED)('%s unset: the heading carries no weight and no measure, as today', (type) => {
    const heading = find(dom([block(type, HEADING_PROPS[type])]), '.cmsc-pb-block-heading');
    expect(heading.style.fontWeight).toBe('');
    expect(heading.classList).not.toContain('cmsc-text-max');
    expect(heading.hasAttribute('data-align')).toBe(false);
  });

  it.each(RENDERED)('%s: a chosen weight is the heading\'s', (type) => {
    const heading = find(dom([block(type, { ...HEADING_PROPS[type], headingWeight: 300 })]), '.cmsc-pb-block-heading');
    expect(heading.style.fontWeight).toBe('300');
  });

  it.each(RENDERED.filter((type) => type !== 'cms.Statement'))('%s: a max width per breakpoint holds the heading', (type) => {
    const heading = find(
      dom([block(type, { ...HEADING_PROPS[type], headingMaxWidth: { base: 'none', tablet: 'medium', desktop: 'custom' }, headingMaxWidthPx: { base: 720, desktop: 900 } })]),
      '.cmsc-pb-block-heading',
    );
    expect(heading.classList).toContain('cmsc-text-max');
    expect(heading.style.getPropertyValue('--cmsc-text-max')).toBe('none');
    expect(heading.style.getPropertyValue('--cmsc-text-max-md')).toBe('48rem');
    expect(heading.style.getPropertyValue('--cmsc-text-max-lg')).toBe('900px');
  });

  it('a held heading follows its block\'s alignment: a centred Stats heading is centred', () => {
    const centred = find(dom([block('cms.Stats', { heading: 'Heading', headingMaxWidth: 'narrow' })]), '.cmsc-pb-block-heading');
    expect(centred.getAttribute('data-align')).toBe('center');
    const start = find(dom([block('cms.FeatureList', { ...HEADING_PROPS['cms.FeatureList'], headingMaxWidth: 'narrow' })]), '.cmsc-pb-block-heading');
    expect(start.hasAttribute('data-align')).toBe(false);
  });

  it('an unknown weight is ignored', () => {
    for (const weight of [900, '850', 'bold', 'default']) {
      const heading = find(dom([block('cms.CtaCard', { heading: 'Heading', headingWeight: weight })]), '.cmsc-pb-block-heading');
      expect(heading.style.fontWeight, String(weight)).toBe('');
    }
    const numeric = find(dom([block('cms.CtaCard', { heading: 'Heading', headingWeight: '500' })]), '.cmsc-pb-block-heading');
    expect(numeric.style.fontWeight).toBe('500');
  });
});

// ── T151 + T152: the hero title ──────────────────────────────────────

describe('cms.Hero title: a weight and a maximum width (T151, T152)', () => {
  it('offers the title weight and a max width per breakpoint, Custom px only when chosen, none by default', async () => {
    const fields = await resolvedFields('cms.Hero');
    expect(values(fields['titleWeight'])).toEqual(WEIGHTS);
    expect(values(fields['titleMaxWidth'])).toEqual(MEASURES);
    expect(fields['titleMaxWidth']?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(Object.keys(fields)).not.toContain('titleMaxWidthPx');
    expect((await resolvedFields('cms.Hero', { titleMaxWidth: 'custom' }))['titleMaxWidthPx']?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(getResponsiveFields(config.components['cms.Hero'] as ComponentConfig)).toEqual(
      expect.arrayContaining(['titleMaxWidth', 'titleMaxWidthPx']),
    );
    const defaults = (config.components['cms.Hero']?.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['titleWeight', 'titleMaxWidth', 'titleMaxWidthPx']) expect(defaults).not.toHaveProperty(key);
  });

  it('unset is today\'s title: no weight, no measure', () => {
    const title = find(dom([block('cms.Hero')]), '.cmsc-pb-hero__title');
    expect(title.style.fontWeight).toBe('');
    expect(title.classList).not.toContain('cmsc-text-max');
  });

  it('a weight and a Custom max width reach the title; a centred hero centres the held title', () => {
    const host = dom([block('cms.Hero', { titleWeight: 400, titleMaxWidth: 'custom', titleMaxWidthPx: 900, align: 'center' })]);
    const title = find(host, '.cmsc-pb-hero__title');
    expect(title.style.fontWeight).toBe('400');
    expect(title.classList).toContain('cmsc-text-max');
    expect(title.style.getPropertyValue('--cmsc-text-max')).toBe('900px');
    expect(title.getAttribute('data-align')).toBe('center');
  });

  it('a stored hero title (no size token) keeps its legacy class and takes the weight', () => {
    const title = find(dom([block('cms.Hero', { titleSize: undefined, titleWeight: 500 })]), '.cmsc-pb-hero__title');
    expect(title.classList).toContain('cmsc-pb-hero__heading');
    expect(title.style.fontWeight).toBe('500');
  });
});

// ── T151: item texts ─────────────────────────────────────────────────

describe('item texts: a weight (T151)', () => {
  const image = { imageSource: 'url', src: 'https://cdn.example.com/a.jpg', alt: '' };

  it('cms.CarouselImage: the caption weight wraps the text in its span; nothing chosen keeps no span', async () => {
    // R17 (T219, deliberately changed, standing rule 13): the caption's look is offered once there is a caption.
    expect(values((await resolvedFields('cms.CarouselImage', { caption: doc('Lake') }))['captionWeight'])).toEqual(WEIGHTS);
    const plain = dom([block('cms.CarouselImage', { image, caption: doc('Lake'), captionPlacement: 'bottom-left' })]);
    expect(plain.querySelector('.cmsc-pb-carousel-image__caption-text')).toBeNull();
    const heavy = dom([block('cms.CarouselImage', { image, caption: doc('Lake'), captionPlacement: 'bottom-left', captionWeight: 400 })]);
    expect(find(heavy, '.cmsc-pb-carousel-image__caption-text').style.fontWeight).toBe('400');
  });

  it('cms.LinkTile: the title and label weights', async () => {
    const fields = await resolvedFields('cms.LinkTile');
    expect(values(fields['titleWeight'])).toEqual(WEIGHTS);
    expect(values(fields['labelWeight'])).toEqual(WEIGHTS);
    const host = dom([block('cms.LinkTile', { title: doc('Guide'), linkLabel: 'More', titleWeight: 400, labelWeight: 700 })]);
    expect(find(host, '.cmsc-pb-link-tile__title-text').style.fontWeight).toBe('400');
    expect(find(host, '.cmsc-pb-link-tile__label-text').style.fontWeight).toBe('700');
    const plain = dom([block('cms.LinkTile', { title: doc('Guide'), linkLabel: 'More' })]);
    expect(plain.querySelector('.cmsc-pb-link-tile__title-text')).toBeNull();
  });

  it('cms.FeatureList: the item title weight, with and without a title size', async () => {
    expect(values((await resolvedFields('cms.FeatureList'))['titleWeight'])).toEqual(WEIGHTS);
    const items = [{ title: 'Fast', body: doc('Body') }];
    expect(find(dom([block('cms.FeatureList', { items })]), '.cmsc-pb-feature-list__title').style.fontWeight).toBe('');
    expect(find(dom([block('cms.FeatureList', { items, titleWeight: 400 })]), '.cmsc-pb-feature-list__title').style.fontWeight).toBe('400');
    expect(
      find(dom([block('cms.FeatureList', { items, titleSize: 'h4', titleWeight: 300 })]), '.cmsc-pb-feature-list__title').style.fontWeight,
    ).toBe('300');
  });

  it('product listings: the card name weight reaches every card style', async () => {
    expect(values(PRODUCT_LISTING_CARD_FIELDS.cardTitleWeight as never)).toEqual(WEIGHTS);
    for (const type of ['catalog.ProductGrid', 'catalog.ProductSlider']) {
      expect(Object.keys(await resolvedFields(type)), type).toContain('cardTitleWeight');
      expect((config.components[type]?.defaultProps ?? {}) as Record<string, unknown>, type).not.toHaveProperty('cardTitleWeight');
    }
    expect(listingCardTitleWeight({ cardTitleWeight: 400 } as never)).toEqual({ nameWeight: 400 });
    expect(listingCardTitleWeight({ cardTitleWeight: 'default' } as never)).toEqual({});
    expect(listingCardTitleWeight({} as never)).toEqual({});
    const product: CmsProductSummary = {
      id: 'p1',
      slug: 'oak-shelf',
      name: 'Oak shelf',
      sku: 'OAK-1',
      primaryAssetUrl: null,
      summary: 'A shelf.',
    } as CmsProductSummary;
    for (const variant of ['default', 'compact', 'horizontal', 'showcase']) {
      const host = document.createElement('div');
      host.innerHTML = renderToString(createElement(CmsProductCardView, { product, locale: 'en-US', variant, nameWeight: 400 } as never));
      expect(find(host, '.cmsc-pb-product-card__name').style.fontWeight, variant).toBe('400');
      const plain = document.createElement('div');
      plain.innerHTML = renderToString(createElement(CmsProductCardView, { product, locale: 'en-US', variant } as never));
      expect(find(plain, '.cmsc-pb-product-card__name').hasAttribute('style'), variant).toBe(false);
    }
  });
});

// ── T153: the Carousel's controls and the first slide ───────────────

describe('carousel controls aligned to the first slide (T153)', () => {
  const CAROUSELS = ['cms.ContentSlider', 'catalog.ProductSlider', 'blog.LatestPosts'] as const;

  it.each(CAROUSELS)('%s offers the content edge (first, today\'s) or the first slide, unset by default and gone for a grid', async (type) => {
    const fields = await resolvedFields(type, { layout: 'carousel' });
    expect(values(fields['controlsAlignTo']), type).toEqual(['container', 'slide']);
    expect((config.components[type]?.defaultProps ?? {}) as Record<string, unknown>, type).not.toHaveProperty('controlsAlignTo');
    if (type !== 'catalog.ProductSlider') {
      expect(Object.keys(await resolvedFields(type, { layout: 'grid' })), type).not.toContain('controlsAlignTo');
    }
  });

  it('cms.ContentSlider hands the choice to the shell', () => {
    const host = dom([block('cms.ContentSlider', { bleed: 'end', controlsPlacement: 'below', controlsAlignTo: 'slide' })]);
    expect(find(host, '.cmsc-pb-carousel').classList).toContain('cmsc-pb-carousel--ctl-to-slide');
    expect(find(dom([block('cms.ContentSlider', { bleed: 'end' })]), '.cmsc-pb-carousel').className).not.toContain('--ctl-to-');
  });

  it('the stylesheet sizes the rows below the track to one slide', () => {
    const css = STYLESHEET.replace(/\s+/g, ' ');
    expect(css).toMatch(
      /\.cmsc-pb-carousel--ctl-to-slide > :is\(\.cmsc-pb-carousel__controls--below, \.cmsc-pb-carousel__controls--dots\) \{[^}]*width: var\(--cmsc-slide-w\)/,
    );
  });
});

// ── R17 (T211): a weight per breakpoint, next to its size ─────────────

describe('a text\'s weight per breakpoint (R17, T211)', () => {
  const WEIGHED = { base: 400, desktop: 700 };

  it('a block heading: one weight stays inline; weights that differ go per breakpoint', () => {
    const plain = find(dom([block('cms.CtaCard', { heading: 'Heading', headingWeight: { base: 600 } })]), '.cmsc-pb-block-heading');
    expect(plain.style.fontWeight).toBe('600');
    expect(plain.querySelector('.cmsc-pb-item-weight')).toBeNull();
    const heading = find(dom([block('cms.CtaCard', { heading: 'Heading', headingWeight: WEIGHED })]), '.cmsc-pb-block-heading');
    // Weights that differ go on one span inside the heading; a tier with none inherits the heading's own.
    const span = find(heading, '.cmsc-pb-item-weight');
    expect(span.style.getPropertyValue('--pb-item-weight')).toBe('400');
    expect(span.style.getPropertyValue('--pb-item-weight-md')).toBe('400');
    expect(span.style.getPropertyValue('--pb-item-weight-lg')).toBe('700');
    expect(heading.style.fontWeight).toBe('');
  });

  it('the hero title, a feature title and a media-text item title take a weight per breakpoint', () => {
    const hero = find(dom([block('cms.Hero', { titleWeight: WEIGHED })]), '.cmsc-pb-hero__title .cmsc-pb-item-weight');
    expect(hero.style.getPropertyValue('--pb-item-weight-lg')).toBe('700');
    const items = [{ title: doc('Fast'), body: doc('Body') }];
    const feature = find(dom([block('cms.FeatureList', { items, titleWeight: WEIGHED })]), '.cmsc-pb-feature-list__title .cmsc-pb-item-weight');
    expect(feature.style.getPropertyValue('--pb-item-weight-lg')).toBe('700');
    const media = find(
      dom([block('cms.MediaText', { heading: 'H', features: [{ title: doc('Item'), body: 'Text' }], featureTitleWeight: WEIGHED })]),
      '.cmsc-pb-media-text__feature-title-text',
    );
    expect(media.style.getPropertyValue('--pb-item-weight-lg')).toBe('700');
  });
});
