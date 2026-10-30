import { Migration } from '@mikro-orm/migrations';

/**
 * Assigns every existing Organization the sales channels its members may use
 * (`specs/154-sales-channel-access/` D4, FR-021, research R-7).
 *
 * From feature 154 on, `sales_channel_organizations` is what the channel-access
 * rule reads: a customer is answered only on a channel assigned to the
 * customer's Organization, and **no assignment means no access**. Before it,
 * nothing read or wrote the bridge, so an upgraded database holds Organizations
 * with no row there — every one of whose buyers the rule would refuse.
 *
 * Each Organization gets:
 *
 *  - the system-default channel, so a single-channel shop sees no change at all;
 *  - every channel it already has at least one order on, so a multi-channel
 *    shop's buyers keep every store they have bought on. Orders are the
 *    evidence of trade (A4): quote requests and baskets are not counted. An
 *    order naming a channel that no longer exists is ignored.
 *
 * `on conflict do nothing` keeps assignments made before it — an operator's —
 * and makes a second run a no-op. `down()` removes nothing: the rows are
 * indistinguishable from an operator's, and removing them would lock buyers out.
 *
 * ## The read of `orders`
 *
 * `orders` is another module's table and this migration cannot declare it:
 * `orders` depends on `organizations`, the tenancy root, so the edge would
 * close a cycle. It is a one-time read of a table that may not exist — on a
 * fresh database `orders` is created after this migration runs, and a
 * deployment may never install it — so the read is guarded by `to_regclass`.
 * The write is to this module's own bridge. Recorded as a permanent R1 entry in
 * `backend/scripts/ledgers/migration-undeclared-references/organizations.ts`.
 * The bridge is written in SQL here rather than through the kernel's audited
 * membership service because a migration has no container; it is the owner's
 * own migration writing its own table.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 */
export class Migration20261018T104644OrganizationsChannelAccessBackfill extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `insert into "sales_channel_organizations" ("sales_channel_id", "organization_id")
       select sc."id", o."id"
       from "organizations" o
       cross join "sales_channels" sc
       where sc."system_default" = true
       on conflict do nothing;`,
    );
    this.addSql(
      `do $$
       begin
         if to_regclass('orders') is not null then
           insert into "sales_channel_organizations" ("sales_channel_id", "organization_id")
           select distinct ord."sales_channel_id", ord."organization_id"
           from "orders" ord
           join "sales_channels" sc on sc."id" = ord."sales_channel_id"
           join "organizations" o on o."id" = ord."organization_id"
           where ord."sales_channel_id" is not null and ord."organization_id" is not null
           on conflict do nothing;
         end if;
       end $$;`,
    );
  }

  override async down(): Promise<void> {
    // Deliberately nothing — see the class comment.
  }
}
