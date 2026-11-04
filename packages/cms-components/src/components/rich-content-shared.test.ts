import { describe, expect, it } from 'vitest';
import {
  coerceRichContentProps,
  htmlFromTiptap,
  resolveRichContentHtml,
  sanitizeRichHtml,
} from './rich-content-shared.js';

describe('coerceRichContentProps', () => {
  it('parses stringified tiptap JSON', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };

    const result = coerceRichContentProps({
      content: JSON.stringify(doc) as never,
      html: '',
    });

    expect(result.content).toEqual(doc);
    expect(typeof result.html).toBe('string');
  });

  it('falls back to html when content is empty', () => {
    const result = coerceRichContentProps({
      content: null,
      html: '<p>Stored html</p>',
    });

    expect(resolveRichContentHtml(result)).toContain('Stored html');
  });
});

describe('sanitizeRichHtml', () => {
  it('keeps img and safe color styles', () => {
    const html = sanitizeRichHtml(
      '<p><span style="color: #ff0000; position: absolute">Red</span><img src="https://cdn.example/a.png" alt="A" /></p>',
    );
    expect(html).toContain('img');
    expect(html).toContain('color: #ff0000');
    expect(html).not.toContain('position');
  });

  it('strips scripts and javascript urls', () => {
    expect(sanitizeRichHtml('<p onclick="x()">x</p><script>alert(1)</script>')).toBe('<p>x</p>');
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichHtml('<img src=x onerror=alert(1)>')).toBe('<img src="x">');
  });

  it('keeps the markup the rich text editor produces', () => {
    const editorHtml =
      '<h2 style="text-align: center">Title</h2>' +
      '<p style="text-align: right">A <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> ' +
      '<span style="color: #958DF1">f</span> ' +
      '<mark data-color="#ffc078" style="background-color: #ffc078; color: inherit">g</mark> ' +
      '<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">h</a></p>' +
      '<pre><code class="language-js">x &lt; y</code></pre><hr><ul><li><p>i</p></li></ul>' +
      '<img src="https://cdn.example/a.png" alt="A" title="T">';
    expect(sanitizeRichHtml(editorHtml)).toBe(editorHtml);
  });

  it('drops style declarations that load or evaluate anything', () => {
    expect(sanitizeRichHtml('<span style="color: red; background-color: url(/x.png)">x</span>')).toBe(
      '<span style="color: red">x</span>',
    );
    expect(sanitizeRichHtml('<span style="color: expression(alert(1))">x</span>')).toBe('<span>x</span>');
  });
});

describe('htmlFromTiptap', () => {
  // T119 (B1): DOM-free — it used to return '' here, where `generateHTML` had no `document`.
  it('serializes without a DOM', () => {
    const html = htmlFromTiptap({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hi' }],
        },
      ],
    });
    expect(html).toBe('<p>Hi</p>');
  });

  it('renders nothing for a node type the schema does not know', () => {
    expect(htmlFromTiptap({ type: 'doc', content: [{ type: 'notANode' }] })).toBe('');
  });
});
