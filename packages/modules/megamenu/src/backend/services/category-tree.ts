import type { CatalogCategoryRecord, ResolvedMenuItem } from '@endora-commerce/contracts';

/**
 * The catalogue's categories, indexed once per menu resolution (feature 168,
 * plan R-6) — every `category-link` and `category-tree` of a menu reads this
 * one index rather than the catalogue, so a tree of any size costs one read
 * (SC-006).
 */
export interface CategoryIndex {
  readonly byId: ReadonlyMap<string, CatalogCategoryRecord>;
  /** Active children per parent (`null` = top level), in the catalogue's order. */
  readonly activeChildren: ReadonlyMap<string | null, readonly CatalogCategoryRecord[]>;
}

export interface CategoryScope {
  language: string;
  fallbackLanguage: string;
}

export function indexCategories(categories: readonly CatalogCategoryRecord[]): CategoryIndex {
  const byId = new Map<string, CatalogCategoryRecord>();
  const activeChildren = new Map<string | null, CatalogCategoryRecord[]>();
  for (const category of categories) {
    if (category.deletedAt) continue;
    byId.set(category.id, category);
    if (!category.isActive) continue;
    const list = activeChildren.get(category.parentCategoryId) ?? [];
    list.push(category);
    activeChildren.set(category.parentCategoryId, list);
  }
  for (const list of activeChildren.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
  }
  return { byId, activeChildren };
}

/**
 * A category's storefront link in a language, or `null` for one a shopper may
 * not reach — inactive, deleted, or with no name in any language.
 *
 * `/c/<slug>` is the storefront's category route (`storefront/app/(catalog)/c/[slug]`).
 */
export function localizedCategoryLink(
  index: CategoryIndex,
  categoryId: string,
  scope: CategoryScope,
): { name: string; url: string } | null {
  const category = index.byId.get(categoryId);
  if (!category || !category.isActive || !category.slug) return null;
  const name = categoryName(category, scope);
  return name === null ? null : { name, url: `/c/${category.slug}` };
}

/**
 * A `category-tree` item's expansion: the root's live descendants (the top
 * level's when the root is `null`) to `depth` levels. An inactive category
 * ends its branch, so nothing below it is reachable through the menu either.
 *
 * Nodes are `category-link` items with no row of their own, so their id is
 * `<tree item id>:<category id>` — unique within the menu and stable across
 * resolutions. The first level's parent is the tree item's parent: the tree is
 * spliced into its parent's children where it stands.
 */
export function expandCategoryTree(
  index: CategoryIndex,
  input: CategoryScope & {
    treeItemId: string;
    parentId: string | null;
    rootCategoryId: string | null;
    depth: number;
  },
): ResolvedMenuItem[] {
  if (input.rootCategoryId !== null) {
    const root = index.byId.get(input.rootCategoryId);
    if (!root || !root.isActive) return [];
  }
  const expand = (parentCategoryId: string | null, parentId: string | null, level: number): ResolvedMenuItem[] => {
    if (level > input.depth) return [];
    const out: ResolvedMenuItem[] = [];
    for (const category of index.activeChildren.get(parentCategoryId) ?? []) {
      const link = localizedCategoryLink(index, category.id, input);
      if (!link) continue;
      const id = `${input.treeItemId}:${category.id}`;
      out.push({
        id,
        parentId,
        kind: 'category-link',
        label: link.name,
        url: link.url,
        children: expand(category.id, id, level + 1),
      });
    }
    return out;
  };
  return expand(input.rootCategoryId, input.parentId, 1);
}

/**
 * The category's name in the requested language, else the channel default's,
 * else any it has: a category named in one language only is still a category
 * a shopper can reach, and dropping it from the menu would hide a live branch
 * of the catalogue for a missing translation.
 */
function categoryName(category: CatalogCategoryRecord, scope: CategoryScope): string | null {
  for (const name of [category.name[scope.language], category.name[scope.fallbackLanguage], ...Object.values(category.name)]) {
    if (typeof name === 'string' && name.trim().length > 0) return name;
  }
  return null;
}
