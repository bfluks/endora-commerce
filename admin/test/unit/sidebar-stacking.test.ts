import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The collapsed sidebar's fly-out is drawn above the page (issue #380).
 *
 * `.b2b-sidebar` is `position: sticky`, and a sticky box is a stacking context
 * of its own: whatever `z-index` the fly-out (`.b2b-sidebar__rail-popover`)
 * declares only orders it *inside* the sidebar. Against the page, the sidebar
 * as a whole is what is compared — and with no `z-index` of its own it lost to
 * every positioned box of the main column that comes later in the document:
 * the sticky topbar (35), a sticky form-action bar (30), a table's sticky
 * column. So the order that matters is the sidebar's, and it is held here:
 * above the topbar and everything in the page, below the modal scrim and the
 * drawers it must never cover.
 *
 * jsdom lays nothing out and paints nothing, so the property is read where it
 * is decided — in the kit's stylesheet.
 */

const THEME = readFileSync(resolve(process.cwd(), '../packages/admin-kit/theme.css'), 'utf8');

/** The `z-index` of the first top-level rule for `selector` — the one outside any media query. */
function zIndexOf(selector: string): number {
  const start = THEME.indexOf(`\n${selector} {`);
  expect(start, `${selector} has a rule`).toBeGreaterThan(-1);
  const body = THEME.slice(start, THEME.indexOf('}', start));
  const match = /z-index:\s*(\d+)/.exec(body);
  expect(match, `${selector} declares a z-index`).not.toBeNull();
  return Number(match?.[1]);
}

describe('the sidebar and its collapsed fly-out stack above the page (#380)', () => {
  it('puts the sidebar above the topbar and every sticky bar of the page', () => {
    const sidebar = zIndexOf('.b2b-sidebar');
    expect(sidebar).toBeGreaterThan(zIndexOf('.b2b-topbar'));
  });

  it('keeps it below the modal scrim, the drawers and the command palette', () => {
    const sidebar = zIndexOf('.b2b-sidebar');
    for (const overlay of ['.b2b-scrim', '.b2b-drawer', '.b2b-palette']) {
      expect(sidebar, overlay).toBeLessThan(zIndexOf(overlay));
    }
  });
});
