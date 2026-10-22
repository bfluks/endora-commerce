import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PriceListStatusWorker } from '../../../../packages/modules/price_lists/src/backend/services/price-list-status-worker.js';
import { DefaultPriceListMigrator } from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * D-287 P0 — **when** the pricing cache is told about a price write, and by whom
 * (`specs/pricing/read-paths-and-performance.md` §2.4).
 *
 *  1. An audited write invalidated from inside the Command Bus `run` callback,
 *     i.e. before its transaction committed, so a read racing the write
 *     re-cached the pre-write value for the whole TTL. It must invalidate after
 *     the bus returns — after commit — and not at all for a write that changed
 *     nothing.
 *  2. The status sweeper flips `scheduled → active` and `active → expired` and
 *     told nobody, so a sale starting at midnight stayed invisible for up to a
 *     further TTL after the sweep that started it.
 *
 * The bus here is a stand-in that records the moment it "commits" — the real
 * one commits when its `transactional` callback returns, which is the same
 * moment, and this file's transaction-rollback fixture cannot nest a second
 * commit inside it.
 */

const TEST_RULE = { kind: 'criterion' as const, type: 'currency' as const, values: ['PLN'] };

class RecordingCache {
  readonly calls: Array<{ committed: boolean }> = [];
  constructor(private readonly bus: { committed: boolean }) {}
  invalidateAll(): void {
    this.calls.push({ committed: this.bus.committed });
  }
}

function recordingBus(db: TestDb): CommandBus & { committed: boolean } {
  const bus = {
    committed: false,
    async run<T>(command: Command<T>): Promise<T> {
      bus.committed = false;
      const outcome = await command.run({
        em: db.em(),
        actor: {
          actorAdminUserId: null,
          impersonatedCustomerAccountId: null,
          kind: 'system',
        },
      });
      await db.em().flush();
      bus.committed = true;
      return outcome.result;
    },
  };
  return bus as unknown as CommandBus & { committed: boolean };
}

describe('price_lists — pricing cache invalidation happens after commit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    await new DefaultPriceListMigrator(() => db.em()).seedDefault();
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('invalidates an audited write once, after the Command Bus has committed it', async () => {
    const bus = recordingBus(db);
    const cache = new RecordingCache(bus);
    const svc = new PriceListService(
      () => db.em(),
      cache,
      undefined,
      bus,
      neighbourReadPorts(() => db.em()),
    );

    const list = await svc.create({ name: 'After commit', type: 'base', applicationRule: TEST_RULE });
    expect(cache.calls).toEqual([{ committed: true }]);

    await svc.patch(list.id, { name: 'After commit, renamed' });
    expect(cache.calls).toEqual([{ committed: true }, { committed: true }]);
  });

  it('does not invalidate a write that changed nothing', async () => {
    const bus = recordingBus(db);
    const cache = new RecordingCache(bus);
    const svc = new PriceListService(
      () => db.em(),
      cache,
      undefined,
      bus,
      neighbourReadPorts(() => db.em()),
    );
    const list = await svc.create({ name: 'Unchanged', type: 'base', applicationRule: TEST_RULE });
    cache.calls.length = 0;

    await svc.patch(list.id, { name: 'Unchanged' });
    expect(cache.calls).toEqual([]);
  });

  it('the status sweeper invalidates when it activates or expires a list, and only then', async () => {
    const svc = new PriceListService(
      () => db.em(),
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(() => db.em()),
    );
    const invalidations: number[] = [];
    const worker = new PriceListStatusWorker(() => db.em(), {
      invalidateAll: () => {
        invalidations.push(Date.now());
      },
    });

    // Nothing due: no invalidation.
    await worker.sweep(new Date());
    expect(invalidations).toHaveLength(0);

    const scheduled = await svc.create({
      name: 'Midnight sale',
      type: 'sale',
      applicationRule: TEST_RULE,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 3 * 86_400_000),
    });
    await svc.activate(scheduled.id);

    const started = await worker.sweep(new Date(Date.now() + 2 * 86_400_000));
    expect(started.scheduledToActive).toBe(1);
    expect(invalidations).toHaveLength(1);

    const ended = await worker.sweep(new Date(Date.now() + 4 * 86_400_000));
    expect(ended.activeToExpired).toBe(1);
    expect(invalidations).toHaveLength(2);
  });
});
