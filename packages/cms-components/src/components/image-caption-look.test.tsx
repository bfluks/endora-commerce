// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T249–T251) — image cards and
 * image captions (plan § *Extend, don't narrow*: every option unset renders
 * today's markup).
 *
 * - `cms.CarouselImage` gains a **read-more label** — e.g. a "read more" line at
 *   the bottom right, apart from the caption — with its own corner, size and
 *   an optional icon (T249), and the caption's **padding per breakpoint**,
 *   which also insets the read-more label (T250).
 * - `cms.Image`'s caption gains a **placement per breakpoint** (below on
 *   phones, beside from the tablet up), a **size per breakpoint**, an
 *   **alignment per breakpoint**, a weight and a colour (T251).
 *
 * R23 (T445, T446): the label's own size and the caption's padding per
 * breakpoint were removed (the label keeps 14 px, 12 px from its corner); the
 * image caption's size is a type token or Custom px, and its weight and colour
 * were removed (the scheme's muted text, today's). Stored values are ignored.
 */

const config = defaultPageBuilderConfig as Config;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function render(type: string, props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [{ type, props: { ...defaults, id: 'block-1', ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function dom(type: string, props: Record<string, unknown>): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = render(type, props);
  return host;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

async function fieldKeys(type: string, props: Record<string, unknown>): Promise<string[]> {
  const block = config.components[type] as ComponentConfig;
  const fields = block.fields as Fields;
  const resolved = await block.resolveFields!(
    { props: { ...(block.defaultProps ?? {}), ...props } } as never,
    { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
  );
  return Object.keys(resolved);
}

const CARD = {
  image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: 'Project' },
  caption: doc('Office building'),
  link: { kind: 'page', slug: 'projects' },
};

describe('cms.CarouselImage read-more label (T249)', () => {
  it('unset renders today’s markup', () => {
    const html = render('cms.CarouselImage', CARD);
    expect(html).not.toContain('__more');
    expect(render('cms.CarouselImage', { ...CARD, moreLabel: '  ', moreLabelPlacement: 'top-left' })).toBe(html);
  });

  it('renders the label in its own corner over the image, inside the item’s link, apart from the caption', () => {
    const host = dom('cms.CarouselImage', { ...CARD, moreLabel: 'Read more', moreLabelIcon: 'plus' });
    const label = host.querySelector('.cmsc-pb-carousel-image__more')!;
    expect(label.className).toContain('cmsc-pb-carousel-image__more--bottom-right');
    expect(label.textContent).toBe('Read more');
    expect(label.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(label.closest('a.cmsc-pb-carousel-image__link')).not.toBeNull();
    expect(label.closest('.cmsc-pb-carousel-image__media')).not.toBeNull();
    expect(host.querySelector('figcaption')?.textContent).toBe('Office building');
    // R23 (T445): a stored label size (R19B) is ignored data.
    const stale = dom('cms.CarouselImage', { ...CARD, moreLabel: 'Read more', moreLabelIcon: 'plus', moreLabelSizePx: { base: 14, desktop: 16 } });
    expect(stale.querySelector('figure')!.getAttribute('style') ?? '').not.toContain('--pb-more-size');
    const placed = dom('cms.CarouselImage', { ...CARD, moreLabel: 'More', moreLabelPlacement: 'top-left' });
    expect(placed.querySelector('.cmsc-pb-carousel-image__more')!.className).toContain('--top-left');
  });

  it('takes the caption’s text colour when one is set; the stylesheet places it and sizes it', () => {
    const host = dom('cms.CarouselImage', { ...CARD, moreLabel: 'More', captionStyle: { color: '#ffcc00' } });
    expect(host.querySelector('.cmsc-pb-carousel-image__more')!.getAttribute('style')).toContain('color:#ffcc00');
    const css = sheet();
    expect(css).toContain('.cmsc-pb-carousel-image__more--bottom-right { right: var(--cmsc-more-inset); bottom: var(--cmsc-more-inset); }');
    expect(css).toContain('--cmsc-more-inset: 12px;');
    expect(css).toContain('font-size: 0.875rem; font-weight: 600; line-height: 1.3;');
  });
});

describe('cms.CarouselImage caption padding per breakpoint (T250) — removed by R23 (T445)', () => {
  it('a stored per-breakpoint padding is ignored: the caption keeps its one padding inline, as today', () => {
    const host = dom('cms.CarouselImage', { ...CARD, captionStyle: { paddingPx: 32 }, captionPaddingPx: { base: 24, desktop: 40 } });
    expect(host.querySelector('figcaption')!.getAttribute('style')).toContain('padding:32px');
    expect(host.querySelector('figure')!.className).not.toContain('caption-pad');
    expect(host.querySelector('figure')!.getAttribute('style') ?? '').not.toContain('--pb-caption-pad');
    expect(sheet()).not.toContain('cmsc-pb-carousel-image--caption-pad');
  });

  it('the read-more label is offered, its corner and icon once it has text; no padding or label size fields', async () => {
    const plain = await fieldKeys('cms.CarouselImage', { caption: doc('A') });
    expect(plain).toContain('moreLabel');
    expect(plain).not.toContain('captionPaddingPx');
    expect(plain).not.toContain('moreLabelPlacement');
    const labelled = await fieldKeys('cms.CarouselImage', { caption: doc('A'), moreLabel: 'More' });
    expect(labelled).toEqual(expect.arrayContaining(['moreLabelPlacement', 'moreLabelIcon']));
    for (const key of ['moreLabelSizePx', 'moreLabelColor', 'moreLabelIconColor', 'moreLabelWeight']) expect(labelled).not.toContain(key);
  });
});

describe('cms.Image caption per breakpoint (T251)', () => {
  const IMAGE = { imageSource: 'url', src: 'https://example.com/avatars.png', alt: '', caption: 'Trusted by 500 installers' };

  it('unset renders today’s markup', () => {
    const html = render('cms.Image', IMAGE);
    expect(html).toContain('data-caption="below"');
    expect(html).not.toContain('data-caption-md');
    expect(html).not.toContain('--pb-img-caption');
    expect(render('cms.Image', { ...IMAGE, captionColor: '', captionWeight: 'default' })).toBe(html);
  });

  it('a placement per breakpoint: the base one as today, the others as attributes the stylesheet reads', () => {
    const figure = dom('cms.Image', { ...IMAGE, captionPlacement: { base: 'below', tablet: 'beside' } }).querySelector('figure')!;
    expect(figure.getAttribute('data-caption')).toBe('below');
    expect(figure.getAttribute('data-caption-md')).toBe('beside');
    expect(figure.hasAttribute('data-caption-lg')).toBe(false);
    const css = sheet();
    expect(css).toContain("@media (min-width: 768px) { .cmsc-pb-image__figure[data-caption-md='beside'] { display: inline-flex; align-items: center; gap: 12px; }");
    expect(css).toContain(".cmsc-pb-image__figure[data-caption-md='below'] { display: inline-block; }");
  });

  it('a Custom px size per breakpoint (stored by R19B without a size: Custom) and an alignment per breakpoint; weight and colour ignored', () => {
    const caption = dom('cms.Image', {
      ...IMAGE,
      captionSizePx: { base: 10, tablet: 12 },
      captionAlign: { base: 'center', tablet: 'start' },
      captionWeight: 300,
      captionColor: '#000000',
    }).querySelector('figcaption')!;
    expect(caption.className).toContain('cmsc-pb-image__caption--styled');
    expect(caption.className).toContain('cmsc-pb-ts-size');
    const style = caption.getAttribute('style') ?? '';
    expect(style).toContain('--pb-ts-size:10px');
    expect(style).toContain('--pb-ts-size-md:12px');
    expect(style).toContain('--pb-img-caption-align:center');
    expect(style).toContain('--pb-img-caption-align-md:start');
    expect(style).not.toContain('font-weight');
    expect(style).not.toContain('color');
    const css = sheet();
    expect(css).toContain('.cmsc-pb-image__caption--styled { text-align: var(--pb-img-caption-align, start); }');
  });

  it('R23 (T446): a type token size brings its line height, weight and tracking', () => {
    const style = dom('cms.Image', { ...IMAGE, captionSize: 'body' }).querySelector('figcaption')!.getAttribute('style') ?? '';
    expect(style).toContain('font-size:var(--cmsb-t-body-size, 16px)');
    expect(style).toContain('line-height:var(--cmsb-t-body-lh, 1.65)');
  });

  it('the caption’s look is offered with a caption, the placement on the Responsive tab', async () => {
    expect(await fieldKeys('cms.Image', {})).not.toContain('captionSize');
    const keys = await fieldKeys('cms.Image', { caption: 'A' });
    expect(keys).toEqual(expect.arrayContaining(['captionPlacement', 'captionSize', 'captionAlign']));
    for (const key of ['captionSizePx', 'captionWeight', 'captionColor', 'captionMinWidthPx']) expect(keys).not.toContain(key);
    expect(await fieldKeys('cms.Image', { caption: 'A', captionSize: 'custom' })).toContain('captionSizePx');
    const placement = ((config.components['cms.Image'] as ComponentConfig).fields as Record<string, { metadata?: unknown }>)['captionPlacement'];
    expect(placement?.metadata).toBeDefined();
  });
});
