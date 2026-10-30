// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { Editor, type JSONContent } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { htmlFromTiptap, richContentExtensions, sanitizeRichHtml } from './rich-content-shared.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19A (T233) — rich text in every
 * block: a text size on a run (a type token or a Custom px) and a marker per
 * bullet list (disc, check, chevron, none). The DOM-free serializer (server)
 * and the editor (client, `getHTML()`) write the same markup, and the
 * sanitizer keeps it.
 */

const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');

const list = (listStyle: string | null): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      ...(listStyle !== null ? { attrs: { listStyle } } : {}),
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }],
    },
  ],
});

const sized = (size: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Big', marks: [{ type: 'textSize', attrs: { size } }] }] }],
});

function clientHtml(content: JSONContent): string {
  const editor = new Editor({ extensions: richContentExtensions, content });
  const out = editor.getHTML();
  editor.destroy();
  return out;
}

describe('list markers (T233)', () => {
  it('a list stored before (no marker) and a check list render as today', () => {
    expect(htmlFromTiptap(list(null))).toBe('<ul><li><p>Item</p></li></ul>');
    expect(htmlFromTiptap(list('check'))).toBe('<ul class="cmsc-list--check"><li><p>Item</p></li></ul>');
  });

  it.each(['chevron', 'none'])('a %s list is a class, the same on the server and in the editor', (marker) => {
    const server = htmlFromTiptap(list(marker));
    expect(server).toBe(`<ul class="cmsc-list--${marker}"><li><p>Item</p></li></ul>`);
    expect(clientHtml(list(marker))).toBe(server);
  });

  it('an unknown marker is the default disc', () => {
    expect(htmlFromTiptap(list('stars'))).toBe('<ul><li><p>Item</p></li></ul>');
  });

  it('the stylesheet draws the chevron and hides the marker of a `none` list', () => {
    expect(STYLESHEET).toMatch(/ul\.cmsc-list--chevron > li::before \{[^}]*content: "›"/);
    expect(STYLESHEET).toMatch(/ul\.cmsc-list--none \{[^}]*list-style: none/);
  });
});

describe('a text size on a run (T233)', () => {
  it('a type token is a class; the server and the editor agree', () => {
    const server = htmlFromTiptap(sized('lead'));
    expect(server).toBe('<p><span class="cmsc-fs cmsc-fs--lead">Big</span></p>');
    expect(clientHtml(sized('lead'))).toBe(server);
    expect(STYLESHEET).toMatch(/\.cmsc-fs--lead \{[^}]*font-size: var\(--cmsb-t-lead-size, 18px\)/);
  });

  it('a Custom px is the run\'s font size, kept by the sanitizer', () => {
    const server = htmlFromTiptap(sized('20px'));
    expect(server).toBe('<p><span class="cmsc-fs" style="font-size: 20px">Big</span></p>');
    // Through a DOM `style.cssText` ends the declaration with `;` (as in T119's parity case); sanitised, the same span.
    expect(sanitizeRichHtml(clientHtml(sized('20px')))).toBe(server);
  });

  it('a size outside the grammar writes no size', () => {
    expect(htmlFromTiptap(sized('20em'))).toBe('<p><span class="cmsc-fs">Big</span></p>');
    expect(htmlFromTiptap(sized('url(x)'))).not.toContain('url');
  });

  it('the editor reads its own markup back into the same mark', () => {
    const editor = new Editor({ extensions: richContentExtensions, content: '<p><span class="cmsc-fs cmsc-fs--h4">A</span><span class="cmsc-fs" style="font-size: 30px">B</span></p>' });
    const marks = (editor.getJSON().content?.[0]?.content ?? []).map((node) => node.marks?.[0]?.attrs?.['size']);
    editor.destroy();
    expect(marks).toEqual(['h4', '30px']);
  });
});

describe('cms.RichContent: the block\'s text size per breakpoint (T233)', () => {
  const config = defaultPageBuilderConfig as Config;
  const render = (props: Record<string, unknown>): HTMLElement => {
    const content = [{ type: 'cms.RichContent', props: { ...config.components['cms.RichContent']?.defaultProps, id: 'rc', ...props } }] as Data['content'];
    const host = document.createElement('div');
    host.innerHTML = renderToString(<Render config={config} data={{ root: { props: {} }, content }} />);
    return host;
  };

  it('unset: the prose keeps today\'s markup', () => {
    expect(render({}).querySelector('.cmsc-pb-rich-content')?.hasAttribute('style')).toBe(false);
  });

  it('a size that differs per breakpoint is a custom property per tier', () => {
    const prose = render({ textSize: 'custom', textSizePx: { base: 14, desktop: 22 } }).querySelector('.cmsc-pb-rich-content')!;
    expect(prose.classList.contains('cmsc-pb-ts-size')).toBe(true);
    expect(prose.getAttribute('style')).toContain('--pb-ts-size:14px');
    expect(prose.getAttribute('style')).toContain('--pb-ts-size-lg:22px');
  });
});
