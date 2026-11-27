import { describe, expect, it } from 'vitest';
import type { CatalogCategoryRecord } from '@endora-commerce/contracts';
import { expandCategoryTree, indexCategories, localizedCategoryLink } from './category-tree.js';

/**
 * `specs/168-megamenu-navigation-bar/` FR-012, FR-013, FR-015 and plan R-6 — a
 * category tree is the catalogue's live categories, expanded from one read.
 */
function category(over: Partial<CatalogCategoryRecord> & { id: string; slug: string }): CatalogCategoryRecord {
  return {
    parentCategoryId: null,
    name: { 'pl-PL': over.slug, 'en-US': `${over.slug} (en)` },
    sortOrder: 0,
    metaTitleOverride: null,
    metaDescriptionOverride: null,
    customFieldValues: {},
    isActive: true,
    inventoryThresholdHigh: null,
    inventoryThresholdMedium: null,
    inventoryThresholdLow: null,
    mainImageAssetId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...over,
  };
}

const catalogue = [
  category({ id: 'tools', slug: 'narzedzia', sortOrder: 2 }),
  category({ id: 'safety', slug: 'bhp', sortOrder: 1 }),
  category({ id: 'drills', slug: 'wiertarki', parentCategoryId: 'tools', sortOrder: 1 }),
  category({ id: 'saws', slug: 'pily', parentCategoryId: 'tools', sortOrder: 0 }),
  category({ id: 'cordless', slug: 'akumulatorowe', parentCategoryId: 'drills' }),
  category({ id: 'gloves', slug: 'rekawice', parentCategoryId: 'safety', isActive: false }),
  category({ id: 'nitrile', slug: 'nitrylowe', parentCategoryId: 'gloves' }),
];
const index = indexCategories(catalogue);
const scope = { language: 'pl-PL', fallbackLanguage: 'pl-PL' };

function shape(nodes: ReturnType<typeof expandCategoryTree>): unknown[] {
  return nodes.map((node) => [node.label, shape(node.children)]);
}

describe('expandCategoryTree (feature 168)', () => {
  it('expands the whole catalogue from its top level, in sort order, to the depth asked', () => {
    const nodes = expandCategoryTree(index, { treeItemId: 'tree', parentId: 'tab', rootCategoryId: null, depth: 2, ...scope });
    expect(shape(nodes)).toEqual([
      ['bhp', []],
      ['narzedzia', [['pily', []], ['wiertarki', []]]],
    ]);
  });

  it('expands a root to its descendants, not to the root itself', () => {
    const nodes = expandCategoryTree(index, { treeItemId: 'tree', parentId: 'tab', rootCategoryId: 'tools', depth: 3, ...scope });
    expect(shape(nodes)).toEqual([['pily', []], ['wiertarki', [['akumulatorowe', []]]]]);
  });

  it('ends a branch at an inactive category', () => {
    const nodes = expandCategoryTree(index, { treeItemId: 'tree', parentId: 'tab', rootCategoryId: 'safety', depth: 3, ...scope });
    expect(nodes).toEqual([]);
  });

  it('expands an inactive or missing root to nothing', () => {
    for (const rootCategoryId of ['gloves', 'gone']) {
      expect(expandCategoryTree(index, { treeItemId: 't', parentId: 'tab', rootCategoryId, depth: 3, ...scope })).toEqual([]);
    }
  });

  it('gives each node a composite id, its parent, a category link and its URL', () => {
    const [saws] = expandCategoryTree(index, { treeItemId: 'tree', parentId: 'tab', rootCategoryId: 'tools', depth: 2, ...scope });
    expect(saws).toMatchObject({ id: 'tree:saws', parentId: 'tab', kind: 'category-link', url: '/c/pily', children: [] });
    const drills = expandCategoryTree(index, { treeItemId: 'tree', parentId: 'tab', rootCategoryId: 'tools', depth: 2, ...scope })[1]!;
    expect(drills.children[0]).toMatchObject({ id: 'tree:cordless', parentId: 'tree:drills' });
  });

  it('labels a node in the requested language, else in the channel default', () => {
    const [saws] = expandCategoryTree(index, {
      treeItemId: 't',
      parentId: 'tab',
      rootCategoryId: 'tools',
      depth: 1,
      language: 'en-US',
      fallbackLanguage: 'pl-PL',
    });
    expect(saws?.label).toBe('pily (en)');
    const deOnly = indexCategories([category({ id: 'x', slug: 'x', name: { 'pl-PL': 'Iks' } })]);
    expect(
      expandCategoryTree(deOnly, { treeItemId: 't', parentId: 'tab', rootCategoryId: null, depth: 1, language: 'de-DE', fallbackLanguage: 'pl-PL' })[0]?.label,
    ).toBe('Iks');
  });

  it('labels a node with any name it has when neither language has one, rather than dropping it', () => {
    const englishOnly = indexCategories([category({ id: 'x', slug: 'x', name: { 'en-US': 'Tools' } })]);
    expect(
      expandCategoryTree(englishOnly, { treeItemId: 't', parentId: 'tab', rootCategoryId: null, depth: 1, language: 'pl-PL', fallbackLanguage: 'pl-PL' })[0]?.label,
    ).toBe('Tools');
  });
});

describe('localizedCategoryLink (feature 168)', () => {
  it('answers a live category name and URL, and nothing for an inactive or missing one', () => {
    expect(localizedCategoryLink(index, 'saws', scope)).toEqual({ name: 'pily', url: '/c/pily' });
    expect(localizedCategoryLink(index, 'gloves', scope)).toBeNull();
    expect(localizedCategoryLink(index, 'gone', scope)).toBeNull();
  });
});
