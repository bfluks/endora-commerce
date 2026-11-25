import type { EntityManager } from '@mikro-orm/postgresql';
import {
  productStatusChanges,
  type ProductScopeStatus,
  type ProductStatusFacts,
  type ProductStatusHookData,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * Spec 193 T049 — the hook data of `catalog`'s hookable status writers
 * (`CATALOG_HOOKABLE_ACTIONS`): each addressed product's global status, archive and deletion
 * flags, and its stored channel-scoped status cells, read on the Command's own transaction before
 * its run and after it, then reduced to what moved (`productStatusChanges`). Two statements per
 * read, whatever the number of products.
 */
export async function readProductStatusFacts(em: EntityManager, productIds: readonly string[]): Promise<ProductStatusFacts[]> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return [];
  const array = `{${ids.join(',')}}`;
  const products = await em.execute<Array<{ id: string; status: 'active' | 'inactive'; archived: boolean; deleted: boolean }>>(
    `select "id", "status", ("archived_at" is not null) as "archived", ("deleted_at" is not null) as "deleted"
       from "products" where "id" = any(?::uuid[])`,
    [array],
  );
  const cells = await em.execute<Array<{ product_id: string; sales_channel_id: string; language_code: string | null; status: ProductScopeStatus | null }>>(
    `select "product_id", "sales_channel_id", null as "language_code", "status"
       from "product_channel_scopes" where "product_id" = any(?::uuid[]) and "status" is not null
     union all
     select "product_id", "sales_channel_id", "language_code", "status"
       from "product_channel_language_scopes" where "product_id" = any(?::uuid[])`,
    [array, array],
  );
  return products.map((p) => ({
    productId: p.id,
    status: p.status,
    archived: p.archived,
    deleted: p.deleted,
    channelStatuses: cells
      .filter((c) => c.product_id === p.id)
      .map((c) => ({ salesChannelId: c.sales_channel_id, languageCode: c.language_code, status: c.status })),
  }));
}

/**
 * `command`, made to supply {@link ProductStatusHookData} for `productIds`: the facts are read on
 * its transaction before the run and after it (pending writes flushed first), so a `beforeCommit`
 * hook sees exactly what this write moved. `productIds` may be a function of the transaction, for
 * a Command whose products are known only once it reads its own rows.
 */
export function withProductStatusHookData<TResult>(
  command: Command<TResult>,
  productIds: readonly string[] | ((em: EntityManager) => Promise<readonly string[]>),
): Command<TResult> {
  let data: ProductStatusHookData = { products: [] };
  return {
    ...command,
    run: async (ctx) => {
      const ids = typeof productIds === 'function' ? await productIds(ctx.em) : productIds;
      const before = await readProductStatusFacts(ctx.em, ids);
      const outcome = await command.run(ctx);
      await ctx.em.flush();
      data = productStatusChanges(before, await readProductStatusFacts(ctx.em, ids));
      return outcome;
    },
    hookData: () => data,
  };
}
