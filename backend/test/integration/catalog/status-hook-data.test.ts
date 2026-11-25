import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_HOOKABLE_ACTIONS, toHookableActionDeclaration, type ProductStatusHookData } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CommandBus } from '../../../src/commands/index.js';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { withProductStatusHookData } from '../../../../packages/modules/catalog/dist/backend/commands/product-status-hook-data.js';
import { Product } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Spec 193 T049 — the hook data of `catalog`'s hookable status writers, on a real Command Bus whose
 * registry carries a recording `beforeCommit` hook: what a hook (the website rule's admission,
 * T068) sees is the addressed product's global status and archive flag before and after, and every
 * channel-scoped status cell the write moved — read on the write's own transaction.
 */
describe('catalog status writers — hook data (spec 193, T049)', () => {
  let h: BackendServerHandle;
  let service: CatalogAdminService;
  let bus: CommandBus;
  const recorder = recordingCommandHooks();
  const sql = <T>(s: string, p: unknown[] = []) => h.em().getConnection().execute<T[]>(s, p);
  const system = <T>(fn: () => Promise<T>) => withSystemScope('spec 193 T049 test', fn);
  const last = () => recorder.calls.at(-1)!.data as ProductStatusHookData;

  beforeAll(async () => {
    h = await setupBackendServer();
    const registry = sealedCommandHookRegistry({
      hookableActions: Object.values(CATALOG_HOOKABLE_ACTIONS).map((ref) => ({ moduleId: 'catalog', ...toHookableActionDeclaration(ref) })),
      moduleDependencies: { probe: ['catalog'] },
      hooks: [{ moduleId: 'probe', entries: Object.values(CATALOG_HOOKABLE_ACTIONS).map((ref) => recorder.on(ref)) }],
      isPresent: () => true,
    });
    bus = new CommandBus(h.orm, h.auditLogService, h.eventBus, { hooks: registry });
    service = new CatalogAdminService(
      h.em,
      h.eventBus as unknown as CatalogEventBus,
      h.auditLogService,
      h.salesChannels.membershipService,
      bus,
    );
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function product(status: 'active' | 'inactive'): Promise<string> {
    const em = h.em();
    const stamp = randomUUID().slice(0, 8);
    const p = em.create(Product, {
      sku: `T049-${stamp}`,
      slug: `t049-${stamp}`,
      type: 'simple',
      status,
      name: 'T049',
      description: 'T049',
      visibility: 'public',
      attributeValues: {},
    });
    await em.persist(p).flush();
    return p.id;
  }

  it('product.update — a global transition to active', async () => {
    const id = await product('inactive');
    await system(() => service.updateProductAudited(id, { status: 'active' } as never));
    expect(recorder.calls.at(-1)!.action).toBe('product.update');
    expect(last()).toEqual({
      products: [
        {
          productId: id,
          before: { status: 'inactive', archived: false, deleted: false },
          after: { status: 'active', archived: false, deleted: false },
          channelStatuses: [],
        },
      ],
    });
  });

  it('product.restore — the archive cleared', async () => {
    const id = await product('active');
    await system(() => service.archiveProduct(id));
    await system(() => service.restoreProduct(id));
    expect(recorder.calls.at(-1)!.action).toBe('product.restore');
    expect(last().products[0]).toMatchObject({ before: { archived: true }, after: { archived: false } });
  });

  it('channel-scoped cells: the channel row and a language, moved and cleared to inherit, read on the write’s transaction', async () => {
    const id = await product('active');
    const [channel] = await sql<{ id: string }>(`select "id" from "sales_channels" order by "created_at" limit 1`);
    const ch = channel!.id;
    await sql(
      `insert into "product_channel_scopes" ("product_id", "sales_channel_id", "status", "window_overridden", "min_order_quantity_overridden", "created_at", "updated_at")
       values (?, ?, 'inactive', false, false, now(), now())`,
      [id, ch],
    );
    const write: Command<null> = {
      action: CATALOG_HOOKABLE_ACTIONS.productScopesUpdate.action,
      objectType: 'product',
      objectId: id,
      run: async ({ em }) => {
        await em.execute(`update "product_channel_scopes" set "status" = null where "product_id" = ?`, [id]);
        await em.execute(
          `insert into "product_channel_language_scopes" ("product_id", "sales_channel_id", "language_code", "status", "created_at", "updated_at")
           values (?, ?, 'pl-PL', 'active', now(), now())`,
          [id, ch],
        );
        return { result: null, after: { id } };
      },
    };
    await system(() => bus.run(withProductStatusHookData(write, [id])));
    expect(last()).toEqual({
      products: [
        {
          productId: id,
          before: { status: 'active', archived: false, deleted: false },
          after: { status: 'active', archived: false, deleted: false },
          channelStatuses: [
            { salesChannelId: ch, languageCode: null, before: 'inactive', after: null },
            { salesChannelId: ch, languageCode: 'pl-PL', before: null, after: 'active' },
          ],
        },
      ],
    });
  });
});
