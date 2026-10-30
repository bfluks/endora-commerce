// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
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
 * `specs/163-page-builder-marketing-pages/` R20E (T301–T303) — `cms.DownloadTile`
 * extended (plan § *Extend, don't narrow*: unset is today's tile):
 *
 * - T301: a minimum height per breakpoint (today's 180 px);
 * - T302: the subtitle's size per breakpoint and its colour (today's 14 px muted);
 * - T303: the tile may link to a page, a product, a URL… (the shared link)
 *   instead of a file — the same card, no file badge, no `download` attribute,
 *   the icon button still pinned to the bottom end.
 *
 * R23 (T444): the minimum height is one value (a stored per-breakpoint one
 * reads as its desktop value, else its base); the subtitle's size and colour
 * (T302) were removed — it keeps today's 14 px muted text.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.DownloadTile'] as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
const FILE = '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
const BASE = { title: 'Catalogue', subtitle: 'Product range', fileAssetId: FILE, linkLabel: 'Download' };

function html(props: Record<string, unknown> = {}, preview = false): string {
  const content = [{ type: 'cms.DownloadTile', props: { ...defaults, id: 'download-1', ...BASE, ...props } }] as Data['content'];
  return renderToString(
    <BlockRenderEnvironmentProvider value={{ language: 'en', preview }}>
      <CmsRenderProvider
        embeds={{ blocks: {}, templates: {} }}
        assets={{ [FILE]: { url: '/assets/file/terms.pdf', mimeType: 'application/pdf', filename: 'terms.pdf' } }}
        mediaBaseUrl="https://api.example.com"
      >
        <Render config={config} data={{ root: { props: {} }, content }} />
      </CmsRenderProvider>
    </BlockRenderEnvironmentProvider>,
  );
}

function host(props: Record<string, unknown> = {}, preview = false): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html(props, preview);
  return element;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

async function keys(props: Record<string, unknown>): Promise<string[]> {
  const fields = block.fields as Fields;
  const resolved = await block.resolveFields!(
    { props: { ...defaults, ...BASE, ...props } } as never,
    { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
  );
  return Object.keys(resolved);
}

describe('cms.DownloadTile minimum height and subtitle (T301, T302)', () => {
  it('unset (and the file link at its default) renders today’s tile', () => {
    expect(html({ linkTo: 'file', subtitleColor: '' })).toBe(html());
  });

  it('one minimum height for every breakpoint; a stored per-breakpoint one reads as its desktop value', () => {
    expect(host({ minHeightPx: 320 }).querySelector('a')!.getAttribute('style')).toBe('--pb-dl-min-h:320px');
    expect(host({ minHeightPx: { base: 320, desktop: 400 } }).querySelector('a')!.getAttribute('style')).toBe('--pb-dl-min-h:400px');
    const css = sheet();
    expect(css).toContain('min-height: var(--pb-dl-min-h, 180px);');
  });

  it('a stored subtitle size and colour are ignored: today’s 14 px muted subtitle', () => {
    expect(host({ subtitleSizePx: { base: 14, tablet: 16 }, subtitleColor: '#ffffff' }).querySelector('a')!.hasAttribute('style')).toBe(false);
    expect(sheet()).toContain('.cmsc-pb-download-tile__subtitle { color: var(--cmsb-fg-muted, #64748b); font-size: 0.875rem; }');
  });
});

describe('cms.DownloadTile linking to a page or URL (T303)', () => {
  it('one link to the page: no download attribute, no file badge, the icon button pinned', () => {
    const tile = host({ linkTo: 'link', link: { kind: 'url', href: 'https://example.com/terms' }, linkLook: 'icon', fileAssetId: '' });
    const anchors = tile.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0]!;
    expect(anchor.getAttribute('href')).toBe('https://example.com/terms');
    expect(anchor.hasAttribute('download')).toBe(false);
    expect(anchor.className).toContain('cmsc-pb-download-tile--page-link');
    expect(tile.querySelector('.cmsc-pb-download-tile__type')).toBeNull();
    expect(tile.querySelector('.cmsc-pb-download-tile__icon-button svg')).not.toBeNull();
    expect(anchor.textContent).toContain('Catalogue');
  });

  it('a link that resolves to nothing: nothing for customers, a warning in the preview', () => {
    expect(host({ linkTo: 'link', link: undefined }).querySelector('a, [role="note"]')).toBeNull();
    expect(host({ linkTo: 'link', link: undefined }, true).querySelector('[role="note"]')?.textContent).toContain('Choose a link');
  });

  it('offers the link with the link target, the file without it', async () => {
    const file = await keys({});
    expect(file).toEqual(expect.arrayContaining(['linkTo', 'fileAssetId', 'minHeightPx']));
    expect(file).not.toContain('subtitleSizePx');
    expect(file).not.toContain('subtitleColor');
    expect(file).not.toContain('link');
    const page = await keys({ linkTo: 'link' });
    expect(page).toContain('link');
    expect(page).not.toContain('fileAssetId');
  });
});
