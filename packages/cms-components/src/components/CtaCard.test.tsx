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
 * `specs/163-page-builder-marketing-pages/` T046, US3, FR-015,
 * contracts/blocks.md `cms.CtaCard` — a boxed call to action: a muted, dark or
 * light card holding a heading, text, an icon list in one or two columns,
 * buttons and an image.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.CtaCard']?.defaultProps ?? {}) as Record<string, unknown>;

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.CtaCard', props: { ...defaults, id: 'card-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.CtaCard (T046)', () => {
  it('default props render a muted card with a heading and one button, no decorative layer and no image', () => {
    expect(defaults['cardScheme']).toBe('muted');
    expect(defaults['decorative']).toBe(false);
    expect(defaults['listColumns']).toBe(2);
    const host = dom();
    const card = host.querySelector('.cmsc-pb-cta-card');
    expect(card).not.toBeNull();
    expect(card!.getAttribute('data-cmsb-scheme')).toBe('muted');
    expect(card!.hasAttribute('data-decorative')).toBe(false);
    expect(host.querySelector('h2')?.textContent).toBeTruthy();
    expect(host.querySelectorAll('.cmsc-pb-cta-card__actions .cmsc-btn')).toHaveLength(1);
    expect(host.querySelector('.cmsc-pb-cta-card__media')).toBeNull();
  });

  it('the card scheme rebinds the scheme variables on the card; decorative paints the backdrop', () => {
    const card = dom({ cardScheme: 'dark', decorative: true }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('data-cmsb-scheme')).toBe('dark');
    expect(card.getAttribute('data-decorative')).toBe('1');
    expect(dom({ cardScheme: 'light' }).querySelector('.cmsc-pb-cta-card')!.getAttribute('data-cmsb-scheme')).toBe('light');
  });

  it('the list renders its icons and texts in two columns, or one', () => {
    const list = [
      { icon: 'checkCircle2', text: 'First point' },
      { icon: 'truck', text: 'Second point' },
      { text: 'Third point' },
    ];
    const host = dom({ list });
    const ul = host.querySelector('ul.cmsc-pb-cta-card__list')!;
    expect(ul.getAttribute('data-columns')).toBe('2');
    const items = Array.from(ul.querySelectorAll('li'));
    expect(items.map((item) => item.textContent)).toEqual(['First point', 'Second point', 'Third point']);
    expect(items[0]!.querySelector('svg')).not.toBeNull();
    expect(items[2]!.querySelector('svg')).toBeNull();
    expect(dom({ list, listColumns: 1 }).querySelector('ul.cmsc-pb-cta-card__list')!.getAttribute('data-columns')).toBe('1');
  });

  it('an image renders beside the text on the chosen side, lazily', () => {
    const host = dom({ image: { imageSource: 'url', src: '/media/card.jpg', alt: 'Card' }, imageSide: 'start' });
    const card = host.querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('data-image-side')).toBe('start');
    const img = host.querySelector('.cmsc-pb-cta-card__media img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('Card');
  });

  it('the body renders as rich text', () => {
    const host = dom({
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Talk to us', marks: [{ type: 'italic' }] }] }] },
    });
    expect(host.querySelector('.cmsc-pb-cta-card__body em')?.textContent).toBe('Talk to us');
  });
});
