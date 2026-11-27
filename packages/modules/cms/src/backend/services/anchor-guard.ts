// Anchor guard — feature 163 (`specs/163-page-builder-marketing-pages/` R-8,
// R-14, data-model §6).
//
// An anchor is a fragment an in-page link jumps to, so within one language tree
// it must name exactly one place, and never an id the storefront layout already
// renders. The set covers:
//   - the `props.anchor` of each `cms.Section` at the root of a language tree
//     (`data.content`). The Section is the one block carrying section
//     settings, as its own top-level props (T117), and it stands only at the
//     top level (plan § Owner ruling 2026-10-23) — or in the slot of a
//     top-level `cms.SectionGroup`, whose own `anchor` counts too (T158,
//     plan § Owner ruling 2026-10-26); a Section stored nested elsewhere, an
//     `anchor` prop on any other block, or a `section` object stored while
//     this feature was developed renders no id and must not refuse a save its
//     editor cannot see the reason for;
//   - every rich-text heading's `attrs.anchor` in a TipTap document, at any
//     depth (slots, slots inside array items, carousel slides, legacy zones),
//     because a heading renders its id wherever the rich text is.
//
// The synced `html` of a rich-content block is not read: it is rendered from the
// same TipTap document, so reading it would count every heading anchor twice.
// Embedded blocks and templates are not followed — only the tree itself.

import { ERROR_CODES, RESERVED_ANCHORS } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

const RESERVED = new Set<string>(RESERVED_ANCHORS);

/** The one block whose `anchor` prop renders an id. */
const SECTION_BLOCK = 'cms.Section';

/** The top-level container of Sections (T158): its own anchor, and its Sections', render ids. */
const SECTION_GROUP_BLOCK = 'cms.SectionGroup';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Heading anchors of every TipTap document under `node`, at any depth. */
function walkHeadings(node: unknown, acc: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkHeadings(item, acc);
    return;
  }
  if (!isRecord(node)) return;
  if (node['type'] === 'heading' && isRecord(node['attrs'])) {
    const anchor = nonEmptyString(node['attrs']['anchor']);
    if (anchor) acc.push(anchor);
  }
  for (const value of Object.values(node)) walkHeadings(value, acc);
}

/**
 * A top-level `cms.SectionGroup` (T158): its own anchor, then each Section in
 * its slot — that Section's anchor, then its headings — in document order.
 */
function groupAnchors(props: Record<string, unknown>, acc: string[]): void {
  const anchor = nonEmptyString(props['anchor']);
  if (anchor) acc.push(anchor);
  for (const [key, value] of Object.entries(props)) {
    if (key !== 'content' || !Array.isArray(value)) {
      walkHeadings(value, acc);
      continue;
    }
    for (const child of value) {
      if (isRecord(child) && child['type'] === SECTION_BLOCK && isRecord(child['props'])) {
        const childAnchor = nonEmptyString(child['props']['anchor']);
        if (childAnchor) acc.push(childAnchor);
      }
      walkHeadings(child, acc);
    }
  }
}

/** The anchors of one language tree, in document order. */
function treeAnchors(tree: unknown, acc: string[]): void {
  if (!isRecord(tree)) return;
  for (const [key, value] of Object.entries(tree)) {
    if (key === 'content' && Array.isArray(value)) {
      // The root content list: each Section's anchor, then whatever headings
      // each component holds.
      for (const component of value) {
        if (isRecord(component) && component['type'] === SECTION_GROUP_BLOCK && isRecord(component['props'])) {
          groupAnchors(component['props'], acc);
          continue;
        }
        if (isRecord(component) && component['type'] === SECTION_BLOCK && isRecord(component['props'])) {
          const anchor = nonEmptyString(component['props']['anchor']);
          if (anchor) acc.push(anchor);
        }
        walkHeadings(component, acc);
      }
    } else {
      walkHeadings(value, acc);
    }
  }
}

/** Every anchor of each language tree, in document order, repeats included. */
export function collectTreeAnchors(languages: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [language, tree] of Object.entries(languages)) {
    const acc: string[] = [];
    treeAnchors(tree, acc);
    out[language] = acc;
  }
  return out;
}

/**
 * Refuse a reserved anchor (`422 CMS_RESERVED_ANCHOR`) or one repeated within a
 * language tree (`422 CMS_DUPLICATE_ANCHOR`). The anchor travels in `details` so
 * the envelope fills the sentence's `{anchor}` placeholder. The same anchor in
 * two language trees is allowed: each language is its own page.
 */
export function assertAnchors(languages: Record<string, unknown>): void {
  for (const anchors of Object.values(collectTreeAnchors(languages))) {
    const seen = new Set<string>();
    for (const anchor of anchors) {
      if (RESERVED.has(anchor)) {
        throw new HttpError(
          422,
          ERROR_CODES.CMS_RESERVED_ANCHOR,
          `The anchor "${anchor}" is reserved by the storefront.`,
          { anchor },
        );
      }
      if (seen.has(anchor)) {
        throw new HttpError(
          422,
          ERROR_CODES.CMS_DUPLICATE_ANCHOR,
          `The anchor "${anchor}" is used more than once in this content.`,
          { anchor },
        );
      }
      seen.add(anchor);
    }
  }
}
