// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
 * `specs/163-page-builder-marketing-pages/` T126 — the hero's video above the
 * content and the media-and-text video take an aspect ratio, per breakpoint,
 * instead of a fixed 16:9 frame. With no ratio chosen the frame is 16:9, as
 * before.
 */

const config = defaultPageBuilderConfig as Config;
const VIDEO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');

function node(type: string, props: Record<string, unknown>): Data['content'][number] {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  return { type, props: { ...defaults, id: `${type}-1`, ...props } } as Data['content'][number];
}

function dom(content: Data['content']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('video frame ratio (T126)', () => {
  it('cms.Hero: a video above the content writes its ratio per breakpoint on the frame', () => {
    const host = dom([
      node('cms.Hero', {
        mediaPlacement: 'above',
        media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, ratio: { base: '1:1', desktop: '67:20' } },
      }),
    ]);
    const frame = host.querySelector('.cmsc-pb-hero__media--above') as HTMLElement;
    expect(frame.getAttribute('data-kind')).toBe('video');
    expect(frame.style.getPropertyValue('--pb-ratio')).toBe('1 / 1');
    expect(frame.style.getPropertyValue('--pb-ratio-lg')).toBe('67 / 20');
  });

  it('cms.Hero: no ratio chosen keeps the 16:9 frame (no variables)', () => {
    const host = dom([
      node('cms.Hero', { mediaPlacement: 'above', media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO } }),
    ]);
    const frame = host.querySelector('.cmsc-pb-hero__media--above') as HTMLElement;
    expect(frame.style.getPropertyValue('--pb-ratio')).toBe('');
  });

  it('cms.MediaText: a video writes its ratio per breakpoint on the frame; none keeps 16:9', () => {
    const host = dom([node('cms.MediaText', { media: { kind: 'video', videoAssetId: VIDEO, ratio: { base: '4:5', tablet: '16:9' } } })]);
    const frame = host.querySelector('.cmsc-pb-media-text__video') as HTMLElement;
    expect(frame.style.getPropertyValue('--pb-ratio')).toBe('4 / 5');
    expect(frame.style.getPropertyValue('--pb-ratio-md')).toBe('16 / 9');
    expect(frame.style.getPropertyValue('--pb-ratio-lg')).toBe('16 / 9');

    const plain = dom([node('cms.MediaText', { media: { kind: 'video', videoAssetId: VIDEO } })]);
    expect((plain.querySelector('.cmsc-pb-media-text__video') as HTMLElement).style.getPropertyValue('--pb-ratio')).toBe('');
  });

  it('the stylesheet reads the ratio with 16:9 as the fallback, per breakpoint', () => {
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain(".cmsc-pb-hero__media--above[data-kind='video'] { aspect-ratio: var(--pb-ratio, 16 / 9); }");
    expect(css).toContain('.cmsc-pb-media-text__video { aspect-ratio: var(--pb-ratio, 16 / 9);');
    expect(css).toMatch(
      /@media \(min-width: 1024px\) \{ \.cmsc-pb-hero__media--above\[data-kind='video'\], \.cmsc-pb-media-text__video \{ aspect-ratio: var\(--pb-ratio-lg, var\(--pb-ratio-md, var\(--pb-ratio, 16 \/ 9\)\)\); \} \}/,
    );
  });
});
