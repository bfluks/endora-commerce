// Content tree walker — feature 014 / T024.
//
// Walks a Puck-shaped JSON tree and yields:
//   - every `assetId` value found anywhere on `props` (case-insensitive
//     match on the suffix `assetId` so `iconAssetId`, `mainImageAssetId`,
//     etc. are caught too).
//   - every `code` referenced by an `InsertBlock` or `InsertTemplate` node.
//   - every component `type` not in a known-names set.
//
// Used by:
//   - the AssetReferenceRegistry's CMS descriptor (asset deletion blocked
//     when an asset is referenced inside content).
//   - the CmsReferenceRegistry (block / template deletion blocked when
//     embedded).
//   - the storefront-resolver (collects every embed code in one walk so
//     the resolver can batch-fetch).
//   - the admin's "missing component" warning surface.

export type AssetIdSet = Set<string>;
export type CodeSet = Set<string>;

export function walkAssetIds(tree: unknown, acc: AssetIdSet = new Set()): AssetIdSet {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkAssetIds(item, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && /assetId$/i.test(key)) {
      if (val.length > 0) acc.add(val);
    } else {
      walkAssetIds(val, acc);
    }
  }
  return acc;
}

export function walkBlockEmbeds(tree: unknown, acc: CodeSet = new Set()): CodeSet {
  return walkEmbedsByType(tree, 'cms.InsertBlock', acc);
}

export function walkTemplateEmbeds(tree: unknown, acc: CodeSet = new Set()): CodeSet {
  return walkEmbedsByType(tree, 'cms.InsertTemplate', acc);
}

function walkEmbedsByType(tree: unknown, typeName: string, acc: CodeSet): CodeSet {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkEmbedsByType(item, typeName, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  if (obj['type'] === typeName) {
    const props = obj['props'];
    if (props && typeof props === 'object' && typeof (props as Record<string, unknown>)['code'] === 'string') {
      const code = (props as Record<string, unknown>)['code'] as string;
      if (code.length > 0) acc.add(code);
    }
  }
  for (const v of Object.values(obj)) walkEmbedsByType(v, typeName, acc);
  return acc;
}

export function walkUnknownComponents(tree: unknown, knownNames: Set<string>, acc: Set<string> = new Set()): Set<string> {
  if (tree === null || tree === undefined) return acc;
  if (Array.isArray(tree)) {
    for (const item of tree) walkUnknownComponents(item, knownNames, acc);
    return acc;
  }
  if (typeof tree !== 'object') return acc;
  const obj = tree as Record<string, unknown>;
  if (typeof obj['type'] === 'string' && obj['props'] && typeof obj['props'] === 'object') {
    const t = obj['type'];
    if (!knownNames.has(t)) acc.add(t);
  }
  for (const v of Object.values(obj)) walkUnknownComponents(v, knownNames, acc);
  return acc;
}

/**
 * A copy of a Page Builder tree whose links of kind `page` point at the public
 * path their target is served under (`specs/163-page-builder-marketing-pages/`
 * R19D, T283). A link stores the target's flat slug; `paths` maps a flat slug,
 * lowercase and without a leading slash, to the path the request's channel
 * serves it at, and holds only the slugs whose path differs. A link to a page
 * that is not nested — every link stored before the option — is left as it is,
 * and a tree with no link to move is returned as the very same object.
 *
 * Copy-on-write, never in place: the tree is the page's stored content.
 */
export function rewritePageLinkSlugs(tree: unknown, paths: ReadonlyMap<string, string>): unknown {
  if (paths.size === 0 || tree === null || typeof tree !== 'object') return tree;
  if (Array.isArray(tree)) {
    let changed = false;
    const out = tree.map((item: unknown) => {
      const next = rewritePageLinkSlugs(item, paths);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : tree;
  }
  const obj = tree as Record<string, unknown>;
  const slug = obj['slug'];
  if (obj['kind'] === 'page' && typeof slug === 'string') {
    const path = paths.get(slug.trim().replace(/^\/+/, '').toLowerCase());
    return path !== undefined && path !== slug ? { ...obj, slug: path } : tree;
  }
  let out: Record<string, unknown> | null = null;
  for (const [key, val] of Object.entries(obj)) {
    const next = rewritePageLinkSlugs(val, paths);
    if (next !== val) {
      out ??= { ...obj };
      out[key] = next;
    }
  }
  return out ?? tree;
}
