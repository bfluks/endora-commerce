import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { uuidArrayLiteral } from './sql-id-arrays.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/` data-model §8, research R16; FR-078,
 * FR-079) — attachments and packaging units per scope.
 *
 * The per-language texts are columns of the attachment and packaging-unit rows
 * themselves; the one bridge row is an attachment hidden in a channel
 * (`product_attachment_channel_hidden`). Like the gallery's (`gallery-scopes.ts`), it has
 * one writer here, run only on the caller's `em` inside the caller's audited Command.
 */

// --- Write: one per bridge-row kind ------------------------------------------------

/** `attachmentId` hidden in exactly `channelIds` (the set replaces the stored one). */
export async function writeAttachmentHiddenChannels(
  em: EntityManager,
  productId: string,
  attachmentId: string,
  channelIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(channelIds)];
  await em.execute(
    `delete from product_attachment_channel_hidden
      where attachment_id = ? and not (sales_channel_id = any(?::uuid[]))`,
    [attachmentId, uuidArrayLiteral(ids)],
  );
  if (ids.length === 0) return;
  await em.execute(
    `insert into product_attachment_channel_hidden (attachment_id, sales_channel_id, product_id)
     select ?, channel_id, ? from unnest(?::uuid[]) as channel_id
     on conflict (attachment_id, sales_channel_id) do nothing`,
    [attachmentId, productId, uuidArrayLiteral(ids)],
  );
}

// --- Reads --------------------------------------------------------------------------

/** The channels `attachmentIds` are hidden in, per attachment, sorted. */
export async function loadHiddenChannelsByAttachment(
  em: EntityManager,
  attachmentIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (attachmentIds.length === 0) return out;
  const rows = await em.execute<Array<{ attachment_id: string; sales_channel_id: string }>>(
    `select attachment_id::text as attachment_id, sales_channel_id::text as sales_channel_id
       from product_attachment_channel_hidden
      where attachment_id = any(?::uuid[])
      order by attachment_id, sales_channel_id`,
    [uuidArrayLiteral([...new Set(attachmentIds)])],
  );
  for (const row of rows) {
    const list = out.get(row.attachment_id) ?? [];
    list.push(row.sales_channel_id);
    out.set(row.attachment_id, list);
  }
  return out;
}

/** The attachments of `productId` hidden in `channelId` — what that channel's product page leaves out. */
export async function loadAttachmentsHiddenInChannel(
  em: EntityManager,
  productId: string,
  channelId: string,
): Promise<Set<string>> {
  const rows = await em.execute<Array<{ attachment_id: string }>>(
    `select attachment_id::text as attachment_id
       from product_attachment_channel_hidden
      where product_id = ? and sales_channel_id = ?`,
    [productId, channelId],
  );
  return new Set(rows.map((row) => row.attachment_id));
}

/**
 * The scope overview's attachment and packaging-unit fields of `productId` (T139b):
 * `attachments:hidden` per channel any attachment is hidden in; `attachments:name`,
 * `attachments:description` and `packagingUnits:name` per language any row has a
 * non-blank text in. One statement.
 */
export async function loadAttachmentPackagingScopedFields(
  em: EntityManager,
  productId: string,
): Promise<Array<{ field: string; channelId: string | null; languageCode: string | null }>> {
  const rows = await em.execute<Array<{ field: string; channel_id: string | null; language_code: string | null }>>(
    `select distinct 'attachments:hidden' as field, sales_channel_id::text as channel_id, null::text as language_code
       from product_attachment_channel_hidden where product_id = ?
     union
     select distinct 'attachments:name', null, t.key
       from product_attachments pa, jsonb_each_text(pa.name_translations) as t
      where pa.product_id = ? and btrim(t.value) <> ''
     union
     select distinct 'attachments:description', null, t.key
       from product_attachments pa, jsonb_each_text(pa.description_translations) as t
      where pa.product_id = ? and btrim(t.value) <> ''
     union
     select distinct 'packagingUnits:name', null, t.key
       from product_packaging_units pu, jsonb_each_text(pu.name_translations) as t
      where pu.product_id = ? and btrim(t.value) <> ''
     order by 1, 2, 3`,
    [productId, productId, productId, productId],
  );
  return rows.map((row) => ({ field: row.field, channelId: row.channel_id, languageCode: row.language_code }));
}

// --- Shared by the scoped writes -----------------------------------------------------

/**
 * FR-014 — every channel in `channelIds` is one the product is a member of, else
 * `422 SCOPE_INVALID` (`reason: 'not_a_member'`) naming the first outside one. The
 * caller passes only the channels a write **adds**: removing one never asks (FR-015).
 */
export async function assertProductChannelMembers(
  membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'> | undefined,
  productId: string,
  channelIds: readonly string[],
): Promise<void> {
  if (channelIds.length === 0) return;
  if (!membership) {
    throw new Error('The channel membership port is not wired — a channel override cannot be checked.');
  }
  const members = new Set(
    (await membership.listChannelsForEntity('product', productId)).map((channel) => channel.id),
  );
  const outside = channelIds.find((channelId) => !members.has(channelId));
  if (outside !== undefined) {
    throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
      channelId: outside,
      reason: 'not_a_member',
    });
  }
}

/**
 * FR-081 — each side's translation maps at `keys` name every language the other side
 * names, `''` where it has none, so either audit projection, re-sent as a PATCH body,
 * puts the row back as it was (an empty text removes that language).
 */
export function mirrorTranslationRemovals(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const b = before[key] as Record<string, string>;
    const a = after[key] as Record<string, string>;
    for (const code of Object.keys(a)) if (!(code in b)) b[code] = '';
    for (const code of Object.keys(b)) if (!(code in a)) a[code] = '';
  }
}

/** A stored translation map with its languages sorted — a stable audit projection. */
export function sortedTranslations(map: Readonly<Record<string, string>> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(map ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}
