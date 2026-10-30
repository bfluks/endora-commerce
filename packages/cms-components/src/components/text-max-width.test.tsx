// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { getResponsiveFields, PB_RESPONSIVE_METADATA } from '@endora-commerce/page-builder-core';
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
 * `specs/163-page-builder-marketing-pages/` T134 (R5, owner gap list (a)12):
 * `cms.Text`, `cms.Statement` and `cms.RichContent` take a maximum text width —
 * a named measure or a Custom px, per breakpoint (the Responsive tab), so a
 * long line can be held to a readable length. Unset, nothing is written and
 * the block keeps today's full width (plan § *Extend, don't narrow*).
 */

const config = defaultPageBuilderConfig as Config;
const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
const BLOCKS = ['cms.Text', 'cms.Statement', 'cms.RichContent'] as const;

/** The element that carries the measure in each block. */
const MEASURED: Record<(typeof BLOCKS)[number], string> = {
  'cms.Text': 'p',
  'cms.Statement': '.cmsc-pb-statement__heading',
  'cms.RichContent': '.cmsc-pb-rich-content',
};

function block(type: string, props: Record<string, unknown> = {}): Data['content'][number] {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const extra = type === 'cms.RichContent' ? { content: null, html: '<p>Long text</p>' } : {};
  return { type, props: { ...defaults, ...extra, id: `${type}-1`, ...props } } as Data['content'][number];
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

type FieldMap = Record<string, { type?: string; options?: Array<{ value: unknown }>; metadata?: unknown }>;

async function resolvedFields(type: string, props: Record<string, unknown>): Promise<FieldMap> {
  const component = config.components[type]!;
  const fields = component.fields as FieldMap;
  if (!component.resolveFields) return fields;
  return (await component.resolveFields(
    { props: { ...(component.defaultProps ?? {}), id: 'x', ...props } } as never,
    { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
  )) as FieldMap;
}

describe('max text width of Text, Statement and RichContent (T134)', () => {
  it.each(BLOCKS)('%s unset writes no measure: today\'s full width', (type) => {
    const host = dom([block(type)]);
    expect(host.querySelector('.cmsc-text-max')).toBeNull();
    expect(host.innerHTML).not.toContain('--cmsc-text-max');
  });

  it.each(BLOCKS)('%s with a named measure carries it per breakpoint, each tier inheriting the one below', (type) => {
    const element = dom([block(type, { textMaxWidth: { base: 'none', tablet: 'medium', desktop: 'wide' } })]).querySelector(
      MEASURED[type],
    ) as HTMLElement;
    expect(element.classList).toContain('cmsc-text-max');
    expect(element.style.getPropertyValue('--cmsc-text-max')).toBe('none');
    expect(element.style.getPropertyValue('--cmsc-text-max-md')).toBe('48rem');
    expect(element.style.getPropertyValue('--cmsc-text-max-lg')).toBe('60rem');
  });

  it.each(BLOCKS)('%s with Custom takes its px', (type) => {
    const element = dom([block(type, { textMaxWidth: 'custom', textMaxWidthPx: 640 })]).querySelector(MEASURED[type]) as HTMLElement;
    expect(element.style.getPropertyValue('--cmsc-text-max')).toBe('640px');
    expect(element.style.getPropertyValue('--cmsc-text-max-lg')).toBe('640px');
  });

  it('cms.Statement holds its heading and its body to the measure', () => {
    const host = dom([
      block('cms.Statement', {
        textMaxWidth: 'narrow',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
      }),
    ]);
    expect(host.querySelector('.cmsc-pb-statement__heading')?.classList).toContain('cmsc-text-max');
    expect(host.querySelector('.cmsc-pb-statement__body')?.classList).toContain('cmsc-text-max');
    expect((host.querySelector('.cmsc-pb-statement__body') as HTMLElement).style.getPropertyValue('--cmsc-text-max')).toBe('36rem');
  });

  it.each(BLOCKS)('%s offers the measure on the Responsive tab, with Custom (px) shown only when chosen', async (type) => {
    const fields = config.components[type]!.fields as FieldMap;
    expect(fields['textMaxWidth']?.options?.map((option) => option.value)).toEqual(['none', 'narrow', 'medium', 'wide', 'custom']);
    expect(fields['textMaxWidth']?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(fields['textMaxWidthPx']?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(Object.keys(await resolvedFields(type, {}))).not.toContain('textMaxWidthPx');
    expect(Object.keys(await resolvedFields(type, { textMaxWidth: { base: 'none', desktop: 'custom' } }))).toContain('textMaxWidthPx');
    expect(getResponsiveFields(config.components[type]!)).toEqual(expect.arrayContaining(['textMaxWidth', 'textMaxWidthPx']));
    expect((config.components[type]!.defaultProps as Record<string, unknown>)['textMaxWidth']).toBeUndefined();
  });

  it('the stylesheet applies the measure per breakpoint and centres a centred text\'s measure', () => {
    const css = STYLESHEET.replace(/\s+/g, ' ');
    expect(css).toMatch(/\.cmsc-text-max \{ max-width: var\(--cmsc-text-max, none\); \}/);
    expect(css).toMatch(/\.cmsc-text-max \{ max-width: var\(--cmsc-text-max-md, var\(--cmsc-text-max, none\)\); \}/);
    expect(css).toMatch(/\.cmsc-text-max \{ max-width: var\(--cmsc-text-max-lg, var\(--cmsc-text-max-md, var\(--cmsc-text-max, none\)\)\); \}/);
    expect(css).toMatch(/\.cmsc-text-max\[data-align='center'\] \{ margin-left: auto; margin-right: auto; \}/);
    expect(css).toMatch(/\.cmsc-pb-statement\[data-align='center'\] \.cmsc-text-max \{ margin-left: auto; margin-right: auto; \}/);
  });
});
