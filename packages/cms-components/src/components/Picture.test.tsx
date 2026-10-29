import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Picture } from './Picture.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` research R-9 — a `ResponsiveImage`
 * renders as one `<picture>` with an art-directed mobile source, lazy by
 * default and eager with a high fetch priority when it is the page's lead image.
 */

const DESKTOP = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const MOBILE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function render(element: ReactElement, assets: Record<string, { url: string }> = {}): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={assets} mediaBaseUrl="https://api.example.com">
      {element}
    </CmsRenderProvider>,
  );
}

describe('Picture', () => {
  it('renders a mobile source before a lazy, async-decoded image', () => {
    const html = render(
      <Picture
        image={{ imageSource: 'library', assetId: DESKTOP, mobileAssetId: MOBILE, alt: 'A team at work' }}
      />,
      { [MOBILE]: { url: 'https://cdn.example.com/mobile.jpg' } },
    );
    expect(html).toMatch(
      /^<picture[^>]*class="cmsc-picture[^"]*"[^>]*><source media="\(max-width: 767\.98px\)" srcSet="https:\/\/cdn\.example\.com\/mobile\.jpg"\/><img [^>]*><\/picture>$/,
    );
    expect(html).toContain(`src="https://api.example.com/assets/file/${DESKTOP}"`);
    expect(html).toContain('alt="A team at work"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('fetchPriority');
  });

  it('uses a mobile-only image at every width', () => {
    const html = render(<Picture image={{ imageSource: 'url', mobileSrc: 'https://cdn.example.com/only.jpg', alt: '' }} />);
    expect(html).not.toContain('<source');
    expect(html).toContain('src="https://cdn.example.com/only.jpg"');
  });

  it('renders no source when there is no mobile image', () => {
    const html = render(<Picture image={{ imageSource: 'url', src: '/media/wide.jpg', alt: 'Wide' }} />);
    expect(html).not.toContain('<source');
    expect(html).toContain('src="https://api.example.com/media/wide.jpg"');
  });

  it('loads a priority image eagerly with a high fetch priority', () => {
    const html = render(<Picture image={{ imageSource: 'url', src: '/media/hero.jpg', alt: '' }} priority />);
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
  });

  it('turns the responsive ratio into --pb-ratio, -md and -lg', () => {
    const html = render(
      <Picture
        image={{ imageSource: 'url', src: '/a.jpg', alt: '', ratio: { base: '4:5', tablet: '1:1', desktop: '21:9' } }}
      />,
    );
    expect(html).toContain('--pb-ratio:4 / 5');
    expect(html).toContain('--pb-ratio-md:1 / 1');
    expect(html).toContain('--pb-ratio-lg:21 / 9');
  });

  it('inherits a ratio upward, and applies fit and focal point to the image', () => {
    const html = render(
      <Picture image={{ imageSource: 'url', src: '/a.jpg', alt: '', ratio: '16:9', fit: 'contain', position: 'top' }} />,
    );
    expect(html).toContain('--pb-ratio:16 / 9;--pb-ratio-md:16 / 9;--pb-ratio-lg:16 / 9');
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('object-position:top');
  });

  it('renders nothing without any image', () => {
    expect(render(<Picture image={{ imageSource: 'url', alt: '' }} />)).toBe('');
  });
});
