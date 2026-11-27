import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T245, T246) — `cms.Button`'s
 * look, extended (plan § *Extend, don't narrow*).
 *
 * - **The outline fill stays as stored.** `cms.Button`'s outline button is
 *   filled with the scheme's background on purpose: it is today's white-filled
 *   `secondary` variant (stylesheet, `.cmsc-pb-button`). So nothing stored
 *   changes; a **Transparent outline fill** switch lets the section show
 *   through, as the section blocks' outline buttons do.
 * - A **border colour** (an icon-only outline button's ring).
 *
 * R23 (T447): R19B's icon-only px size per breakpoint was removed — an
 * icon-only button follows its size option; a stored size is ignored.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.Button'] as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;

function render(props: Record<string, unknown> = {}): string {
  const data: Data = {
    root: { props: {} },
    content: [{ type: 'cms.Button', props: { ...defaults, id: 'button-1', ...props } }] as Data['content'],
  };
  return renderToString(<Render config={config} data={data} />);
}

const outline = { label: 'Download', link: { kind: 'url', href: '/file.pdf' }, style: 'dark', fill: 'outline', size: 'medium' };
const iconOnly = { ...outline, icon: 'download', iconPosition: 'only' };

function tag(html: string): string {
  const match = /<(?:a|span) [^>]*class="[^"]*cmsc-btn[^"]*"[^>]*>/.exec(html);
  if (!match) throw new Error(`no button in ${html}`);
  return match[0];
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

async function fieldKeys(props: Record<string, unknown>): Promise<string[]> {
  const fields = block.fields as Fields;
  const resolved = await block.resolveFields!(
    { props: { ...defaults, ...props } } as never,
    { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
  );
  return Object.keys(resolved);
}

describe('cms.Button outline fill (T245)', () => {
  it('keeps today’s scheme-filled outline: the stylesheet rule is intentional and unchanged', () => {
    expect(sheet()).toContain('.cmsc-pb-button { --cmsc-btn-outline-bg: var(--cmsb-bg, #ffffff); }');
    const html = render({ button: outline });
    expect(tag(html)).not.toContain('--cmsc-btn-outline-bg');
    expect(render({ button: outline, transparentOutline: false })).toBe(html);
  });

  it('the switch makes the outline fill transparent on this button only', () => {
    expect(tag(render({ button: outline, transparentOutline: true }))).toContain('--cmsc-btn-outline-bg:transparent');
  });
});

describe('cms.Button border colour (T246; R23 T447: no icon-only px size)', () => {
  it('a stored icon-only size is ignored: the button follows its size option', () => {
    const html = render({ button: iconOnly });
    expect(render({ button: iconOnly, iconSizePx: { base: 72, desktop: 116 } })).toBe(html);
    expect(html).not.toContain('--pb-btn-size');
    expect(sheet()).not.toContain('cmsc-btn--icon-size');
  });

  it('a border colour (a hex or a brand token) replaces the fill’s border, on any fill', () => {
    expect(tag(render({ button: iconOnly, borderColor: '#6b7280' }))).toContain('--cmsc-btn-border:#6b7280');
    expect(tag(render({ button: outline, borderColor: 'token:primary' }))).toMatch(/--cmsc-btn-border:var\(--cmsb-color-primary/);
    expect(tag(render({ button: outline, borderColor: 'red;x' }))).not.toContain('--cmsc-btn-border');
  });

  it('unset renders today’s markup', () => {
    const html = render({ button: iconOnly });
    expect(render({ button: iconOnly, borderColor: '', transparentOutline: false })).toBe(html);
  });
});

describe('cms.Button fields (T245, T246)', () => {
  it('are offered where they apply: the outline switch with an outline fill; no px size', async () => {
    const solid = await fieldKeys({});
    expect(solid).toContain('borderColor');
    expect(solid).not.toContain('transparentOutline');
    expect(await fieldKeys({ button: outline })).toContain('transparentOutline');
    expect(await fieldKeys({ button: { ...outline, fill: { base: 'solid', desktop: 'outline' } } })).toContain('transparentOutline');
    expect(await fieldKeys({ button: iconOnly })).not.toContain('iconSizePx');
    expect(block.fields).not.toHaveProperty('iconSizePx');
  });
});
