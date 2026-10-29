import type { BlockTranslatableText, CmsPageBuilderTranslationScope } from '@endora-commerce/contracts';
import { encodeHtml, visibleHtmlText } from './html-codec.js';
import { escapeText } from './placeholders.js';
import { encodeInline, nodeAt, textblockPaths, type EncodedInline, type TiptapNode } from './tiptap-inline-codec.js';

/**
 * Feature 151 (research R4–R8, R22) — what of a Page Builder document is sent
 * to the model, and where each answer goes back.
 *
 * Pure: it reads the document and the per-block declarations and returns the
 * segments (deduplicated, as sent) and the locations they came from. Nothing
 * here knows about providers, chunks or HTTP.
 */

/** A block's declaration, or `undefined` when the platform does not know how to translate it. */
export type Declarations = (blockName: string) => readonly BlockTranslatableText[] | undefined;

/** A path from the document root to a value: object keys and array indexes. */
export type ValuePath = ReadonlyArray<string | number>;

export interface Segment {
  id: string;
  /** How `text` is encoded: escaped plain text, inline tags (TipTap) or ordered HTML placeholders. */
  kind: 'plain' | 'inline' | 'html';
  /** Exactly what is sent to the model. */
  text: string;
}

export type Location =
  /** A whole string, or — for a text selection — the range `[start, end)` of it. */
  | { kind: 'plain'; leaf: ValuePath; segmentId: string; range?: readonly [number, number] }
  | { kind: 'html'; leaf: ValuePath; segmentId: string; tags: readonly string[] }
  /** One textblock of a TipTap document, translated with its inline tags. */
  | { kind: 'inline'; leaf: ValuePath; node: readonly number[]; segmentId: string; encoded: EncodedInline }
  /** Part of one text node of a TipTap textblock — a selection inside one formatting run. */
  | {
      kind: 'run';
      leaf: ValuePath;
      node: readonly number[];
      child: number;
      range: readonly [number, number];
      segmentId: string;
    };

export interface Extraction {
  segments: Segment[];
  locations: Location[];
  /** Blocks with no declaration, by name — reported, never touched (FR-025). */
  untranslatableBlocks: Map<string, number>;
  /** Characters sent: the sum of the segments' encoded lengths. */
  characters: number;
  scope: { kind: 'canvas' | 'component' | 'text'; widened: boolean };
  /** The selected component's block name, when the scope named one (audit metadata). */
  componentType?: string;
}

/** The selection's block or text is not in the submitted document (research R22). */
export class SelectionNotFoundError extends Error {
  override readonly name = 'SelectionNotFoundError';
  constructor(readonly what: 'component' | 'text') {
    super(what === 'component' ? 'The selected component is not in the content.' : 'The selected text is not in the content.');
  }
}

interface ComponentRef {
  node: { type: string; props: Record<string, unknown> };
  path: ValuePath;
}

const MAX_DEPTH = 64;
const LETTER = /\p{L}/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponent(value: unknown): value is ComponentRef['node'] {
  return isRecord(value) && typeof value['type'] === 'string' && isRecord(value['props']);
}

/**
 * Every component in document order, each before its descendants. Slots are any
 * prop holding an array of components, at any depth inside the props (the
 * deprecated `Row.columnItems[].content` included); legacy `zones` follow
 * `content`. The root is not a component.
 */
function componentsOf(data: Record<string, unknown>): ComponentRef[] {
  const out: ComponentRef[] = [];
  const visitList = (list: unknown[], path: ValuePath, depth: number): void => {
    list.forEach((element, index) => {
      if (isComponent(element)) visitComponent(element, [...path, index], depth);
    });
  };
  const visitComponent = (node: ComponentRef['node'], path: ValuePath, depth: number): void => {
    out.push({ node, path });
    if (depth > MAX_DEPTH) return;
    for (const [key, value] of Object.entries(node.props)) searchValue(value, [...path, 'props', key], depth + 1);
  };
  const searchValue = (value: unknown, path: ValuePath, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      if (value.length > 0 && value.every(isComponent)) {
        visitList(value, path, depth);
        return;
      }
      value.forEach((element, index) => {
        if (isRecord(element)) searchValue(element, [...path, index], depth + 1);
      });
    } else if (isRecord(value) && !isComponent(value)) {
      for (const [key, inner] of Object.entries(value)) {
        if (Array.isArray(inner) || isRecord(inner)) searchValue(inner, [...path, key], depth + 1);
      }
    }
  };
  if (Array.isArray(data['content'])) visitList(data['content'], ['content'], 0);
  if (isRecord(data['zones'])) {
    for (const [zone, list] of Object.entries(data['zones'])) {
      if (Array.isArray(list)) visitList(list, ['zones', zone], 0);
    }
  }
  return out;
}

function isPrefix(prefix: ValuePath, path: ValuePath): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

interface Leaf {
  path: ValuePath;
  value: unknown;
  format: 'plain' | 'tiptap' | 'html';
}

/** Resolve one declared path (`items[].title`) against a component's props. */
function leavesOf(component: ComponentRef, declaration: BlockTranslatableText): Leaf[] {
  const format = declaration.format ?? 'plain';
  const parts = declaration.path.split('.');
  let frontier: Array<{ value: unknown; path: ValuePath }> = [
    { value: component.node.props, path: [...component.path, 'props'] },
  ];
  for (const part of parts) {
    const iterate = part.endsWith('[]');
    const key = iterate ? part.slice(0, -2) : part;
    const next: typeof frontier = [];
    for (const { value, path } of frontier) {
      if (!isRecord(value) || !(key in value)) continue;
      const inner = value[key];
      if (iterate) {
        if (Array.isArray(inner)) inner.forEach((element, index) => next.push({ value: element, path: [...path, key, index] }));
      } else {
        next.push({ value: inner, path: [...path, key] });
      }
    }
    frontier = next;
  }
  // Feature 163 (T039): a block reshaped to inline rich text (`cms.Heading`'s
  // `text`) still holds a plain string where it was stored before the reshape
  // and has not been opened in the editor since. That string is prose, and is
  // translated as the plain text it is; the answer is written back as a string.
  return frontier.map(({ value, path }) => ({
    value,
    path,
    format: format === 'tiptap' && typeof value === 'string' ? 'plain' : format,
  }));
}

function isTiptapDoc(value: unknown): value is TiptapNode {
  return isRecord(value) && Array.isArray(value['content']);
}

class SegmentTable {
  readonly segments: Segment[] = [];
  private readonly byKey = new Map<string, string>();
  add(kind: Segment['kind'], text: string): string {
    const key = `${kind}\u0000${text}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const id = `s${this.segments.length + 1}`;
    this.segments.push({ id, kind, text });
    this.byKey.set(key, id);
    return id;
  }
}

/** Every location of one leaf, for a whole-leaf translation. */
function wholeLeaf(leaf: Leaf, table: SegmentTable, locations: Location[]): void {
  if (leaf.format === 'plain') {
    if (typeof leaf.value !== 'string' || !LETTER.test(leaf.value)) return;
    locations.push({ kind: 'plain', leaf: leaf.path, segmentId: table.add('plain', escapeText(leaf.value)) });
  } else if (leaf.format === 'html') {
    if (typeof leaf.value !== 'string' || !LETTER.test(visibleHtmlText(leaf.value))) return;
    const encoded = encodeHtml(leaf.value);
    locations.push({ kind: 'html', leaf: leaf.path, segmentId: table.add('html', encoded.text), tags: encoded.tags });
  } else if (isTiptapDoc(leaf.value)) {
    for (const nodePath of textblockPaths(leaf.value)) {
      textblock(leaf, leaf.value, nodePath, table, locations);
    }
  }
}

function textblock(leaf: Leaf, doc: TiptapNode, nodePath: number[], table: SegmentTable, locations: Location[]): void {
  const node = nodeAt(doc, nodePath);
  if (!node) return;
  const encoded = encodeInline(node);
  const visible = (node.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
  if (!LETTER.test(visible)) return;
  locations.push({ kind: 'inline', leaf: leaf.path, node: nodePath, segmentId: table.add('inline', encoded.text), encoded });
}

// ── Text selection ────────────────────────────────────────────────────────

/** Collapse whitespace runs to one space, trimmed; `map[i]` is the original index of normalised char `i`. */
function normalise(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      map.push(i - 1);
      pendingSpace = false;
    }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

/** The original `[start, end)` of `needle` (already normalised) in `haystack`, or `null`. */
function findNormalised(haystack: string, needle: string): [number, number] | null {
  const hay = normalise(haystack);
  const at = hay.text.indexOf(needle);
  if (at < 0 || needle.length === 0) return null;
  return [hay.map[at]!, hay.map[at + needle.length - 1]! + 1];
}

/**
 * Locate a selected fragment in one leaf. Returns `null` when the leaf does not
 * hold it; otherwise pushes the locations and returns whether it had to widen.
 */
function selectionInLeaf(leaf: Leaf, needle: string, table: SegmentTable, locations: Location[]): boolean | null {
  if (leaf.format === 'plain') {
    if (typeof leaf.value !== 'string') return null;
    const range = findNormalised(leaf.value, needle);
    if (!range) return null;
    const segmentId = table.add('plain', escapeText(leaf.value.slice(range[0], range[1])));
    locations.push({ kind: 'plain', leaf: leaf.path, segmentId, range });
    return false;
  }
  if (leaf.format === 'html') {
    if (typeof leaf.value !== 'string') return null;
    const visible = normalise(visibleHtmlText(leaf.value)).text;
    if (!visible.includes(needle)) return null;
    // Inside markup the safe unit is the whole value: its tags travel as
    // ordered placeholders and nothing smaller can be re-assembled safely.
    wholeLeaf(leaf, table, locations);
    return visible !== needle;
  }
  if (!isTiptapDoc(leaf.value)) return null;
  const doc = leaf.value;
  const blocks = textblockPaths(doc);

  for (const nodePath of blocks) {
    const node = nodeAt(doc, nodePath)!;
    // Visible text with, per character, the inline child it came from.
    let visible = '';
    const owner: number[] = [];
    const offset: number[] = [];
    (node.content ?? []).forEach((child, index) => {
      const text = child.type === 'text' ? (child.text ?? '') : child.type === 'hardBreak' ? '\n' : '';
      for (let i = 0; i < text.length; i += 1) {
        visible += text[i];
        owner.push(child.type === 'text' ? index : -1);
        offset.push(i);
      }
    });
    const range = findNormalised(visible, needle);
    if (!range) continue;
    const first = owner[range[0]]!;
    const last = owner[range[1] - 1]!;
    if (first >= 0 && first === last) {
      const child = node.content![first]!;
      const start = offset[range[0]]!;
      const end = offset[range[1] - 1]! + 1;
      const segmentId = table.add('plain', escapeText((child.text ?? '').slice(start, end)));
      locations.push({ kind: 'run', leaf: leaf.path, node: nodePath, child: first, range: [start, end], segmentId });
      return false;
    }
    textblock(leaf, doc, nodePath, table, locations);
    return true;
  }

  // Across paragraphs: search the textblocks joined by line breaks, and widen
  // to every one the match touches.
  let joined = '';
  const blockOf: number[] = [];
  blocks.forEach((nodePath, blockIndex) => {
    if (blockIndex > 0) {
      joined += '\n';
      blockOf.push(blockIndex);
    }
    const node = nodeAt(doc, nodePath)!;
    const text = (node.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : c.type === 'hardBreak' ? '\n' : '')).join('');
    joined += text;
    for (let i = 0; i < text.length; i += 1) blockOf.push(blockIndex);
  });
  const range = findNormalised(joined, needle);
  if (!range) return null;
  for (let blockIndex = blockOf[range[0]]!; blockIndex <= blockOf[range[1] - 1]!; blockIndex += 1) {
    textblock(leaf, doc, blocks[blockIndex]!, table, locations);
  }
  return true;
}

// ── Entry point ───────────────────────────────────────────────────────────

/**
 * Extract the segments to translate from `data`, restricted to `scope`
 * (absent = the whole canvas). Throws {@link SelectionNotFoundError} when the
 * scope's component or text is not in the document — before anything is sent.
 */
export function extract(
  data: unknown,
  declarations: Declarations,
  scope?: CmsPageBuilderTranslationScope,
): Extraction {
  const document = isRecord(data) ? data : {};
  const table = new SegmentTable();
  const locations: Location[] = [];
  const untranslatableBlocks = new Map<string, number>();
  let components = componentsOf(document);
  let componentType: string | undefined;

  if (scope?.componentId) {
    const selected = components.find((c) => c.node.props['id'] === scope.componentId);
    if (!selected) throw new SelectionNotFoundError('component');
    componentType = selected.node.type;
    components = components.filter((c) => isPrefix(selected.path, c.path));
  }

  let widened = false;
  if (scope?.kind === 'text') {
    const needle = normalise(scope.selectedText).text;
    let found = false;
    outer: for (const component of components) {
      const declaration = declarations(component.node.type);
      if (!declaration) continue;
      for (const entry of declaration) {
        for (const leaf of leavesOf(component, entry)) {
          const result = selectionInLeaf(leaf, needle, table, locations);
          if (result === null) continue;
          widened = result;
          found = true;
          break outer;
        }
      }
    }
    if (!found) throw new SelectionNotFoundError('text');
  } else {
    for (const component of components) {
      const declaration = declarations(component.node.type);
      if (!declaration) {
        untranslatableBlocks.set(component.node.type, (untranslatableBlocks.get(component.node.type) ?? 0) + 1);
        continue;
      }
      for (const entry of declaration) {
        for (const leaf of leavesOf(component, entry)) wholeLeaf(leaf, table, locations);
      }
    }
  }

  return {
    segments: table.segments,
    locations,
    untranslatableBlocks,
    characters: table.segments.reduce((sum, segment) => sum + segment.text.length, 0),
    scope: { kind: scope ? scope.kind : 'canvas', widened },
    ...(componentType !== undefined ? { componentType } : {}),
  };
}
