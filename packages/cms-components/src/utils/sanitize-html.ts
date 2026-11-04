/**
 * HTML sanitiser shared by every CMS component that renders stored markup.
 *
 * It is a string-to-string function with no DOM dependency, so a server render and a client
 * render of the same props produce byte-identical markup. The input is tokenised the way an
 * HTML tokenizer reads it (comments, raw-text elements, quoted and unquoted attributes) and
 * the output is **rebuilt** from the tokens a policy admits: every emitted tag is written in a
 * canonical, fully quoted form, and every `<` that does not start an emitted tag is escaped.
 * The browser therefore never sees markup the policy did not inspect.
 */

export interface HtmlSanitizePolicy {
  /** Whether an element is emitted. A refused element is unwrapped — its children are kept. */
  allowTag(tag: string): boolean;
  /**
   * Whether an attribute is kept on an emitted element (`on*` and `srcdoc` never are). `value`
   * is the attribute's value as the browser reads it (character references decoded), for a
   * policy that admits an attribute only with a value of a given form, such as an anchor `id`.
   */
  allowAttr(tag: string, attr: string, value: string): boolean;
  /** Returns the cleaned `style` attribute value, or `null` to drop the attribute. `tag` is the element's. */
  cleanStyle(style: string, tag?: string): string | null;
  /**
   * Whether a `<style>` element is emitted. Its text is kept only when it contains no `<`, so
   * it reads identically as raw text (HTML) and as markup (inside SVG or MathML).
   */
  allowStyleElement: boolean;
}

/** Elements whose content is dropped together with the element. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'noscript',
  'template',
  'xmp',
  'noembed',
  'noframes',
  'textarea',
  'title',
]);

/** Elements whose content the tokenizer reads as raw text up to the matching end tag. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'textarea',
  'title',
]);

/** Elements that are never emitted, under any policy. */
const NEVER_ALLOWED = new Set([
  'script',
  'base',
  'meta',
  'link',
  'object',
  'embed',
  'applet',
  'frame',
  'frameset',
  'param',
  'plaintext',
  // SVG animation elements can rewrite another element's attributes after sanitising.
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'discard',
  'handler',
  'listener',
  ...DROP_WITH_CONTENT,
]);

/** Attributes whose value is a URL; their scheme is restricted. */
const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'data',
  'poster',
  'background',
  'cite',
  'longdesc',
  'usemap',
  'codebase',
  'ping',
  'lowsrc',
  'dynsrc',
  'manifest',
  'icon',
  'profile',
  'itemtype',
]);

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  bsol: '\\',
  lpar: '(',
  rpar: ')',
  period: '.',
  comma: ',',
  semi: ';',
  num: '#',
  excl: '!',
  quest: '?',
  equals: '=',
  percnt: '%',
  plus: '+',
  lowbar: '_',
  commat: '@',
};

const TAG_NAME = /^[a-z][a-z0-9-]*$/;
const ATTR_NAME = /^[a-z_][a-z0-9_.:-]*$/;
const WHITESPACE = /[\t\n\f\r ]/;

/** Decodes character references the way an attribute value is decoded by a browser. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+);?|#(\d+);?|([a-z][a-z0-9]*);)/gi, (full, hex, dec, name) => {
    if (hex !== undefined || dec !== undefined) {
      const code = parseInt(hex ?? dec, hex !== undefined ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return '�';
      }
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? full;
  });
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes an attribute value whose character references are left for the browser to decode. */
function escapeRawAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Whether a decoded URL is http(s), mailto, tel or relative. Control characters and whitespace
 * are removed before the scheme is read, since browsers ignore them inside a scheme.
 */
export function isSafeUrl(decoded: string): boolean {
  const compact = decoded.replace(/[\u0000- \u007f-\u009f]/g, '');
  const scheme = /^([^/?#]*?):/.exec(compact);
  if (!scheme) return true;
  return SAFE_SCHEMES.has(scheme[1]!.toLowerCase());
}

function safeSrcset(decoded: string): boolean {
  return decoded
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
    .every((url) => url === '' || isSafeUrl(url));
}

/** Style values that load a resource or evaluate anything are refused outright. */
export function isInertStyle(decoded: string): boolean {
  const compact = decoded.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').toLowerCase();
  return !/url\(|expression|javascript:|behavior:|-moz-binding|@import|\\|<|image-set\(|image\(/.test(compact);
}

interface TagToken {
  name: string;
  attrs: Array<[string, string]>;
  selfClosing: boolean;
}

/** Reads a start tag at `start` (pointing at its `<`). Returns `null` when the input ends inside it. */
function readStartTag(html: string, start: number): { token: TagToken; end: number } | null {
  let i = start + 1;
  let name = '';
  while (i < html.length && !WHITESPACE.test(html[i]!) && html[i] !== '/' && html[i] !== '>') {
    name += html[i];
    i += 1;
  }
  const attrs: Array<[string, string]> = [];
  const seen = new Set<string>();
  let selfClosing = false;
  while (i < html.length) {
    const ch = html[i]!;
    if (WHITESPACE.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '>') {
      return { token: { name: name.toLowerCase(), attrs, selfClosing }, end: i + 1 };
    }
    if (ch === '/') {
      selfClosing = html[i + 1] === '>';
      i += 1;
      continue;
    }
    selfClosing = false;
    let attrName = ch;
    i += 1;
    while (i < html.length && !WHITESPACE.test(html[i]!) && !'/>='.includes(html[i]!)) {
      attrName += html[i];
      i += 1;
    }
    while (i < html.length && WHITESPACE.test(html[i]!)) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < html.length && WHITESPACE.test(html[i]!)) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close === -1) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        while (i < html.length && !WHITESPACE.test(html[i]!) && html[i] !== '>') {
          value += html[i];
          i += 1;
        }
      }
    }
    const lower = attrName.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      attrs.push([lower, value]);
    }
  }
  return null;
}

/** Index just past the end tag closing a raw-text element, or the end of input. */
function rawTextEnd(html: string, from: number, tag: string): { contentEnd: number; end: number } {
  const re = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />])`, 'gi');
  re.lastIndex = from;
  const match = re.exec(html);
  if (!match) return { contentEnd: html.length, end: html.length };
  const close = html.indexOf('>', match.index);
  return { contentEnd: match.index, end: close === -1 ? html.length : close + 1 };
}

function serialiseStartTag(token: TagToken, policy: HtmlSanitizePolicy): string {
  const parts: string[] = [];
  let target = '';
  let relIndex = -1;
  for (const [name, raw] of token.attrs) {
    if (!ATTR_NAME.test(name) || name.startsWith('on') || name === 'srcdoc') continue;
    if (!policy.allowAttr(token.name, name, decodeHtmlEntities(raw))) continue;
    if (URL_ATTRS.has(name)) {
      const decoded = decodeHtmlEntities(raw).trim();
      if (!isSafeUrl(decoded)) continue;
      parts.push(` ${name}="${escapeAttr(decoded)}"`);
      continue;
    }
    if (name === 'srcset' || name === 'imagesrcset') {
      const decoded = decodeHtmlEntities(raw);
      if (!safeSrcset(decoded)) continue;
      parts.push(` ${name}="${escapeAttr(decoded)}"`);
      continue;
    }
    if (name === 'style') {
      const cleaned = policy.cleanStyle(decodeHtmlEntities(raw), token.name);
      if (cleaned) parts.push(` style="${escapeAttr(cleaned)}"`);
      continue;
    }
    if (name === 'target') target = decodeHtmlEntities(raw).trim().toLowerCase();
    if (name === 'rel') relIndex = parts.length;
    parts.push(raw === '' ? ` ${name}` : ` ${name}="${escapeRawAttr(raw)}"`);
  }
  if (token.name === 'a' && target === '_blank') {
    const rel = relIndex === -1 ? '' : (token.attrs.find(([n]) => n === 'rel')?.[1] ?? '').toLowerCase();
    if (!/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)) {
      const replacement = ' rel="noreferrer noopener"';
      if (relIndex === -1) parts.push(replacement);
      else parts[relIndex] = replacement;
    }
  }
  return `<${token.name}${parts.join('')}${token.selfClosing ? ' /' : ''}>`;
}

/** Sanitises `html` under `policy`. Pure and deterministic — identical on server and client. */
export function sanitizeHtmlWithPolicy(html: string, policy: HtmlSanitizePolicy): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, lt));
    i = lt;
    const next = html[i + 1] ?? '';

    if (html.startsWith('<!--', i)) {
      // Comment, including the abrupt `<!-->` / `<!--->` forms. Dropped.
      if (html.startsWith('<!-->', i)) i += 5;
      else if (html.startsWith('<!--->', i)) i += 6;
      else {
        const close = /--!?>/g;
        close.lastIndex = i + 4;
        const match = close.exec(html);
        i = match ? match.index + match[0].length : html.length;
      }
      continue;
    }
    if (next === '!' || next === '?') {
      // Doctype, CDATA or bogus comment. Dropped.
      const close = html.indexOf('>', i);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (next === '/') {
      const after = html[i + 2] ?? '';
      if (/[a-z]/i.test(after)) {
        const read = readStartTag(html, i + 1);
        if (!read) break;
        const name = read.token.name;
        if (
          TAG_NAME.test(name) &&
          !NEVER_ALLOWED.has(name) &&
          name !== 'style' &&
          policy.allowTag(name)
        ) {
          out += `</${name}>`;
        }
        i = read.end;
        continue;
      }
      if (after === '>') {
        i += 3;
        continue;
      }
      // `</` followed by anything else opens a bogus comment.
      const close = html.indexOf('>', i);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (!/[a-z]/i.test(next)) {
      out += '&lt;';
      i += 1;
      continue;
    }

    const read = readStartTag(html, i);
    if (!read) break;
    const { token } = read;
    i = read.end;

    if (token.name === 'plaintext') break;
    if (RAW_TEXT.has(token.name)) {
      const { contentEnd, end } = rawTextEnd(html, i, token.name);
      const content = html.slice(i, contentEnd);
      i = end;
      if (token.name === 'style') {
        if (policy.allowStyleElement && !content.includes('<') && isInertStyle(content)) {
          out += `${serialiseStartTag({ ...token, selfClosing: false }, policy)}${content}</style>`;
        }
        continue;
      }
      if (token.name === 'iframe' && policy.allowTag('iframe')) {
        // Fallback content of an iframe is never rendered; only the element is kept.
        out += `${serialiseStartTag({ ...token, selfClosing: false }, policy)}</iframe>`;
      }
      continue;
    }
    if (!TAG_NAME.test(token.name) || NEVER_ALLOWED.has(token.name) || !policy.allowTag(token.name)) {
      continue;
    }
    out += serialiseStartTag(token, policy);
  }
  return out;
}

const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

/** Allowlist used when sanitising is on: a fixed set of tags and attributes, no styles. */
const ALLOWLIST_POLICY: HtmlSanitizePolicy = {
  allowTag: (tag) => ALLOWED_TAGS.has(tag),
  allowAttr: (tag, attr) => ALLOWED_ATTRS[tag]?.has(attr) === true,
  cleanStyle: () => null,
  allowStyleElement: false,
};

/**
 * Trusted HTML ("sanitize: off"): any element and attribute is kept, except what executes —
 * scripts, event handler attributes, URLs outside http(s)/mailto/tel/relative, `srcdoc`, and
 * styles that load or evaluate anything.
 */
const TRUSTED_POLICY: HtmlSanitizePolicy = {
  allowTag: () => true,
  allowAttr: () => true,
  cleanStyle: (style) => (isInertStyle(style) ? style.trim() || null : null),
  allowStyleElement: true,
};

/**
 * Sanitises stored CMS HTML. With `enabled` (the default) only an allowlist of tags and
 * attributes survives; with `enabled === false` the markup is trusted, but scripts, event
 * handlers and unsafe URLs are still removed.
 */
export function sanitizeHtml(html: string, enabled = true): string {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtmlWithPolicy(html, enabled ? ALLOWLIST_POLICY : TRUSTED_POLICY);
}
