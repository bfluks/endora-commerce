// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { isEmptyInline } from './section-parts.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R20E — defects found while
 * rebuilding the reference pages, each with its regression case:
 *
 * - T292: a read-more label on an image card kept clear of a caption on the
 *   same edge (it overlapped it on a narrow card);
 * - T293: an image caption beside the image at a breakpoint, with a custom
 *   image width, sized as image plus caption (it was squeezed to the image's
 *   width, one word per line);
 * - T294: an inline heading left empty renders nothing (an empty `<h3>` was
 *   written);
 * - T295: no props object holding `key` spread into JSX (React's warning on
 *   a media-and-text video).
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
  captionPlacement: 'bottom-left',
  link: { kind: 'page', slug: 'projects' },
};

describe('a read-more label keeps clear of the caption on its edge (T292)', () => {
  it('unset, or on another edge, the card renders as before', () => {
    const plain = dom('cms.CarouselImage', CARD).querySelector('figure')!;
    expect(plain.className).not.toContain('more-clear');
    const apart = dom('cms.CarouselImage', { ...CARD, moreLabel: 'More', moreLabelPlacement: 'top-right' }).querySelector('figure')!;
    expect(apart.className).not.toContain('more-clear');
    const below = dom('cms.CarouselImage', { ...CARD, captionPlacement: 'below', moreLabel: 'More' }).querySelector('figure')!;
    expect(below.className).not.toContain('more-clear');
  });

  it('a caption on the label’s edge is lifted above the label’s line', () => {
    const bottom = dom('cms.CarouselImage', { ...CARD, moreLabel: 'More' }).querySelector('figure')!;
    expect(bottom.className).toContain('cmsc-pb-carousel-image--more-clear-bottom');
    const top = dom('cms.CarouselImage', { ...CARD, captionPlacement: 'top-center', moreLabel: 'More', moreLabelPlacement: 'top-left' }).querySelector('figure')!;
    expect(top.className).toContain('cmsc-pb-carousel-image--more-clear-top');
    const css = sheet();
    expect(css).toContain(
      '.cmsc-pb-carousel-image--more-clear-bottom .cmsc-pb-carousel-image__caption { bottom: calc(var(--cmsc-more-clear-inset) + var(--cmsc-more-clear-line)); }',
    );
    expect(css).toContain(
      '.cmsc-pb-carousel-image--more-clear-top .cmsc-pb-carousel-image__caption { top: calc(var(--cmsc-more-clear-inset) + var(--cmsc-more-clear-line)); }',
    );
  });
});

describe('the read-more label’s own colour and weight (T308) — removed by R23 (T445)', () => {
  it('the label takes the caption colour and the stylesheet weight', () => {
    const label = dom('cms.CarouselImage', { ...CARD, moreLabel: 'More', captionStyle: { color: '#ffcc00' } }).querySelector('.cmsc-pb-carousel-image__more')!;
    expect(label.getAttribute('style')).toBe('color:#ffcc00');
  });

  it('a stored colour, icon colour and weight of its own are ignored', () => {
    const label = dom('cms.CarouselImage', {
      ...CARD,
      moreLabel: 'More',
      moreLabelIcon: 'plus',
      captionStyle: { color: '#ffffff' },
      moreLabelColor: '#3366cc',
      moreLabelIconColor: '#ffffff',
      moreLabelWeight: 400,
    }).querySelector('.cmsc-pb-carousel-image__more')!;
    expect(label.getAttribute('style')).toBe('color:#ffffff');
    expect(label.querySelector('svg')?.hasAttribute('style')).toBe(false);
  });

  it('no fields for them', async () => {
    const keys = await fieldKeys('cms.CarouselImage', { caption: doc('A'), moreLabel: 'More' });
    for (const key of ['moreLabelColor', 'moreLabelIconColor', 'moreLabelWeight']) expect(keys).not.toContain(key);
  });
});

describe('an image caption beside the image at a breakpoint, with a custom width (T293)', () => {
  const IMAGE = { imageSource: 'url', src: 'https://example.com/avatars.png', alt: '', caption: 'Trusted by many teams', widthMode: 'custom', widthPx: 120 };

  it('one placement everywhere renders as before', () => {
    const figure = dom('cms.Image', IMAGE).querySelector('figure')!;
    expect(figure.className).not.toContain('--tiered');
    expect(figure.getAttribute('style')).toContain('width:120px');
  });

  it('below on phones and beside from the tablet: the image keeps its width and the caption gets its own column', () => {
    const figure = dom('cms.Image', { ...IMAGE, captionPlacement: { base: 'below', tablet: 'beside' } }).querySelector('figure')!;
    expect(figure.className).toContain('cmsc-pb-image__figure--tiered');
    expect(figure.getAttribute('style') ?? '').not.toMatch(/(^|;)width:/);
    expect(figure.getAttribute('style')).toContain('--pb-img-fig-w:120px');
    expect(figure.firstElementChild?.className).toBe('cmsc-pb-image__media');
    expect(figure.querySelector('img')?.getAttribute('style')).toContain('width:100%');
    const css = sheet();
    expect(css).toContain('.cmsc-pb-image__figure--tiered[data-caption] { width: var(--pb-img-fig-w, auto); }');
    expect(css).toContain(
      "@media (min-width: 768px) { .cmsc-pb-image__figure--tiered[data-caption-md='beside'] { width: auto; } .cmsc-pb-image__figure--tiered[data-caption-md='beside'] > .cmsc-pb-image__media { flex: none; width: var(--pb-img-fig-w, auto); max-width: 100%; }",
    );
  });

  it('the caption’s maximum width per breakpoint; R23 (T446): no minimum width (a stored one is ignored)', async () => {
    const caption = dom('cms.Image', { ...IMAGE, captionPlacement: 'beside', captionMinWidthPx: 120, captionMaxWidthPx: { base: 180, desktop: 240 } }).querySelector('figcaption')!;
    expect(caption.className).toContain('cmsc-pb-image__caption--measure');
    const style = caption.getAttribute('style') ?? '';
    expect(style).not.toContain('--pb-img-caption-min');
    expect(style).toContain('--pb-img-caption-max:180px');
    expect(style).toContain('--pb-img-caption-max-lg:240px');
    expect(sheet()).toContain(
      '.cmsc-pb-image__figure[data-caption] > .cmsc-pb-image__caption.cmsc-pb-image__caption--measure { max-width: var(--pb-img-caption-max, none); }',
    );
    expect(await fieldKeys('cms.Image', { caption: 'A' })).toContain('captionMaxWidthPx');
    expect(await fieldKeys('cms.Image', { caption: 'A' })).not.toContain('captionMinWidthPx');
    expect(await fieldKeys('cms.Image', {})).not.toContain('captionMaxWidthPx');
  });
});

describe('an inline heading left empty renders nothing (T294)', () => {
  it('reads blank text, hard breaks and no content as empty; an icon or a word as content', () => {
    expect(isEmptyInline({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isEmptyInline({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] })).toBe(true);
    expect(isEmptyInline({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }, { type: 'hardBreak' }] }] })).toBe(true);
    expect(isEmptyInline({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'inlineIcon', attrs: { name: 'check' } }] }] })).toBe(false);
    expect(isEmptyInline(doc('Word'))).toBe(false);
  });

  it('cms.MediaText with a blank heading writes no heading element', () => {
    const blank = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] };
    const host = dom('cms.MediaText', { heading: blank });
    expect(host.querySelector('.cmsc-pb-media-text__heading')).toBeNull();
    expect(host.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('cms.Hero with a blank title writes no title element', () => {
    const blank = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
    expect(dom('cms.Hero', { title: blank }).querySelector('.cmsc-pb-hero__title')).toBeNull();
  });

  it('cms.Heading left blank writes no heading element on the storefront (its box stays)', () => {
    const host = dom('cms.Heading', { text: { type: 'doc', content: [{ type: 'paragraph' }] } });
    expect(host.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(dom('cms.Heading', { text: doc('Title') }).querySelector('h1, h2, h3, h4, h5, h6')?.textContent).toBe('Title');
  });
});

describe('no props object holding `key` is spread into JSX (T295)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a media-and-text video pair renders without React’s key-spread warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const html = render('cms.MediaText', {
      media: { kind: 'video', videoSource: 'url', videoUrl: 'https://example.com/d.mp4', mobileVideoUrl: 'https://example.com/m.mp4' },
    });
    expect(html.match(/<video/g)).toHaveLength(2);
    const warnings = errors.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('"key" prop is being spread'));
    expect(warnings).toEqual([]);
  });
});
