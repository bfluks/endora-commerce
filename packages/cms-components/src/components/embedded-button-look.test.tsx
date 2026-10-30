import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { BUTTON_SPEC_OBJECT_FIELDS, specAtTier } from './Button.js';

/**
 * `specs/163-page-builder-marketing-pages/` R20E (T296, T297) — the button
 * look options of `cms.Button` (R19B: transparent outline fill, a border
 * colour) on **every** button a block embeds (`ButtonSpec`: a hero's, a
 * card's, a section header's), plus an icon-only button's **pill** shape (on
 * both).
 *
 * One code path: `ButtonView` reads the look from the spec and from the
 * block's own options (`cms.Button`, which keeps its stored block-level
 * fields); the same look renders the same button either way. Unset renders
 * today's markup.
 *
 * R23 (T447): an icon-only button's px size (R19B) and a pill's px width
 * (R20E) were removed — the button follows its size option and a pill is 1.15
 * times its height. Stored values are ignored.
 */

const config = defaultPageBuilderConfig as Config;

function render(type: string, props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const data: Data = { root: { props: {} }, content: [{ type, props: { ...defaults, id: 'block-1', ...props } }] as Data['content'] };
  return renderToString(<Render config={config} data={data} />);
}

function buttonTag(html: string): string {
  const match = /<(?:a|span) [^>]*class="[^"]*cmsc-btn [^"]*"[^>]*>/.exec(html);
  if (!match) throw new Error(`no button in ${html}`);
  return match[0];
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

const outline = { label: 'Scroll down', link: { kind: 'anchor', anchor: 'products' }, style: 'light', fill: 'outline', size: 'medium' };
const iconOnly = { ...outline, icon: 'chevronDown', iconPosition: 'only' };
const LOOK = {
  transparentOutline: true,
  borderColor: '#777777',
  iconOnlyShape: 'pill',
};
/** The px options R20E stored and R23 removed. */
const STALE = { iconSizePx: { base: 44, desktop: 56 }, iconOnlyWidthPx: { base: 64, desktop: 72 } };

describe('the button look on a block-embedded button (T296)', () => {
  it('unset renders today’s hero button', () => {
    const html = render('cms.Hero', { buttons: [iconOnly] });
    expect(render('cms.Hero', { buttons: [{ ...iconOnly, transparentOutline: false, iconOnlyShape: 'circle' }] })).toBe(html);
    expect(buttonTag(html)).not.toContain('style=');
  });

  it('a hero button takes the transparent outline, the border colour and the pill shape', () => {
    const tag = buttonTag(render('cms.Hero', { buttons: [{ ...iconOnly, ...LOOK }] }));
    expect(tag).toContain('--cmsc-btn-outline-bg:transparent');
    expect(tag).toContain('--cmsc-btn-border:#777777');
    expect(tag).toContain('cmsc-btn--icon-pill');
  });

  it('R23 (T447): a stored px size and pill width are ignored data', () => {
    const tag = buttonTag(render('cms.Hero', { buttons: [{ ...iconOnly, ...LOOK, ...STALE }] }));
    expect(tag).toBe(buttonTag(render('cms.Hero', { buttons: [{ ...iconOnly, ...LOOK }] })));
    expect(tag).not.toContain('--pb-btn-size');
    expect(tag).not.toContain('--pb-btn-width');
    expect(tag).not.toContain('cmsc-btn--icon-size');
  });

  it('the pill only on an icon-only button; the outline and the border on any', () => {
    const tag = buttonTag(render('cms.Hero', { buttons: [{ ...outline, ...LOOK }] }));
    expect(tag).not.toContain('icon-pill');
    expect(tag).toContain('--cmsc-btn-outline-bg:transparent');
    expect(tag).toContain('--cmsc-btn-border:#777777');
  });

  it('a section header button and a media-and-text button read it too', () => {
    const media = buttonTag(render('cms.MediaText', { buttons: [{ ...iconOnly, ...LOOK }] }));
    expect(media).toContain('cmsc-btn--icon-pill');
    expect(media).toContain('--cmsc-btn-outline-bg:transparent');
  });

  it('the editor canvas resolves the previewed tier’s style and fill', () => {
    const spec = specAtTier({ ...iconOnly, ...LOOK, style: { base: 'light', desktop: 'dark' } } as never, 'desktop');
    expect(spec.style).toBe('dark');
    expect(spec.iconOnlyShape).toBe('pill');
  });

  it('the embedded button’s fields offer the look options, and no px size or width', () => {
    const keys = Object.keys(BUTTON_SPEC_OBJECT_FIELDS);
    expect(keys).toEqual(expect.arrayContaining(['transparentOutline', 'borderColor', 'iconOnlyShape']));
    expect(keys).not.toContain('iconSizePx');
    expect(keys).not.toContain('iconOnlyWidthPx');
  });
});

describe('cms.Button and an embedded button share one code path (T297)', () => {
  it('the block’s own options and the same options on the spec render the same button', () => {
    const block = buttonTag(render('cms.Button', { button: iconOnly, ...LOOK }));
    const spec = buttonTag(render('cms.Button', { button: { ...iconOnly, ...LOOK } }));
    expect(spec).toBe(block);
    expect(block).toContain('cmsc-btn--icon-pill');
  });

  it('the block’s own option wins over the spec’s', () => {
    const tag = buttonTag(render('cms.Button', { button: { ...iconOnly, borderColor: '#000000' }, borderColor: '#ffffff' }));
    expect(tag).toContain('--cmsc-btn-border:#ffffff');
  });

  it('cms.Button offers the pill with an icon-only button, and keeps the look off its button object', async () => {
    const block = config.components['cms.Button'] as ComponentConfig;
    const fields = block.fields as Fields;
    const keys = async (props: Record<string, unknown>): Promise<string[]> =>
      Object.keys(
        await block.resolveFields!(
          { props: { ...(block.defaultProps ?? {}), ...props } } as never,
          { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
        ),
      );
    expect(await keys({ button: outline })).not.toContain('iconOnlyShape');
    expect(await keys({ button: iconOnly })).toContain('iconOnlyShape');
    expect(await keys({ button: iconOnly, iconOnlyShape: 'pill' })).not.toContain('iconOnlyWidthPx');
    const object = (fields['button'] as { objectFields: Record<string, unknown> }).objectFields;
    expect(Object.keys(object)).not.toContain('transparentOutline');
  });

  it('the stylesheet draws the pill 1.15 times as wide as it is tall', () => {
    const css = sheet();
    expect(css).toContain('.cmsc-btn--icon-only.cmsc-btn--icon-pill { width: calc(var(--cmsc-btn-h) * 1.15); }');
    expect(css).not.toContain('--pb-btn-width');
  });
});
