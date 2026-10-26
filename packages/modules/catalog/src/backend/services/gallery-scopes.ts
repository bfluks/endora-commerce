import type { EntityManager } from '@mikro-orm/postgresql';
import type { GalleryLabel } from '@endora-commerce/contracts';
import { uuidArrayLiteral } from './sql-id-arrays.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/` data-model §7, research R14; FR-076) —
 * a product's gallery in one sales channel.
 *
 * The image set is global (D-6). A channel may hide an item and may give a role
 * (`base_image`, `small_image`, `thumbnail`) to another item. In the channel:
 *
 * - the items are the global items minus the ones hidden there, in the global order;
 * - role R is held by the channel's own holder for R, else by the global holder;
 * - a role whose holder is hidden there is held by nobody — the reader's own fallback
 *   applies (the listing card's chain moves on to the next role, then the first item);
 * - a channel holder that is not one of the product's items is ignored.
 *
 * With no override — every channel today, and every read that names no channel — the
 * answer is the global gallery unchanged.
 */

const LABELS: readonly GalleryLabel[] = ['base_image', 'small_image', 'thumbnail'];

/** One product's overrides in one channel. */
export interface GalleryChannelOverrides {
  /** role → the item holding it in this channel. */
  roles: ReadonlyMap<GalleryLabel, string>;
  /** The items hidden in this channel. */
  hidden: ReadonlySet<string>;
}

export function effectiveGallery<T extends { id: string; labels: readonly GalleryLabel[] }>(
  items: readonly T[],
  overrides: GalleryChannelOverrides | undefined,
): Array<T & { labels: GalleryLabel[] }> {
  if (!overrides || (overrides.roles.size === 0 && overrides.hidden.size === 0)) {
    return items.map((item) => ({ ...item, labels: [...item.labels] }));
  }
  const ids = new Set(items.map((item) => item.id));
  const holder = new Map<GalleryLabel, string>();
  for (const item of items) for (const label of item.labels) holder.set(label, item.id);
  for (const [label, itemId] of overrides.roles) {
    if (ids.has(itemId)) holder.set(label, itemId);
  }
  return items
    .filter((item) => !overrides.hidden.has(item.id))
    .map((item) => ({
      ...item,
      labels: LABELS.filter((label) => holder.get(label) === item.id),
    }));
}

/**
 * The overrides of `productIds` in `channelId`, one statement for the whole page. A
 * product with none is absent from the map. `channelId` `null` (a read that names no
 * channel) answers an empty map.
 */
export async function loadGalleryChannelOverrides(
  em: EntityManager,
  productIds: readonly string[],
  channelId: string | null,
): Promise<Map<string, GalleryChannelOverrides>> {
  const out = new Map<string, { roles: Map<GalleryLabel, string>; hidden: Set<string> }>();
  if (channelId === null || productIds.length === 0) return out;
  const ids = [...new Set(productIds)];
  const entry = (productId: string): { roles: Map<GalleryLabel, string>; hidden: Set<string> } => {
    let found = out.get(productId);
    if (!found) {
      found = { roles: new Map(), hidden: new Set() };
      out.set(productId, found);
    }
    return found;
  };
  // One statement for the page; `em.execute`, so a caller inside a transaction reads
  // its own writes (issue #200).
  const rows = await em.execute<
    Array<{ product_id: string; gallery_item_id: string; label: GalleryLabel | null }>
  >(
    `select product_id::text as product_id, gallery_item_id::text as gallery_item_id, label
       from gallery_item_channel_labels
      where sales_channel_id = ? and product_id = any(?::uuid[])
     union all
     select product_id::text, gallery_item_id::text, null
       from gallery_item_channel_hidden
      where sales_channel_id = ? and product_id = any(?::uuid[])`,
    [channelId, uuidArrayLiteral(ids), channelId, uuidArrayLiteral(ids)],
  );
  for (const row of rows) {
    if (row.label === null) entry(row.product_id).hidden.add(row.gallery_item_id);
    else entry(row.product_id).roles.set(row.label, row.gallery_item_id);
  }
  return out;
}

// --- Writes: one per bridge-row kind ----------------------------------------------
//
// The scope-row writers of `product-scopes.service.ts` (`writeChannelScopeRow`,
// `writeLanguageScopeRow`) own `product_channel_scopes` and
// `product_channel_language_scopes`. A gallery override is a row of its own tables
// (data-model §7: the role holder keyed by (product, channel, role), the hidden item
// by (item, channel)), so it has its own single writer here — each run on the
// caller's `em`, inside the caller's audited Command, and nowhere else.

/** The role `label` of `productId` in `channelId` held by `itemId`; `null` deletes the override (use inherited). */
export async function writeGalleryChannelRole(
  em: EntityManager,
  productId: string,
  channelId: string,
  label: GalleryLabel,
  itemId: string | null,
): Promise<void> {
  if (itemId === null) {
    await em.execute(
      `delete from gallery_item_channel_labels where product_id = ? and sales_channel_id = ? and label = ?`,
      [productId, channelId, label],
    );
    return;
  }
  await em.execute(
    `insert into gallery_item_channel_labels (product_id, sales_channel_id, label, gallery_item_id)
     values (?, ?, ?, ?)
     on conflict (product_id, sales_channel_id, label) do update set gallery_item_id = excluded.gallery_item_id`,
    [productId, channelId, label, itemId],
  );
}

/** `itemId` hidden in exactly `channelIds` (the set replaces the stored one). */
export async function writeGalleryHiddenChannels(
  em: EntityManager,
  productId: string,
  itemId: string,
  channelIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(channelIds)];
  await em.execute(
    `delete from gallery_item_channel_hidden
      where gallery_item_id = ? and not (sales_channel_id = any(?::uuid[]))`,
    [itemId, uuidArrayLiteral(ids)],
  );
  if (ids.length === 0) return;
  await em.execute(
    `insert into gallery_item_channel_hidden (gallery_item_id, sales_channel_id, product_id)
     select ?, channel_id, ? from unnest(?::uuid[]) as channel_id
     on conflict (gallery_item_id, sales_channel_id) do nothing`,
    [itemId, productId, uuidArrayLiteral(ids)],
  );
}

/** The channels `itemIds` are hidden in, per item, sorted. */
export async function loadHiddenChannelsByItem(
  em: EntityManager,
  itemIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.length === 0) return out;
  const rows = await em.execute<Array<{ gallery_item_id: string; sales_channel_id: string }>>(
    `select gallery_item_id::text as gallery_item_id, sales_channel_id::text as sales_channel_id
       from gallery_item_channel_hidden
      where gallery_item_id = any(?::uuid[])
      order by gallery_item_id, sales_channel_id`,
    [uuidArrayLiteral([...new Set(itemIds)])],
  );
  for (const row of rows) {
    const list = out.get(row.gallery_item_id) ?? [];
    list.push(row.sales_channel_id);
    out.set(row.gallery_item_id, list);
  }
  return out;
}

/** Every channel role override of `productId`, keyed by channel. */
export async function loadChannelRoles(
  em: EntityManager,
  productId: string,
): Promise<Map<string, Map<GalleryLabel, string>>> {
  const rows = await em.execute<Array<{ sales_channel_id: string; label: GalleryLabel; gallery_item_id: string }>>(
    `select sales_channel_id::text as sales_channel_id, label, gallery_item_id::text as gallery_item_id
       from gallery_item_channel_labels
      where product_id = ?
      order by sales_channel_id, label`,
    [productId],
  );
  const out = new Map<string, Map<GalleryLabel, string>>();
  for (const row of rows) {
    const roles = out.get(row.sales_channel_id) ?? new Map<GalleryLabel, string>();
    roles.set(row.label, row.gallery_item_id);
    out.set(row.sales_channel_id, roles);
  }
  return out;
}

/**
 * The scope overview's gallery fields of `productId` (T134b): `media:roles` and
 * `media:hidden` per channel holding such an override, `media:altText` per language
 * any item has an alt text in.
 */
export async function loadMediaScopedFields(
  em: EntityManager,
  productId: string,
): Promise<Array<{ field: string; channelId: string | null; languageCode: string | null }>> {
  const rows = await em.execute<Array<{ field: string; channel_id: string | null; language_code: string | null }>>(
    `select distinct 'media:roles' as field, sales_channel_id::text as channel_id, null::text as language_code
       from gallery_item_channel_labels where product_id = ?
     union
     select distinct 'media:hidden', sales_channel_id::text, null
       from gallery_item_channel_hidden where product_id = ?
     union
     select distinct 'media:altText', null, alt.key
       from gallery_items gi, jsonb_each_text(gi.alt_text) as alt
      where gi.product_id = ? and btrim(alt.value) <> ''
     order by 1, 2, 3`,
    [productId, productId, productId],
  );
  return rows.map((row) => ({ field: row.field, channelId: row.channel_id, languageCode: row.language_code }));
}
