import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  EMPHASIS_VARIANTS,
  SECTION_ANCHOR_RE,
  isInlineIconOffset,
  isInlineIconSize,
  isSafeLinkUrl,
  plainTextToInlineRichText,
  type InlineRichMark,
  type InlineRichNode,
  type InlineRichText,
} from '@endora-commerce/page-builder-core';
import { splitWords, WORD_CLASS } from '../utils/split-words.js';
import { resolveCmsIcon } from './icon-catalog.js';
import { emphasisColor } from './emphasis-color.js';

/**
 * Inline rich text — the one-paragraph TipTap document of a short heading
 * (`specs/163-page-builder-marketing-pages/` research R-10) — rendered to plain
 * elements: `<strong>`, `<em>`, `<a>`, `<br>` and
 * `<span class="cmsc-em cmsc-em--<variant>">` (T175: with its colour, when it
 * has one), and an icon of the catalog
 * (T163) as inline SVG, `1em` square unless it carries a size (T166) and
 * hidden from assistive technology.
 *
 * No TipTap runtime and no hook, so it renders the same on the server, in a
 * Server Component and after hydration, and its text is in the HTML (SC-005).
 * Nothing is rendered as HTML: every stretch of text is a text node, a link
 * whose address is not safe is dropped with its text kept, and a mark or node
 * this grammar does not know is ignored.
 */

/** Marks applied outermost first, so the emphasis span wraps the text itself (a gradient clips to it). */
const MARK_ORDER: ReadonlyArray<InlineRichMark['type']> = ['link', 'bold', 'italic', 'emphasis'];

function isSafeInlineHref(href: string): boolean {
  if (href.startsWith('#')) return SECTION_ANCHOR_RE.test(href.slice(1));
  return isSafeLinkUrl(href);
}

function applyMark(mark: InlineRichMark, children: ReactNode): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>;
    case 'italic':
      return <em>{children}</em>;
    case 'emphasis': {
      const variant = mark.attrs?.variant;
      if (!variant || !(EMPHASIS_VARIANTS as readonly string[]).includes(variant)) return children;
      // T175: a colour (a brand token or a hex) painted over the variant's own, named for the stylesheet.
      const color = emphasisColor(mark.attrs?.color);
      return color ? (
        <span className={`cmsc-em cmsc-em--${variant}`} data-cms-em-color={color.value} style={{ color: color.css }}>
          {children}
        </span>
      ) : (
        <span className={`cmsc-em cmsc-em--${variant}`}>{children}</span>
      );
    }
    case 'link': {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href.trim() : '';
      if (!href || !isSafeInlineHref(href)) return children;
      const blank = mark.attrs.target === '_blank';
      return (
        <a href={href} {...(blank ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {children}
        </a>
      );
    }
    default:
      return children;
  }
}

/** A text as numbered word spans with its whitespace kept as text (the word reveal, R-21). */
function wordSpans(text: string, counter: { next: number }): ReactNode {
  return splitWords(text).map((part, index) =>
    'space' in part ? (
      <Fragment key={index}>{part.space}</Fragment>
    ) : (
      <span key={index} className={WORD_CLASS} style={{ '--i': counter.next++ } as CSSProperties}>
        {part.word}
      </span>
    ),
  );
}

/**
 * T166: how an inline icon's attributes draw it — its `size` (em of the text
 * or px; `1em` unset) and its vertical `offset` (em of the text, as the SVG's
 * `vertical-align`; unset, the stylesheet's `-0.125em`). A value outside the
 * grammar is ignored. The editor's node view draws it through this too.
 */
export function inlineIconPresentation(attrs: { size?: unknown; offset?: unknown } | null | undefined): {
  size: string;
  style?: CSSProperties;
} {
  const rawSize = attrs?.size;
  const offset = attrs?.offset;
  const size = isInlineIconSize(rawSize) ? rawSize : '1em';
  return isInlineIconOffset(offset) ? { size, style: { verticalAlign: `${offset}em` } } : { size };
}

/** T163: an icon of the catalog by name, as inline SVG in the text's size and colour; an unknown name is nothing. */
function inlineIcon(attrs: { name?: unknown; size?: unknown; offset?: unknown } | undefined): ReactNode {
  const name = attrs?.name;
  const Icon = typeof name === 'string' ? resolveCmsIcon(name) : null;
  if (!Icon) return null;
  const { size, style } = inlineIconPresentation(attrs);
  return <Icon className="cmsc-inline-icon" size={size} aria-hidden="true" focusable="false" {...(style ? { style } : {})} />;
}

function sortedMarks(node: InlineRichNode): InlineRichMark[] {
  return [...(node.marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type));
}

function renderNode(node: InlineRichNode, counter: { next: number } | null): ReactNode {
  if (node.type === 'hardBreak') return <br />;
  if (node.type === 'inlineIcon') {
    const icon = inlineIcon(node.attrs);
    return icon === null ? null : sortedMarks(node).reduce<ReactNode>((children, mark) => applyMark(mark, children), icon);
  }
  if (node.type !== 'text' || typeof node.text !== 'string' || node.text === '') return null;
  const marks = sortedMarks(node);
  const text = counter ? wordSpans(node.text, counter) : node.text;
  return marks.reduce<ReactNode>((children, mark) => applyMark(mark, children), text);
}

function inlineNodes(value: InlineRichText | string | null | undefined): InlineRichNode[] {
  if (value === null || value === undefined) return [];
  const doc = typeof value === 'string' ? plainTextToInlineRichText(value) : value;
  return Array.isArray(doc?.content) ? (doc.content[0]?.content ?? []) : [];
}

/** R21G (T336): whether a text begins with an inline icon — what a hanging indent hangs. */
export function leadsWithInlineIcon(value: InlineRichText | string | null | undefined): boolean {
  return inlineNodes(value)[0]?.type === 'inlineIcon';
}

/** How many words the word reveal splits an inline rich text into — where a following text's stagger starts. */
export function countInlineRichWords(value: InlineRichText | string | null | undefined): number {
  let count = 0;
  for (const node of inlineNodes(value)) {
    if (node.type === 'text' && typeof node.text === 'string') count += splitWords(node.text).filter((part) => 'word' in part).length;
  }
  return count;
}

export interface InlineRichProps {
  /** A stored document, or a legacy plain string, which is read as one. */
  value: InlineRichText | string | null | undefined;
  /**
   * The word reveal (research R-21): every word becomes
   * `<span class="cmsc-w" style="--i:n">`, numbered from this index, inside
   * its marks; whitespace stays text, so the text reads the same.
   */
  wordStart?: number;
  /**
   * R19A (T226): a text that begins with an icon hangs the rest beside it —
   * `<span class="cmsc-hang">` holding the icon and the text in two boxes, so a
   * wrapped line starts under the text, not under the icon. The whitespace
   * after the icon becomes the boxes' gap. A text with no leading icon renders
   * as without it.
   */
  hangingIcon?: boolean;
}

/** The text after a leading icon, its first run's leading whitespace dropped (the gap replaces it). */
function afterLeadingIcon(nodes: InlineRichNode[]): InlineRichNode[] {
  const rest = nodes.slice(1);
  const first = rest[0];
  if (first?.type === 'text' && typeof first.text === 'string') {
    const trimmed = first.text.replace(/^\s+/, '');
    return trimmed === '' ? rest.slice(1) : [{ ...first, text: trimmed }, ...rest.slice(1)];
  }
  return rest;
}

export function InlineRich({ value, wordStart, hangingIcon = false }: InlineRichProps): ReactNode {
  const nodes = inlineNodes(value);
  if (nodes.length === 0) return null;
  const counter = wordStart === undefined ? null : { next: wordStart };
  const lead = hangingIcon && nodes[0]?.type === 'inlineIcon' ? renderNode(nodes[0], counter) : null;
  if (lead !== null) {
    return (
      <span className="cmsc-hang">
        <span className="cmsc-hang__icon">{lead}</span>
        <span className="cmsc-hang__text">
          {afterLeadingIcon(nodes).map((node, index) => (
            <Fragment key={index}>{renderNode(node, counter)}</Fragment>
          ))}
        </span>
      </span>
    );
  }
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>{renderNode(node, counter)}</Fragment>
      ))}
    </>
  );
}
