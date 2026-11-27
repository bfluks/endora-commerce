import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeHtml } from './sanitize-html.js';
import { sanitizeRichHtml } from '../components/rich-content-shared.js';

/** Payloads whose output must contain no executable markup under every policy. */
const INERT_PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<a href=javascript:alert(1)>x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript&colon;alert(1)">x</a>',
  '<a href="&#106avascript:alert(1)">x</a>',
  '<a href="java&#9;script:alert(1)">x</a>',
  '<a href=" JaVaScRiPt:alert(1)">x</a>',
  '<svg onload=alert(1)>',
  '<<x>img src=x onerror=alert(1)>',
  '<iframe src=javascript:alert(1)>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<p title="a&quot; onmouseover=alert(1) x=&quot;">x</p>',
  '<p title=\'"><img src=x onerror=alert(1)>\'>x</p>',
  '<scr<script>ipt>alert(1)</script>',
  '<!--><img src=x onerror=alert(1)>-->',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<div style="width: expression(alert(1))">x</div>',
  '<svg><a><animate attributeName=href values=javascript:alert(1) /><text>x</text></a></svg>',
  '<form action=javascript:alert(1)><button formaction=javascript:alert(1)>x</button></form>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<meta http-equiv=refresh content="0;url=javascript:alert(1)">',
  '<img src=x onerror\n=alert(1)>',
  '<img/src=x/onerror=alert(1)>',
];

/**
 * Tokenises the output the way a browser would see start tags and returns every attribute
 * name and value it carries, so the assertions do not depend on the exact serialisation.
 */
function startTags(html: string): Array<{ tag: string; attrs: Record<string, string> }> {
  const tags: Array<{ tag: string; attrs: Record<string, string> }> = [];
  const tagRe = /<([a-zA-Z][^\s/>]*)((?:\s+[^\s/>=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  for (const match of html.matchAll(tagRe)) {
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const attr of (match[2] ?? '').matchAll(attrRe)) {
      attrs[attr[1]!.toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    tags.push({ tag: match[1]!.toLowerCase(), attrs });
  }
  return tags;
}

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function expectInert(html: string): void {
  const tags = startTags(html);
  for (const { tag, attrs } of tags) {
    expect(['script', 'style', 'meta', 'base', 'animate', 'set']).not.toContain(tag);
    for (const [name, raw] of Object.entries(attrs)) {
      expect(name.startsWith('on')).toBe(false);
      expect(name).not.toBe('srcdoc');
      const value = decode(raw).replace(/[\u0000- ]/g, '').toLowerCase();
      expect(value).not.toContain('javascript:');
      expect(value).not.toContain('data:text');
      expect(value).not.toContain('expression(');
    }
  }
  // Nothing can be smuggled through text: every '<' left starts a tag the sanitiser emitted.
  const lessThans = html.split('<').length - 1;
  const endTags = (html.match(/<\/[a-z][^>]*>/gi) ?? []).length;
  expect(lessThans).toBe(tags.length + endTags);
}

describe('sanitizeHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>', true)).toBe('<p>ok</p>');
  });

  it('keeps allowed tags and drops attributes outside the allowlist', () => {
    expect(sanitizeHtml('<p class="x">Hello <strong>world</strong></p>', true)).toBe(
      '<p>Hello <strong>world</strong></p>',
    );
  });

  it('unwraps disallowed elements but keeps their text', () => {
    expect(sanitizeHtml('<section><p>a</p><custom-el>b</custom-el></section>', true)).toBe('<p>a</p>b');
  });

  it('keeps http, https, mailto, tel and relative links', () => {
    const html =
      '<a href="https://example.com/a?b=1&amp;c=2">a</a><a href="mailto:a@b.c">b</a>' +
      '<a href="tel:+48123">c</a><a href="/p/x">d</a><a href="#top">e</a><a href="x.html">f</a>';
    expect(sanitizeHtml(html, true)).toBe(html);
  });

  it('adds rel to links opening a new window', () => {
    expect(sanitizeHtml('<a href="/x" target="_blank">x</a>', true)).toBe(
      '<a href="/x" target="_blank" rel="noreferrer noopener">x</a>',
    );
  });

  it('keeps entities in text and plain attributes as written', () => {
    const html = '<p>Fish &amp; chips &lt;3</p><img src="/a.png" alt="caf&eacute;">';
    expect(sanitizeHtml(html, true)).toBe(html);
  });

  it('produces the same output whether or not a DOM parser exists', () => {
    const input = '<p onclick="x()">a<img src=x onerror=alert(1)><a href="/b">b</a></p>';
    const withoutDom = sanitizeHtml(input, true);
    const trustedWithoutDom = sanitizeHtml(input, false);
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString(): never {
          throw new Error('the sanitiser must not depend on a DOM');
        }
      },
    );
    expect(sanitizeHtml(input, true)).toBe(withoutDom);
    expect(sanitizeHtml(input, false)).toBe(trustedWithoutDom);
    expect(withoutDom).toBe('<p>a<img src="x"><a href="/b">b</a></p>');
  });

  describe.each([
    ['sanitising on', (html: string) => sanitizeHtml(html, true)],
    ['trusted HTML', (html: string) => sanitizeHtml(html, false)],
    ['rich content', (html: string) => sanitizeRichHtml(html)],
  ])('%s', (_label, sanitise) => {
    it.each(INERT_PAYLOADS)('renders %s inert', (payload) => {
      expectInert(sanitise(payload));
    });
  });

  describe('trusted HTML', () => {
    it('keeps arbitrary markup, classes, ids, inline SVG and iframes with safe sources', () => {
      const input =
        '<section id="hero" class="x"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg>' +
        '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe></section>';
      expect(sanitizeHtml(input, false)).toBe(
        '<section id="hero" class="x"><svg viewbox="0 0 10 10"><path d="M0 0" /></svg>' +
          '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe></section>',
      );
    });

    it('removes event handlers and unsafe URLs but keeps the element', () => {
      expect(sanitizeHtml('<button onclick="go()" class="b">Go</button>', false)).toBe(
        '<button class="b">Go</button>',
      );
      expect(sanitizeHtml('<a href="javascript:go()">x</a>', false)).toBe('<a>x</a>');
    });

    it('keeps style elements and inline styles without url( or expression', () => {
      const html = '<style>.a > .b { color: red }</style><p style="color: red">x</p>';
      expect(sanitizeHtml(html, false)).toBe(html);
      expect(sanitizeHtml('<p style="background: url(/a.png)">x</p>', false)).toBe('<p>x</p>');
    });

    it('drops script elements together with their content', () => {
      expect(sanitizeHtml('<div>a<script>alert(1)</script>b</div>', false)).toBe('<div>ab</div>');
    });
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T061, FR-025, research R-14 — the
 * rich-content policy gains exactly: `details` (with `open`) and `summary` for
 * a read-more passage, and `id` on `h1`–`h6` when it is a valid anchor. Check
 * lists and button links are classes, which the policy already keeps.
 */
describe('rich content policy — R-14 additions', () => {
  it('keeps a read-more passage: details, its open state and its summary', () => {
    const html = '<details class="cmsc-read-more" open><summary>Read more</summary><p>Hidden <strong>text</strong></p></details>';
    expect(sanitizeRichHtml(html)).toBe(html);
    expect(sanitizeRichHtml('<details class="cmsc-read-more"><summary>More</summary><p>x</p></details>')).toBe(
      '<details class="cmsc-read-more"><summary>More</summary><p>x</p></details>',
    );
  });

  it('keeps an id on a heading only when it is a valid anchor, and never on another element', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(sanitizeRichHtml(`<h${level} id="pricing-2026">x</h${level}>`)).toBe(`<h${level} id="pricing-2026">x</h${level}>`);
    }
    for (const bad of ['2026-pricing', 'Pricing', 'two words', 'a_b', `a${'b'.repeat(64)}`, '', 'a:b', 'a<b']) {
      expect(sanitizeRichHtml(`<h2 id="${bad}">x</h2>`), bad).toBe('<h2>x</h2>');
    }
    // An entity-encoded id is judged by what the browser would read.
    expect(sanitizeRichHtml('<h2 id="&#80;ricing">x</h2>')).toBe('<h2>x</h2>');
    expect(sanitizeRichHtml('<p id="pricing">x</p>')).toBe('<p>x</p>');
    expect(sanitizeRichHtml('<details id="pricing"><summary id="pricing">x</summary></details>')).toBe('<details><summary>x</summary></details>');
  });

  it('keeps the check-list class on a list and the button classes on a link', () => {
    const list = '<ul class="cmsc-list--check"><li><p>One</p></li></ul>';
    expect(sanitizeRichHtml(list)).toBe(list);
    const button = '<a class="cmsc-btn cmsc-btn--primary-solid" href="/contact">Contact us</a>';
    expect(sanitizeRichHtml(button)).toBe(button);
  });

  it('still drops div and button, keeping their text', () => {
    expect(sanitizeRichHtml('<div class="cmsc-read-more"><button type="button">Open</button><p>x</p></div>')).toBe('Open<p>x</p>');
  });

  it('renders a read-more passage carrying a handler inert', () => {
    expectInert(sanitizeRichHtml('<details open ontoggle=alert(1)><summary onclick=alert(1)>x</summary></details>'));
  });
});
