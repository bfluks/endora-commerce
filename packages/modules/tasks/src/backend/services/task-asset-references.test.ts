import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type { SqlFragment } from './task-visibility.js';
import { taskAttachmentReferenceDescriptor, type TaskAssetRestrictionDeps } from './task-asset-references.js';

// `specs/166-asset-reference-visibility/` contracts/ports.md §1.1 (Tasks) —
// the restriction's wiring. The SQL complement property over seeded rows is
// `backend/test/integration/tasks/asset-reference-restriction.test.ts`: no
// co-located test of this package opens a database (tasks.md T001 (f)).

const ASSET = '00000000-0000-4000-8000-0000000000a1';
const TASK = '00000000-0000-4000-8000-0000000000d1';

interface Statement {
  sql: string;
  params: unknown[];
}

function fakeEm(answer: (sql: string) => unknown[]): { emFactory: () => EntityManager; statements: Statement[] } {
  const statements: Statement[] = [];
  const em = {
    async execute(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      return answer(sql);
    },
  };
  return { emFactory: () => em as unknown as EntityManager, statements };
}

function restrictionDeps(options: { mayRead?: boolean; condition?: SqlFragment | null; visible?: string[] } = {}) {
  const resolved = { access: 0, visibility: 0 };
  const visibleIdsAsked: string[][] = [];
  const deps: TaskAssetRestrictionDeps = {
    access: () => {
      resolved.access += 1;
      return {
        async visibleIds(ids: readonly string[]) {
          visibleIdsAsked.push([...ids]);
          return new Set(ids.filter((id) => (options.visible ?? []).includes(id)));
        },
      };
    },
    visibility: () => {
      resolved.visibility += 1;
      return {
        async condition() {
          return options.condition === undefined ? { sql: 't."is_private" = false', params: [] } : options.condition;
        },
      };
    },
    mayReadTasks: async () => options.mayRead ?? true,
  };
  return { deps, resolved, visibleIdsAsked };
}

describe('the Tasks asset-reference descriptor (feature 166)', () => {
  it('tags every hit with the asset it points at, in one statement', async () => {
    const { emFactory, statements } = fakeEm(() => [{ id: TASK, number: 'T-1', asset_id: ASSET }]);
    const descriptor = taskAttachmentReferenceDescriptor(emFactory, restrictionDeps().deps);

    const hits = await descriptor.findReferences([ASSET, '00000000-0000-4000-8000-0000000000a2']);

    expect(hits).toEqual([{ kind: 'task_attachment', entityId: TASK, label: 'Task T-1', assetId: ASSET }]);
    expect(statements).toHaveLength(1);
  });

  it('declares a reader restriction and resolves its services per call, never at construction', async () => {
    const { emFactory } = fakeEm(() => []);
    const { deps, resolved } = restrictionDeps({ visible: [TASK] });
    const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

    expect(descriptor.readerRestriction).toBeDefined();
    expect(resolved).toEqual({ access: 0, visibility: 0 });

    await descriptor.readerRestriction!.visibleEntityIds([TASK]);
    await descriptor.readerRestriction!.visibleEntityIds([TASK]);
    expect(resolved.access).toBe(2);
  });

  it('answers visibleEntityIds through TaskAccess.visibleIds', async () => {
    const { emFactory } = fakeEm(() => []);
    const other = '00000000-0000-4000-8000-0000000000d2';
    const { deps, visibleIdsAsked } = restrictionDeps({ visible: [TASK] });
    const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

    expect([...(await descriptor.readerRestriction!.visibleEntityIds([TASK, other]))]).toEqual([TASK]);
    expect(visibleIdsAsked).toEqual([[TASK, other]]);
  });

  describe('without tasks:read', () => {
    it('sees no Task, and does not ask TaskAccess', async () => {
      const { emFactory } = fakeEm(() => []);
      const { deps, visibleIdsAsked, resolved } = restrictionDeps({ mayRead: false, visible: [TASK] });
      const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

      expect([...(await descriptor.readerRestriction!.visibleEntityIds([TASK]))]).toEqual([]);
      expect(visibleIdsAsked).toEqual([]);
      expect(resolved.access).toBe(0);
    });

    it('reports every referenced asset as having a hidden reference', async () => {
      const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
      const { deps, resolved } = restrictionDeps({ mayRead: false });
      const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

      expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([ASSET]);
      expect(statements).toHaveLength(1);
      expect(statements[0]!.sql).toMatch(/select distinct a\."asset_id"/);
      expect(statements[0]!.sql).not.toMatch(/is not true/);
      expect(resolved.visibility).toBe(0);
    });
  });

  it('hides nothing when the visibility condition is null', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const { deps } = restrictionDeps({ condition: null });
    const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('writes the hidden set as the NULL-safe complement of the condition', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const { deps } = restrictionDeps({ condition: { sql: 't."created_by_admin_user_id" = ?::uuid', params: ['me'] } });
    const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([ASSET]);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain('(t."created_by_admin_user_id" = ?::uuid) is not true');
    expect(statements[0]!.params).toEqual(['me']);
  });

  it('lists every attached asset for allReferencedAssetIds, whoever asks', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const { deps, resolved } = restrictionDeps({ mayRead: false });
    const descriptor = taskAttachmentReferenceDescriptor(emFactory, deps);

    expect(await descriptor.readerRestriction!.allReferencedAssetIds()).toEqual([ASSET]);
    expect(statements[0]!.sql).toMatch(/from "task_attachments"/);
    expect(resolved).toEqual({ access: 0, visibility: 0 });
  });
});
