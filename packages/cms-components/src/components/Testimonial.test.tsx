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
 * `specs/163-page-builder-marketing-pages/` T048, US3,
 * contracts/blocks.md `cms.Testimonial` — a rich quote, its author and role, an
 * avatar, today's card (the default) or an image card with the quote laid over
 * it. A testimonial stored before renders as it did.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.Testimonial']?.defaultProps ?? {}) as Record<string, unknown>;

const AVATAR = '9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.Testimonial', props: { ...defaults, id: 'quote-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.Testimonial (T048)', () => {
  it('the default is today\'s card: the quote, the author and role, a light fill, rounded corners', () => {
    expect(defaults['layout']).toBe('card');
    const host = dom();
    const card = host.querySelector<HTMLElement>('.cmsc-pb-testimonial')!;
    expect(card.classList).not.toContain('cmsc-pb-testimonial--image-overlay');
    expect(host.querySelector('blockquote.cmsc-pb-testimonial__quote')?.textContent).toBeTruthy();
    expect(host.querySelector('.cmsc-pb-testimonial__author')?.textContent).toBeTruthy();
    expect(host.querySelector('.cmsc-pb-testimonial__role')?.textContent).toBeTruthy();
    // Today's #f8fafc fill and 24 px padding (BoxStyled renders them inline).
    expect(card.outerHTML).toContain('#f8fafc');
    expect(host.querySelector('.cmsc-pb-testimonial__image')).toBeNull();
  });

  it('the quote is rich text', () => {
    const host = dom({
      quote: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fast', marks: [{ type: 'bold' }] }] }] },
    });
    expect(host.querySelector('blockquote strong')?.textContent).toBe('Fast');
  });

  it('the avatar is a responsive image from the library', () => {
    const img = dom({ avatar: { imageSource: 'library', assetId: AVATAR, alt: 'Portrait' } }).querySelector('img.cmsc-pb-testimonial__avatar');
    expect(img?.getAttribute('src')).toBe(`https://api.example.com/assets/file/${AVATAR}`);
    expect(img?.getAttribute('alt')).toBe('Portrait');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('the image-overlay layout lays the quote, author and role over the image', () => {
    const host = dom({
      layout: 'image-overlay',
      image: { imageSource: 'url', src: '/media/portrait.jpg', alt: 'A customer' },
    });
    const card = host.querySelector('.cmsc-pb-testimonial')!;
    expect(card.classList).toContain('cmsc-pb-testimonial--image-overlay');
    const img = card.querySelector('.cmsc-pb-testimonial__image img');
    expect(img?.getAttribute('alt')).toBe('A customer');
    const overlay = card.querySelector('.cmsc-pb-testimonial__overlay');
    expect(overlay?.querySelector('blockquote')).not.toBeNull();
    expect(overlay?.querySelector('.cmsc-pb-testimonial__author')).not.toBeNull();
  });

  it('a card with an image shows it above the quote', () => {
    const host = dom({ image: { imageSource: 'url', src: '/media/office.jpg', alt: 'Office' } });
    const image = host.querySelector('.cmsc-pb-testimonial__image')!;
    expect(image.compareDocumentPosition(host.querySelector('blockquote')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a testimonial stored on origin/master renders as it did: its plain quote and its URL avatar with today\'s alternative text', () => {
    const host = dom({
      quote: '“Simple and fast.”',
      author: 'Alex Doe',
      role: 'Buyer',
      avatar: undefined,
      layout: undefined,
      avatarSource: 'url',
      avatarUrl: 'https://cdn.example.com/a.jpg',
      avatarAssetId: '',
    });
    expect(host.querySelector('blockquote')?.textContent).toBe('“Simple and fast.”');
    const img = host.querySelector('img.cmsc-pb-testimonial__avatar');
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/a.jpg');
    expect(img?.getAttribute('alt')).toBe('Alex Doe avatar');
  });
});
