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
 * `specs/163-page-builder-marketing-pages/` T048, US3, FR-018,
 * contracts/blocks.md `cms.Stats` — key figures with a heading, an optional
 * image beside them and a grid per breakpoint. Without a heading and an image,
 * the default render equals today's.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.Stats']?.defaultProps ?? {}) as Record<string, unknown>;

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.Stats', props: { ...defaults, id: 'stats-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

const SIX = Array.from({ length: 6 }, (_, index) => ({ value: `${index + 1}0+`, label: `Figure ${index + 1}` }));

describe('cms.Stats (T048)', () => {
  it('six values lay out in the chosen grid per breakpoint, e.g. 2 × 3 on desktop (US3 acceptance 3)', () => {
    const ul = dom({ items: SIX, columns: { base: 2, desktop: 3 } }).querySelector<HTMLElement>('ul.cmsc-pb-stats')!;
    expect(ul.querySelectorAll('li')).toHaveLength(6);
    const style = ul.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-stats-cols:2');
    expect(style).toContain('--cmsc-stats-cols-md:2');
    expect(style).toContain('--cmsc-stats-cols-lg:3');
  });

  it('renders a heading and an image beside the figures, on the chosen side', () => {
    const host = dom({
      heading: doc('In numbers'),
      image: { imageSource: 'url', src: '/media/stats.jpg', alt: 'Team' },
      imageSide: 'end',
    });
    expect(host.querySelector('h2')?.textContent).toBe('In numbers');
    const layout = host.querySelector('.cmsc-pb-stats-block')!;
    expect(layout.getAttribute('data-image-side')).toBe('end');
    const img = layout.querySelector('.cmsc-pb-stats-block__media img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('Team');
    expect(layout.querySelector('ul.cmsc-pb-stats')).not.toBeNull();
  });

  it('a value size token applies the type scale', () => {
    const value = dom({ valueSize: 'display' }).querySelector('.cmsc-pb-stats__value')!;
    expect(value.classList).toContain('cmsc-t--display');
  });

  it('the default render equals today\'s: four columns, 24 px gap, centred, values in the secondary colour, no heading or image', () => {
    const host = dom();
    const ul = host.querySelector<HTMLElement>('ul.cmsc-pb-stats')!;
    expect(ul.querySelectorAll('li')).toHaveLength(4);
    const style = ul.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-stats-cols:4');
    expect(style).toContain('--cmsc-stats-gap:24px');
    expect(ul.style.textAlign).toBe('center');
    const value = host.querySelector<HTMLElement>('.cmsc-pb-stats__value')!;
    expect(value.className).toBe('cmsc-pb-stats__value');
    expect(value.getAttribute('style')).toContain('var(--cmsb-color-secondary, #0f766e)');
    expect(host.querySelector('h2')).toBeNull();
    expect(host.querySelector('.cmsc-pb-stats-block__media')).toBeNull();
  });

  it('a block stored on origin/master renders as it did', () => {
    const host = dom({ items: SIX.slice(0, 2), columns: 6, gap: 32, align: 'left', valueColor: '#1d4ed8', gapPx: undefined });
    const ul = host.querySelector<HTMLElement>('ul.cmsc-pb-stats')!;
    expect(ul.getAttribute('style')).toContain('--cmsc-stats-cols:6');
    expect(ul.getAttribute('style')).toContain('--cmsc-stats-gap:32px');
    expect(ul.style.textAlign).toBe('left');
    expect(host.querySelector<HTMLElement>('.cmsc-pb-stats__value')!.style.color).toBe('rgb(29, 78, 216)');
  });
});
