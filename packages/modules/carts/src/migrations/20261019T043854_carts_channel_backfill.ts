import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/154-sales-channel-access/` M3 — a basket with no sales channel is
 * recorded on the system-default channel.
 *
 * From this feature on a basket belongs to the channel it is used on: it is
 * created on the request's channel and every read is keyed by
 * `(owner, channel)`. A row with no channel is therefore a basket no request
 * reaches, and the system default is the honest record of where it was used —
 * every basket created before this feature was created there
 * (`CartService.#defaultSalesChannelId`, now gone), and a `null` is what that
 * lookup wrote on a store that had no default at the time.
 *
 * **One exception, left in place rather than failing the upgrade.** The unique
 * index `carts_one_active_per_customer_per_channel` admits one active basket
 * per customer per channel. A customer's active channel-less basket therefore
 * moves only when the customer holds no active basket on the default channel
 * already, and only the most recently used one when there are several. The old
 * lookup ignored the channel and so never made such a set; should one exist,
 * the rows left keep their `null` and stay unreachable rather than this
 * statement aborting the migration.
 *
 * Writes only this module's own table and reads the kernel's `sales_channels`,
 * so it declares no manifest dependency. Idempotent: a second run finds no
 * channel-less row it may change. `down()` is a no-op — the channel a basket
 * was recorded on is not information to throw away.
 */
export class Migration20261019T043854CartsChannelBackfill extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      with "d" as (
        select "id" from "sales_channels" where "system_default" = true limit 1
      ),
      "target" as (
        select c."id"
          from "carts" as c
         where c."sales_channel_id" is null
           and (
             c."status" <> 'active'
             or c."customer_account_id" is null
             or (
               not exists (
                 select 1 from "carts" as x, "d"
                  where x."customer_account_id" = c."customer_account_id"
                    and x."sales_channel_id" = "d"."id"
                    and x."status" = 'active'
               )
               and c."id" = (
                 select y."id" from "carts" as y
                  where y."customer_account_id" = c."customer_account_id"
                    and y."sales_channel_id" is null
                    and y."status" = 'active'
                  order by y."last_activity_at" desc, y."id"
                  limit 1
               )
             )
           )
      )
      update "carts" as c
         set "sales_channel_id" = "d"."id"
        from "d", "target"
       where c."id" = "target"."id";
    `);
  }

  override async down(): Promise<void> {
    // Intentionally empty: see the doc comment.
  }
}
