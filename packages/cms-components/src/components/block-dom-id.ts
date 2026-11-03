import { useId } from 'react';

/**
 * The base of the element ids a block writes into its markup (tab and panel
 * ids, `aria-controls`, a label's `for`) — `specs/163-page-builder-marketing-pages/`
 * T149, the pattern T141 set for carousels.
 *
 * Made from the block's own id (Puck's `id` prop), which is the same on the
 * server and on hydration whatever is rendered above the block. `useId()` is
 * only the fallback for a block rendered without an id: its value encodes the
 * whole component path from the application root, so a server tree that
 * differs above the page — even without any DOM — hydrates with other ids.
 *
 * Trade-off (as T141): the same reusable block embedded twice on one page
 * repeats its ids; Puck ids are unique within one document.
 */
export function useBlockDomId(prefix: string, blockId: unknown): string {
  const reactId = useId();
  const source = typeof blockId === 'string' && blockId.trim() !== '' ? blockId : reactId;
  return `${prefix}-${source.replace(/[^A-Za-z0-9_-]/g, '')}`;
}
