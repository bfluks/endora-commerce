import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetReferenceReaderRestriction } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import type { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';

/**
 * The Tasks descriptor's reader restriction over seeded rows
 * (`specs/166-asset-reference-visibility/` contracts/ports.md §1.1, research
 * R-2, R-16).
 *
 * The property the library's list depends on: `assetIdsWithHiddenReferences()`
 * is the **exact complement** of `visibleEntityIds` over this descriptor's
 * references — written NULL-safe, so a row the predicate cannot decide is
 * hidden — and `allReferencedAssetIds()` is every attached asset. Measured for
 * a creator, a plain reader, a `tasks:see_private` holder and a reader without
 * `tasks:read`, over a public Task, a private one, a draft, a Task in a context
 * nobody may see and a Task without a context (NULL `context_id`).
 *
 * The restriction is read off the composed registry, so the getters the boot
 * hook hands it are what is measured too.
 */
describe('tasks — the asset-reference reader restriction (feature 166)', () => {
  let h: BackendServerHandle;
  type Person = { adminUserId: string; undo: () => void };
  let creator: Person;
  let reader: Person;
  let privateReader: Person;
  let nonReader: Person;
  const tasks: Record<'open' | 'private' | 'draft' | 'context', string> = {
    open: randomUUID(),
    private: randomUUID(),
    draft: randomUUID(),
    context: randomUUID(),
  };
  const assets: Record<'open' | 'private' | 'draft' | 'context' | 'shared', string> = {
    open: randomUUID(),
    private: randomUUID(),
    draft: randomUUID(),
    context: randomUUID(),
    shared: randomUUID(),
  };
  /** Every (asset, Task) pair seeded. */
  const pairs: Array<[string, string]> = [
    [assets.open, tasks.open],
    [assets.private, tasks.private],
    [assets.draft, tasks.draft],
    [assets.context, tasks.context],
    [assets.shared, tasks.open],
    [assets.shared, tasks.private],
  ];
  const ours = new Set(Object.values(assets));

  function restriction(): AssetReferenceReaderRestriction {
    const registry = h.container.resolve<AssetReferenceRegistry>('assetReferenceRegistry');
    const descriptor = registry.partition().restricted.find((d) => d.ownerModuleId === 'tasks');
    expect(descriptor, 'Tasks registers a reader-restricted descriptor').toBeDefined();
    return descriptor!.readerRestriction!;
  }

  const as = <T>(adminUserId: string, body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext({ kind: 'admin', adminUserId }, { allowAll: true, allowedOrganizationIds: [] }),
      body,
    );

  /** Asserts the complement property for one reader and answers what they see and what is hidden. */
  async function complementFor(adminUserId: string): Promise<{ visible: string[]; hidden: string[] }> {
    return as(adminUserId, async () => {
      const r = restriction();
      const visible = await r.visibleEntityIds(Object.values(tasks));
      const expected = new Set(pairs.filter(([, task]) => !visible.has(task)).map(([asset]) => asset));
      const hidden = (await r.assetIdsWithHiddenReferences()).filter((id) => ours.has(id));
      expect([...hidden].sort(), 'assetIdsWithHiddenReferences is the complement of visibleEntityIds').toEqual(
        [...expected].sort(),
      );
      return { visible: [...visible].sort(), hidden: [...hidden].sort() };
    });
  }

  const sorted = (...ids: string[]) => [...ids].sort();

  beforeAll(async () => {
    h = await setupBackendServer();
    creator = await seedCrmAdmin(h.em(), 'r6-task-creator', ['tasks:read', 'tasks:write']);
    reader = await seedCrmAdmin(h.em(), 'r6-task-reader', ['tasks:read']);
    privateReader = await seedCrmAdmin(h.em(), 'r6-task-private', ['tasks:read', 'tasks:see_private']);
    nonReader = await seedCrmAdmin(h.em(), 'r6-task-none', ['assets.read']);
    const conn = h.em().getConnection();
    const rows: Array<[string, { draft: boolean; private: boolean; contextId: string | null }]> = [
      [tasks.open, { draft: false, private: false, contextId: null }],
      [tasks.private, { draft: false, private: true, contextId: null }],
      [tasks.draft, { draft: true, private: false, contextId: null }],
      // A Project nobody may see: it does not exist.
      [tasks.context, { draft: false, private: false, contextId: randomUUID() }],
    ];
    for (const [id, row] of rows) {
      await conn.execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_draft", "is_private", "context_type", "context_id")
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          `T-R6-${id.slice(0, 8)}`,
          `R6 ${id.slice(0, 8)}`,
          creator.adminUserId,
          row.draft,
          row.private,
          row.contextId === null ? null : 'project',
          row.contextId,
        ],
      );
    }
    for (const [asset, task] of pairs) {
      await conn.execute(
        `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
        [task, asset, creator.adminUserId],
      );
    }
  });

  afterAll(async () => {
    await h.em()
      .getConnection()
      .execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${Object.values(tasks).join(',')}}`]);
    for (const person of [creator, reader, privateReader, nonReader]) person?.undo();
    await teardownBackendServer(h);
  });

  it('a plain reader sees the public Task only; every other file has a hidden reference', async () => {
    const { visible, hidden } = await complementFor(reader.adminUserId);
    expect(visible).toEqual([tasks.open]);
    expect(hidden).toEqual(sorted(assets.private, assets.draft, assets.context, assets.shared));
  });

  it('the creator sees their own private Task and draft, not the unseen context', async () => {
    const { visible, hidden } = await complementFor(creator.adminUserId);
    expect(visible).toEqual(sorted(tasks.open, tasks.private, tasks.draft));
    expect(hidden).toEqual([assets.context]);
  });

  it('a tasks:see_private holder sees the private Task, never the draft', async () => {
    const { visible, hidden } = await complementFor(privateReader.adminUserId);
    expect(visible).toEqual(sorted(tasks.open, tasks.private));
    expect(hidden).toEqual(sorted(assets.draft, assets.context));
  });

  it('a reader without tasks:read sees no Task, and every file has a hidden reference', async () => {
    const { visible, hidden } = await complementFor(nonReader.adminUserId);
    expect(visible).toEqual([]);
    expect(hidden).toEqual(sorted(...Object.values(assets)));
  });

  it('allReferencedAssetIds is every attached file, whoever asks', async () => {
    for (const who of [reader, nonReader]) {
      const all = await as(who.adminUserId, () => restriction().allReferencedAssetIds());
      expect(all.filter((id) => ours.has(id)).sort()).toEqual(sorted(...Object.values(assets)));
    }
  });
});
