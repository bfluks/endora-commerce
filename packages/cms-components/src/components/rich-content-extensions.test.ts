// @vitest-environment jsdom
import { generateHTML, generateJSON, type JSONContent } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { htmlFromTiptap, richContentExtensions, sanitizeRichHtml } from './rich-content-shared.js';

/**
 * `specs/163-page-builder-marketing-pages/` T061, FR-025, research R-14 — the
 * rich text extensions, and the exact HTML each one writes.
 *
 * | Capability              | Output                                                              |
 * | ----------------------- | ------------------------------------------------------------------- |
 * | Highlight phrase        | `<span class="cmsc-em cmsc-em--…">`                                 |
 * | Read more               | `<details class="cmsc-read-more"><summary>…</summary>…</details>`   |
 * | Check-mark list         | `<ul class="cmsc-list--check">`                                     |
 * | Button link             | `<a class="cmsc-btn cmsc-btn--primary-solid">`                      |
 * | Heading anchor          | `<h2 id="…">`                                                       |
 * | Visually hidden heading | `<h2 class="cmsc-sr-only">`                                         |
 *
 * `generateHTML` needs a DOM, hence jsdom here: it is the reference the
 * DOM-free `htmlFromTiptap` (T119) is compared with; `rich-body-ssr.test.tsx`
 * renders the blocks with no DOM at all.
 */

// `page-builder-core` reaches Puck's drag-and-drop layer, which observes element sizes on import.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

const DOC: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, anchor: 'pricing' }, content: [text('Pricing')] },
    { type: 'heading', attrs: { level: 2, srOnly: true }, content: [text('Our offer')] },
    paragraph(text('Plans for '), text('every team', [{ type: 'emphasis', attrs: { variant: 'accent' } }])),
    {
      type: 'bulletList',
      attrs: { listStyle: 'check' },
      content: [{ type: 'listItem', content: [paragraph(text('Unlimited users'))] }],
    },
    paragraph(text('Contact us', [{ type: 'link', attrs: { href: '/contact', target: null, rel: null, variant: 'primary-solid' } }])),
    {
      type: 'readMore',
      content: [
        { type: 'readMoreSummary', content: [text('Read more')] },
        paragraph(text('The full terms.')),
      ],
    },
  ],
};

const EXPECTED =
  '<h2 id="pricing">Pricing</h2>' +
  '<h2 class="cmsc-sr-only">Our offer</h2>' +
  '<p>Plans for <span class="cmsc-em cmsc-em--accent">every team</span></p>' +
  '<ul class="cmsc-list--check"><li><p>Unlimited users</p></li></ul>' +
  '<p><a class="cmsc-btn cmsc-btn--primary-solid" href="/contact">Contact us</a></p>' +
  '<details class="cmsc-read-more"><summary>Read more</summary><p>The full terms.</p></details>';

describe('rich content extensions (T061, R-14)', () => {
  it('write exactly the HTML of R-14, and the sanitiser keeps all of it', () => {
    expect(generateHTML(DOC, richContentExtensions)).toBe(EXPECTED);
    expect(htmlFromTiptap(DOC)).toBe(EXPECTED);
  });

  it('read the same HTML back into the same attributes', () => {
    const parsed = generateJSON(EXPECTED, richContentExtensions) as JSONContent;
    const [anchored, hidden, highlighted, list, button, readMore] = parsed.content ?? [];
    expect(anchored?.attrs).toMatchObject({ level: 2, anchor: 'pricing', srOnly: false });
    expect(hidden?.attrs).toMatchObject({ level: 2, anchor: null, srOnly: true });
    expect(highlighted?.content?.[1]?.marks).toEqual([{ type: 'emphasis', attrs: { variant: 'accent' } }]);
    expect(list).toMatchObject({ type: 'bulletList', attrs: { listStyle: 'check' } });
    expect(button?.content?.[0]?.marks?.[0]).toMatchObject({ type: 'link', attrs: { href: '/contact', variant: 'primary-solid' } });
    expect(readMore).toMatchObject({
      type: 'readMore',
      attrs: { open: false },
      content: [{ type: 'readMoreSummary', content: [{ type: 'text', text: 'Read more' }] }, { type: 'paragraph' }],
    });
  });

  it('write nothing extra by default: a plain heading, list and link, and a closed passage', () => {
    const plain: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [text('Plain')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('Item'))] }] },
        paragraph(text('Link', [{ type: 'link', attrs: { href: '/a', target: null, rel: null } }])),
      ],
    };
    expect(htmlFromTiptap(plain)).toBe('<h3>Plain</h3><ul><li><p>Item</p></li></ul><p><a href="/a">Link</a></p>');
  });

  it('opens a read-more passage only when asked', () => {
    const open: JSONContent = {
      type: 'doc',
      content: [{ type: 'readMore', attrs: { open: true }, content: [{ type: 'readMoreSummary', content: [text('More')] }, paragraph(text('x'))] }],
    };
    expect(htmlFromTiptap(open)).toBe('<details class="cmsc-read-more" open><summary>More</summary><p>x</p></details>');
  });

  it('drop an anchor that is not valid and a button style that is not known', () => {
    const bad: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, anchor: 'Not an anchor' }, content: [text('Heading')] },
        paragraph(text('Link', [{ type: 'link', attrs: { href: '/a', target: null, rel: null, variant: 'evil" onclick="x' } }])),
      ],
    };
    expect(htmlFromTiptap(bad)).toBe('<h2>Heading</h2><p><a href="/a">Link</a></p>');
  });

  // T119 (B1): the DOM-free serializer writes what TipTap's DOM serializer
  // writes, for every node, mark and attribute the schema allows.
  it('the DOM-free serializer matches TipTap\'s DOM serializer for every node and mark', () => {
    const FULL: JSONContent = {
      type: 'doc',
      content: [
        ...(DOC.content ?? []),
        { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [text('Centred & <safe>')] },
        {
          type: 'paragraph',
          attrs: { textAlign: 'right' },
          content: [
            text('bold ', [{ type: 'bold' }]),
            text('both', [{ type: 'bold' }, { type: 'italic' }]),
            text(' italic', [{ type: 'italic' }]),
            text(' u', [{ type: 'underline' }]),
            text(' s', [{ type: 'strike' }]),
            text(' code', [{ type: 'code' }]),
            { type: 'hardBreak' },
            text('red', [{ type: 'textStyle', attrs: { color: '#958DF1' } }]),
            text(' marked', [{ type: 'highlight', attrs: { color: '#ffc078' } }]),
            text(' muted', [{ type: 'emphasis', attrs: { variant: 'muted' } }]),
            text(' out', [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer nofollow' } }]),
            text('\u00a0"quoted"'),
          ],
        },
        { type: 'blockquote', content: [paragraph(text('Quoted'))] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [text('x < y && z')] },
        { type: 'horizontalRule' },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [paragraph(text('Third'))] }],
        },
        { type: 'image', attrs: { src: 'https://cdn.example.com/a.png', alt: 'An "image"', title: 'T' } },
        { type: 'paragraph' },
      ],
    };
    // The one difference: a DOM's `style.cssText` rewrites a colour as `rgb()`, a
    // string keeps the hex the editor stored. Both render the same colour.
    const hexColours = (html: string): string =>
      html
        .replace(/rgb\((\d+), (\d+), (\d+)\)/g, (_m, r: string, g: string, b: string) =>
          `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`,
        )
        .replace(/#[0-9a-f]{6}\b/gi, (hex) => hex.toLowerCase());
    const reference = sanitizeRichHtml(generateHTML(FULL, richContentExtensions));
    expect(reference).toContain('<img');
    expect(hexColours(htmlFromTiptap(FULL))).toBe(hexColours(reference));
  });

  /**
   * T163: the inline icon node of inline rich text (headings, captions). The
   * page renders it through `InlineRich` (inline SVG); as HTML — the clipboard,
   * `getHTML()`, the DOM-free serializer — it is an empty, aria-hidden span
   * naming the icon, read back into the same node. The DOM-free serializer
   * writes it exactly as TipTap's DOM serializer does.
   */
  it('the inline icon node writes the same HTML through both serializers, and reads it back (T163)', async () => {
    const { default: StarterKit } = await import('@tiptap/starter-kit');
    const { emphasisMark, inlineIconNode } = await import('./rich-content-shared.js');
    const { tiptapJsonToHtml } = await import('./tiptap-html.js');
    const extensions = [StarterKit, emphasisMark, inlineIconNode];
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'New ' },
            { type: 'inlineIcon', attrs: { name: 'sparkles' } },
            { type: 'inlineIcon', attrs: { name: 'arrowRight' }, marks: [{ type: 'emphasis', attrs: { variant: 'accent' } }] },
          ],
        },
      ],
    };
    const expected =
      '<p>New <span class="cmsc-inline-icon" data-cms-icon="sparkles" aria-hidden="true"></span>' +
      '<span class="cmsc-em cmsc-em--accent"><span class="cmsc-inline-icon" data-cms-icon="arrowRight" aria-hidden="true"></span></span></p>';
    expect(generateHTML(doc, extensions)).toBe(expected);
    expect(tiptapJsonToHtml(doc, extensions)).toBe(expected);
    expect(generateJSON(expected, extensions)).toEqual(doc);
  });

  /**
   * T166: an inline icon's size and vertical offset are attributes of the
   * node, written as `data-cms-icon-size` / `data-cms-icon-offset` the same way
   * by both serializers and read back; an unset one (`undefined` by default,
   * so a document's JSON stays `{name}`) writes nothing — the T163 markup above
   * is unchanged — and a value outside the grammar is dropped.
   */
  it('the inline icon node writes its size and offset the same through both serializers, and reads them back (T166)', async () => {
    const { default: StarterKit } = await import('@tiptap/starter-kit');
    const { inlineIconNode } = await import('./rich-content-shared.js');
    const { tiptapJsonToHtml } = await import('./tiptap-html.js');
    const extensions = [StarterKit, inlineIconNode];
    const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
    const doc = paragraph(
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '0.5em', offset: 0.35 } },
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '30px', offset: -0.2 } },
      { type: 'inlineIcon', attrs: { name: 'sparkles' } },
    );
    const expected =
      '<p><span class="cmsc-inline-icon" data-cms-icon="sparkles" data-cms-icon-size="0.5em" data-cms-icon-offset="0.35" aria-hidden="true"></span>' +
      '<span class="cmsc-inline-icon" data-cms-icon="sparkles" data-cms-icon-size="30px" data-cms-icon-offset="-0.2" aria-hidden="true"></span>' +
      '<span class="cmsc-inline-icon" data-cms-icon="sparkles" aria-hidden="true"></span></p>';
    expect(generateHTML(doc, extensions)).toBe(expected);
    expect(tiptapJsonToHtml(doc, extensions)).toBe(expected);
    expect(generateJSON(expected, extensions)).toEqual(doc);

    const outside = paragraph({ type: 'inlineIcon', attrs: { name: 'sparkles', size: '9em', offset: 4 } });
    const plain = '<p><span class="cmsc-inline-icon" data-cms-icon="sparkles" aria-hidden="true"></span></p>';
    expect(generateHTML(outside, extensions)).toBe(plain);
    expect(tiptapJsonToHtml(outside, extensions)).toBe(plain);
    expect(
      generateJSON('<p><span class="cmsc-inline-icon" data-cms-icon="sparkles" data-cms-icon-size="1rem" data-cms-icon-offset="x"></span></p>', extensions),
    ).toEqual(paragraph({ type: 'inlineIcon', attrs: { name: 'sparkles' } }));
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T168 (R10): a read-more passage's
 * summary style — `text` (today's: the summary line as a link-coloured label)
 * or `chevron` (a bare chevron; the summary text stays in the markup as the
 * control's accessible name and is hidden visually by the stylesheet). It is
 * one class on the `<details>`, written identically by both serializers, read
 * back, and kept by the sanitiser as it is (`class` is already allowed).
 */
describe('read-more summary style (T168)', () => {
  const passage = (attrs: Record<string, unknown>): JSONContent => ({
    type: 'doc',
    content: [{ type: 'readMore', attrs, content: [{ type: 'readMoreSummary', content: [text('Read more')] }, paragraph(text('x'))] }],
  });

  it('`text` or unset writes today\'s passage; an unknown style is ignored', () => {
    const today = '<details class="cmsc-read-more"><summary>Read more</summary><p>x</p></details>';
    for (const attrs of [{}, { summaryStyle: 'text' }, { summaryStyle: 'evil" onclick="x' }]) {
      expect(htmlFromTiptap(passage(attrs)), JSON.stringify(attrs)).toBe(today);
    }
  });

  it('`chevron` adds one class, the same through both serializers, and reads back', () => {
    const expected = '<details class="cmsc-read-more cmsc-read-more--chevron"><summary>Read more</summary><p>x</p></details>';
    expect(generateHTML(passage({ summaryStyle: 'chevron' }), richContentExtensions)).toBe(expected);
    expect(htmlFromTiptap(passage({ summaryStyle: 'chevron' }))).toBe(expected);
    expect(sanitizeRichHtml(expected)).toBe(expected);
    const open = '<details class="cmsc-read-more cmsc-read-more--chevron" open><summary>Read more</summary><p>x</p></details>';
    expect(htmlFromTiptap(passage({ summaryStyle: 'chevron', open: true }))).toBe(open);
    const parsed = generateJSON(open, richContentExtensions) as JSONContent;
    expect(parsed.content?.[0]).toMatchObject({ type: 'readMore', attrs: { open: true, summaryStyle: 'chevron' } });
    const plain = generateJSON('<details class="cmsc-read-more"><summary>Read more</summary><p>x</p></details>', richContentExtensions) as JSONContent;
    expect(plain.content?.[0]?.attrs).toMatchObject({ open: false, summaryStyle: 'text' });
  });
});

/**
 * T173 (R11): a read-more passage places its summary — the text or the chevron
 * — at the start (today's), the centre or the end of the line, and may reveal
 * its hidden text above the summary while open. Both are classes on the
 * `<details>`, written identically by both serializers, read back, and kept by
 * the sanitiser as they are; the DOM order (summary first) never changes — the
 * stylesheet reorders the open passage visually.
 */
describe('read-more summary position and reveal above (T173)', () => {
  const passage = (attrs: Record<string, unknown>): JSONContent => ({
    type: 'doc',
    content: [{ type: 'readMore', attrs, content: [{ type: 'readMoreSummary', content: [text('Read more')] }, paragraph(text('x'))] }],
  });

  it('unset, `start`, `false` or an unknown value writes today\'s passage', () => {
    const today = '<details class="cmsc-read-more"><summary>Read more</summary><p>x</p></details>';
    for (const attrs of [{}, { chevronPosition: 'start' }, { revealAbove: false }, { chevronPosition: 'middle" onclick="x' }, { revealAbove: 'yes' }]) {
      expect(htmlFromTiptap(passage(attrs)), JSON.stringify(attrs)).toBe(today);
    }
  });

  it('a centred or end summary and the reveal above add one class each, the same through both serializers, and read back', () => {
    const attrs = { summaryStyle: 'chevron', chevronPosition: 'center', revealAbove: true };
    const expected =
      '<details class="cmsc-read-more cmsc-read-more--chevron cmsc-read-more--center cmsc-read-more--reveal-above"><summary>Read more</summary><p>x</p></details>';
    expect(generateHTML(passage(attrs), richContentExtensions)).toBe(expected);
    expect(htmlFromTiptap(passage(attrs))).toBe(expected);
    expect(sanitizeRichHtml(expected)).toBe(expected);
    const end = '<details class="cmsc-read-more cmsc-read-more--end"><summary>Read more</summary><p>x</p></details>';
    expect(generateHTML(passage({ chevronPosition: 'end' }), richContentExtensions)).toBe(end);
    expect(htmlFromTiptap(passage({ chevronPosition: 'end' }))).toBe(end);
    const parsed = generateJSON(expected, richContentExtensions) as JSONContent;
    expect(parsed.content?.[0]).toMatchObject({ type: 'readMore', attrs: { summaryStyle: 'chevron', chevronPosition: 'center', revealAbove: true } });
    expect((generateJSON(end, richContentExtensions) as JSONContent).content?.[0]?.attrs).toMatchObject({ chevronPosition: 'end', revealAbove: false });
    const plain = generateJSON('<details class="cmsc-read-more"><summary>Read more</summary><p>x</p></details>', richContentExtensions) as JSONContent;
    expect(plain.content?.[0]?.attrs).toMatchObject({ chevronPosition: 'start', revealAbove: false });
  });
});

/**
 * T175 (R11): the `emphasis` mark's colour — a brand colour token or a hex —
 * is `data-cms-em-color` (the stored value, read back) and the inline `color`
 * it paints, written identically by both serializers. The sanitiser keeps the
 * attribute on a `<span>` only when its value is a colour of that grammar.
 */
describe('emphasis colour (T175)', () => {
  const phrase = (attrs: Record<string, unknown>): JSONContent => ({
    type: 'doc',
    content: [paragraph(text('Plans for '), text('every team', [{ type: 'emphasis', attrs }]))],
  });

  it('unset or outside the grammar writes today\'s span', () => {
    const today = '<p>Plans for <span class="cmsc-em cmsc-em--accent">every team</span></p>';
    for (const attrs of [{ variant: 'accent' }, { variant: 'accent', color: null }, { variant: 'accent', color: 'red' }, { variant: 'accent', color: 'token:nope' }]) {
      expect(htmlFromTiptap(phrase(attrs)), JSON.stringify(attrs)).toBe(today);
    }
  });

  it('a token or a hex: the same span through both serializers, kept by the sanitiser, read back', () => {
    for (const [color, css] of [
      ['token:primary', 'var(--cmsb-color-primary, #1261a6)'],
      ['#1d4ed8', '#1d4ed8'],
    ] as const) {
      const expected = `<p>Plans for <span class="cmsc-em cmsc-em--gradient" data-cms-em-color="${color}" style="color: ${css}">every team</span></p>`;
      expect(htmlFromTiptap(phrase({ variant: 'gradient', color })), color).toBe(expected);
      // As in T119's parity case: through a DOM, `style.cssText` ends the declaration with `;` and rewrites a hex
      // as `rgb()`; sanitised and read back as hex, TipTap's DOM serializer writes the same span.
      const viaDom = sanitizeRichHtml(generateHTML(phrase({ variant: 'gradient', color }), richContentExtensions)).replace(
        /rgb\((\d+), (\d+), (\d+)\)/g,
        (_m, r: string, g: string, b: string) => `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`,
      );
      expect(viaDom, color).toBe(expected);
      expect(sanitizeRichHtml(expected), color).toBe(expected);
      const parsed = generateJSON(expected, richContentExtensions) as JSONContent;
      expect(parsed.content?.[0]?.content?.[1]?.marks?.[0], color).toEqual({ type: 'emphasis', attrs: { variant: 'gradient', color } });
    }
  });

  it('the sanitiser drops a colour attribute whose value is not a colour, and keeps it nowhere but on a span', () => {
    expect(sanitizeRichHtml('<span class="cmsc-em cmsc-em--accent" data-cms-em-color="javascript:x">a</span>')).toBe(
      '<span class="cmsc-em cmsc-em--accent">a</span>',
    );
    expect(sanitizeRichHtml('<p data-cms-em-color="#1d4ed8">a</p>')).toBe('<p>a</p>');
  });
});
