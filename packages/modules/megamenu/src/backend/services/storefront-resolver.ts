import type { EntityManager } from '@mikro-orm/postgresql';
import {
  MEGAMENU_LABEL_INHERITING_KINDS,
  type MegamenuAlignment,
  type MegamenuAssetKind,
  type MegamenuAudience,
  type MegamenuButtonVariant,
  type MegamenuEmbedSide,
  type MegamenuIconPosition,
  type MegamenuItemKind,
  type MegamenuPresentation,
  type ResolvedMegamenu,
} from '@endora-commerce/contracts';
import type { AudiencedItem } from './audience.js';
import { expandCategoryTree, indexCategories, localizedCategoryLink, type CategoryIndex } from './category-tree.js';
import type { MegamenuCache } from './megamenu-cache.js';
import { resolveMenuAsset, resolveMenuBlock, type MegamenuCrossModulePorts } from './cross-module-ports.js';

/** Request-resolved sales channel handed in by the resolver middleware. */
export type ResolvedChannel = { id: string; code: string; defaultLanguage: string };

type ItemRow = {
  id: string;
  parent_id: string | null;
  position: number;
  kind: MegamenuItemKind;
  labels: Record<string, string>;
  descriptions: Record<string, string> | null;
  target: Record<string, unknown>;
  presentation: MegamenuPresentation | null;
  alignment: MegamenuAlignment | null;
  audience: MegamenuAudience | null;
  click_navigates: boolean | null;
};

type ActiveMenuRow = {
  id: string;
  name: string;
};

/**
 * A resolved menu as it is cached: every audience's items, each still carrying
 * its audience (feature 168, plan R-3). The route filters it per visitor with
 * `filterForViewer`, which is also what takes the audiences off.
 */
export type AudiencedMegamenu = Omit<ResolvedMegamenu, 'items'> & { items: AudiencedItem[] };

/** What one resolution reads once and every item shares. */
interface ResolutionScope {
  language: string;
  fallbackLanguage: string;
  /** Read only when the menu holds a category link or tree. */
  categories: CategoryIndex | null;
  /** The menu's page links, in the served language. */
  pages: ReadonlyMap<string, { name: string; url: string }>;
}

/**
 * Storefront resolution for the Megamenu module — feature 015 / T028, reshaped
 * by feature 168 into the navigation bar's tree.
 *
 * `resolveByChannelAndLanguage` is the read behind
 * `GET /api/v1/megamenu/by-channel`. It looks up the active binding via the
 * partial unique index, fetches every item in one query, reads the catalogue
 * once and the menu's CMS pages once, and assembles a recursive payload. The
 * Redis read-through wraps the whole call and holds the audienced tree, so one
 * entry serves every visitor of a (channel, language).
 */
export class StorefrontResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * The cross-module reads a resolved menu needs, as their owners' published
     * ports (`specs/110-instance-repository/` T118c).
     */
    private readonly ports: MegamenuCrossModulePorts,
    private readonly cache?: MegamenuCache,
  ) {}

  async resolveByChannelAndLanguage(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
  }): Promise<AudiencedMegamenu | null> {
    const em = this.emFactory();
    const channel = input.resolvedChannel;
    const requestedLanguage = input.language ?? channel.defaultLanguage;

    if (this.cache) {
      const cached = await this.cache.get(channel.code, requestedLanguage);
      if (cached) return cached;
    }

    const menuRows = (await em.execute(
      `select m.id::text as id, m.name as name
         from megamenu_bindings b
         join megamenus m on m.id = b.megamenu_id
        where b.sales_channel_id = ? and b.language = ? and b.active = true
        limit 1`,
      [channel.id, requestedLanguage],
    )) as ActiveMenuRow[];
    const active = menuRows[0];
    if (!active) return null;

    const itemRows = (await em.execute(
      `select id::text, parent_id::text, position, kind, labels, descriptions, target,
              presentation, alignment, audience, click_navigates
         from megamenu_items
        where megamenu_id = ?
        order by parent_id nulls first, position asc, id asc`,
      [active.id],
    )) as ItemRow[];

    const scope = await this.readScope(itemRows, channel, requestedLanguage);

    const byParent = new Map<string | null, ItemRow[]>();
    for (const row of itemRows) {
      const list = byParent.get(row.parent_id) ?? [];
      list.push(row);
      byParent.set(row.parent_id, list);
    }

    const buildSubtree = async (parentId: string | null): Promise<AudiencedItem[]> => {
      const out: AudiencedItem[] = [];
      for (const row of byParent.get(parentId) ?? []) {
        if (row.kind === 'category-tree') {
          out.push(...this.expandTree(row, scope));
          continue;
        }
        const built = await this.buildOne(row, scope, buildSubtree);
        if (built) out.push(built);
      }
      return out;
    };

    const payload: AudiencedMegamenu = {
      megamenuId: active.id,
      name: active.name,
      language: requestedLanguage,
      items: await buildSubtree(null),
    };

    if (this.cache) {
      await this.cache.set(channel.code, requestedLanguage, payload);
    }
    return payload;
  }

  /**
   * The two shared reads, each issued only when the menu needs it: the live
   * category tree (SC-006 — one read however many categories), and the
   * localised links of every page the menu points at (plan R-8).
   */
  private async readScope(rows: readonly ItemRow[], channel: ResolvedChannel, language: string): Promise<ResolutionScope> {
    const needsCategories = rows.some((row) => row.kind === 'category-link' || row.kind === 'category-tree');
    const pageIds = rows
      .filter((row) => row.kind === 'cms-page-link')
      .map((row) => (row.target as { pageId: string }).pageId);
    const [categories, links] = await Promise.all([
      needsCategories ? this.ports.categories.listAll({ liveOnly: true }) : Promise.resolve(null),
      pageIds.length > 0
        ? this.ports.pages.findStorefrontLinks([...new Set(pageIds)], {
            salesChannelId: channel.id,
            language,
          })
        : Promise.resolve([]),
    ]);
    return {
      language,
      fallbackLanguage: channel.defaultLanguage,
      categories: categories ? indexCategories(categories) : null,
      pages: new Map(links.map((link) => [link.id, { name: link.name, url: link.url }])),
    };
  }

  /** A `category-tree` row, replaced by what it expands to, each carrying the tree's audience. */
  private expandTree(row: ItemRow, scope: ResolutionScope): AudiencedItem[] {
    if (!scope.categories) return [];
    const target = row.target as { rootCategoryId: string | null; depth: number };
    const audience = row.audience ?? undefined;
    const withAudience = (node: ReturnType<typeof expandCategoryTree>[number], top: boolean): AudiencedItem => ({
      ...node,
      ...(top && audience ? { audience } : {}),
      children: node.children.map((child) => withAudience(child, false)),
    });
    return expandCategoryTree(scope.categories, {
      treeItemId: row.id,
      parentId: row.parent_id,
      rootCategoryId: target.rootCategoryId,
      depth: target.depth,
      language: scope.language,
      fallbackLanguage: scope.fallbackLanguage,
    }).map((node) => withAudience(node, true));
  }

  private async buildOne(
    row: ItemRow,
    scope: ResolutionScope,
    buildSubtree: (parentId: string | null) => Promise<AudiencedItem[]>,
  ): Promise<AudiencedItem | null> {
    const typed = this.resolveLabel(row.labels, scope);
    // A label is optional where the target has a name (FR-015) and where
    // nothing is shown as text — media and embeds. Elsewhere none means the
    // item cannot be shown, which feature 015 always answered by dropping it.
    if (typed === null && !MEGAMENU_LABEL_INHERITING_KINDS.has(row.kind) && row.kind !== 'asset' && row.kind !== 'cms-block-embed') {
      return null;
    }
    const description = this.resolveLabel(row.descriptions ?? {}, scope);
    const children = await buildSubtree(row.id);

    const base: AudiencedItem = {
      id: row.id,
      parentId: row.parent_id,
      kind: row.kind as AudiencedItem['kind'],
      label: typed ?? '',
      ...(description !== null ? { description } : {}),
      ...(row.parent_id === null
        ? {
            presentation: row.presentation ?? 'mega',
            alignment: row.alignment ?? 'start',
            ...(row.click_navigates ? { clickNavigates: true } : {}),
          }
        : {}),
      ...(row.audience && row.audience.kind !== 'everyone' ? { audience: row.audience } : {}),
      children,
    };

    switch (row.kind) {
      case 'category-link': {
        const target = row.target as { categoryId: string; iconAssetId?: string; iconPosition?: MegamenuIconPosition };
        const link = scope.categories ? localizedCategoryLink(scope.categories, target.categoryId, scope) : null;
        if (!link) return null;
        const icon = await this.resolveIcon(target.iconAssetId, target.iconPosition);
        return { ...base, label: typed ?? link.name, url: link.url, ...(icon ? { icon } : {}) };
      }
      case 'cms-page-link': {
        const target = row.target as { pageId: string; iconAssetId?: string; iconPosition?: MegamenuIconPosition };
        const link = scope.pages.get(target.pageId);
        if (!link) return null;
        const icon = await this.resolveIcon(target.iconAssetId, target.iconPosition);
        return { ...base, label: typed ?? link.name, url: link.url, ...(icon ? { icon } : {}) };
      }
      case 'external-link': {
        const target = row.target as { url: string; iconAssetId?: string; iconPosition?: MegamenuIconPosition };
        const icon = await this.resolveIcon(target.iconAssetId, target.iconPosition);
        return { ...base, url: target.url, ...(icon ? { icon } : {}) };
      }
      case 'button': {
        const target = row.target as { url: string; variant: MegamenuButtonVariant };
        return { ...base, url: target.url, variant: target.variant };
      }
      case 'group':
        return base;
      case 'asset': {
        const target = row.target as { assetId?: string; kind: MegamenuAssetKind };
        if (!target.assetId) return null;
        const resolved = await resolveMenuAsset(this.ports, target.assetId);
        if (!resolved) return null;
        return {
          ...base,
          asset: { id: target.assetId, kind: resolved.kind, url: resolved.url, label: resolved.label },
        };
      }
      case 'cms-block-embed': {
        const target = row.target as { blockId: string; embedSide: MegamenuEmbedSide };
        const block = await resolveMenuBlock(this.ports.blocks, target.blockId, scope.language);
        if (!block) return null;
        return { ...base, block, embedSide: target.embedSide };
      }
      case 'category-tree':
        // Expanded by the caller; a tree is never an item of its own.
        return null;
    }
  }

  private async resolveIcon(
    iconAssetId: string | undefined,
    iconPosition: MegamenuIconPosition | undefined,
  ): Promise<{ assetId: string; url: string; position: MegamenuIconPosition } | null> {
    if (!iconAssetId) return null;
    const asset = await resolveMenuAsset(this.ports, iconAssetId);
    if (!asset) return null;
    return { assetId: iconAssetId, url: asset.url, position: iconPosition ?? 'left' };
  }

  /** The value in the requested language, else in the channel's default; blank counts as absent. */
  private resolveLabel(labels: Record<string, string>, scope: ResolutionScope): string | null {
    for (const language of [scope.language, scope.fallbackLanguage]) {
      const value = labels[language];
      if (typeof value === 'string' && value.trim().length > 0) return value;
    }
    return null;
  }
}
