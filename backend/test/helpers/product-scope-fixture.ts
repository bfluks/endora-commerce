import type { EntityManager } from '@mikro-orm/postgresql';
import type { ProductScopeStatus } from '@endora-commerce/contracts';

/**
 * Feature 163 — writes a product's scope rows straight into `catalog`'s two
 * scope tables, for the consumer-seam tests (`specs/163-product-data-scopes/`
 * Phases 6–8). The admin route that owns these writes is exercised by
 * `contract/catalog/product-scopes-api.test.ts`; the seams under test only
 * read, so the fixture writes the rows the route would.
 *
 * Every statement goes through the connection of the server harness the
 * caller booted (`h.em().getConnection()`), outside any test transaction, so
 * the request under test reads them; `clearProductScopes` is the cleanup.
 */

async function exec(em: EntityManager, sql: string, params: unknown[]): Promise<void> {
  await em.getConnection().execute(sql, params);
}

/** The channel-scope status of `productId` on each channel; `null` removes the override. */
export async function setChannelStatus(
  em: EntityManager,
  productId: string,
  channelIds: readonly string[],
  status: ProductScopeStatus | null,
): Promise<void> {
  for (const channelId of channelIds) {
    await exec(
      em,
      `insert into product_channel_scopes (product_id, sales_channel_id, status, created_at, updated_at)
       values (?, ?, ?, now(), now())
       on conflict (product_id, sales_channel_id) do update set status = excluded.status, updated_at = now()`,
      [productId, channelId, status],
    );
  }
}

/**
 * The channel audience override of `productId` on each channel — the rule replaces the
 * global one whole (C4); `null` removes the override (inherit).
 */
export async function setChannelAudience(
  em: EntityManager,
  productId: string,
  channelIds: readonly string[],
  rule: { visibility: string; allowedOrganizationIds: readonly string[] } | null,
): Promise<void> {
  for (const channelId of channelIds) {
    await exec(
      em,
      `insert into product_channel_scopes (product_id, sales_channel_id, visibility, allowed_organization_ids, created_at, updated_at)
       values (?, ?, ?, ?::jsonb, now(), now())
       on conflict (product_id, sales_channel_id) do update
         set visibility = excluded.visibility, allowed_organization_ids = excluded.allowed_organization_ids, updated_at = now()`,
      [productId, channelId, rule?.visibility ?? null, rule ? JSON.stringify(rule.allowedOrganizationIds) : null],
    );
  }
}

/** The channel × language status; `null` removes the row. */
export async function setLanguageStatus(
  em: EntityManager,
  productId: string,
  channelId: string,
  languageCode: string,
  status: ProductScopeStatus | null,
): Promise<void> {
  if (status === null) {
    await exec(
      em,
      `delete from product_channel_language_scopes where product_id = ? and sales_channel_id = ? and language_code = ?`,
      [productId, channelId, languageCode],
    );
    return;
  }
  await exec(
    em,
    `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
     values (?, ?, ?, ?, now(), now())
     on conflict (product_id, sales_channel_id, language_code) do update set status = excluded.status, updated_at = now()`,
    [productId, channelId, languageCode, status],
  );
}

/** The product's global publication window. */
export async function setGlobalWindow(
  em: EntityManager,
  productId: string,
  window: { from: Date | null; until: Date | null },
): Promise<void> {
  await exec(em, `update products set publish_from = ?, publish_until = ? where id = ?`, [
    window.from,
    window.until,
    productId,
  ]);
}

/** Every scope row of the products, and their global window. */
export async function clearProductScopes(em: EntityManager, productIds: readonly string[]): Promise<void> {
  if (productIds.length === 0) return;
  const list = productIds.map(() => '?').join(',');
  await exec(em, `delete from product_channel_language_scopes where product_id in (${list})`, [...productIds]);
  await exec(em, `delete from product_channel_scopes where product_id in (${list})`, [...productIds]);
  await exec(em, `update products set publish_from = null, publish_until = null where id in (${list})`, [
    ...productIds,
  ]);
}

/** A channel's Name override for a product (feature 022 row); `languageCode` `null` = channel-only. */
export async function setNameOverride(
  em: EntityManager,
  productId: string,
  channelId: string,
  languageCode: string | null,
  name: string,
): Promise<void> {
  await exec(
    em,
    `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
     values (gen_random_uuid(), ?, 'name', ?, ?, ?::jsonb, now(), now())`,
    [productId, channelId, languageCode, JSON.stringify({ v: name })],
  );
}

/** Every value override of the products. */
export async function clearValueOverrides(em: EntityManager, productIds: readonly string[]): Promise<void> {
  if (productIds.length === 0) return;
  await exec(em, `delete from product_value_overrides where product_id in (${productIds.map(() => '?').join(',')})`, [
    ...productIds,
  ]);
}

/**
 * An error response's body without its `requestId` — the one field two
 * otherwise identical refusals never share. "Answers what an absent product
 * answers" compares this: the code and the (localised) message.
 */
export function errorBodyOf(res: { json(): unknown }): unknown {
  const body = res.json() as { error?: Record<string, unknown> };
  if (!body.error) return body;
  const { requestId: _requestId, ...error } = body.error;
  return { ...body, error };
}
