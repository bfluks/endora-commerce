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
