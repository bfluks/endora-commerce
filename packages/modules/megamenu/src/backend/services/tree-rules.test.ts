import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { checkTreeRules, type TreeRuleItem } from './tree-rules.js';

/**
 * `specs/168-megamenu-navigation-bar/` FR-001..FR-003, FR-016 and the editor
 * warnings of data-model §3 — what a saved tree may look like.
 */
let seq = 0;
function item(over: Partial<TreeRuleItem>): TreeRuleItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    parentId: null,
    kind: 'external-link',
    labels: { 'pl-PL': 'Pozycja' },
    target: { url: 'https://example.com' },
    ...over,
  };
}
function tab(over: Partial<TreeRuleItem> = {}): TreeRuleItem {
  return item({ presentation: 'mega', alignment: 'start', ...over });
}

function refusal(run: () => unknown): HttpError {
  try {
    run();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('checkTreeRules (feature 168)', () => {
  it('accepts a tab of each allowed kind and presentation', () => {
    const tabs = [
      tab({ kind: 'cms-page-link', labels: {}, presentation: 'link', target: { pageId: 'p' } }),
      tab({ kind: 'group', target: {}, presentation: 'catalog' }),
      tab({ kind: 'category-link', labels: {}, presentation: 'dropdown', target: { categoryId: 'c' } }),
      tab({ kind: 'button', presentation: 'link', alignment: 'end', target: { url: '/quick-order', variant: 'primary' } }),
    ];
    expect(checkTreeRules(tabs)).toEqual([]);
  });

  it('refuses a tab without a presentation', () => {
    const err = refusal(() => checkTreeRules([item({})]));
    expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses a presentation or an alignment below the top level', () => {
    const parent = tab({ kind: 'group', target: {} });
    for (const over of [{ presentation: 'mega' as const }, { alignment: 'end' as const }]) {
      const err = refusal(() => checkTreeRules([parent, item({ parentId: parent.id, ...over })]));
      expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('refuses a media, embed or category-tree tab', () => {
    for (const kind of ['asset', 'cms-block-embed', 'category-tree'] as const) {
      const err = refusal(() => checkTreeRules([tab({ kind, target: {} })]));
      expect(err.code, kind).toBe(ERROR_CODES.MEGAMENU_KIND_NOT_ALLOWED_AS_TAB);
    }
  });

  it('refuses a link tab with children, and a link tab that is a group', () => {
    const linkTab = tab({ presentation: 'link' });
    expect(refusal(() => checkTreeRules([linkTab, item({ parentId: linkTab.id })])).code).toBe(
      ERROR_CODES.MEGAMENU_LINK_TAB_INVALID,
    );
    expect(refusal(() => checkTreeRules([tab({ kind: 'group', target: {}, presentation: 'link' })])).code).toBe(
      ERROR_CODES.MEGAMENU_LINK_TAB_INVALID,
    );
  });

  it('refuses an external link, a button or a group with no label in any language', () => {
    for (const kind of ['external-link', 'button', 'group'] as const) {
      const err = refusal(() => checkTreeRules([tab({ kind, labels: { 'pl-PL': '  ' }, target: {} })]));
      expect(err.code, kind).toBe(ERROR_CODES.MEGAMENU_LABEL_REQUIRED);
      expect(err.message).toContain('item-');
    }
  });

  it('lets a link to a page, a category or a category tree leave its label empty', () => {
    const parent = tab({ kind: 'group', target: {} });
    const children = [
      item({ parentId: parent.id, kind: 'cms-page-link', labels: {}, target: { pageId: 'p' } }),
      item({ parentId: parent.id, kind: 'category-link', labels: {}, target: { categoryId: 'c' } }),
      item({ parentId: parent.id, kind: 'category-tree', labels: {}, target: { rootCategoryId: null, depth: 2 } }),
      item({ parentId: parent.id, kind: 'asset', labels: {}, target: { assetId: 'a', kind: 'image' } }),
    ];
    expect(checkTreeRules([parent, ...children])).toEqual([]);
  });

  it('warns that a dropdown shows one level', () => {
    const dropdown = tab({ kind: 'group', target: {}, presentation: 'dropdown' });
    const child = item({ parentId: dropdown.id, kind: 'group', target: {} });
    const grandchild = item({ parentId: child.id });
    expect(checkTreeRules([dropdown, child, grandchild]).map((w) => w.code)).toEqual([
      'MEGAMENU_DROPDOWN_DEPTH_IGNORED',
    ]);
  });

  it('warns when two embeds of one panel take the same side', () => {
    const mega = tab({ kind: 'group', target: {} });
    const embed = (): TreeRuleItem =>
      item({ parentId: mega.id, kind: 'cms-block-embed', labels: {}, target: { blockId: 'b', embedSide: 'right' } });
    expect(checkTreeRules([mega, embed(), embed()]).map((w) => w.code)).toEqual(['MEGAMENU_PROMO_SLOT_TAKEN']);
  });

  it('lets a link tab with a panel follow its link on click, and refuses it anywhere else', () => {
    const tabWithPanel = tab({ kind: 'category-link', labels: {}, target: { categoryId: 'c' }, clickNavigates: true });
    expect(checkTreeRules([tabWithPanel, item({ parentId: tabWithPanel.id })])).toEqual([]);
    for (const wrong of [
      tab({ kind: 'group', target: {}, clickNavigates: true }),
      tab({ kind: 'button', target: { url: '/x', variant: 'primary' }, clickNavigates: true }),
    ]) {
      expect(refusal(() => checkTreeRules([wrong])).code, wrong.kind).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
    const parent = tab({ kind: 'group', target: {} });
    expect(
      refusal(() => checkTreeRules([parent, item({ parentId: parent.id, clickNavigates: true })])).code,
    ).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
