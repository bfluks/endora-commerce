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
import { responsivePxVars } from './responsive-px.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T247, T248) — the download
 * tile's look options (plan § *Extend, don't narrow*: unset is today's light,
 * bordered 8 px card with a type badge and a text label).
 *
 * The tile stays **one link** to the file, its accessible name the title, the
 * subtitle and the label (also with the round icon button, whose label is
 * visually hidden). Options: a colour scheme and a background colour, the
 * border, the corners, the padding and the title size, the type badge, the
 * image on hover shown in full under a dark gradient, and the link drawn as a
 * round icon button pinned to the bottom end.
 *
 * R23 (T437, T444): the padding is one spacing step; the title size a type
 * token or Custom px (a Custom px stored without a size reads as Custom); the
 * icon button's px size and ring colour were removed (48 px, the text colour).
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.DownloadTile'] as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
const FILE = '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
const IMAGE = '0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b';
const BASE = { title: 'Price list', subtitle: 'PDF, 2026', fileAssetId: FILE, linkLabel: 'Download' };

function html(props: Record<string, unknown> = {}): string {
  const content = [{ type: 'cms.DownloadTile', props: { ...defaults, id: 'download-1', ...BASE, ...props } }] as Data['content'];
  return renderToString(
    <BlockRenderEnvironmentProvider value={{ language: 'en', preview: false }}>
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
}

function tile(props: Record<string, unknown> = {}): HTMLAnchorElement {
  const host = document.createElement('div');
  host.innerHTML = html(props);
  const anchors = host.querySelectorAll('a');
  expect(anchors).toHaveLength(1);
  return anchors[0] as HTMLAnchorElement;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('cms.DownloadTile look (T247)', () => {
  it('unset (and every option at its default) renders today’s markup', () => {
    const today = html();
    expect(
      html({ scheme: 'inherit', cardBackground: '', cardBorder: true, showType: true, hoverImageLook: 'faint', linkLook: 'label' }),
    ).toBe(today);
    expect(tile().className).toBe('cmsc-pb-download-tile');
    expect(tile().hasAttribute('style')).toBe(false);
  });

  it('a colour scheme on the card, a background colour, no border, corners, a padding step and a title size per breakpoint', () => {
    const anchor = tile({
      scheme: 'dark',
      cardBackground: '#000000',
      cardBorder: false,
      cornerRadius: 'none',
      cardPadding: 'm',
      titleSize: 'custom',
      titleSizePx: { base: 32, desktop: 48 },
    });
    expect(anchor.getAttribute('data-cmsb-scheme')).toBe('dark');
    expect(anchor.className.split(' ')).toEqual(expect.arrayContaining(['cmsc-pb-download-tile--no-border']));
    const style = anchor.getAttribute('style') ?? '';
    expect(style).toContain('--pb-dl-bg:#000000');
    expect(style).toContain('--pb-dl-radius:0px');
    expect(style).toContain('--pb-dl-pad:var(--cmsb-space-m, 24px)');
    expect(style).toContain('--pb-dl-pad-lg:var(--cmsb-space-m, 40px)');
    const title = anchor.querySelector('.cmsc-pb-download-tile__title')!;
    expect(title.className).toContain('cmsc-pb-ts-size');
    expect(title.getAttribute('style')).toContain('--pb-ts-size:32px');
    expect(title.getAttribute('style')).toContain('--pb-ts-size-lg:48px');
    // R19B's px padding is ignored data; its Custom px title without a size reads as Custom.
    const stale = tile({ paddingPx: 24, titleSizePx: 30 });
    expect(stale.getAttribute('style') ?? '').not.toContain('--pb-dl-pad');
    expect(stale.querySelector('.cmsc-pb-download-tile__title')!.getAttribute('style')).toBe('font-size:30px');
  });

  it('the type badge can be switched off', () => {
    expect(tile().querySelector('.cmsc-pb-download-tile__type')?.textContent).toBe('PDF');
    expect(tile({ showType: false }).querySelector('.cmsc-pb-download-tile__type')).toBeNull();
  });

  it('the stylesheet reads each option, with today’s value as the fallback', () => {
    const css = sheet();
    expect(css).toContain('border-radius: var(--pb-dl-radius, 8px); background: var(--pb-dl-bg, var(--cmsb-bg, #ffffff));');
    expect(css).toContain('padding: var(--pb-dl-pad, 20px);');
    expect(css).toContain('.cmsc-pb-download-tile--no-border { border-color: transparent; }');
    expect(css).toContain('.cmsc-pb-download-tile__title { font-size: 1.125rem;');
    expect(css).toContain('padding: var(--pb-dl-pad-lg, var(--pb-dl-pad-md, var(--pb-dl-pad, 20px)));');
  });
});

describe('cms.DownloadTile hover image and icon button (T248)', () => {
  it('the hover image can show in full under a dark gradient', () => {
    const anchor = tile({ hoverImage: { imageSource: 'library', assetId: IMAGE }, hoverImageLook: 'full' });
    expect(anchor.className).toContain('cmsc-pb-download-tile--hover-image');
    expect(anchor.className).toContain('cmsc-pb-download-tile--hover-full');
    expect(sheet()).toContain('.cmsc-pb-download-tile--hover-full:is(:hover, :focus-visible) .cmsc-pb-download-tile__hover { opacity: 1; }');
  });

  it('the link drawn as a round icon button at the bottom end, the label kept for screen readers', () => {
    const anchor = tile({ linkLook: 'icon' });
    expect(anchor.className).toContain('cmsc-pb-download-tile--icon-link');
    const action = anchor.querySelector('.cmsc-pb-download-tile__icon-button');
    expect(action?.getAttribute('aria-hidden')).toBe('true');
    expect(action?.querySelector('svg')).not.toBeNull();
    const label = anchor.querySelector('.cmsc-pb-download-tile__label');
    expect(label?.className).toContain('cmsc-sr-only');
    expect(label?.textContent).toBe('Download');
    expect(anchor.textContent).toContain('Price list');
    // R23 (T444): a stored px size and ring colour are ignored data.
    expect(tile({ linkLook: 'icon', iconButtonSizePx: { base: 72, desktop: 116 }, iconButtonBorderColor: '#6b7280' }).outerHTML).toBe(anchor.outerHTML);
    expect(sheet()).toContain('.cmsc-pb-download-tile__icon-button { position: relative; z-index: 1; align-self: flex-end;');
    expect(sheet()).toContain('width: 48px; height: 48px; margin-top: auto; border: 1px solid currentColor;');
  });
});

describe('cms.DownloadTile fields (T247, T248)', () => {
  async function keys(props: Record<string, unknown>): Promise<string[]> {
    const fields = block.fields as Fields;
    const resolved = await block.resolveFields!(
      { props: { ...defaults, ...props } } as never,
      { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
    );
    return Object.keys(resolved);
  }

  it('offer the look options, the icon button’s only with the icon look and the hover look only with an image', async () => {
    const plain = await keys({});
    expect(plain).toEqual(expect.arrayContaining(['scheme', 'cardBackground', 'cardBorder', 'cornerRadius', 'cardPadding', 'titleSize', 'showType', 'linkLook']));
    expect(plain).not.toContain('titleSizePx');
    expect(plain).not.toContain('iconButtonIcon');
    expect(plain).not.toContain('hoverImageLook');
    expect(await keys({ titleSize: 'custom' })).toContain('titleSizePx');
    const icon = await keys({ linkLook: 'icon', hoverImage: { imageSource: 'library', assetId: IMAGE } });
    expect(icon).toEqual(expect.arrayContaining(['iconButtonIcon', 'hoverImageLook']));
    for (const key of ['iconButtonSizePx', 'iconButtonBorderColor', 'paddingPx']) expect(icon).not.toContain(key);
  });
});

describe('responsivePxVars', () => {
  it('writes only the breakpoints set; the editor writes the previewed one', () => {
    expect(responsivePxVars('x', undefined, null, { min: 0, max: 100 })).toBeNull();
    expect(responsivePxVars('x', 12, null, { min: 0, max: 100 })).toEqual({ '--pb-x': '12px' });
    expect(responsivePxVars('x', { base: 12, desktop: 400 }, null, { min: 0, max: 100 })).toEqual({ '--pb-x': '12px', '--pb-x-lg': '100px' });
    expect(responsivePxVars('x', { base: 12, tablet: 20 }, 'desktop', { min: 0, max: 100 })).toEqual({ '--pb-x': '20px' });
    expect(responsivePxVars('x', { tablet: 20 }, 'mobile', { min: 0, max: 100 })).toBeNull();
  });
});
