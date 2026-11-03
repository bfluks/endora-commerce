import { getSchema, type Extensions, type JSONContent } from '@tiptap/core';

/**
 * A DOM-free TipTap JSON → HTML serializer (`specs/163-page-builder-marketing-pages/`
 * T119, defect B1 of the local rebuild).
 *
 * TipTap's `generateHTML` hands the document to ProseMirror's `DOMSerializer`
 * and reads `innerHTML` back, so it needs `document`: on the server it throws,
 * and every rich body rendered empty there and filled in on the client (no
 * content for a crawler, a hydration mismatch). This walks the same schema the
 * editor uses and calls the same `toDOM` specs — so every extension's
 * `renderHTML`, global attributes included, is honoured — and writes the
 * markup as a string, the way `DOMSerializer.serializeFragment` and
 * `innerHTML` would: adjacent text with equal marks shares one mark element,
 * void elements have no end tag, text escapes `& < >` and attributes `& "`.
 *
 * Only array specs (`['tag', attrs?, ...children | 0]`) are supported, which is
 * what every node and mark of `richContentExtensions` returns; a spec that
 * hands back a DOM node throws, and the caller renders nothing.
 */

type Schema = ReturnType<typeof getSchema>;
type PmNode = ReturnType<Schema['nodeFromJSON']>;
type PmMark = PmNode['marks'][number];

interface Element {
  tag: string;
  attrs: Map<string, string>;
  children: Array<Element | string>;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function element(tag: string): Element {
  return { tag, attrs: new Map(), children: [] };
}

/** ProseMirror's `renderSpec`, building a string tree instead of DOM nodes. */
function renderSpec(structure: unknown): { dom: Element | string; contentDOM?: Element } {
  if (typeof structure === 'string') return { dom: structure };
  if (!Array.isArray(structure)) throw new RangeError('Only array DOM specs can be serialized without a DOM');
  let tagName = structure[0] as unknown;
  if (typeof tagName !== 'string') throw new RangeError('Invalid array passed to renderSpec');
  const space = tagName.indexOf(' ');
  if (space > 0) tagName = tagName.slice(space + 1);
  const dom = element(tagName as string);
  let contentDOM: Element | undefined;
  const attrs = structure[1] as unknown;
  let start = 1;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && (attrs as { nodeType?: unknown }).nodeType == null) {
    start = 2;
    for (const [name, value] of Object.entries(attrs as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      const nameSpace = name.indexOf(' ');
      dom.attrs.set(nameSpace > 0 ? name.slice(nameSpace + 1) : name, String(value));
    }
  }
  for (let index = start; index < structure.length; index += 1) {
    const child = structure[index] as unknown;
    if (child === 0) {
      if (index < structure.length - 1 || index > start) {
        throw new RangeError('Content hole must be the only child of its parent node');
      }
      return { dom, contentDOM: dom };
    }
    const inner = renderSpec(child);
    dom.children.push(inner.dom);
    if (inner.contentDOM) {
      if (contentDOM) throw new RangeError('Multiple content holes');
      contentDOM = inner.contentDOM;
    }
  }
  return contentDOM ? { dom, contentDOM } : { dom };
}

function serializeMark(mark: PmMark, inline: boolean): { dom: Element | string; contentDOM?: Element } | null {
  const toDOM = mark.type.spec.toDOM;
  return toDOM ? renderSpec(toDOM(mark, inline)) : null;
}

function serializeNode(node: PmNode): Element | string {
  if (node.isText) return node.text ?? '';
  const toDOM = node.type.spec.toDOM;
  if (!toDOM) throw new RangeError(`No toDOM for node type ${node.type.name}`);
  const { dom, contentDOM } = renderSpec(toDOM(node));
  if (contentDOM) {
    if (node.isLeaf) throw new RangeError('Content hole not allowed in a leaf node spec');
    serializeFragment(node, contentDOM);
  }
  return dom;
}

/** ProseMirror's `DOMSerializer.serializeFragment`: marks open and close around runs of text. */
function serializeFragment(parent: PmNode, target: Element): void {
  let top = target;
  const active: Array<[PmMark, Element]> = [];
  parent.content.forEach((node) => {
    if (active.length > 0 || node.marks.length > 0) {
      let keep = 0;
      let rendered = 0;
      while (keep < active.length && rendered < node.marks.length) {
        const next = node.marks[rendered]!;
        if (!next.type.spec.toDOM) {
          rendered += 1;
          continue;
        }
        if (!next.eq(active[keep]![0]) || next.type.spec.spanning === false) break;
        keep += 1;
        rendered += 1;
      }
      while (keep < active.length) top = active.pop()![1];
      while (rendered < node.marks.length) {
        const add = node.marks[rendered]!;
        rendered += 1;
        const markDOM = serializeMark(add, node.isInline);
        if (markDOM && typeof markDOM.dom !== 'string') {
          active.push([add, top]);
          top.children.push(markDOM.dom);
          top = markDOM.contentDOM ?? markDOM.dom;
        }
      }
    }
    top.children.push(serializeNode(node));
  });
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;');
}

function toHtml(node: Element | string): string {
  if (typeof node === 'string') return escapeText(node);
  let attrs = '';
  for (const [name, value] of node.attrs) attrs += ` ${name}="${escapeAttr(value)}"`;
  if (VOID_ELEMENTS.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(toHtml).join('')}</${node.tag}>`;
}

const schemas = new WeakMap<Extensions, Schema>();

/**
 * The HTML of a TipTap document for `extensions`, with no DOM — identical on
 * the server and in the browser. Throws on content the schema does not know.
 */
export function tiptapJsonToHtml(content: JSONContent, extensions: Extensions): string {
  let schema = schemas.get(extensions);
  if (!schema) {
    schema = getSchema(extensions);
    schemas.set(extensions, schema);
  }
  const root = schema.nodeFromJSON(content);
  const container = element('div');
  serializeFragment(root, container);
  return container.children.map(toHtml).join('');
}
