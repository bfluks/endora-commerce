// @vitest-environment jsdom
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
 * contracts/blocks.md `cms.CarouselSplit` — a split slide: media (an image or
 * a video, as `cms.MediaText`'s) on one side, an icon, a title, rich text and
 * up to two buttons on the other.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.CarouselSplit']?.defaultProps ?? {}) as Record<string, unknown>;
const ASSET = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const VIDEO = '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const button = (label: string) => ({ label, link: { kind: 'url', href: '/x' }, style: 'primary', fill: 'solid', size: 'medium' });

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.CarouselSplit', props: { ...defaults, id: 'split-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.CarouselSplit (T053)', () => {
  it('default props render a non-empty split slide: a media frame, a title and text, media on the start side', () => {
    const root = dom().querySelector('.cmsc-pb-carousel-split');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('data-media-side')).toBe('start');
    expect(root!.querySelector('.cmsc-pb-carousel-split__media')).not.toBeNull();
    expect(root!.querySelector('.cmsc-pb-carousel-split__title')?.textContent).toBeTruthy();
    expect(root!.querySelector('.cmsc-pb-carousel-split__body')?.textContent).toBeTruthy();
  });

  it('renders an image or a video with its poster, on the chosen side', () => {
    const image = dom({ media: { kind: 'image', image: { imageSource: 'library', assetId: ASSET, alt: 'Plant' } }, mediaSide: 'end' });
    expect(image.querySelector('.cmsc-pb-carousel-split')!.getAttribute('data-media-side')).toBe('end');
    expect(image.querySelector('.cmsc-pb-carousel-split__media img')?.getAttribute('alt')).toBe('Plant');
    const video = dom({ media: { kind: 'video', videoAssetId: VIDEO, posterAssetId: ASSET } }).querySelector('video')!;
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.getAttribute('poster')).toContain(ASSET);
  });

  it('renders the icon, the title, the rich text and at most two buttons', () => {
    const host = dom({
      icon: 'truck',
      title: doc('Fast delivery'),
      body: doc('Across the region.'),
      buttons: [button('One'), button('Two'), button('Three')],
    });
    expect(host.querySelector('.cmsc-pb-carousel-split__icon svg')).not.toBeNull();
    expect(host.querySelector('.cmsc-pb-carousel-split__title')?.textContent).toBe('Fast delivery');
    expect(host.querySelector('.cmsc-pb-carousel-split__body')?.textContent).toBe('Across the region.');
    expect(Array.from(host.querySelectorAll('a.cmsc-btn')).map((a) => a.textContent)).toEqual(['One', 'Two']);
  });

  it('an uploaded SVG icon wins over the catalog icon, drawn as a mask in the text colour', () => {
    const icon = dom({ icon: 'truck', iconAssetId: ASSET }).querySelector<HTMLElement>('.cmsc-pb-carousel-split__icon .cmsc-pb-icon-mask');
    expect(icon).not.toBeNull();
    expect(icon!.style.backgroundColor).toBe('currentcolor');
  });
});

/** `specs/163-page-builder-marketing-pages/` T131 (R5) — the item's filter tags. */
describe('cms.CarouselSplit — tags (T131)', () => {
  it('writes its tags for the Carousel\'s filter on its root', () => {
    expect((config.components['cms.CarouselSplit']!.fields as Record<string, { type: string }>)['tags']?.type).toBe('text');
    expect(dom({ tags: 'Offices' }).querySelector('.cmsc-pb-carousel-split')!.getAttribute('data-pb-tags')).toBe('offices');
    expect(dom().querySelector('[data-pb-tags]')).toBeNull();
  });
});
