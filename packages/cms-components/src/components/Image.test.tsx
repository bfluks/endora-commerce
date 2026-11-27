// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isResponsiveField } from '@endora-commerce/page-builder-core';
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
 * `specs/163-page-builder-marketing-pages/` T127, US3, research R-9 —
 * `cms.Image` gains art direction (a mobile image), an aspect ratio per
 * breakpoint, an overlay (solid or gradient, direction, strength) and an
 * optional caption below or beside the image (an "image + caption" line such
 * as a small avatar group and a sentence).
 *
 * Extend, don't narrow: an image stored on `origin/master` renders today's
 * `<img>` — the same width, fit, opacity, radius, link and alignment — now
 * lazy-loaded; every new option is off by default.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.Image'] as unknown as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;

const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');

const IMAGE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const MOBILE_IMAGE = '7a2d3c4b-5e6f-4071-8b8c-0d1e2f3a4b5c';

function image(props: Record<string, unknown> = {}): Data['content'][number] {
  return { type: 'cms.Image', props: { ...defaults, id: 'image-1', ...props } } as Data['content'][number];
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

async function fieldsFor(props: Record<string, unknown>): Promise<Fields> {
  const fields = block.fields as Fields;
  if (!block.resolveFields) return fields;
  return block.resolveFields(
    { props: { id: 'image-1', ...defaults, ...props } } as never,
    { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cms.Image — as on origin/master', () => {
  it('an image stored on origin/master renders one <img> with today\'s inline style, now lazy', () => {
    const host = dom([image({ src: 'https://cdn.example.com/a.jpg', alt: 'A product', objectFit: 'contain', opacity: 80 })]);
    const imgs = host.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    const img = imgs[0] as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/a.jpg');
    expect(img.getAttribute('alt')).toBe('A product');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.opacity).toBe('0.8');
    expect(img.style.display).toBe('inline-block');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    // No new wrapper unless a new option asks for one.
    expect(host.querySelector('picture, figure, .cmsc-pb-image__frame, .cmsc-pb-image__overlay')).toBeNull();
  });

  it('keeps today\'s defaults, every new option off', () => {
    // R17 (deliberately changed, standing rule 13): a new image starts on the asset library (T214)
    // and with no link — the shared `link` replaced `href` and `linkTarget` (T212).
    expect(defaults).not.toHaveProperty('href');
    expect(defaults).not.toHaveProperty('linkTarget');
    expect(defaults).not.toHaveProperty('link');
    expect(defaults).toMatchObject({
      imageSource: 'library',
      src: '',
      alt: '',
      objectFit: 'cover',
      opacity: 100,
      widthMode: 'auto',
      widthPx: 320,
      align: 'left',
    });
    for (const key of ['mobileSrc', 'mobileAssetId', 'ratio', 'overlay', 'caption']) {
      expect(defaults[key] === undefined || defaults[key] === '' || (defaults[key] as { kind?: string })?.kind === 'none', key).toBe(true);
    }
  });
});

describe('cms.Image — art direction, ratio, overlay and caption (T127)', () => {
  it('a mobile image is a <source> below the tablet tier, in the same <img>', () => {
    const host = dom([
      image({ imageSource: 'library', assetId: IMAGE, mobileAssetId: MOBILE_IMAGE, alt: 'Workshop' }),
    ]);
    const picture = host.querySelector('picture')!;
    expect(picture).not.toBeNull();
    const source = picture.querySelector('source')!;
    expect(source.getAttribute('media')).toBe('(max-width: 767.98px)');
    expect(source.getAttribute('srcset')).toBe(`https://api.example.com/assets/file/${MOBILE_IMAGE}`);
    expect(picture.querySelector('img')!.getAttribute('src')).toBe(`https://api.example.com/assets/file/${IMAGE}`);
    expect(picture.querySelector('img')!.getAttribute('alt')).toBe('Workshop');
  });

  it('a URL image takes a mobile URL the same way', () => {
    const host = dom([image({ src: 'https://cdn.example.com/wide.jpg', mobileSrc: 'https://cdn.example.com/tall.jpg' })]);
    expect(host.querySelector('picture source')!.getAttribute('srcset')).toBe('https://cdn.example.com/tall.jpg');
  });

  it('a ratio per breakpoint is a frame that reserves the space, the image covering it', () => {
    const host = dom([image({ src: 'https://cdn.example.com/a.jpg', ratio: { base: '3:4', desktop: '67:20' } })]);
    const frame = host.querySelector('.cmsc-pb-image__frame') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.classList).toContain('cmsc-pb-image__frame--ratio');
    expect(frame.style.getPropertyValue('--pb-ratio')).toBe('3 / 4');
    expect(frame.style.getPropertyValue('--pb-ratio-md')).toBe('3 / 4');
    expect(frame.style.getPropertyValue('--pb-ratio-lg')).toBe('67 / 20');
    expect(frame.querySelector('img')).not.toBeNull();
  });

  it('an `auto` ratio is the image\'s own: no frame', () => {
    const host = dom([image({ src: 'https://cdn.example.com/a.jpg', ratio: 'auto' })]);
    expect(host.querySelector('.cmsc-pb-image__frame')).toBeNull();
  });

  it('a gradient overlay fades towards its direction at its strength, over the image, hidden from assistive tech', () => {
    const host = dom([
      image({ src: 'https://cdn.example.com/a.jpg', overlay: { kind: 'gradient', direction: 'to-top', strength: 60 } }),
    ]);
    const overlay = host.querySelector('.cmsc-pb-image__frame .cmsc-pb-image__overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.style.background).toContain('linear-gradient');
    expect(overlay.style.background).toContain('to top');
    expect(overlay.style.background).toContain('0.6');
  });

  it('a solid overlay is a flat layer; `none` adds nothing', () => {
    const solid = dom([image({ src: 'https://cdn.example.com/a.jpg', overlay: { kind: 'solid', strength: 40 } })]);
    expect((solid.querySelector('.cmsc-pb-image__overlay') as HTMLElement).style.background).toContain('0.4');
    const none = dom([image({ src: 'https://cdn.example.com/a.jpg', overlay: { kind: 'none', strength: 40 } })]);
    expect(none.querySelector('.cmsc-pb-image__overlay')).toBeNull();
  });

  it('a caption is a <figcaption> below the image, or beside it', () => {
    const below = dom([image({ src: 'https://cdn.example.com/a.jpg', caption: 'Our team at work' })]);
    const figure = below.querySelector('figure.cmsc-pb-image__figure')!;
    expect(figure).not.toBeNull();
    expect(figure.getAttribute('data-caption')).toBe('below');
    expect(figure.querySelector('figcaption')!.textContent).toBe('Our team at work');
    expect(figure.querySelector('img')).not.toBeNull();

    const beside = dom([
      image({ src: 'https://cdn.example.com/avatars.png', caption: 'Trusted by 2,000 teams', captionPlacement: 'beside', widthMode: 'custom', widthPx: 96 }),
    ]);
    expect(beside.querySelector('figure')!.getAttribute('data-caption')).toBe('beside');
    expect(beside.querySelector('figcaption')!.textContent).toBe('Trusted by 2,000 teams');
  });

  it('a linked image keeps its link around the image, the caption outside it', () => {
    const host = dom([image({ src: 'https://cdn.example.com/a.jpg', href: '/about', caption: 'About us' })]);
    const link = host.querySelector('figure a')!;
    expect(link.getAttribute('href')).toBe('/about');
    expect(link.querySelector('img')).not.toBeNull();
    expect(link.querySelector('figcaption')).toBeNull();
  });
});

describe('cms.Image — fields', () => {
  it('offers the mobile image of the chosen source, the ratio, the overlay and the caption', async () => {
    const url = Object.keys(await fieldsFor({ imageSource: 'url' }));
    expect(url).toEqual(expect.arrayContaining(['src', 'mobileSrc', 'ratio', 'overlay', 'caption']));
    expect(url).not.toContain('mobileAssetId');
    const library = Object.keys(await fieldsFor({ imageSource: 'library' }));
    expect(library).toEqual(expect.arrayContaining(['assetId', 'mobileAssetId']));
    expect(library).not.toContain('mobileSrc');
  });

  it('shows the caption placement only once there is a caption', async () => {
    expect(Object.keys(await fieldsFor({ caption: '' }))).not.toContain('captionPlacement');
    const placement = (await fieldsFor({ caption: 'A caption' }))['captionPlacement'] as { options: { value: unknown }[] };
    expect(placement.options.map((o) => o.value)).toEqual(['below', 'beside']);
  });

  it('the ratio is a responsive field, on the Responsive tab', () => {
    expect(isResponsiveField((block.fields as Fields)['ratio'] as never)).toBe(true);
    expect((block as unknown as { responsiveFields?: string[] }).responsiveFields).toContain('ratio');
  });

  it('the overlay has today\'s overlay vocabulary', () => {
    const overlay = (block.fields as Fields)['overlay'] as { objectFields: Record<string, { options?: { value: unknown }[] }> };
    expect(overlay.objectFields['kind']!.options!.map((o) => o.value)).toEqual(['none', 'solid', 'gradient']);
    expect(overlay.objectFields['direction']!.options!.map((o) => o.value)).toEqual(['to-top', 'to-bottom', 'to-left', 'to-right']);
    expect(Object.keys(overlay.objectFields)).toContain('strength');
  });
});

describe('cms.Image — stylesheet', () => {
  const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');

  it('the ratio frame reserves its space per breakpoint and the image covers it', () => {
    expect(css).toContain('.cmsc-pb-image__frame--ratio { aspect-ratio: var(--pb-ratio, auto); }');
    expect(css).toContain('.cmsc-pb-image__frame--ratio img { width: 100%; height: 100%; }');
    expect(css).toMatch(/@media \(min-width: 1024px\) \{ \.cmsc-pb-image__frame--ratio \{ aspect-ratio: var\(--pb-ratio-lg, var\(--pb-ratio-md, var\(--pb-ratio, auto\)\)\); \} \}/);
  });

  it('the overlay covers the frame and lets clicks through; a beside caption sits next to the image', () => {
    expect(css).toContain('.cmsc-pb-image__overlay { position: absolute; inset: 0; pointer-events: none; }');
    expect(css).toContain(".cmsc-pb-image__figure[data-caption='beside'] { display: inline-flex; align-items: center;");
  });
});
