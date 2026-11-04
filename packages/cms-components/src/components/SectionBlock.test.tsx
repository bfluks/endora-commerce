import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Render, type ComponentConfig, type Config, type Data, type Field, type PuckAction } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getResponsiveFields, isResponsiveField } from '@endora-commerce/page-builder-core';
import { shouldRevertPuckAction } from '@endora-commerce/page-builder-core/editor/puck-guards';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { SectionFrame } from './Section.js';

/**
 * `specs/163-page-builder-marketing-pages/` T109, FR-000–FR-005 and plan
 * § *Owner ruling 2026-10-23* — `cms.Section` is the one block that carries
 * section settings (anchor, scheme, background, spacing, width, content
 * position, reveal), with a slot for any other blocks. It stands only at the
 * top level of a page: every slot refuses it, the editor guard reverts a drop
 * into a slot, and a Section stored nested renders its children without the
 * section wrapper.
 *
 * Rendered through Puck's `<Render>`, the storefront's path.
 */

const config = defaultPageBuilderConfig as Config;
const sectionConfig = config.components['cms.Section'];
const defaults = (sectionConfig?.defaultProps ?? {}) as Record<string, unknown>;
const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;
const textDefaults = (config.components['cms.Text']?.defaultProps ?? {}) as Record<string, unknown>;

const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');
const IMAGE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function text(id: string, value: string): unknown {
  return { type: 'cms.Text', props: { ...textDefaults, id, text: value } };
}

function section(id: string, props: Record<string, unknown> = {}, content: unknown[] = []): unknown {
  return { type: 'cms.Section', props: { ...defaults, id, content, ...props } };
}

function row(id: string, content: unknown[]): unknown {
  return { type: 'cms.Row', props: { ...rowDefaults, id, content } };
}

function column(id: string, content: unknown[]): unknown {
  return { type: 'cms.Column', props: { ...columnDefaults, id, span: 12, content } };
}

function render(content: unknown[]): string {
  const data: Data = { root: { props: {} }, content: content as Data['content'] };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

function sectionTags(html: string): string[] {
  return html.match(/<section [^>]*class="cmsc-section[^"]*"[^>]*>/g) ?? [];
}

describe('cms.Section at the top level', () => {
  // T117: the settings are the block's own top-level props, so the
  // responsive ones reach the editor's Responsive tab (as `cms.Row`'s do).
  it('is registered as a block whose settings are top-level props, and a slot', () => {
    expect(sectionConfig).toBeDefined();
    const fields = (sectionConfig?.fields ?? {}) as Record<string, { type?: string; metadata?: unknown }>;
    expect(fields['section']).toBeUndefined();
    expect(fields['content']?.type).toBe('slot');
    for (const key of ['anchor', 'scheme', 'background', 'width', 'customMaxWidthPx', 'spaceTop', 'spaceBottom', 'contentPosition', 'reveal']) {
      expect(fields[key], key).toBeDefined();
    }
  });

  // T148 (deliberately changed, standing rule 13): the overlap joins the Responsive tab.
  // R19C (T260; deliberately changed, standing rule 13): so does the width. R23 (T449): the outset (T261) was removed.
  it('puts the width, space above, space below, content position and overlap on the Responsive tab, and nothing else', () => {
    const fields = (sectionConfig?.fields ?? {}) as Record<string, Field>;
    const responsive = Object.entries(fields)
      .filter(([, field]) => isResponsiveField(field))
      .map(([name]) => name)
      .sort();
    expect(responsive).toEqual(['contentPosition', 'overlap', 'spaceBottom', 'spaceTop', 'width']);
    expect([...getResponsiveFields(sectionConfig as ComponentConfig)].sort()).toEqual([
      'contentPosition',
      'overlap',
      'spaceBottom',
      'spaceTop',
      'width',
    ]);
    expect(fields['contentPosition']?.type).toBe('select');
  });

  it('offers the custom max width only with the custom width', async () => {
    const resolve = async (props: Record<string, unknown>): Promise<string[]> =>
      Object.keys(
        await sectionConfig!.resolveFields!({ props: { ...defaults, id: 's-1', ...props } } as never, {
          fields: sectionConfig!.fields,
          lastFields: sectionConfig!.fields,
          changed: {},
          lastData: null,
          metadata: {},
          appState: {},
          parent: { type: 'root', props: { id: 'root' } },
        } as never),
      );
    expect(await resolve({})).not.toContain('customMaxWidthPx');
    expect(await resolve({ width: 'wide' })).not.toContain('customMaxWidthPx');
    expect(await resolve({ width: 'custom' })).toContain('customMaxWidthPx');
  });

  // R19C (T260): with a width per breakpoint, a setting shows when any breakpoint's width takes it.
  it('shows the custom max width and the content width when any breakpoint\'s width takes them; no outset (R23)', async () => {
    const resolve = async (props: Record<string, unknown>): Promise<string[]> =>
      Object.keys(
        await sectionConfig!.resolveFields!({ props: { ...defaults, id: 's-1', ...props } } as never, {
          fields: sectionConfig!.fields,
          lastFields: sectionConfig!.fields,
          changed: {},
          lastData: null,
          metadata: {},
          appState: {},
          parent: { type: 'root', props: { id: 'root' } },
        } as never),
      );
    expect(await resolve({})).not.toContain('outsetPx');
    expect(await resolve({ width: { base: 'bleed', desktop: 'contained' } })).not.toContain('outsetPx');
    expect(await resolve({ width: { base: 'bleed', desktop: 'contained' } })).toContain('contentWidth');
    expect(await resolve({ width: { base: 'contained', desktop: 'custom' } })).toContain('customMaxWidthPx');
    expect(await resolve({ width: { base: 'contained' } })).not.toContain('contentWidth');
  });

  it('renders a custom max width from its plain px value', () => {
    const [tag] = sectionTags(render([section('s-1', { width: 'custom', customMaxWidthPx: 880 })])) as [string];
    expect(tag).toContain('data-width="custom"');
    expect(tag).toContain('--cmsc-section-max:880px');
    expect(tag).toContain('--cmsc-section-max-lg:880px');
  });

  it('renders <section class="cmsc-section"> with anchor, scheme and width, and its children inside the frame', () => {
    const html = render([
      section('s-1', { anchor: 'services', scheme: 'dark', width: 'wide', spaceTop: 'xl', spaceBottom: { px: 24 } }, [
        text('t-1', 'Inside the section'),
      ]),
    ]);
    const tags = sectionTags(html);
    expect(tags).toHaveLength(1);
    const [tag] = tags as [string];
    expect(tag).toContain('id="services"');
    expect(tag).toContain('data-cmsb-scheme="dark"');
    expect(tag).toContain('data-width="wide"');
    expect(tag).toContain('--cmsc-section-pt:var(--cmsb-space-xl, 56px)');
    expect(tag).toContain('--cmsc-section-pb:24px');
    const frame = html.slice(html.indexOf('cmsc-section__frame'));
    expect(frame).toContain('Inside the section');
  });

  it('draws an image background with its overlay, and paints a solid one on itself', () => {
    const image = render([
      section('s-1', {
        background: { kind: 'image', imageSource: 'library', imageAssetId: IMAGE, overlay: { kind: 'solid', strength: 40 } },
      }),
    ]);
    expect(image).toContain('cmsc-section__media');
    expect(image).toContain('cmsc-section__picture');
    expect(image).toContain('cmsc-section__overlay');
    expect(sectionTags(image)[0]).toContain('data-media="1"');

    const solid = render([section('s-2', { background: { kind: 'solid', color: '#123456' } })]);
    expect(sectionTags(solid)[0]).toContain('background-color:#123456');
  });

  it('renders no reveal state on the server, so content is visible without JavaScript', () => {
    const html = render([section('s-1', { reveal: { effect: 'fade-up', desktopOnly: false } }, [text('t-1', 'Shown')])]);
    expect(html).not.toContain('data-cmsc-reveal');
    expect(html).toContain('Shown');
  });

  it('writes the content position per breakpoint', () => {
    const html = render([
      section('s-1', { width: 'viewport', contentPosition: { base: 'start', desktop: 'center' } }),
    ]);
    const [tag] = sectionTags(html) as [string];
    expect(tag).toContain('data-position="start"');
    expect(tag).toContain('data-position-lg="center"');
  });

  it('renders an empty, neutral section by default: no colour, contained, the default spacing', () => {
    // Nothing but the empty slot: an untouched Section stores no settings.
    expect(defaults).toEqual({ content: [] });
    const html = render([section('s-1')]);
    const [tag] = sectionTags(html) as [string];
    expect(tag).not.toContain('data-cmsb-scheme');
    expect(tag).not.toContain('background');
    expect(tag).not.toContain(' id=');
    expect(tag).toContain('data-width="contained"');
    expect(tag).toContain('--cmsc-section-pt:var(--cmsb-space-l, 40px)');
    expect(tag).toContain('--cmsc-section-pb-lg:var(--cmsb-space-l, 64px)');
  });

  // T124 (gap a1 of the local rebuild): the background's extent and the
  // content's width are separate choices — a viewport-wide background with the
  // content in the container, without the viewport's full height.
  it('offers a content width with the wide backgrounds only, defaulting to today\'s frame', async () => {
    const field = (sectionConfig?.fields as Record<string, { type?: string; options?: Array<{ value: string }> }>)['contentWidth'];
    expect(field?.type).toBe('select');
    expect(field?.options?.map((option) => option.value)).toEqual(['contained', 'wide', 'full', 'custom']);
    const resolve = async (props: Record<string, unknown>): Promise<string[]> =>
      Object.keys(
        await sectionConfig!.resolveFields!(
          { props: { id: 's-1', content: [], ...props } } as never,
          {
            fields: sectionConfig!.fields!,
            changed: {},
            lastFields: sectionConfig!.fields!,
            lastData: null,
            metadata: {},
            appState: {},
            parent: { type: 'root', props: { id: 'root' } },
          } as never,
        ),
      );
    for (const width of [undefined, 'contained', 'wide', 'custom']) {
      expect(await resolve(width ? { width } : {}), String(width)).not.toContain('contentWidth');
    }
    for (const width of ['full', 'viewport', 'bleed']) expect(await resolve({ width }), width).toContain('contentWidth');
    // The custom max width also serves a custom content width.
    expect(await resolve({ width: 'bleed', contentWidth: 'custom' })).toContain('customMaxWidthPx');
    expect(await resolve({ width: 'bleed', contentWidth: 'contained' })).not.toContain('customMaxWidthPx');
  });

  it('writes the content width on a wide background, and nothing when unset or not applicable', () => {
    const [bleed] = sectionTags(render([section('s-1', { width: 'bleed', contentWidth: 'contained' })])) as [string];
    expect(bleed).toContain('data-width="bleed"');
    expect(bleed).toContain('data-content-width="contained"');
    const [custom] = sectionTags(render([section('s-1', { width: 'full', contentWidth: 'custom', customMaxWidthPx: 720 })])) as [string];
    expect(custom).toContain('data-content-width="custom"');
    expect(custom).toContain('--cmsc-section-max:720px');
    const [plain] = sectionTags(render([section('s-1', { width: 'bleed' })])) as [string];
    expect(plain).not.toContain('data-content-width');
    const [ignored] = sectionTags(render([section('s-1', { width: 'contained', contentWidth: 'full' })])) as [string];
    expect(ignored).not.toContain('data-content-width');
  });

  it('stylesheet: the content width sizes the frame, and only `viewport` forces the full height', () => {
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('}', start));
    };
    expect(rule(".cmsc-section[data-content-width='contained'] > .cmsc-section__frame")).toMatch(/max-width: var\(--cmsb-container, 1360px\)/);
    expect(rule(".cmsc-section[data-content-width='contained'] > .cmsc-section__frame")).toMatch(/padding-left: var\(--pb-page-padding/);
    expect(rule(".cmsc-section[data-content-width='wide'] > .cmsc-section__frame")).toMatch(/max-width: var\(--cmsb-wide, 1600px\)/);
    expect(rule(".cmsc-section[data-content-width='full'] > .cmsc-section__frame")).toMatch(/max-width: none/);
    expect(rule(".cmsc-section[data-content-width='custom'] > .cmsc-section__frame")).toMatch(/max-width: var\(--cmsc-section-max, 1200px\)/);
    expect(css).not.toMatch(/\[data-width='bleed'\][^{]*\{[^}]*min-height/);
    expect(css).not.toMatch(/\[data-width='full'\][^{]*\{[^}]*min-height/);
  });

  it('stylesheet: a viewport-wide section is at least the viewport tall and positions its content', () => {
    const css = readFileSync(STYLESHEET, 'utf8');
    expect(css).toMatch(/\.cmsc-section\[data-width='viewport'\]\s*\{[^}]*min-height:\s*100svh/);
    expect(css).toMatch(/\.cmsc-section\[data-position='center'\]\s*\{[^}]*justify-content:\s*center/);
  });
});

describe('cms.Section is top-level only', () => {
  it('its own slot refuses another Section and a Column', () => {
    const slot = (sectionConfig?.fields as Record<string, { disallow?: string[] }> | undefined)?.['content'];
    expect(slot?.disallow).toEqual(expect.arrayContaining(['cms.Section', 'cms.Column']));
  });

  // T158 (deliberately changed, standing rule 13): a top-level Section group's slot is the one exception.
  it('every slot of every block but a Section group\'s refuses it', () => {
    const offenders: string[] = [];
    const visit = (owner: string, fields: Record<string, unknown> | undefined): void => {
      for (const [key, raw] of Object.entries(fields ?? {})) {
        const field = raw as { type?: string; allow?: string[]; disallow?: string[]; arrayFields?: Record<string, unknown>; objectFields?: Record<string, unknown> };
        if (field?.type === 'slot') {
          const refused = field.allow ? !field.allow.includes('cms.Section') : (field.disallow ?? []).includes('cms.Section');
          if (!refused) offenders.push(`${owner}.${key}`);
        }
        if (field?.arrayFields) visit(`${owner}.${key}[]`, field.arrayFields);
        if (field?.objectFields) visit(`${owner}.${key}`, field.objectFields);
      }
    };
    for (const [name, component] of Object.entries(config.components)) {
      visit(name, component.fields as Record<string, unknown> | undefined);
    }
    expect(offenders).toEqual(['cms.SectionGroup.content']);
  });

  it('the editor guard reverts a Section inserted or moved into a slot, and keeps one at the root', () => {
    const data = {
      root: { props: {} },
      content: [section('s-1'), row('row-1', [column('col-1', [])])],
    } as unknown as Data;
    const insert = (destinationZone: string): PuckAction =>
      ({ type: 'insert', componentType: 'cms.Section', destinationIndex: 0, destinationZone, id: 'new' }) as PuckAction;
    expect(shouldRevertPuckAction(insert('col-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(insert('s-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(insert('root:default-zone'), data)).toBe(false);

    const move = { type: 'move', sourceZone: 'root:default-zone', sourceIndex: 0, destinationZone: 'col-1:content', destinationIndex: 0 } as PuckAction;
    expect(shouldRevertPuckAction(move, data)).toBe(true);
    const reorder = { type: 'reorder', sourceIndex: 0, destinationIndex: 1, destinationZone: 'root:default-zone' } as PuckAction;
    expect(shouldRevertPuckAction(reorder, data)).toBe(false);
  });

  it('stored nested, it renders its children without the section wrapper', () => {
    const html = render([
      row('row-1', [column('col-1', [section('s-nested', { anchor: 'nested', scheme: 'dark' }, [text('t-1', 'Nested child')])])]),
    ]);
    expect(sectionTags(html)).toEqual([]);
    expect(html).not.toContain('id="nested"');
    expect(html).toContain('Nested child');
  });
});

describe('section settings live only on cms.Section', () => {
  it('no other block carries a `section` field or default', () => {
    const carriers = Object.entries(config.components)
      .filter(([name]) => name !== 'cms.Section')
      .filter(([, component]) => {
        const fields = (component.fields ?? {}) as Record<string, unknown>;
        const props = (component.defaultProps ?? {}) as Record<string, unknown>;
        return 'section' in fields || 'section' in props;
      })
      .map(([name]) => name);
    expect(carriers).toEqual([]);
  });

  it('a stray `section` prop stored on another block is ignored at render', () => {
    const html = render([
      { type: 'cms.Text', props: { ...textDefaults, id: 't-1', text: 'Plain', section: { anchor: 'stray', scheme: 'dark' } } },
    ]);
    expect(sectionTags(html)).toEqual([]);
    expect(html).not.toContain('id="stray"');
  });
});

/**
 * T148 (R7, owner request 2026-10-26) — two Section behaviours a marketing page
 * needs, both added without changing an untouched Section's markup:
 *
 * - **overlap**: the Section's content is pulled up into the previous section
 *   by a spacing token or px, per breakpoint (Responsive tab), and sits above
 *   that section's background (the Section's own box, its background included,
 *   stays where it is);
 * - **empty collapse**: a published Section whose children all render nothing
 *   (a data block with no data, a block hidden at that breakpoint) paints no
 *   blank padding — a stylesheet rule on the frame's content (`:has()`), so the
 *   DOM of a non-empty Section is unchanged.
 */
describe('cms.Section overlap and empty collapse (T148)', () => {
  const css = (): string =>
    readFileSync(STYLESHEET, 'utf8')
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')');

  it('offers the overlap as a responsive spacing field, unset by default', () => {
    const fields = (sectionConfig?.fields ?? {}) as Record<string, Field>;
    expect(fields['overlap']?.type).toBe('custom');
    expect(isResponsiveField(fields['overlap'] as Field)).toBe(true);
    expect(defaults).not.toHaveProperty('overlap');
  });

  it('writes nothing for an unset overlap, or one that is none at every breakpoint', () => {
    for (const overlap of [undefined, 'none', { px: 0 }, { base: 'none', desktop: { px: 0 } }]) {
      const [tag] = sectionTags(render([section('s-1', overlap === undefined ? {} : { overlap })])) as [string];
      expect(tag, JSON.stringify(overlap)).not.toContain('data-overlap');
      expect(tag, JSON.stringify(overlap)).not.toContain('--cmsc-section-overlap');
    }
  });

  it('writes the overlap per breakpoint, a token through its brand variable and px as a literal', () => {
    const [tag] = sectionTags(render([section('s-1', { overlap: { base: 'none', tablet: 'l', desktop: { px: 120 } } })])) as [string];
    expect(tag).toContain('data-overlap="1"');
    expect(tag).toContain('--cmsc-section-overlap:var(--cmsb-space-none, 0px)');
    expect(tag).toContain('--cmsc-section-overlap-md:var(--cmsb-space-l, 40px)');
    expect(tag).toContain('--cmsc-section-overlap-lg:120px');
  });

  it('in the editor canvas, writes the previewed breakpoint\'s overlap only, for the band that shows it', () => {
    const editing = (tier: 'mobile' | 'desktop'): string =>
      renderToString(
        <SectionFrame settings={{ overlap: { base: 'none', desktop: 'xl' } }} tier={tier} editing>
          <p>x</p>
        </SectionFrame>,
      );
    const [desktop] = sectionTags(editing('desktop')) as [string];
    expect(desktop).toContain('data-overlap="1"');
    expect(desktop).toContain('--cmsc-section-overlap:var(--cmsb-space-xl, 96px)');
    expect(desktop).not.toContain('--cmsc-section-overlap-lg');
    const [mobile] = sectionTags(editing('mobile')) as [string];
    expect(mobile).not.toContain('data-overlap');
  });

  it('stylesheet: the frame is pulled up per breakpoint above the previous section, never in the editor or on the first block', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.cmsc-section\[data-overlap\] \{[^}]*z-index: 1/);
    expect(sheet).toMatch(
      /\.cmsc-section\[data-overlap\]:not\(\.cmsc-section--tier\) > \.cmsc-section__frame \{[^}]*margin-top: calc\(-1 \* var\(--cmsc-section-overlap, 0px\)\)/,
    );
    expect(sheet).toMatch(/margin-top: calc\(-1 \* var\(--cmsc-section-overlap-md, var\(--cmsc-section-overlap, 0px\)\)\)/);
    expect(sheet).toMatch(
      /margin-top: calc\(-1 \* var\(--cmsc-section-overlap-lg, var\(--cmsc-section-overlap-md, var\(--cmsc-section-overlap, 0px\)\)\)\)/,
    );
    // A negative margin must not collapse through a Section with no space above.
    expect(sheet).toMatch(/\.cmsc-section\[data-overlap\]:not\(\[data-position\]\) \{[^}]*display: flow-root/);
    expect(sheet).toMatch(/\.cmsc-pb-hide-on:first-child > \.cmsc-section\[data-overlap\] > \.cmsc-section__frame \{[^}]*margin-top: 0/);
    // The editor shows a band of the overlap's height instead.
    expect(sheet).toMatch(/\.cmsc-section--tier\[data-overlap\]::before \{[^}]*height: var\(--cmsc-section-overlap, 0px\)[^}]*pointer-events: none/);
  });

  it('stylesheet: an empty Section drops its padding, per breakpoint counting the blocks hidden there', () => {
    const sheet = css();
    const empty = /:not\(:has\(> \.cmsc-section__frame > \* > :not\(([^)]*)\)\)\)/g;
    const lists = [...sheet.matchAll(empty)].map((match) => match[1]);
    expect(lists).toContain('.cmsc-pb-hide-on:empty');
    for (const tier of ['mobile', 'tablet', 'desktop']) {
      expect(lists, tier).toContain(`.cmsc-pb-hide-on:empty, .cmsc-pb-hide-on[data-hide-${tier}='1']`);
    }
    // Never in the editor (its slot keeps a drop area), never over an image or a video.
    expect(sheet).toMatch(/\.cmsc-section:not\(\.cmsc-section--tier, \[data-media\]\):not\(:has\(/);
  });

  it('a Section whose only block renders nothing (news with no posts) holds an empty block wrapper — what the rule reads', () => {
    const latest = (config.components['blog.LatestPosts']?.defaultProps ?? {}) as Record<string, unknown>;
    const html = render([section('s-1', {}, [{ type: 'blog.LatestPosts', props: { ...latest, id: 'lp-1' } }])]);
    const frame = html.slice(html.indexOf('<div class="cmsc-section__frame">'));
    expect(frame).toMatch(/^<div class="cmsc-section__frame"><div><div class="cmsc-pb-hide-on"[^>]*><\/div><\/div><\/div>/);
  });
});
