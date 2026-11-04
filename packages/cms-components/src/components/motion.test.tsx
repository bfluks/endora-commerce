// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data, type Fields } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
 * `specs/163-page-builder-marketing-pages/` T089/T090, US10, FR-036, FR-037,
 * research R-21 — restrained motion on the blocks that offer it:
 *
 * - `reveal` fades a top-level `cms.Section`'s content up; the block-level
 *   `reveal` of `cms.Hero` (its statement and body) and `cms.Statement` (its
 *   heading and body) fades them up, or reveals them word by word;
 * - `hoverZoom` on the image-bearing carousel items that lacked it
 *   (`cms.LinkTile`, `cms.CarouselSplit`);
 * - every hidden pre-state lives in the stylesheet under
 *   `[data-cmsc-reveal="pending"]` inside `prefers-reduced-motion:
 *   no-preference`, and the server HTML carries the full text and no pending
 *   state, so content is readable before any script runs;
 * - defaults are none / off: a stored or new block renders as before.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;

const doc = (...texts: string[]) => ({
  type: 'doc',
  content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});
const inline = (...content: Array<Record<string, unknown>>) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

function block(type: string, props: Record<string, unknown> = {}): Data['content'][number] {
  return { type, props: { ...defaultsOf(type), id: `${type}-1`, ...props } } as Data['content'][number];
}

/** A top-level `cms.Section` holding `content`; the section settings live only there (T111). */
function inSection(settings: Record<string, unknown>, content: Data['content']): Data['content'][number] {
  return block('cms.Section', { id: 'section-1', ...settings, content });
}

function tree(content: Data['content']) {
  return (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>
  );
}

function html(content: Data['content']): string {
  return renderToString(tree(content));
}

function dom(content: Data['content']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(content);
  return host;
}

/** Text with React's text-node separators and the tags removed. */
const textOf = (markup: string): string => markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '');

const WORDS = { effect: 'words', desktopOnly: false };
const FADE = { effect: 'fade-up', desktopOnly: false };

describe('motion — server HTML (T089)', () => {
  it('a section reveal renders no pending state on the server; the content is in the HTML', () => {
    const markup = html([inSection({ reveal: FADE }, [block('cms.Statement')])]);
    expect(markup).not.toContain('data-cmsc-reveal');
    expect(markup).toContain('cmsc-section');
    expect(textOf(markup)).toContain('A short statement about what you do.');
  });

  it('a Statement word reveal splits heading and body into numbered words, keeping the full text and its marks', () => {
    const heading = inline(
      { type: 'text', text: 'We build pages. ' },
      { type: 'text', text: 'Then we keep them fast.', marks: [{ type: 'emphasis', attrs: { variant: 'muted' } }] },
    );
    const plain = dom([block('cms.Statement', { heading, body: doc('Supporting text here.') })]);
    const host = dom([block('cms.Statement', { heading, body: doc('Supporting text here.'), reveal: WORDS })]);
    const root = host.querySelector('.cmsc-pb-statement')!;
    expect(root.hasAttribute('data-cmsc-reveal')).toBe(false);

    // Same visible text as without the reveal.
    expect(host.querySelector('h2')!.textContent).toBe(plain.querySelector('h2')!.textContent);
    expect(host.querySelector('.cmsc-pb-statement__body')!.textContent).toBe(plain.querySelector('.cmsc-pb-statement__body')!.textContent);

    const words = Array.from(root.querySelectorAll<HTMLElement>('.cmsc-w'));
    expect(words.map((word) => word.textContent)).toEqual(['We', 'build', 'pages.', 'Then', 'we', 'keep', 'them', 'fast.', 'Supporting', 'text', 'here.']);
    // One stagger across heading and body.
    expect(words.map((word) => word.style.getPropertyValue('--i'))).toEqual(words.map((_, index) => String(index)));
    // The mark still wraps its words.
    expect(root.querySelector('h2 .cmsc-em--muted .cmsc-w')?.textContent).toBe('Then');
  });

  it('a Statement fade-up marks its heading and body as the reveal targets', () => {
    const host = dom([block('cms.Statement', { body: doc('Body.'), reveal: FADE })]);
    expect(host.querySelector('h2')!.classList).toContain('cmsc-reveal-target');
    expect(host.querySelector('.cmsc-pb-statement__body')!.classList).toContain('cmsc-reveal-target');
    expect(host.querySelector('.cmsc-w')).toBeNull();
  });

  it('a Hero reveal applies to its statement and body, not to its title', () => {
    const props = { statement: inline({ type: 'text', text: 'Fast and calm.' }), body: doc('Body copy.') };
    const words = dom([block('cms.Hero', { ...props, reveal: WORDS })]);
    expect(Array.from(words.querySelectorAll('.cmsc-w')).map((word) => word.textContent)).toEqual(['Fast', 'and', 'calm.', 'Body', 'copy.']);
    expect(words.querySelector('h1 .cmsc-w')).toBeNull();
    expect(words.querySelector('.cmsc-pb-hero__statement')!.textContent).toBe('Fast and calm.');

    const fade = dom([block('cms.Hero', { ...props, reveal: FADE })]);
    expect(fade.querySelector('.cmsc-pb-hero__statement')!.classList).toContain('cmsc-reveal-target');
    expect(fade.querySelector('.cmsc-pb-hero__body')!.classList).toContain('cmsc-reveal-target');
    expect(fade.querySelector('h1')!.classList).not.toContain('cmsc-reveal-target');
  });

  it('by default nothing is split, marked or zoomed — stored and new blocks render as before', () => {
    for (const type of ['cms.Hero', 'cms.Statement', 'cms.LinkTile', 'cms.CarouselSplit']) {
      expect(defaultsOf(type)['reveal']).toBeUndefined();
      const markup = html([block(type)]);
      expect(markup).not.toContain('cmsc-w');
      expect(markup).not.toContain('cmsc-reveal-target');
      expect(markup).not.toContain('cmsc-hover-zoom');
    }
  });

  it('hoverZoom on a LinkTile and a CarouselSplit sets the zoom class', () => {
    expect(dom([block('cms.LinkTile', { hoverZoom: true })]).querySelector('.cmsc-pb-link-tile')!.classList).toContain('cmsc-hover-zoom');
    expect(dom([block('cms.CarouselSplit', { hoverZoom: true })]).querySelector('.cmsc-pb-carousel-split')!.classList).toContain(
      'cmsc-hover-zoom',
    );
    expect(dom([block('cms.LinkTile', { hoverZoom: false })]).querySelector('.cmsc-hover-zoom')).toBeNull();
  });
});

describe('motion — fields (T090)', () => {
  const fieldsOf = (type: string): Record<string, unknown> => (config.components[type]?.fields ?? {}) as Fields as Record<string, unknown>;

  it('Hero and Statement offer a block-level reveal: none, fade-up or words, and desktop only', () => {
    for (const type of ['cms.Hero', 'cms.Statement']) {
      const field = fieldsOf(type)['reveal'] as { type: string; objectFields: Record<string, { options?: Array<{ value: unknown }> }> };
      expect(field?.type).toBe('object');
      expect(field.objectFields['effect']!.options!.map((option) => option.value)).toEqual(['none', 'fade-up', 'words']);
      // R17 (T204, deliberately changed): a switch storing the same boolean.
      expect(field.objectFields['desktopOnly']).toMatchObject({ type: 'custom', metadata: { pageBuilder: { toggle: true } } });
    }
  });

  it('LinkTile and CarouselSplit offer hoverZoom, off by default', () => {
    for (const type of ['cms.LinkTile', 'cms.CarouselSplit']) {
      // R17 (T204, deliberately changed): a switch storing the same boolean.
      expect(fieldsOf(type)['hoverZoom']).toMatchObject({ type: 'custom', metadata: { pageBuilder: { toggle: true } } });
      expect(defaultsOf(type)['hoverZoom']).toBe(false);
    }
  });
});

describe('motion — on the client (T089)', () => {
  const roots: Root[] = [];

  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function mount(content: Data['content']): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(tree(content)));
    return host;
  }

  it('a section, a Statement and a Hero with a reveal turn pending on mount', () => {
    const host = mount([
      inSection({ reveal: FADE }, [block('cms.Statement', { reveal: WORDS })]),
      block('cms.Hero', { id: 'hero-2', statement: inline({ type: 'text', text: 'Calm.' }), reveal: FADE }),
    ]);
    expect(host.querySelector('section.cmsc-section')!.getAttribute('data-cmsc-reveal')).toBe('pending');
    expect(host.querySelector('.cmsc-pb-statement')!.getAttribute('data-cmsc-reveal')).toBe('pending');
    expect(host.querySelector('.cmsc-pb-hero__content')!.getAttribute('data-cmsc-reveal')).toBe('pending');
  });
});

describe('motion — stylesheet (T090, FR-037)', () => {
  // Rules only: comments may name the selectors they explain.
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  /** The bodies of every `@media (prefers-reduced-motion: no-preference)` block, joined. */
  function noPreferenceBlocks(): string {
    const out: string[] = [];
    const marker = '@media (prefers-reduced-motion: no-preference) {';
    let at = css.indexOf(marker);
    while (at !== -1) {
      let depth = 1;
      let index = at + marker.length;
      for (; index < css.length && depth > 0; index += 1) {
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}') depth -= 1;
      }
      out.push(css.slice(at + marker.length, index - 1));
      at = css.indexOf(marker, index);
    }
    return out.join(' ');
  }

  /** The stylesheet with every no-preference block removed. */
  function outsideNoPreference(): string {
    let rest = css;
    const marker = '@media (prefers-reduced-motion: no-preference) {';
    let at = rest.indexOf(marker);
    while (at !== -1) {
      let depth = 1;
      let index = at + marker.length;
      for (; index < rest.length && depth > 0; index += 1) {
        if (rest[index] === '{') depth += 1;
        else if (rest[index] === '}') depth -= 1;
      }
      rest = rest.slice(0, at) + rest.slice(index);
      at = rest.indexOf(marker);
    }
    return rest;
  }

  it('hides only under [data-cmsc-reveal="pending"], and only when motion is allowed', () => {
    const inside = noPreferenceBlocks();
    expect(inside).toMatch(/\.cmsc-section\[data-cmsc-reveal='pending'\] > \.cmsc-section__frame[^{]*\{[^}]*opacity: 0/);
    expect(inside).toMatch(/\[data-cmsc-reveal='pending'\] \.cmsc-reveal-target[^{]*\{[^}]*opacity: 0/);
    expect(inside).toMatch(/\[data-cmsc-reveal='pending'\] \.cmsc-w[^{]*\{[^}]*opacity: 0/);
    expect(inside).toMatch(/\.cmsc-w[^{]*\{[^}]*transition-delay:[^}]*var\(--i/);
    expect(outsideNoPreference()).not.toContain('data-cmsc-reveal');
    expect(outsideNoPreference()).not.toMatch(/\.cmsc-w\b/);
  });

  it('zooms on hover only when motion is allowed', () => {
    expect(noPreferenceBlocks()).toMatch(/\.cmsc-hover-zoom:hover[^{]*\{[^}]*transform: scale\(/);
    expect(outsideNoPreference()).not.toContain('.cmsc-hover-zoom');
  });
});
