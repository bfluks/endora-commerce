import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Migration20261018T104644OrganizationsChannelAccessBackfill } from '@endora-commerce/mod-organizations/migrations';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order } from '../../helpers/package-entities.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

/**
 * Feature 154 — the upgrade that makes the channel-access rule safe to switch
 * on (D4, FR-021, research R-7; User Story 3).
 *
 * Every existing Organization is assigned the system-default channel plus every
 * channel it already has at least one order on. Assignments made before it are
 * kept, a second run changes nothing, and a database on which `orders` was
 * never installed does not fail. The statements come from the migration class,
 * so a change to the policy shows up here.
 */
describe('organizations — channel-access backfill', () => {
  let h: BackendServerHandle;
  let defaultId: string;
  let aId: string;
  let bId: string;
  let cId: string;

  async function runMigration(): Promise<void> {
    const em = h.em();
    const migration = new Migration20261018T104644OrganizationsChannelAccessBackfill(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
    em.clear();
  }

  async function channelsOf(organizationId: string): Promise<string[]> {
    const rows = await h
      .em()
      .execute<Array<{ sales_channel_id: string }>>(
        'select "sales_channel_id" from "sales_channel_organizations" where "organization_id" = ?',
        [organizationId],
      );
    return rows.map((r) => r.sales_channel_id).sort();
  }

  /** An Organization the way a pre-feature database holds it: no channel at all. */
  async function legacyOrganization(label: string): Promise<string> {
    const org = await seedAdHocOrganization(h.em(), `Backfill ${label}`);
    await h
      .em()
      .execute('delete from "sales_channel_organizations" where "organization_id" = ?', [org.id]);
    return org.id;
  }

  async function orderOn(organizationId: string, salesChannelId: string): Promise<void> {
    const em = h.em();
    em.create(Order, {
      organizationId,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId,
      deliveryAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: {
        code: 'p',
        name: 'P',
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
      },
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '0.00',
      total: '123.00',
      currency: 'PLN',
      placedAt: new Date(),
    } as never);
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const ids: string[] = [];
    for (const code of ['backfill-a', 'backfill-b', 'backfill-c']) {
      const channel = em.create(SalesChannel, {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      });
      ids.push(channel.id);
    }
    await em.flush();
    [aId, bId, cId] = ids as [string, string, string];
    defaultId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('assigns the default channel to an Organization with no orders', async () => {
    const org = await legacyOrganization('no orders');
    await runMigration();
    expect(await channelsOf(org)).toEqual([defaultId].sort());
  });

  it('assigns the default channel and every channel ordered on, and no other', async () => {
    const org = await legacyOrganization('two channels');
    await orderOn(org, aId);
    await orderOn(org, aId);
    await orderOn(org, bId);
    // An order recording a channel that no longer exists is not evidence of a store.
    await orderOn(org, randomUUID());
    await runMigration();
    expect(await channelsOf(org)).toEqual([defaultId, aId, bId].sort());
  });

  it('keeps an assignment made before it', async () => {
    const org = await legacyOrganization('pre-assigned');
    await h
      .em()
      .execute(
        'insert into "sales_channel_organizations" ("sales_channel_id", "organization_id") values (?, ?)',
        [cId, org],
      );
    await runMigration();
    expect(await channelsOf(org)).toEqual([defaultId, cId].sort());
  });

  it('changes nothing when run a second time', async () => {
    const org = await legacyOrganization('rerun');
    await orderOn(org, bId);
    await runMigration();
    const first = await channelsOf(org);
    const total = async (): Promise<number> =>
      Number(
        (
          await h
            .em()
            .execute<Array<{ n: string }>>(
              'select count(*)::text as n from "sales_channel_organizations"',
            )
        )[0]!.n,
      );
    const before = await total();
    await runMigration();
    expect(await channelsOf(org)).toEqual(first);
    expect(await total()).toBe(before);
  });

  it('does not fail on a database where orders was never installed', async () => {
    const org = await legacyOrganization('no orders table');
    const em = h.em();
    const migration = new Migration20261018T104644OrganizationsChannelAccessBackfill(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    const queries = migration.getQueries().map((q) => q as string);
    // One transaction, rolled back: the table is renamed out of sight for the
    // length of these statements only.
    await em
      .transactional(async (tx) => {
        await tx.execute(`set local lock_timeout = '5s'`);
        await tx.execute('alter table "orders" rename to "orders_hidden_by_backfill_test"');
        for (const query of queries) await tx.execute(query);
        const rows = await tx.execute<Array<{ sales_channel_id: string }>>(
          'select "sales_channel_id" from "sales_channel_organizations" where "organization_id" = ?',
          [org],
        );
        expect(rows.map((r) => r.sales_channel_id)).toEqual([defaultId]);
        throw new RollbackSignal();
      })
      .catch((err: unknown) => {
        if (!(err instanceof RollbackSignal)) throw err;
      });
    const orders = await h
      .em()
      .execute<Array<{ present: string | null }>>(`select to_regclass('orders')::text as present`);
    expect(orders[0]!.present).toBe('orders');
  });
});

class RollbackSignal extends Error {}
