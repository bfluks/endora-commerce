import type { InlineRichText } from '@endora-commerce/page-builder-core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InlineRich } from './InlineRich.js';

/**
 * `specs/163-page-builder-marketing-pages/` research R-10 — inline rich text
 * renders to plain elements with no TipTap runtime, so a heading reads the same
 * on the server as after hydration.
 */

type Mark = NonNullable<Extract<InlineRichText['content'][0]['content'], unknown[]>[number]['marks']>[number];

function doc(...content: NonNullable<InlineRichText['content'][0]['content']>): InlineRichText {
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

const text = (value: string, ...marks: Mark[]) => ({ type: 'text' as const, text: value, ...(marks.length ? { marks } : {}) });

describe('InlineRich', () => {
  it('renders bold and italic as strong and em', () => {
    expect(renderToString(<InlineRich value={doc(text('Bold', { type: 'bold' }))} />)).toBe('<strong>Bold</strong>');
    expect(renderToString(<InlineRich value={doc(text('Slanted', { type: 'italic' }))} />)).toBe('<em>Slanted</em>');
  });

  it('renders a link with its href, and a _blank one with rel', () => {
    expect(
      renderToString(<InlineRich value={doc(text('Read', { type: 'link', attrs: { href: '/about-us' } }))} />),
    ).toBe('<a href="/about-us">Read</a>');
    expect(
      renderToString(
        <InlineRich value={doc(text('Out', { type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }))} />,
      ),
    ).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Out</a>');
  });

  it('renders each emphasis variant as a classed span', () => {
    for (const variant of ['gradient', 'accent', 'muted'] as const) {
      expect(
        renderToString(<InlineRich value={doc(text('phrase', { type: 'emphasis', attrs: { variant } }))} />),
      ).toBe(`<span class="cmsc-em cmsc-em--${variant}">phrase</span>`);
    }
  });

  it('renders a hard break as br', () => {
    expect(renderToString(<InlineRich value={doc(text('One'), { type: 'hardBreak' }, text('Two'))} />)).toBe(
      'One<br/>Two',
    );
  });

  it('nests marks with the link outermost and the emphasis innermost', () => {
    expect(
      renderToString(
        <InlineRich
          value={doc(
            text(
              'all',
              { type: 'emphasis', attrs: { variant: 'accent' } },
              { type: 'italic' },
              { type: 'bold' },
              { type: 'link', attrs: { href: '#contact' } },
            ),
          )}
        />,
      ),
    ).toBe('<a href="#contact"><strong><em><span class="cmsc-em cmsc-em--accent">all</span></em></strong></a>');
  });

  it('renders a legacy plain string as text', () => {
    expect(renderToString(<InlineRich value="Built to last" />)).toBe('Built to last');
    expect(renderToString(<InlineRich value={'<b>not markup</b>'} />)).toBe('&lt;b&gt;not markup&lt;/b&gt;');
  });

  it('renders nothing for an empty value', () => {
    expect(renderToString(<InlineRich value={undefined} />)).toBe('');
    expect(renderToString(<InlineRich value={{ type: 'doc', content: [{ type: 'paragraph' }] }} />)).toBe('');
  });

  it('drops an unsafe link href and keeps the text', () => {
    const html = renderToString(
      <InlineRich value={doc(text('Click', { type: 'link', attrs: { href: 'javascript:alert(1)' } }))} />,
    );
    expect(html).toBe('Click');
  });

  /**
   * T163: an icon of the catalog in a heading or a caption — inline SVG,
   * `1em` square so it follows the text, hidden from assistive technology
   * (the heading's words are its name); an unknown name renders nothing.
   */
  describe('an inline icon (T163)', () => {
    const icon = (name: string, ...marks: Mark[]) => ({ type: 'inlineIcon' as const, attrs: { name }, ...(marks.length ? { marks } : {}) });

    it('renders the icon as inline SVG, aria-hidden, sized by the text, on the server', () => {
      const html = renderToString(<InlineRich value={doc(text('New '), icon('sparkles'), text(' here'))} />);
      const svg = html.match(/<svg [^>]*>/)?.[0] ?? '';
      expect(html.startsWith('New <svg ')).toBe(true);
      expect(html.endsWith('</svg> here')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
      expect(svg).toMatch(/class="[^"]*\bcmsc-inline-icon\b/);
      expect(svg).toMatch(/class="[^"]*\blucide-sparkles\b/);
      expect(svg).toContain('width="1em"');
      expect(svg).toContain('height="1em"');
      expect(svg).toContain('stroke="currentColor"');
    });

    it('takes its marks: inside a link and an emphasis span', () => {
      const html = renderToString(
        <InlineRich value={doc(icon('arrowRight', { type: 'link', attrs: { href: '/contact' } }, { type: 'emphasis', attrs: { variant: 'accent' } }))} />,
      );
      expect(html).toMatch(/^<a href="\/contact"><span class="cmsc-em cmsc-em--accent"><svg [^>]*class="[^"]*cmsc-inline-icon/);
    });

    it('renders nothing for an unknown or missing name, and the words around it stay', () => {
      expect(renderToString(<InlineRich value={doc(text('A'), icon('notAnIcon'), text('B'))} />)).toBe('A<!-- -->B');
      expect(renderToString(<InlineRich value={doc({ type: 'inlineIcon' } as never)} />)).toBe('');
    });

    it('is not a word: the word reveal numbers only the text', async () => {
      const { countInlineRichWords } = await import('./InlineRich.js');
      expect(countInlineRichWords(doc(text('Two words'), icon('sparkles')))).toBe(2);
      const html = renderToString(<InlineRich value={doc(text('Hi'), icon('sparkles'))} wordStart={0} />);
      expect(html.match(/class="cmsc-w"/g)).toHaveLength(1);
      expect(html).toContain('cmsc-inline-icon');
    });
  });

  /**
   * T166: an inline icon may carry a size (em of the text, 0.5–3, or px,
   * 8–200) and a vertical offset (em of the text, −1–1, positive raises it).
   * Unset — or a value outside the grammar — keeps today's 1 em square on the
   * stylesheet's line position, the markup byte for byte.
   */
  describe('an inline icon\'s size and vertical offset (T166)', () => {
    const svgOf = (attrs: Record<string, unknown>): string =>
      renderToString(<InlineRich value={doc({ type: 'inlineIcon', attrs: { name: 'sparkles', ...attrs } } as never)} />).match(/<svg [^>]*>/)?.[0] ?? '';

    it('draws the icon at the stored size, in em or px', () => {
      expect(svgOf({ size: '0.5em' })).toContain('width="0.5em"');
      expect(svgOf({ size: '0.5em' })).toContain('height="0.5em"');
      expect(svgOf({ size: '30px' })).toContain('width="30px"');
      expect(svgOf({ size: '30px' })).toContain('height="30px"');
    });

    it('moves it by the stored offset, in em of the text', () => {
      expect(svgOf({ offset: 0.35 })).toContain('style="vertical-align:0.35em"');
      expect(svgOf({ offset: -1 })).toContain('style="vertical-align:-1em"');
      expect(svgOf({ size: '2em', offset: 0 })).toContain('style="vertical-align:0em"');
    });

    it('unset, null or outside the grammar: today\'s 1 em and no inline position, byte for byte', () => {
      const today = svgOf({});
      expect(today).toContain('width="1em"');
      expect(today).not.toContain('style=');
      for (const attrs of [{ size: null, offset: null }, { size: '0.2em', offset: 2 }, { size: '1rem', offset: '0.3' }, { size: 'calc(1em)' }]) {
        expect(svgOf(attrs), JSON.stringify(attrs)).toBe(today);
      }
    });
  });

  /**
   * T175: an emphasis may carry a colour — a brand colour token or a hex —
   * beside its variant. The span keeps its variant class and names the stored
   * colour in `data-cms-em-color` (what the stylesheet and the editor read),
   * painted as its inline `color` (a token as its brand variable with today's
   * literal). No colour, or one outside the grammar: today's span, byte for byte.
   */
  describe('an emphasis colour (T175)', () => {
    const em = (attrs: Record<string, unknown>): string =>
      renderToString(<InlineRich value={doc(text('phrase', { type: 'emphasis', attrs } as never))} />);

    it('writes a token as its brand variable and a hex as it is, beside the variant class', () => {
      expect(em({ variant: 'accent', color: 'token:primary' })).toBe(
        '<span class="cmsc-em cmsc-em--accent" data-cms-em-color="token:primary" style="color:var(--cmsb-color-primary, #1261a6)">phrase</span>',
      );
      expect(em({ variant: 'gradient', color: '#1d4ed8' })).toBe(
        '<span class="cmsc-em cmsc-em--gradient" data-cms-em-color="#1d4ed8" style="color:#1d4ed8">phrase</span>',
      );
    });

    it('unset, null, an unknown role or a colour outside the grammar: today\'s span', () => {
      const today = '<span class="cmsc-em cmsc-em--muted">phrase</span>';
      for (const color of [undefined, null, 'token:nope', 'red', '#fff', 'var(--x)', 'url(x)']) {
        expect(em({ variant: 'muted', ...(color === undefined ? {} : { color }) }), String(color)).toBe(today);
      }
    });
  });
});
