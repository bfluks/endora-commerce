// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
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
 * `specs/163-page-builder-marketing-pages/` R21H:
 *
 * - T350 (bug): a text whose type token changes across breakpoints (a carousel
 *   header heading, a section heading, a hero text, `cms.Heading`) follows each
 *   tier's token for its line height, weight and tracking — not only its size.
 *   One token at every tier writes nothing new.
 * - T354 (a carousel small-desktop tier) was removed by R23 (T434); its stored
 *   props are ignored data.
 */

const config = defaultPageBuilderConfig as Config;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function dom(type: string, props: Record<string, unknown>): HTMLElement {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [{ type, props: { ...defaults, id: `${type}-1`, ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

const stylesheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('R21H (T350): a per-breakpoint type token carries its line height, weight and tracking', () => {
  it('a carousel header heading h3 → h2 writes each tier\'s token for line height, weight and letter spacing', () => {
    const heading = dom('cms.ContentSlider', {
      header: { heading: doc('Innovations') },
      headingLevel: 'h2',
      headingSize: { base: 'h3', desktop: 'h2' },
    }).querySelector<HTMLElement>('.cmsc-pb-carousel__header h2')!;
    expect(heading.className).toContain('cmsc-t--h3');
    expect(heading.className).toContain('cmsc-pb-text-token');
    const style = heading.getAttribute('style') ?? '';
    expect(style).toContain('--pb-text-lh:var(--cmsb-t-h3-lh, 1.12)');
    expect(style).toContain('--pb-text-lh-md:var(--cmsb-t-h3-lh, 1.12)');
    expect(style).toContain('--pb-text-lh-lg:var(--cmsb-t-h2-lh, 1.12)');
    expect(style).toContain('--pb-text-w-lg:var(--cmsb-t-h2-w, 700)');
    expect(style).toContain('--pb-text-ls-lg:var(--cmsb-t-h2-ls, 0em)');
  });

  it('one token at every tier writes nothing new (today\'s markup)', () => {
    const heading = dom('cms.ContentSlider', {
      header: { heading: doc('Innovations') },
      headingLevel: 'h2',
      headingSize: 'h3',
    }).querySelector<HTMLElement>('.cmsc-pb-carousel__header h2')!;
    expect(heading.className).not.toContain('cmsc-pb-text-token');
    expect(heading.getAttribute('style') ?? '').not.toContain('--pb-text-lh');
  });

  it('a Custom px tier keeps the class token\'s line height; a token tier follows its own', () => {
    const heading = dom('cms.ContentSlider', {
      header: { heading: doc('Innovations') },
      headingLevel: 'h2',
      headingSize: { base: 'custom', desktop: 'body' },
      headingSizePx: { base: 30 },
    }).querySelector<HTMLElement>('.cmsc-pb-carousel__header h2')!;
    const style = heading.getAttribute('style') ?? '';
    expect(style).toContain('--pb-text-lh:var(--cmsb-t-h3-lh, 1.12)');
    expect(style).toContain('--pb-text-lh-lg:var(--cmsb-t-body-lh, 1.65)');
    expect(style).toContain('--pb-text-w-lg:var(--cmsb-t-body-w, 400)');
  });

  it('the hero title h2 → h1 follows the desktop token too', () => {
    const title = dom('cms.Hero', { title: doc('Title'), titleSize: { base: 'h2', desktop: 'h1' } }).querySelector<HTMLElement>(
      '.cmsc-pb-hero__title',
    )!;
    expect(title.className).toContain('cmsc-pb-text-token');
    expect(title.getAttribute('style') ?? '').toContain('--pb-text-lh-lg:var(--cmsb-t-h1-lh, 1.12)');
  });

  it('cms.Heading h3 → display follows the desktop token; its own line height still wins (a later rule)', () => {
    const host = dom('cms.Heading', { size: { base: 'h3', desktop: 'display' } });
    const heading = host.querySelector<HTMLElement>('h2')!;
    expect(heading.className).toContain('cmsc-pb-text-token');
    expect(heading.getAttribute('style') ?? '').toContain('--pb-text-lh-lg:var(--cmsb-t-display-lh, 1.08)');
    const css = stylesheet();
    const token = css.indexOf('.cmsc-pb-text-token {');
    expect(token).toBeGreaterThan(css.indexOf('.cmsc-t--small {'));
    expect(token).toBeLessThan(css.indexOf('.cmsc-pb-text-weight {'));
    expect(token).toBeLessThan(css.indexOf('.cmsc-pb-text-leading {'));
    expect(css).toContain(
      '.cmsc-pb-text-token { line-height: var(--pb-text-lh); font-weight: var(--pb-text-w); letter-spacing: var(--pb-text-ls); }',
    );
    expect(css).toMatch(/@media \(min-width: 1024px\) \{ \.cmsc-pb-text-token \{ line-height: var\(--pb-text-lh-lg\); font-weight: var\(--pb-text-w-lg\); letter-spacing: var\(--pb-text-ls-lg\); \} \}/);
  });
});

describe('R23 (T434): the carousel small-desktop tier (R21H T354) is gone', () => {
  const region = (props: Record<string, unknown>) =>
    dom('cms.ContentSlider', props).querySelector<HTMLElement>('[role="region"]')!.getAttribute('style') ?? '';

  it('stored small-desktop slides per view and gap are ignored data: the markup is the one without them', () => {
    expect(region({ slidesPerViewSmallDesktop: 2, gapSmallDesktopPx: 12 })).toBe(region({}));
    expect(region({ slidesPerViewSmallDesktop: 2 })).not.toContain('-sd');
  });

  it('the stylesheet has no small-desktop carousel rule, and no carousel offers the fields', () => {
    expect(stylesheet()).not.toContain('--pb-spv-sd');
    for (const type of ['cms.ContentSlider', 'catalog.ProductSlider', 'blog.LatestPosts']) {
      const fields = (config.components[type]?.fields ?? {}) as Record<string, unknown>;
      expect(Object.keys(fields), type).not.toContain('slidesPerViewSmallDesktop');
      expect(Object.keys(fields), type).not.toContain('gapSmallDesktopPx');
    }
  });
});
