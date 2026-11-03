// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
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
 * `specs/163-page-builder-marketing-pages/` T053, US4, FR-020, FR-021,
 * contracts/blocks.md `cms.DownloadTile` — a file from the asset library,
 * referenced by identity (`fileAssetId`), so replacing the asset updates the
 * tile. The tile is one `<a href download>`; a missing asset renders nothing
 * for customers and a warning in the preview (spec edge case).
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.DownloadTile']?.defaultProps ?? {}) as Record<string, unknown>;
const FILE = '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
const IMAGE = '0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b';

function dom(props: Record<string, unknown> = {}, preview = false): HTMLElement {
  const content = [{ type: 'cms.DownloadTile', props: { ...defaults, id: 'download-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <BlockRenderEnvironmentProvider value={{ language: 'en', preview }}>
      <CmsRenderProvider
        embeds={{ blocks: {}, templates: {} }}
        assets={{
          [FILE]: { url: '/assets/file/price-list.pdf', mimeType: 'application/pdf', filename: 'price-list.pdf' },
          [IMAGE]: { url: '/assets/file/cover.jpg', mimeType: 'image/jpeg' },
        }}
        mediaBaseUrl="https://api.example.com"
      >
        <Render config={config} data={{ root: { props: {} }, content }} />
      </CmsRenderProvider>
    </BlockRenderEnvironmentProvider>,
  );
  return host;
}

describe('cms.DownloadTile (T053)', () => {
  it('is a single <a href download> to the asset, named by its title and its link label', () => {
    const host = dom({ title: 'Price list', subtitle: 'PDF, 2026', fileAssetId: FILE, linkLabel: 'Download' });
    const anchors = host.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0]!;
    expect(anchor.getAttribute('href')).toBe('https://api.example.com/assets/file/price-list.pdf');
    expect(anchor.hasAttribute('download')).toBe(true);
    expect(anchor.className).toContain('cmsc-pb-download-tile');
    expect(anchor.textContent).toContain('Price list');
    expect(anchor.textContent).toContain('PDF, 2026');
    expect(anchor.textContent).toContain('Download');
    expect(anchor.hasAttribute('aria-label')).toBe(false);
  });

  it('defaults its link label to "Download" and shows the file type', () => {
    expect(defaults['linkLabel']).toBe('Download');
    const anchor = dom({ title: 'Price list', fileAssetId: FILE }).querySelector('a')!;
    expect(anchor.querySelector('.cmsc-pb-download-tile__label')?.textContent).toBe('Download');
    expect(anchor.querySelector('.cmsc-pb-download-tile__type')?.textContent).toBe('PDF');
  });

  it('a missing asset renders nothing for customers and a warning in the preview', () => {
    const customer = dom({ title: 'Price list', fileAssetId: '' });
    expect(customer.querySelector('a')).toBeNull();
    expect(customer.textContent).not.toContain('Price list');
    const gone = dom({ title: 'Price list', fileAssetId: '1f2a3b4c-5d6e-4f7a-8b8c-9d0e1f2a3b4c' });
    expect(gone.querySelector('a')).toBeNull();

    const preview = dom({ title: 'Price list', fileAssetId: '' }, true);
    expect(preview.querySelector('a')).toBeNull();
    const warning = preview.querySelector('[role="note"].cmsc-pb-download-tile--missing');
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain('Price list');
  });

  it('reveals an optional image on hover, lazily loaded', () => {
    const img = dom({ title: 'Price list', fileAssetId: FILE, hoverImage: { imageSource: 'library', assetId: IMAGE, alt: '' } }).querySelector(
      '.cmsc-pb-download-tile__hover img',
    );
    expect(img?.getAttribute('src')).toBe('https://api.example.com/assets/file/cover.jpg');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });
});

/** `specs/163-page-builder-marketing-pages/` T131 (R5) — the item's filter tags. */
describe('cms.DownloadTile — tags (T131)', () => {
  it('writes its tags for the Carousel\'s filter on the link', () => {
    expect((config.components['cms.DownloadTile']!.fields as Record<string, { type: string }>)['tags']?.type).toBe('text');
    expect(dom({ fileAssetId: FILE, tags: 'Sheets, manuals' }).querySelector('a')!.getAttribute('data-pb-tags')).toBe('sheets,manuals');
    expect(dom({ fileAssetId: FILE }).querySelector('[data-pb-tags]')).toBeNull();
  });
});
