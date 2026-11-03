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
 * `specs/163-page-builder-marketing-pages/` T048, US3, FR-017,
 * contracts/blocks.md `cms.FeatureList` — 1–4 columns per breakpoint, a
 * heading, rich item bodies, icons from the catalog or uploaded SVGs drawn in
 * the text colour (US3 acceptance 2), and an image below the grid. A list
 * stored before renders as it did.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.FeatureList']?.defaultProps ?? {}) as Record<string, unknown>;

const SVG_ASSET = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

const doc = (text: string, marks?: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] }],
});

function dom(props: Record<string, unknown> = {}, assets: Record<string, { url: string }> = {}): HTMLElement {
  const content = [{ type: 'cms.FeatureList', props: { ...defaults, id: 'features-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={assets as never} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

function grid(host: HTMLElement): HTMLElement {
  return host.querySelector<HTMLElement>('ul.cmsc-pb-feature-list')!;
}

describe('cms.FeatureList (T048)', () => {
  it('columns 1–4 per breakpoint are custom properties, read by the stylesheet (no script decides them)', () => {
    const style = grid(dom({ columns: { base: 1, tablet: 2, desktop: 4 } })).getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-fl-cols:1');
    expect(style).toContain('--cmsc-fl-cols-md:2');
    expect(style).toContain('--cmsc-fl-cols-lg:4');
    // Out of range is clamped to 1–4.
    const clamped = grid(dom({ columns: 9 })).getAttribute('style') ?? '';
    expect(clamped).toContain('--cmsc-fl-cols:4');
  });

  it('an uploaded SVG icon is drawn as a mask filled with currentColor, so it takes the text colour (US3 acceptance 2)', () => {
    const host = dom(
      { items: [{ iconAssetId: SVG_ASSET, icon: 'truck', title: 'Uploaded', body: doc('Body') }], iconColor: undefined },
      { [SVG_ASSET]: { url: '/media/icons/leaf.svg' } },
    );
    const mask = host.querySelector<HTMLElement>('.cmsc-pb-feature-list__icon .cmsc-pb-icon-mask');
    expect(mask).not.toBeNull();
    const style = mask!.getAttribute('style') ?? '';
    expect(style).toContain('mask-image:url("https://api.example.com/media/icons/leaf.svg")');
    expect(mask!.style.backgroundColor).toBe('currentcolor');
    // The uploaded icon wins over the catalog icon.
    expect(host.querySelector('.cmsc-pb-feature-list__icon svg')).toBeNull();
    // No icon colour: the icon inherits the scheme's text colour.
    expect((host.querySelector('.cmsc-pb-feature-list__icon') as HTMLElement).style.color).toBe('');
  });

  it('an icon colour colours the uploaded icon too', () => {
    const host = dom({ items: [{ iconAssetId: SVG_ASSET, title: 'Uploaded' }], iconColor: '#1d4ed8' });
    expect((host.querySelector('.cmsc-pb-feature-list__icon') as HTMLElement).style.color).toBe('rgb(29, 78, 216)');
  });

  it('renders a heading, rich item bodies and an image below the grid', () => {
    const host = dom({
      heading: doc('Why us'),
      items: [{ icon: 'truck', title: doc('Fast'), body: doc('Rich body', [{ type: 'bold' }]) }],
      image: { imageSource: 'url', src: '/media/below.jpg', alt: 'Below' },
    });
    expect(host.querySelector('h2')?.textContent).toBe('Why us');
    expect(host.querySelector('.cmsc-pb-feature-list__body strong')?.textContent).toBe('Rich body');
    const image = host.querySelector('.cmsc-pb-feature-list__image');
    expect(image).not.toBeNull();
    expect(image!.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    // Below the grid.
    expect(grid(host).compareDocumentPosition(image!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a title size token applies the type scale', () => {
    const title = dom({ titleSize: 'h4', items: [{ title: 'Sized' }] }).querySelector('.cmsc-pb-feature-list__title')!;
    expect(title.classList).toContain('cmsc-t--h4');
  });

  it('the default render equals today\'s: three items, three columns, 24 px gap, 28 px icons in the secondary colour, left-aligned, no heading or image', () => {
    const host = dom();
    const ul = grid(host);
    expect(ul.querySelectorAll('li')).toHaveLength(3);
    const style = ul.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-fl-cols:3');
    expect(style).toContain('--cmsc-fl-gap:24px');
    expect(ul.style.textAlign).toBe('left');
    const svg = host.querySelector('.cmsc-pb-feature-list__icon svg')!;
    expect(svg.getAttribute('width')).toBe('28');
    // Today's teal, now the secondary brand colour whose built-in value it is.
    expect(host.querySelector('.cmsc-pb-feature-list__icon')!.getAttribute('style')).toContain('var(--cmsb-color-secondary, #0f766e)');
    const title = host.querySelector('h3.cmsc-pb-feature-list__title')!;
    expect(title.className).toBe('cmsc-pb-feature-list__title');
    expect(host.querySelector('.cmsc-pb-feature-list__desc')?.textContent).toBeTruthy();
    expect(host.querySelector('h2')).toBeNull();
    expect(host.querySelector('.cmsc-pb-feature-list__image')).toBeNull();
  });

  it('a list stored on origin/master renders as it did: its description, its px gap and icon size, its alignment', () => {
    const host = dom({
      heading: undefined,
      items: [{ icon: 'truck', title: 'Fast delivery', description: 'Reliable logistics.' }],
      columns: 2,
      gap: 16,
      iconColor: '#0f766e',
      iconSize: 36,
      align: 'center',
      gapPx: undefined,
      iconSizePx: undefined,
    });
    const ul = grid(host);
    expect(ul.getAttribute('style')).toContain('--cmsc-fl-gap:16px');
    expect(ul.getAttribute('style')).toContain('--cmsc-fl-cols:2');
    expect(ul.style.textAlign).toBe('center');
    expect(host.querySelector('.cmsc-pb-feature-list__icon svg')!.getAttribute('width')).toBe('36');
    expect(host.querySelector('.cmsc-pb-feature-list__desc')?.textContent).toBe('Reliable logistics.');
    expect(host.querySelector('h3.cmsc-pb-feature-list__title')?.textContent).toBe('Fast delivery');
  });

  it('carries no section settings: a stray `section` prop renders no section (T111)', () => {
    const host = dom({ section: { anchor: 'features', scheme: 'muted' } });
    expect(host.querySelector('section.cmsc-section')).toBeNull();
    expect(host.querySelector('#features')).toBeNull();
  });
});
