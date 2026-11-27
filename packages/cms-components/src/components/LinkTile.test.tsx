// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T053, US4, FR-020,
 * contracts/blocks.md `cms.LinkTile` — an image, a title and a "more" link
 * label, the whole tile one link to wherever the `LinkValue` points.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.LinkTile']?.defaultProps ?? {}) as Record<string, unknown>;
const ASSET = '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f';
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.LinkTile', props: { ...defaults, id: 'tile-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider
      embeds={{ blocks: {}, templates: {} }}
      assets={{ [ASSET]: { url: '/assets/file/brochure.pdf' } }}
      mediaBaseUrl="https://api.example.com"
    >
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.LinkTile (T053)', () => {
  it('default props render a non-empty tile: an image frame, a title and the link label', () => {
    const tile = dom().querySelector('.cmsc-pb-link-tile');
    expect(tile).not.toBeNull();
    expect(tile!.querySelector('.cmsc-pb-link-tile__media')).not.toBeNull();
    expect(tile!.querySelector('.cmsc-pb-link-tile__title')?.textContent).toBeTruthy();
    expect(tile!.querySelector('.cmsc-pb-link-tile__label')?.textContent).toBeTruthy();
  });

  it('resolves each link kind, the whole tile being the one link', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ kind: 'url', href: 'https://example.com/guide' }, 'https://example.com/guide'],
      [{ kind: 'page', slug: 'about' }, '/about'],
      [{ kind: 'product', slug: 'chair' }, '/p/chair'],
      [{ kind: 'category', slug: 'seating' }, '/c/seating'],
      [{ kind: 'asset', fileAssetId: ASSET }, 'https://api.example.com/assets/file/brochure.pdf'],
      [{ kind: 'anchor', anchor: 'contact' }, '#contact'],
    ];
    for (const [link, href] of cases) {
      const host = dom({ title: doc('Guide'), linkLabel: 'Read more', link });
      const anchors = host.querySelectorAll('a');
      expect(anchors, String(link['kind'])).toHaveLength(1);
      expect(anchors[0]!.getAttribute('href'), String(link['kind'])).toBe(href);
      expect(anchors[0]!.className).toContain('cmsc-pb-link-tile');
      expect(anchors[0]!.textContent).toContain('Guide');
      expect(anchors[0]!.textContent).toContain('Read more');
    }
    const blank = dom({ link: { kind: 'url', href: 'https://example.com', target: '_blank' } }).querySelector('a')!;
    expect(blank.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders no link when the link resolves to nothing, keeping the content', () => {
    const host = dom({ title: doc('Guide'), link: { kind: 'url', href: 'javascript:alert(1)' } });
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('.cmsc-pb-link-tile__title')?.textContent).toBe('Guide');
  });

  it('frames the image at the tile\'s ratio', () => {
    const picture = dom({ image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' }, ratio: '3:4' }).querySelector<HTMLElement>('picture')!;
    expect(picture.getAttribute('style')).toContain('--pb-ratio:3 / 4');
  });
});

/** `specs/163-page-builder-marketing-pages/` T130, T131 (R5) — a ratio per breakpoint, and filter tags. */
describe('cms.LinkTile — ratio per breakpoint and tags (T130, T131)', () => {
  const block = config.components['cms.LinkTile'] as { fields: Record<string, { type: string; metadata?: unknown; options?: Array<{ value: unknown }> }>; responsiveFields?: string[] };

  it('the ratio is a value per breakpoint on the Responsive tab, with every ratio it had', () => {
    expect(block.fields['ratio']?.metadata).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    expect(block.fields['ratio']?.options?.map((option) => option.value)).toEqual(expect.arrayContaining(['1:1', '4:3', '3:4', '3:2', '16:9']));
    expect(block.responsiveFields ?? []).toContain('ratio');
    expect(block.fields['tags']?.type).toBe('text');
  });

  it('frames the image and the empty placeholder at each breakpoint\'s ratio', () => {
    const ratio = { base: '16:9', desktop: '3:4' };
    const picture = dom({ image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' }, ratio }).querySelector<HTMLElement>('picture')!;
    expect(picture.getAttribute('style')).toContain('--pb-ratio:16 / 9;--pb-ratio-md:16 / 9;--pb-ratio-lg:3 / 4');
    const placeholder = dom({ image: { imageSource: 'library', alt: '' }, ratio }).querySelector<HTMLElement>('.cmsc-pb-link-tile__placeholder')!;
    expect(placeholder.className).toContain('cmsc-picture--ratio');
    expect(placeholder.getAttribute('style')).toContain('--pb-ratio:16 / 9;--pb-ratio-md:16 / 9;--pb-ratio-lg:3 / 4');
    // An unknown ratio at a breakpoint falls back to the default, 4:3.
    const odd = dom({ image: { imageSource: 'library', alt: '' }, ratio: { base: 'tall', desktop: '1:1' } }).querySelector<HTMLElement>('.cmsc-pb-link-tile__placeholder')!;
    expect(odd.getAttribute('style')).toContain('--pb-ratio:4 / 3;--pb-ratio-md:4 / 3;--pb-ratio-lg:1 / 1');
  });

  it('writes its tags for the Carousel\'s filter on the tile', () => {
    expect(dom({ tags: 'Retail' }).querySelector('.cmsc-pb-link-tile')!.getAttribute('data-pb-tags')).toBe('retail');
    expect(dom().querySelector('[data-pb-tags]')).toBeNull();
  });
});

/** `specs/163-page-builder-marketing-pages/` T144 (R7) — the title's and the label's size and font, and the label's style. */
describe('cms.LinkTile — title and label typography, label style (T144)', () => {
  const block = config.components['cms.LinkTile'] as {
    fields: Record<string, { type: string; metadata?: unknown; options?: Array<{ value: unknown }> }>;
    responsiveFields?: string[];
    resolveFields?: (data: unknown, params: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
  const values = (key: string) => block.fields[key]?.options?.map((option) => option.value) ?? [];

  it('offers a size per breakpoint and a font role for the title and the label, and the label\'s style; none stored by default', async () => {
    for (const key of ['titleSize', 'labelSize']) {
      expect(values(key), key).toEqual(['default', 'display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'small', 'custom']);
      expect(block.fields[key]?.metadata, key).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    }
    expect(values('titleFont')).toEqual(['default', 'heading', 'body']);
    expect(values('labelFont')).toEqual(['default', 'heading', 'body']);
    expect(values('labelStyle')).toEqual(['link', 'button', 'none']);
    expect(block.responsiveFields ?? []).toEqual(expect.arrayContaining(['ratio', 'titleSize', 'titleSizePx', 'labelSize', 'labelSizePx']));
    for (const key of ['titleSize', 'titleSizePx', 'titleFont', 'labelSize', 'labelSizePx', 'labelFont', 'labelStyle']) {
      expect(defaults, key).not.toHaveProperty(key);
    }
    const plain = Object.keys(await block.resolveFields!({ props: { ...defaults, id: 't' } }, { fields: block.fields }));
    expect(plain).not.toContain('titleSizePx');
    expect(plain).not.toContain('labelSizePx');
    const custom = Object.keys(
      await block.resolveFields!({ props: { ...defaults, id: 't', titleSize: 'custom', labelSize: { base: 'custom' } } }, { fields: block.fields }),
    );
    expect(custom).toEqual(expect.arrayContaining(['titleSizePx', 'labelSizePx']));
  });

  it('nothing chosen is today\'s tile: the title\'s text and a text link with an arrow', () => {
    const tile = dom({ title: doc('Guide'), linkLabel: 'Read more' });
    expect(tile.querySelector('.cmsc-pb-link-tile__title-text, .cmsc-pb-link-tile__label-text')).toBeNull();
    const label = tile.querySelector('.cmsc-pb-link-tile__label')!;
    expect(label.textContent).toBe('Read more →');
    expect(label.querySelector('.cmsc-pb-link-tile__arrow')?.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('.cmsc-btn')).toBeNull();
  });

  it('sizes the title and the label by a type token or a Custom px, and sets their font role', () => {
    const tile = dom({
      title: doc('Guide'),
      linkLabel: 'Read more',
      titleSize: 'h4',
      titleFont: 'body',
      labelSize: 'custom',
      labelSizePx: 20,
    });
    const title = tile.querySelector<HTMLElement>('.cmsc-pb-link-tile__title .cmsc-pb-link-tile__title-text')!;
    expect(title.className).toContain('cmsc-t--h4');
    expect(title.getAttribute('style')).toContain('font-family:var(--cmsb-font-body');
    expect(title.textContent).toBe('Guide');
    const label = tile.querySelector<HTMLElement>('.cmsc-pb-link-tile__label .cmsc-pb-link-tile__label-text')!;
    expect(label.className).toContain('cmsc-pb-text-size');
    expect(label.getAttribute('style')).toContain('--pb-text-size:20px');
    // The arrow follows the label's size: it sits inside the sized text.
    expect(label.querySelector('.cmsc-pb-link-tile__arrow')).not.toBeNull();
  });

  it('a button label is a button look inside the one link (no nested control); "none" shows no label', () => {
    const button = dom({ title: doc('Guide'), linkLabel: 'Read more', labelStyle: 'button' });
    expect(button.querySelectorAll('a')).toHaveLength(1);
    expect(button.querySelectorAll('button')).toHaveLength(0);
    expect(button.querySelector('.cmsc-pb-link-tile__label')).toBeNull();
    const look = button.querySelector('.cmsc-pb-link-tile__button')!;
    expect(look.tagName).toBe('SPAN');
    expect(look.className).toContain('cmsc-btn');
    expect(look.className).toContain('cmsc-btn--primary-solid');
    expect(look.textContent).toBe('Read more');
    expect(look.querySelector('.cmsc-pb-link-tile__arrow')).toBeNull();
    const none = dom({ title: doc('Guide'), linkLabel: 'Read more', labelStyle: 'none' });
    expect(none.querySelector('.cmsc-pb-link-tile__label')).toBeNull();
    // The tile stays one link, named by its title.
    expect(none.querySelector('a')!.textContent).toBe('Guide');
  });
});

describe('cms.LinkTile — resting title and label colour (T178)', () => {
  const block = config.components['cms.LinkTile'] as { fields: Record<string, { label?: string }> };
  const TILE = { title: doc('Guide'), linkLabel: 'Read more', link: { kind: 'page', slug: 'guide' } };
  const html = (props: Record<string, unknown> = {}) => dom({ ...TILE, ...props }).innerHTML;
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');

  it('unset (or anything but a hex or a known token) renders exactly what it rendered before', () => {
    const today = html();
    expect(today).not.toContain('-color');
    expect(html({ titleColor: '', labelColor: 'red;background:url(x)' })).toBe(today);
    expect(html({ titleColor: 'token:nope' })).toBe(today);
  });

  it('a hex or a brand token sets the resting colour of the title and of the text-link label', () => {
    const tile = dom({ ...TILE, titleColor: '#475569', labelColor: 'token:secondary' });
    const link = tile.querySelector<HTMLElement>('a.cmsc-pb-link-tile')!;
    expect(link.classList).toContain('cmsc-pb-link-tile--title-color');
    expect(link.classList).toContain('cmsc-pb-link-tile--label-color');
    expect(link.getAttribute('style')).toContain('--pb-title-color:#475569');
    expect(link.getAttribute('style')).toMatch(/--pb-label-color:var\(--cmsb-color-secondary, #[0-9a-f]{6}\)/);
    // Each one is its own: a title colour alone writes nothing for the label.
    const titleOnly = dom({ ...TILE, titleColor: '#475569' }).querySelector('a')!;
    expect(titleOnly.className).not.toContain('label-color');
    expect(titleOnly.getAttribute('style')).not.toContain('--pb-label-color');
  });

  it('a label shown as a button keeps the button\'s colours; no title, no title colour', () => {
    const button = dom({ ...TILE, labelStyle: 'button', labelColor: '#475569' }).querySelector('a')!;
    expect(button.className).not.toContain('label-color');
    const untitled = dom({ ...TILE, title: '', titleColor: '#475569' }).querySelector('a')!;
    expect(untitled.className).not.toContain('title-color');
  });

  it('offers both as colours, each on the Responsive tab since T181 (its hover colour follows its font since T188); none stored by default', () => {
    const keys = Object.keys(block.fields);
    // T181: the resting colours are values per breakpoint, so the editor lists them with the responsive fields
    // (T188: the weights too, so a hover colour now follows the font).
    expect(keys.indexOf('titleHoverColor')).toBe(keys.indexOf('titleFont') + 1);
    expect(keys.indexOf('labelHoverColor')).toBe(keys.indexOf('labelFont') + 1);
    expect(keys.indexOf('titleColor')).toBe(keys.indexOf('titleWeight') + 1);
    expect(keys.indexOf('labelColor')).toBe(keys.indexOf('labelWeight') + 1);
    expect(keys.indexOf('titleColor')).toBeGreaterThan(keys.indexOf('tags'));
    expect(keys.indexOf('labelColor')).toBeGreaterThan(keys.indexOf('titleColor'));
    expect(block.fields['titleColor']?.label).toBe('Title color');
    expect(block.fields['labelColor']?.label).toBe('Label color');
    expect(defaults).not.toHaveProperty('titleColor');
    expect(defaults).not.toHaveProperty('labelColor');
  });

  it('the stylesheet paints the resting colour, and a hover colour still wins on hover and focus', () => {
    const css = builtCss();
    const title = css.indexOf('.cmsc-pb-link-tile--title-color.cmsc-pb-link-tile__title{color:var(--pb-title-color)}');
    const label = css.indexOf('.cmsc-pb-link-tile--label-color.cmsc-pb-link-tile__label{color:var(--pb-label-color)}');
    expect(title).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(-1);
    // The hover rules come later (and are more specific), so a resting colour never masks them.
    expect(css.indexOf('.cmsc-pb-link-tile--hover-title:is(:hover,:focus-visible).cmsc-pb-link-tile__title')).toBeGreaterThan(title);
    expect(css.indexOf('.cmsc-pb-link-tile--hover-label:is(:hover,:focus-visible).cmsc-pb-link-tile__label')).toBeGreaterThan(label);
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T181 (R13) — the resting title and
 * label colour per breakpoint, so a tile can rest light on touch widths and
 * darker on desktop. A single stored colour renders exactly as in T178; a
 * value per breakpoint writes `--pb-title-color(-md|-lg)` (and the label's)
 * with a class per tier that has a colour of its own, so a tier with none
 * keeps the tile's own look (a value without `base`, T170).
 */
describe('cms.LinkTile — resting colours per breakpoint (T181)', () => {
  const block = config.components['cms.LinkTile'] as {
    fields: Record<string, { label?: string; metadata?: unknown }>;
    responsiveFields?: string[];
  };
  const TILE = { title: doc('Guide'), linkLabel: 'Read more', link: { kind: 'page', slug: 'guide' } };
  const tile = (props: Record<string, unknown>) => dom({ ...TILE, ...props }).querySelector<HTMLElement>('a.cmsc-pb-link-tile')!;
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');

  it('both colours are values per breakpoint on the Responsive tab; none stored by default', () => {
    for (const key of ['titleColor', 'labelColor']) {
      expect(block.fields[key]?.metadata, key).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
      expect(block.responsiveFields ?? [], key).toContain(key);
      expect(defaults).not.toHaveProperty(key);
    }
    expect(block.fields['titleColor']?.label).toBe('Title color');
    expect(block.fields['labelColor']?.label).toBe('Label color');
  });

  it('a single stored colour renders exactly what T178 rendered', () => {
    const single = tile({ titleColor: '#475569', labelColor: '#1d4ed8' });
    expect(single.className).toBe('cmsc-pb-link-tile cmsc-pb-link-tile--link cmsc-pb-link-tile--title-color cmsc-pb-link-tile--label-color');
    expect(single.getAttribute('style')).not.toMatch(/-color-(md|lg)/);
    // The same colour stored with only its base is the same tile.
    expect(tile({ titleColor: { base: '#475569' }, labelColor: { base: '#1d4ed8' } }).outerHTML).toBe(single.outerHTML);
  });

  it('a colour per breakpoint writes a variable and a class for each tier with a colour of its own', () => {
    const link = tile({ titleColor: { base: '#ffffff', desktop: '#334155' }, labelColor: { base: '#ffffff', tablet: 'token:secondary' } });
    expect(link.classList).toContain('cmsc-pb-link-tile--title-color');
    expect(link.classList).toContain('cmsc-pb-link-tile--title-color-lg');
    expect(link.classList).not.toContain('cmsc-pb-link-tile--title-color-md');
    expect(link.classList).toContain('cmsc-pb-link-tile--label-color');
    expect(link.classList).toContain('cmsc-pb-link-tile--label-color-md');
    const style = link.getAttribute('style') ?? '';
    expect(style).toContain('--pb-title-color:#ffffff');
    expect(style).toContain('--pb-title-color-lg:#334155');
    expect(style).toContain('--pb-label-color:#ffffff');
    expect(style).toMatch(/--pb-label-color-md:var\(--cmsb-color-secondary, #[0-9a-f]{6}\)/);
  });

  it('a value without a base keeps the tile\'s own colour below its first breakpoint; an invalid tier is ignored', () => {
    const desktopOnly = tile({ titleColor: { desktop: '#334155' } });
    expect(desktopOnly.classList).toContain('cmsc-pb-link-tile--title-color-lg');
    expect(desktopOnly.classList).not.toContain('cmsc-pb-link-tile--title-color');
    expect(desktopOnly.getAttribute('style')).not.toContain('--pb-title-color:');
    const invalid = tile({ titleColor: { base: 'red;x', tablet: 'token:nope', desktop: '#334155' } });
    expect(invalid.className).toBe('cmsc-pb-link-tile cmsc-pb-link-tile--link cmsc-pb-link-tile--title-color-lg');
    // Nothing valid: today's tile.
    expect(tile({ titleColor: { base: 'nope' } }).outerHTML).toBe(tile({}).outerHTML);
    // A button label keeps the button's colours, at every breakpoint.
    expect(tile({ labelStyle: 'button', labelColor: { desktop: '#334155' } }).className).not.toContain('label-color');
  });

  it('the stylesheet paints each tier from its breakpoint up, before the hover rules, which still win', () => {
    const css = builtCss();
    const md = css.indexOf('@media(min-width:768px){.cmsc-pb-link-tile--title-color-md.cmsc-pb-link-tile__title{color:var(--pb-title-color-md)}.cmsc-pb-link-tile--label-color-md.cmsc-pb-link-tile__label{color:var(--pb-label-color-md)}}');
    const lg = css.indexOf('@media(min-width:1024px){.cmsc-pb-link-tile--title-color-lg.cmsc-pb-link-tile__title{color:var(--pb-title-color-lg)}.cmsc-pb-link-tile--label-color-lg.cmsc-pb-link-tile__label{color:var(--pb-label-color-lg)}}');
    expect(md).toBeGreaterThan(-1);
    expect(lg).toBeGreaterThan(md);
    expect(css.indexOf('.cmsc-pb-link-tile--hover-title:is(:hover,:focus-visible).cmsc-pb-link-tile__title')).toBeGreaterThan(lg);
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T188 (R14) — the title's and the
 * label's weight per breakpoint (Responsive tab), as T185 did for the
 * accordion's titles. A single weight — plain, stored with only its base, or
 * the same at every tier — stays T151's inline `font-weight`, byte for byte;
 * weights that differ across breakpoints go on the text's own span as
 * `--pb-item-weight(-md|-lg)` with the `cmsc-pb-item-weight` class, every tier
 * written, and a tier with none of its own keeps today's weight: a sized
 * text's token weight, else `initial` (the variable left invalid, so the span
 * inherits the tile's own weight, as the text did with no span).
 */
describe('cms.LinkTile — title and label weight per breakpoint (T188)', () => {
  const block = config.components['cms.LinkTile'] as {
    fields: Record<string, { label?: string; metadata?: unknown; options?: Array<{ value: unknown }> }>;
    responsiveFields?: string[];
  };
  const TILE = { title: doc('Guide'), linkLabel: 'Read more', link: { kind: 'page', slug: 'guide' } };
  const tile = (props: Record<string, unknown>) => dom({ ...TILE, ...props });
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');

  it('both weights are values per breakpoint on the Responsive tab, with today\'s options; none stored by default', () => {
    for (const key of ['titleWeight', 'labelWeight']) {
      expect(block.fields[key]?.metadata, key).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
      expect(block.responsiveFields ?? [], key).toContain(key);
      expect(block.fields[key]?.options?.map((option) => option.value), key).toEqual(['default', 300, 400, 500, 600, 700, 800]);
      expect(defaults).not.toHaveProperty(key);
    }
    expect(block.fields['titleWeight']?.label).toBe('Title weight');
    expect(block.fields['labelWeight']?.label).toBe('Label weight');
  });

  it('a single weight renders exactly what T151 rendered, whether plain, stored with only its base or the same at every tier', () => {
    const single = tile({ titleWeight: 400, labelWeight: 700 }).innerHTML;
    for (const [titleWeight, labelWeight] of [
      [{ base: 400 }, { base: 700 }],
      [{ base: 400, tablet: 400, desktop: 400 }, { base: '700', desktop: 700 }],
    ]) {
      expect(tile({ titleWeight, labelWeight }).innerHTML, JSON.stringify(titleWeight)).toBe(single);
    }
    const today = tile({}).innerHTML;
    for (const titleWeight of [{ base: 'default' }, { desktop: 'default' }, { base: 'bold', desktop: 250 }]) {
      expect(tile({ titleWeight, labelWeight: titleWeight }).innerHTML, JSON.stringify(titleWeight)).toBe(today);
    }
  });

  it('weights that differ across breakpoints are written per tier on the text\'s span, not inline', () => {
    const host = tile({ titleWeight: { base: 400, desktop: 500 }, labelWeight: { base: 300, tablet: 600 } });
    const title = host.querySelector<HTMLElement>('.cmsc-pb-link-tile__title-text')!;
    expect(title.classList).toContain('cmsc-pb-item-weight');
    expect(title.getAttribute('style')).toBe('--pb-item-weight:400;--pb-item-weight-md:400;--pb-item-weight-lg:500');
    expect(title.style.fontWeight).toBe('');
    const label = host.querySelector<HTMLElement>('.cmsc-pb-link-tile__label-text')!;
    expect(label.classList).toContain('cmsc-pb-item-weight');
    expect(label.getAttribute('style')).toBe('--pb-item-weight:300;--pb-item-weight-md:600;--pb-item-weight-lg:600');
    // A button label takes the same weights.
    const button = tile({ labelStyle: 'button', labelWeight: { base: 400, desktop: 700 } }).querySelector<HTMLElement>('.cmsc-pb-link-tile__label-text')!;
    expect(button.getAttribute('style')).toBe('--pb-item-weight:400;--pb-item-weight-md:400;--pb-item-weight-lg:700');
  });

  it('below the first chosen tier, and on a tier left on Default, the text keeps today\'s weight (the tile\'s own, or its size token\'s)', () => {
    const plain = tile({ titleWeight: { desktop: 500 } }).querySelector<HTMLElement>('.cmsc-pb-link-tile__title-text')!;
    expect(plain.getAttribute('style')).toBe('--pb-item-weight:initial;--pb-item-weight-md:initial;--pb-item-weight-lg:500');
    const sized = tile({ titleSize: 'h4', titleWeight: { tablet: 500, desktop: 'default' } }).querySelector<HTMLElement>('.cmsc-pb-link-tile__title-text')!;
    expect(sized.className).toBe('cmsc-pb-link-tile__title-text cmsc-t--h4 cmsc-pb-item-weight');
    expect(sized.getAttribute('style')).toBe(
      '--pb-item-weight:var(--cmsb-t-h4-w, 700);--pb-item-weight-md:500;--pb-item-weight-lg:var(--cmsb-t-h4-w, 700)',
    );
  });

  it('the stylesheet reads each tier\'s own weight from its breakpoint up, after the type tokens\' weights', () => {
    const css = builtCss();
    const base = css.indexOf('.cmsc-pb-item-weight{font-weight:var(--pb-item-weight)}');
    expect(base).toBeGreaterThan(css.indexOf('.cmsc-t--small{'));
    expect(css.indexOf('@media(min-width:768px){.cmsc-pb-item-weight{font-weight:var(--pb-item-weight-md)}}')).toBeGreaterThan(base);
    expect(css.indexOf('@media(min-width:1024px){.cmsc-pb-item-weight{font-weight:var(--pb-item-weight-lg)}}')).toBeGreaterThan(base);
  });
});
