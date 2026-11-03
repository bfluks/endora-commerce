import { generateJSON, type JSONContent } from '@tiptap/core';
import type { ReactElement } from 'react';
import { DEFAULT_SPACING } from '@endora-commerce/page-builder-core';
import { DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';
import { sanitizeHtml } from '../utils/sanitize-html.js';
import { richContentExtensions } from './rich-content-shared.js';

/**
 * Tab and accordion panels as blocks (`specs/163-page-builder-marketing-pages/`
 * research R-13, FR-023).
 *
 * Each item's panel is a slot under `panel`. A page stored before the reshape
 * holds the panel as HTML under `content`: Puck cannot read a string as a slot
 * (its walk calls `.map` on the value), so the blocks have a key of their own,
 * the stored string renders as it did, and the editor converts it into one
 * `cms.RichContent` block when it resolves the block.
 */

/**
 * A column belongs in a row; a tab or accordion block does not nest in a
 * panel; a Section and a Section group stand only at the top level of a page
 * (FR-000; a Section also in a group, T158).
 */
export const PANEL_DISALLOW = ['cms.Column', 'cms.Tabs', 'cms.Accordion', 'cms.Section', 'cms.SectionGroup'] as const;

export function panelSlotField(label: string) {
  return { type: 'slot' as const, label, disallow: [...PANEL_DISALLOW] };
}

interface StoredBlock {
  type: string;
  props: Record<string, unknown>;
}

/** TipTap JSON for the stored HTML, where a DOM can parse it (the editor); `null` elsewhere. */
function tiptapFromHtml(html: string): JSONContent | null {
  if (typeof window === 'undefined' || typeof window.DOMParser !== 'function') return null;
  try {
    return generateJSON(html, richContentExtensions) as JSONContent;
  } catch {
    return null;
  }
}

/**
 * The blocks a panel stored as HTML becomes: one `cms.RichContent` holding the
 * HTML as it was (and, in the editor, its TipTap form so it can be edited),
 * with no margin of its own. An empty panel becomes an empty slot.
 */
export function panelFromHtml(html: string, id: string): StoredBlock[] {
  if (html.trim() === '') return [];
  return [
    {
      type: 'cms.RichContent',
      props: { ...DEFAULT_BOX_PROPS, margin: DEFAULT_SPACING, id, content: tiptapFromHtml(html), html },
    },
  ];
}

/**
 * Items as the reshaped block stores them: a stored HTML `content` moves into
 * the `panel` slot, every other key is kept. Idempotent; a block with nothing
 * stored as HTML is returned as it is.
 */
export function panelItemsFromLegacy(props: Record<string, unknown>): Record<string, unknown> {
  const items = props['items'];
  if (!Array.isArray(items)) return props;
  const blockId = typeof props['id'] === 'string' ? props['id'] : 'panel-block';
  let changed = false;
  const next = items.map((item: unknown, index) => {
    if (typeof item !== 'object' || item === null) return item;
    const record = item as Record<string, unknown>;
    if (!('content' in record) || Array.isArray(record['panel'])) return item;
    changed = true;
    const { content, ...rest } = record;
    return { ...rest, panel: panelFromHtml(typeof content === 'string' ? content : '', `${blockId}-panel-${index}`) };
  });
  return changed ? { ...props, items: next } : props;
}

/**
 * One panel's body: the slot's blocks, or the HTML a page stored before the
 * reshape, sanitised as it always was.
 */
export function PanelBody({
  item,
}: {
  /** An item as Puck renders it: `panel` is the slot's render function by then. */
  item: { panel?: unknown; content?: string | undefined };
}): ReactElement | null {
  const Panel = item.panel;
  if (typeof Panel === 'function') {
    const SlotContent = Panel as (props: Record<string, never>) => ReactElement;
    return <SlotContent />;
  }
  if (typeof item.content === 'string' && item.content !== '') {
    return <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }} />;
  }
  return null;
}
