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
 * `specs/163-page-builder-marketing-pages/` T046, US3, FR-014,
 * contracts/blocks.md `cms.BackgroundPanel` — a full-bleed image with the text
 * in one half on desktop, stacked above or below the image on mobile.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.BackgroundPanel']?.defaultProps ?? {}) as Record<string, unknown>;

const ICON_ASSET = '5e6f7081-92a3-4b4c-8d5e-6f708192a3b4';

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.BackgroundPanel', props: { ...defaults, id: 'panel-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.BackgroundPanel (T046)', () => {
  it('default props render a non-empty panel: a heading, the text side at the end, the text on top on mobile, one button', () => {
    expect(defaults['textSide']).toBe('end');
    expect(defaults['mobileTextPosition']).toBe('top');
    expect(defaults['minHeight']).toBe('tall');
    const host = dom();
    const panel = host.querySelector('.cmsc-pb-panel');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('data-text-side')).toBe('end');
    expect(panel!.getAttribute('data-mobile-text')).toBe('top');
    expect(host.querySelector('h2')?.textContent).toBeTruthy();
    expect(host.querySelectorAll('.cmsc-pb-panel__actions .cmsc-btn')).toHaveLength(1);
    // The image is the panel's own layer: a placeholder until one is chosen.
    expect(host.querySelector('.cmsc-pb-panel__media')).not.toBeNull();
  });

  it('textSide and mobileTextPosition are the panel\'s attributes', () => {
    const panel = dom({ textSide: 'start', mobileTextPosition: 'bottom' }).querySelector('.cmsc-pb-panel')!;
    expect(panel.getAttribute('data-text-side')).toBe('start');
    expect(panel.getAttribute('data-mobile-text')).toBe('bottom');
  });

  it('the image renders lazily, art-directed', () => {
    const host = dom({
      image: { imageSource: 'url', src: '/media/wide.jpg', mobileSrc: '/media/tall.jpg', alt: 'A building' },
    });
    const picture = host.querySelector('.cmsc-pb-panel__media picture');
    expect(picture).not.toBeNull();
    expect(picture!.querySelector('source')?.getAttribute('srcset')).toBe('https://api.example.com/media/tall.jpg');
    const img = picture!.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('alt')).toBe('A building');
  });

  it('the min height is a custom property per breakpoint', () => {
    const style = dom({ minHeight: { base: 'medium', desktop: 'screen' } }).querySelector<HTMLElement>('.cmsc-pb-panel')!.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-panel-min-h:50vh');
    expect(style).toContain('--cmsc-panel-min-h-md:50vh');
    expect(style).toContain('--cmsc-panel-min-h-lg:100vh');
  });

  it('renders the rich body and an uploaded icon drawn in the text colour', () => {
    const host = dom({
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body', marks: [{ type: 'bold' }] }] }] },
      iconAssetId: ICON_ASSET,
    });
    expect(host.querySelector('.cmsc-pb-panel__body strong')?.textContent).toBe('Body');
    const icon = host.querySelector<HTMLElement>('.cmsc-pb-panel__icon .cmsc-pb-icon-mask');
    expect(icon).not.toBeNull();
    expect(icon!.style.backgroundColor).toBe('currentcolor');
  });

  // R19C (T264): the text box may let the image show through; unset, today's opaque box.
  it('paints the text box with the scheme unless it is transparent', async () => {
    expect(defaults).not.toHaveProperty('textBoxTransparent');
    expect(dom().querySelector('.cmsc-pb-panel')!.hasAttribute('data-text-box')).toBe(false);
    expect(dom({ textBoxTransparent: false }).querySelector('.cmsc-pb-panel')!.hasAttribute('data-text-box')).toBe(false);
    expect(dom({ textBoxTransparent: true }).querySelector('.cmsc-pb-panel')!.getAttribute('data-text-box')).toBe('transparent');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'styles/cms-components.css'), 'utf8');
    expect(css).toMatch(/\.cmsc-pb-panel\[data-text-box='transparent'\] > \.cmsc-pb-panel__content \{\s*background-color: transparent;/);
  });

  it('offers the transparent text box as a switch after the text placement', () => {
    const fields = Object.keys((config.components['cms.BackgroundPanel']?.fields ?? {}) as Record<string, unknown>);
    expect(fields).toContain('textBoxTransparent');
    expect(fields.indexOf('textBoxTransparent')).toBeGreaterThan(fields.indexOf('mobileTextPosition'));
    const field = (config.components['cms.BackgroundPanel']?.fields as Record<string, { type?: string }>)['textBoxTransparent'];
    expect(field?.type).toBe('custom');
  });
});
