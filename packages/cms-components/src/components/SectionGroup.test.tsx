// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data, type Field, type PuckAction } from '@puckeditor/core';
import { DEFAULT_BRAND_TOKENS, type CmsBrandTokens } from '@endora-commerce/page-builder-core/brand-tokens';
import { getResponsiveFields, isResponsiveField } from '@endora-commerce/page-builder-core';
import { ROOT_ONLY_TYPES, shouldRevertPuckAction } from '@endora-commerce/page-builder-core/editor/puck-guards';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { brandTokensToCss } from '../brand/brand-css.js';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { SectionGroupFrame } from './Section.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T158 (R9), FR-005 as amended on
 * 2026-10-26, plan § *Owner ruling 2026-10-26: a Section group container* —
 * **`cms.SectionGroup`**: a top-level container whose slot holds only
 * `cms.Section`s. It owns a colour scheme, a background (image, video,
 * overlay, decorative backdrop) and optional spacing, and paints them **once**
 * behind all its Sections, so the decorative layer runs on with no seam at a
 * Section boundary. A Section inside it inherits its scheme unless it sets its
 * own; while the group paints, a Section with no background of its own (and
 * the group's scheme, or none) is transparent. The Section stays a top-level
 * Section in every other respect: its `<section>`, anchor, spacing, overlap
 * and empty collapse.
 */

const config = defaultPageBuilderConfig as Config;
const groupConfig = config.components['cms.SectionGroup'];
const groupDefaults = (groupConfig?.defaultProps ?? {}) as Record<string, unknown>;
const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;
const textDefaults = (config.components['cms.Text']?.defaultProps ?? {}) as Record<string, unknown>;
const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILT_STYLESHEET = resolve(HERE, '../../dist/cms-components.css');
const SOURCE_STYLESHEET = resolve(HERE, '../../styles/cms-components.css');
const SVG_ASSET = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const IMAGE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const FILE_URL = `https://api.example.com/assets/file/${SVG_ASSET}`;

type Node = Data['content'][number];

function text(id: string, value: string): Node {
  return { type: 'cms.Text', props: { ...textDefaults, id, text: value } } as Node;
}

function section(id: string, props: Record<string, unknown> = {}, content: Node[] = []): Node {
  return { type: 'cms.Section', props: { ...sectionDefaults, id, content, ...props } } as Node;
}

function group(id: string, props: Record<string, unknown> = {}, content: Node[] = []): Node {
  return { type: 'cms.SectionGroup', props: { ...groupDefaults, id, content, ...props } } as Node;
}

function row(id: string, content: Node[]): Node {
  return { type: 'cms.Row', props: { ...rowDefaults, id, content } } as Node;
}

function column(id: string, content: Node[]): Node {
  return { type: 'cms.Column', props: { ...columnDefaults, id, span: 12, content } } as Node;
}

function render(content: Node[]): string {
  const data: Data = { root: { props: {} }, content };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

function mount(content: Node[]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = render(content);
  document.body.appendChild(host);
  return host;
}

/** `value` with each `var()` replaced by the nearest ancestor's custom property, or its fallback. */
function resolveVars(element: Element, value: string): string {
  let out = value;
  for (let guard = 0; guard < 20 && out.includes('var('); guard += 1) {
    const start = out.indexOf('var(');
    let depth = 1;
    let end = start + 4;
    for (; end < out.length && depth > 0; end += 1) {
      if (out[end] === '(') depth += 1;
      if (out[end] === ')') depth -= 1;
    }
    const inner = out.slice(start + 4, end - 1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    let set = '';
    for (let node: Element | null = element; node && set === ''; node = node.parentElement) {
      set = getComputedStyle(node).getPropertyValue(name).trim();
    }
    out = out.slice(0, start) + (set !== '' ? set : fallback) + out.slice(end);
  }
  return out;
}

function style(element: Element, property: string): string {
  return resolveVars(element, getComputedStyle(element).getPropertyValue(property)).trim();
}

function css(): string {
  return readFileSync(SOURCE_STYLESHEET, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

const TRANSPARENT = ['', 'transparent', 'rgba(0, 0, 0, 0)'];

beforeAll(() => {
  const sheet = document.createElement('style');
  sheet.textContent = readFileSync(BUILT_STYLESHEET, 'utf8');
  document.head.appendChild(sheet);
  const tokens: CmsBrandTokens = {
    ...DEFAULT_BRAND_TOKENS,
    schemes: { ...DEFAULT_BRAND_TOKENS.schemes, dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, decorativeAssetId: SVG_ASSET } },
  };
  const brand = document.createElement('style');
  brand.id = 'cmsb';
  brand.textContent = brandTokensToCss(tokens, { assetUrl: (id) => `https://api.example.com/assets/file/${id}` }).css;
  document.head.appendChild(brand);
});

describe('cms.SectionGroup is registered (T158)', () => {
  it('is a block with a scheme, a background, an anchor, spacing and a slot that admits only cms.Section', () => {
    expect(groupConfig).toBeDefined();
    const fields = (groupConfig?.fields ?? {}) as Record<string, { type?: string; allow?: string[]; disallow?: string[] }>;
    for (const key of ['scheme', 'background', 'anchor', 'spaceTop', 'spaceBottom']) expect(fields[key], key).toBeDefined();
    expect(fields['content']?.type).toBe('slot');
    expect(fields['content']?.allow).toEqual(['cms.Section']);
    // Neutral by default: nothing stored until an edit.
    expect(groupDefaults).toEqual({ content: [] });
  });

  it('puts space above and space below on the Responsive tab, and nothing else', () => {
    const fields = (groupConfig?.fields ?? {}) as Record<string, Field>;
    const responsive = Object.entries(fields)
      .filter(([, field]) => isResponsiveField(field))
      .map(([key]) => key);
    expect(responsive.sort()).toEqual(['spaceBottom', 'spaceTop']);
    expect(getResponsiveFields(groupConfig as never)?.slice().sort()).toEqual(['spaceBottom', 'spaceTop']);
  });

  it('the group is root-only, and the editor guards know it', () => {
    expect(ROOT_ONLY_TYPES).toEqual(expect.arrayContaining(['cms.Section', 'cms.SectionGroup']));
  });
});

describe('cms.SectionGroup renders one paint behind its Sections (T158)', () => {
  it('renders a wrapper with its anchor, scheme and paint layer, and each Section inside as a top-level section', () => {
    const html = render([
      group('g-1', { anchor: 'dark-run', scheme: 'dark', background: { kind: 'none', decorative: true } }, [
        section('s-1', { anchor: 'first' }, [text('t-1', 'First band')]),
        section('s-2', { anchor: 'second' }, [text('t-2', 'Second band')]),
      ]),
    ]);
    const tag = /<div [^>]*class="cmsc-section-group"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toContain('id="dark-run"');
    expect(tag).toContain('data-cmsb-scheme="dark"');
    expect(tag).toContain('data-decorative="1"');
    expect(tag).toContain('data-paint="1"');
    expect(html.match(/class="cmsc-section-group__paint"/g)).toHaveLength(1);
    const sections = html.match(/<section [^>]*class="cmsc-section[^"]*"[^>]*>/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('id="first"');
    expect(sections[1]).toContain('id="second"');
    for (const tagOf of sections) {
      expect(tagOf).toContain('data-in-group="1"');
      // The Section has no scheme of its own: it inherits the group's.
      expect(tagOf).not.toContain('data-cmsb-scheme');
    }
    expect(html).toContain('First band');
    expect(html).toContain('Second band');
  });

  it('paints the decorative layer once, on the group, and not on its Sections: no seam at the boundary', () => {
    const host = mount([
      group('g-paint', { scheme: 'dark', background: { kind: 'none', decorative: true } }, [
        section('s-a', { scheme: 'dark' }, [text('t-a', 'A')]),
        section('s-b', {}, [text('t-b', 'B')]),
      ]),
    ]);
    const paint = host.querySelector<HTMLElement>('.cmsc-section-group__paint')!;
    expect(style(paint, 'background-image').replace(/["']/g, '')).toBe(`url(${FILE_URL})`);
    expect(style(paint, 'background-size')).toBe('cover');
    expect(style(paint, 'background-color')).toBe('#0f172a');
    const sections = Array.from(host.querySelectorAll<HTMLElement>('section.cmsc-section'));
    expect(sections).toHaveLength(2);
    for (const node of sections) {
      expect(style(node, 'background-image')).toMatch(/^(none)?$/);
      expect(TRANSPARENT).toContain(style(node, 'background-color'));
      expect(node.getAttribute('data-transparent')).toBe('1');
    }
    // The text takes the dark scheme's colour, from the group or the Section's own scheme.
    expect(style(host.querySelector('.cmsc-section-group')!, 'color')).toBe('#f8fafc');
  });

  it('a Section that sets another scheme, or a background of its own, keeps painting it', () => {
    const html = render([
      group('g-own', { scheme: 'dark', background: { kind: 'none', decorative: true } }, [
        section('s-light', { scheme: 'light' }, [text('t-l', 'Light')]),
        section('s-solid', { background: { kind: 'solid', color: '#1d4ed8' } }, [text('t-s', 'Solid')]),
        section('s-deco', { scheme: 'dark', background: { kind: 'none', decorative: true } }, [text('t-d', 'Deco')]),
      ]),
    ]);
    const sections = html.match(/<section [^>]*>/g) ?? [];
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain('data-cmsb-scheme="light"');
    for (const tagOf of sections) expect(tagOf).not.toContain('data-transparent');
  });

  it('a group with no scheme and no background paints nothing, and its Sections paint as they would alone', () => {
    const html = render([group('g-plain', {}, [section('s-1', { scheme: 'dark' }, [text('t-1', 'Alone')])])]);
    const tag = /<div [^>]*class="cmsc-section-group"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).not.toContain('data-paint');
    expect(html).not.toContain('cmsc-section-group__paint');
    expect(html).not.toContain('data-transparent');
    expect(html).toContain('data-cmsb-scheme="dark"');
  });

  it('draws an image background with its overlay once, behind every Section', () => {
    const html = render([
      group('g-img', { background: { kind: 'image', imageSource: 'library', imageAssetId: IMAGE, overlay: { kind: 'solid', strength: 40 } } }, [
        section('s-1', {}, [text('t-1', 'One')]),
        section('s-2', {}, [text('t-2', 'Two')]),
      ]),
    ]);
    expect(html.match(/class="cmsc-section__media"/g)).toHaveLength(1);
    expect(html.match(/class="cmsc-section__overlay"/g)).toHaveLength(1);
    expect(html.indexOf('cmsc-section__media')).toBeLessThan(html.indexOf('<section'));
    expect(/<div [^>]*class="cmsc-section-group"[^>]*>/.exec(html)?.[0]).toContain('data-media="1"');
  });

  it('writes its spacing per breakpoint, none by default', () => {
    const plain = /<div [^>]*class="cmsc-section-group"[^>]*>/.exec(render([group('g-1', {}, [section('s-1')])]))?.[0] ?? '';
    expect(plain).toContain('--cmsc-group-pt:var(--cmsb-space-none, 0px)');
    expect(plain).toContain('--cmsc-group-pb:var(--cmsb-space-none, 0px)');
    const spaced =
      /<div [^>]*class="cmsc-section-group"[^>]*>/.exec(render([group('g-2', { spaceTop: { base: 's', desktop: { px: 120 } } }, [section('s-1')])]))?.[0] ?? '';
    expect(spaced).toContain('--cmsc-group-pt:var(--cmsb-space-s, 16px)');
    expect(spaced).toContain('--cmsc-group-pt-lg:120px');
  });

  it('in the editor canvas, writes the previewed breakpoint\'s spacing only', () => {
    const html = renderToString(
      <SectionGroupFrame settings={{ spaceTop: { base: 'none', desktop: 'xl' } }} tier="desktop" editing>
        <p>x</p>
      </SectionGroupFrame>,
    );
    expect(html).toContain('cmsc-section-group--tier');
    expect(html).toContain('--cmsc-group-pt:var(--cmsb-space-xl, 96px)');
    expect(html).not.toContain('--cmsc-group-pt-lg');
  });

  it('stored nested, it renders its children only, and a Section in it is not a section', () => {
    const html = render([
      row('row-1', [column('col-1', [group('g-nested', { anchor: 'nested', scheme: 'dark' }, [section('s-n', { anchor: 'inner' }, [text('t-1', 'Deep')])])])]),
    ]);
    expect(html).not.toContain('cmsc-section-group');
    expect(html).not.toMatch(/<section [^>]*class="cmsc-section[ "]/);
    expect(html).not.toContain('id="nested"');
    expect(html).not.toContain('id="inner"');
    expect(html).toContain('Deep');
  });

  it('a Section stored nested inside a grouped Section is still not a section', () => {
    const html = render([group('g-1', {}, [section('s-1', {}, [section('s-deep', { anchor: 'deep' }, [text('t-1', 'Deep')])])])]);
    expect(html.match(/<section [^>]*class="cmsc-section[ "]/g)).toHaveLength(1);
    expect(html).not.toContain('id="deep"');
  });
});

describe('cms.SectionGroup stylesheet (T158)', () => {
  it('paints the group across the window behind its Sections, and inside the editor frame', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.cmsc-section-group \{[^}]*position: relative[^}]*isolation: isolate/);
    expect(sheet).toMatch(/\.cmsc-section-group__paint \{[^}]*position: absolute[^}]*z-index: -1/);
    expect(sheet).toMatch(/\.cmsc-section-group__paint \{[^}]*left: calc\(50% - 50vw\)[^}]*width: 100vw/);
    expect(sheet).toMatch(/\[data-puck-entry\] \.cmsc-section-group__paint \{[^}]*left: 0[^}]*width: 100%/);
    expect(sheet).toMatch(/\.cmsc-section-group\[data-decorative='1'\] > \.cmsc-section-group__paint \{[^}]*background-image: var\(--cmsb-decorative, none\)/);
    expect(sheet).toMatch(/\.cmsc-section\[data-transparent='1'\] \{[^}]*background-color: transparent/);
    // Spacing is padding per breakpoint, as a Section's.
    expect(sheet).toMatch(/\.cmsc-section-group \{[^}]*padding-top: var\(--cmsc-group-pt, 0px\)/);
    expect(sheet).toMatch(/padding-top: var\(--cmsc-group-pt-lg, var\(--cmsc-group-pt-md, var\(--cmsc-group-pt, 0px\)\)\)/);
  });

  it('a Section in a group still collapses when empty — the DOM the T148 rule reads is unchanged', () => {
    const latest = (config.components['blog.LatestPosts']?.defaultProps ?? {}) as Record<string, unknown>;
    const html = render([group('g-1', {}, [section('s-1', {}, [{ type: 'blog.LatestPosts', props: { ...latest, id: 'lp-1' } } as Node])])]);
    const frame = html.slice(html.indexOf('<div class="cmsc-section__frame">'));
    expect(frame).toMatch(/^<div class="cmsc-section__frame"><div><div class="cmsc-pb-hide-on"[^>]*><\/div><\/div><\/div>/);
  });

  it('an empty group drops its own spacing, per breakpoint counting what is hidden there; never in the editor or over media', () => {
    const sheet = css();
    expect(sheet).toMatch(/\.cmsc-section-group:not\(\.cmsc-section-group--tier, \[data-media\]\):not\(:has\(/);
    for (const tier of ['mobile', 'tablet', 'desktop']) {
      expect(sheet, tier).toContain(
        `> .cmsc-section-group__frame > * > .cmsc-pb-hide-on:not([data-hide-${tier}='1']) > .cmsc-section > .cmsc-section__frame > * > :not(.cmsc-pb-hide-on:empty, .cmsc-pb-hide-on[data-hide-${tier}='1'])`,
      );
    }
    expect(sheet).toContain('> .cmsc-section-group__frame > * > * > .cmsc-section > .cmsc-section__frame > * > :not(.cmsc-pb-hide-on:empty)');
  });

  it('the first Section of a group overlaps the block before the group; the first block of the page still overlaps nothing', () => {
    const sheet = css();
    expect(sheet).toMatch(
      /\.cmsc-pb-hide-on:first-child > \.cmsc-section\[data-in-group\]\[data-overlap\]:not\(\.cmsc-section--tier\) > \.cmsc-section__frame \{[^}]*margin-top: calc\(-1 \* var\(--cmsc-section-overlap, 0px\)\)/,
    );
    expect(sheet).toMatch(
      /\.cmsc-pb-hide-on:first-child > \.cmsc-section-group > \.cmsc-section-group__frame > \* > \.cmsc-pb-hide-on:first-child > \.cmsc-section\[data-overlap\] > \.cmsc-section__frame \{[^}]*margin-top: 0/,
    );
  });
});

describe('editor guards for the group (T158)', () => {
  const data = {
    root: { props: {} },
    content: [section('s-1'), group('g-1', {}, [section('s-2')]), row('row-1', [column('col-1', [])])],
  } as unknown as Data;
  const insert = (componentType: string, destinationZone: string): PuckAction =>
    ({ type: 'insert', componentType, destinationIndex: 0, destinationZone, id: 'new' }) as PuckAction;

  it('a Section may be inserted at the root or into a group, nowhere else', () => {
    expect(shouldRevertPuckAction(insert('cms.Section', 'root:default-zone'), data)).toBe(false);
    expect(shouldRevertPuckAction(insert('cms.Section', 'g-1:content'), data)).toBe(false);
    expect(shouldRevertPuckAction(insert('cms.Section', 's-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(insert('cms.Section', 'col-1:content'), data)).toBe(true);
  });

  it('a group may be inserted at the root only', () => {
    expect(shouldRevertPuckAction(insert('cms.SectionGroup', 'root:default-zone'), data)).toBe(false);
    expect(shouldRevertPuckAction(insert('cms.SectionGroup', 'g-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(insert('cms.SectionGroup', 's-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(insert('cms.SectionGroup', 'col-1:content'), data)).toBe(true);
  });

  it('nothing but a Section goes into a group', () => {
    for (const type of ['cms.Text', 'cms.Row', 'cms.Hero', 'cms.Column']) {
      expect(shouldRevertPuckAction(insert(type, 'g-1:content'), data), type).toBe(true);
    }
  });

  it('moves follow the same rules', () => {
    const move = (sourceZone: string, sourceIndex: number, destinationZone: string): PuckAction =>
      ({ type: 'move', sourceZone, sourceIndex, destinationZone, destinationIndex: 0 }) as PuckAction;
    // A root Section into the group, and a grouped Section back to the root.
    expect(shouldRevertPuckAction(move('root:default-zone', 0, 'g-1:content'), data)).toBe(false);
    expect(shouldRevertPuckAction(move('g-1:content', 0, 'root:default-zone'), data)).toBe(false);
    // A grouped Section into a column, the group into a Section, a Row into the group.
    expect(shouldRevertPuckAction(move('g-1:content', 0, 'col-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(move('root:default-zone', 1, 's-1:content'), data)).toBe(true);
    expect(shouldRevertPuckAction(move('root:default-zone', 2, 'g-1:content'), data)).toBe(true);
  });

  it('every slot of every block refuses the group', () => {
    const offenders: string[] = [];
    const visit = (owner: string, fields: Record<string, unknown> | undefined): void => {
      for (const [key, raw] of Object.entries(fields ?? {})) {
        const field = raw as { type?: string; allow?: string[]; disallow?: string[]; arrayFields?: Record<string, unknown>; objectFields?: Record<string, unknown> };
        if (field?.type === 'slot') {
          const refused = field.allow ? !field.allow.includes('cms.SectionGroup') : (field.disallow ?? []).includes('cms.SectionGroup');
          if (!refused) offenders.push(`${owner}.${key}`);
        }
        if (field?.arrayFields) visit(`${owner}.${key}[]`, field.arrayFields);
        if (field?.objectFields) visit(`${owner}.${key}`, field.objectFields);
      }
    };
    for (const [name, component] of Object.entries(config.components)) {
      visit(name, component.fields as Record<string, unknown> | undefined);
    }
    expect(offenders).toEqual([]);
  });
});
