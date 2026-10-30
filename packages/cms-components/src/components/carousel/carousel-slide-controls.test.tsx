// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import { CmsRenderProvider } from '../render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T253) — **the controls inside
 * a split slide**, under its text column (`controlsPlacement: 'slide'`, a
 * value per breakpoint like the others).
 *
 * The shell hands each slide its position; a `cms.CarouselSplit` renders the
 * arrows and the dots at the end of its text column. Only the shown slide's
 * copy is operable: the others are `inert` and hidden from assistive
 * technology, so a keyboard meets one set of controls. A carousel whose slides
 * draw no controls (none of them a split slide) keeps them under the track
 * there, so it is never left without controls.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.ContentSlider']?.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const split = (id: string, title: string) => ({
  type: 'cms.CarouselSplit',
  props: { id, title: doc(title), body: doc('Text'), media: { kind: 'image', image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' } }, buttons: [] },
});

function dom(props: Record<string, unknown>): HTMLElement {
  const content = [{ type: 'cms.ContentSlider', props: { ...defaults, id: 'carousel-1', slidesPerView: 1, ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }}>
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('controls inside a split slide (T253)', () => {
  it('each split slide draws the arrows and dots at the end of its text column; only the shown slide’s copy is operable', () => {
    const host = dom({ controlsPlacement: 'slide', controls: { arrows: true, dots: true }, slides: [split('a', 'First'), split('b', 'Second')] });
    const copies = Array.from(host.querySelectorAll<HTMLElement>('.cmsc-pb-carousel__controls--slide'));
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect(copy.parentElement?.className).toContain('cmsc-pb-carousel-split__text');
    expect(copies[0]!.querySelector('button[aria-label="Next slide"]')).not.toBeNull();
    expect(copies[0]!.hasAttribute('inert')).toBe(false);
    expect(copies[1]!.hasAttribute('inert')).toBe(true);
    expect(copies[1]!.getAttribute('aria-hidden')).toBe('true');
    // No other row of arrows is operable at that breakpoint: the fallback under the track is there for slides that draw none.
    const fallback = host.querySelector('.cmsc-pb-carousel__controls--slide-fallback');
    expect(fallback).not.toBeNull();
    expect(host.querySelector('.cmsc-pb-carousel__controls--below:not(.cmsc-pb-carousel__controls--slide-fallback)')).toBeNull();
  });

  it('per breakpoint: below the track on phones, inside the slide from the tablet up', () => {
    const host = dom({
      controlsPlacement: { base: 'below', tablet: 'slide' },
      controls: { arrows: true, dots: false },
      slides: [split('a', 'First'), split('b', 'Second')],
    });
    const copy = host.querySelector('.cmsc-pb-carousel__controls--slide')!;
    expect(copy.className).toContain('cmsc-pb-carousel__controls--off-sm');
    expect(copy.className).not.toContain('--off-md');
    const below = host.querySelector('.cmsc-pb-carousel__controls--below:not(.cmsc-pb-carousel__controls--slide-fallback)')!;
    expect(below.className).toContain('--off-md');
    expect(below.className).toContain('--off-lg');
  });

  it('the stylesheet hides the fallback row when the carousel’s slides hold controls', () => {
    const css = sheet();
    expect(css).toContain('.cmsc-pb-carousel:has(> .cmsc-pb-carousel__viewport .cmsc-pb-carousel__controls--slide) > .cmsc-pb-carousel__controls--slide-fallback { display: none; }');
    expect(css).toContain('.cmsc-pb-carousel__controls--slide { display: flex;');
  });

  it('a split slide outside a carousel, or in one with another placement, draws no controls', () => {
    expect(dom({ controlsPlacement: 'below', slides: [split('a', 'First')] }).querySelector('.cmsc-pb-carousel__controls--slide')).toBeNull();
  });

  it('the Carousel offers the placement; the product and post listings, which hold no split slides, do not', () => {
    const options = (type: string): string[] =>
      (((config.components[type] as ComponentConfig).fields as Fields)['controlsPlacement'] as { options: Array<{ value: string }> }).options.map(
        (option) => option.value,
      );
    expect(options('cms.ContentSlider')).toContain('slide');
    expect(options('catalog.ProductSlider')).not.toContain('slide');
    expect(options('blog.LatestPosts')).not.toContain('slide');
  });
});
