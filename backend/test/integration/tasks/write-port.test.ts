import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TASKS_EVENTS,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
  type TaskReadPort,
  type TaskWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * `taskWritePort` — another module creating and deleting Tasks in a context it
 * owns (`specs/163-projects-and-tasks/contracts/ports-and-events.md` §1).
 *
 * One `tasks.task.create` Command per Task, so each has its own audit row and
 * its own `tasks.task.created.v1`; at most 100 per call; the context's type
 * must be registered by a present module. The probe context is owned by `crm`
 * for the length of this file, a toggleable module.
 */
describe('tasks — the write port', () => {
  let h: BackendServerHandle;
  const visible = new Set<string>();
  const asAdmin = <T>(fn: () => Promise<T>) =>
    runWithTenantContext({ mode: 'all', actor: { kind: 'admin', id: TEST_ADMIN_ID } }, fn);
  const writePort = () => h.container.resolve<TaskWritePort>('taskWritePort');
  const readPort = () => h.container.resolve<TaskReadPort>('taskReadPort');

  async function taskCount(contextId: string): Promise<number> {
    const rows = (await h.orm.em.getConnection().execute(
      `select count(*)::int as n from "tasks" where "context_id" = ?`,
      [contextId],
    )) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? '' };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const probe: TaskContextDescriptor = {
      contextType: 'write_probe',
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [...visible],
      visibleContextIds: async (ids) => new Set(ids.filter((id) => visible.has(id))),
      canSeeAs: async (_adminUserId, id) => visible.has(id),
      canChangeTasks: async () => false,
      describe: async () => new Map(),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);
  });

  afterAll(async () => {
    await h.orm.em.getConnection().execute(`delete from "tasks" where "context_type" = 'write_probe'`);
    await teardownBackendServer(h);
  });

  it('creates one Task per entry, each by its own Command with its own audit row and event', async () => {
    const contextId = randomUUID();
    const groupId = randomUUID();
    visible.add(contextId);
    const created: unknown[] = [];
    const off = h.eventBus.on(TASKS_EVENTS.CREATED as never, (payload: unknown) => {
      created.push(payload);
    });
    try {
      const { ids } = await asAdmin(() =>
        writePort().createMany({
          context: { contextType: 'write_probe', contextId, contextGroupId: groupId },
          tasks: [
            { title: 'Measure the showroom', dueOn: '2026-11-02', contextNote: 'Responsible role: Installer' },
            { title: 'Order the fittings', assignedAdminUserId: TEST_ADMIN_ID },
          ],
        }),
      );
      expect(ids).toHaveLength(2);

      const records = await asAdmin(() => readPort().listInContext({ contextType: 'write_probe', contextId }));
      expect(records.map((r) => r.id).sort()).toEqual([...ids].sort());
      const measure = records.find((r) => r.title === 'Measure the showroom')!;
      expect(measure).toMatchObject({
        status: 'todo',
        dueOn: '2026-11-02',
        contextGroupId: groupId,
        contextNote: 'Responsible role: Installer',
        assignedAdminUserId: null,
      });
      expect(measure.number).toMatch(/^TSK-\d{6,}$/);
      expect(records.find((r) => r.title === 'Order the fittings')!.assignedAdminUserId).toBe(TEST_ADMIN_ID);

      for (const id of ids) {
        const audit = await h.auditLogService.query({ action: 'tasks.task.create', objectId: id });
        expect(audit, id).toHaveLength(1);
        expect(audit[0]).toMatchObject({ objectType: 'task' });
      }
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({ contextType: 'write_probe', contextId, contextGroupId: groupId });
    } finally {
      off();
    }
  });

  it('refuses a context type nobody registered — nothing is created', async () => {
    const contextId = randomUUID();
    const refused = await refusal(
      asAdmin(() =>
        writePort().createMany({ context: { contextType: 'nobody_owns_this', contextId }, tasks: [{ title: 'x' }] }),
      ),
    );
    expect(refused).toEqual({ statusCode: 422, code: 'TASK_CONTEXT_INVALID' });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('refuses a context whose owner is off — nothing is created', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    await withModuleOff('crm', 'deactivated', async () => {
      const refused = await refusal(
        asAdmin(() =>
          writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks: [{ title: 'x' }] }),
        ),
      );
      expect(refused).toEqual({ statusCode: 422, code: 'TASK_CONTEXT_INVALID' });
    });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('refuses an assignee who is not an active administrator — nothing is created', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    const refused = await refusal(
      asAdmin(() =>
        writePort().createMany({
          context: { contextType: 'write_probe', contextId },
          tasks: [{ title: 'fine' }, { title: 'nobody', assignedAdminUserId: randomUUID() }],
        }),
      ),
    );
    expect(refused).toEqual({ statusCode: 422, code: 'TASK_ASSIGNEE_INVALID' });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('refuses more than 100 Tasks in one call, and an invalid entry, before writing anything', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    const tooMany = await refusal(
      asAdmin(() =>
        writePort().createMany({
          context: { contextType: 'write_probe', contextId },
          tasks: Array.from({ length: 101 }, (_, i) => ({ title: `t${i}` })),
        }),
      ),
    );
    expect(tooMany).toEqual({ statusCode: 422, code: 'VALIDATION_FAILED' });
    const blank = await refusal(
      asAdmin(() =>
        writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks: [{ title: '   ' }] }),
      ),
    );
    expect(blank).toEqual({ statusCode: 422, code: 'VALIDATION_FAILED' });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('deletes every Task of one context and no other, each with its own audit row', async () => {
    const doomed = randomUUID();
    const kept = randomUUID();
    visible.add(doomed);
    visible.add(kept);
    const { ids } = await asAdmin(() =>
      writePort().createMany({
        context: { contextType: 'write_probe', contextId: doomed },
        tasks: [{ title: 'one' }, { title: 'two' }],
      }),
    );
    await asAdmin(() =>
      writePort().createMany({ context: { contextType: 'write_probe', contextId: kept }, tasks: [{ title: 'three' }] }),
    );

    const result = await asAdmin(() => writePort().deleteInContext({ contextType: 'write_probe', contextId: doomed }));
    expect(result).toEqual({ deleted: 2 });
    expect(await taskCount(doomed)).toBe(0);
    expect(await taskCount(kept)).toBe(1);
    for (const id of ids) {
      expect(await h.auditLogService.query({ action: 'tasks.task.delete', objectId: id }), id).toHaveLength(1);
    }
  });

  it('is gated: with tasks off, resolving either port refuses with MODULE_DISABLED', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    await withModuleOff('tasks', 'deactivated', async () => {
      await expect(
        (async () =>
          asAdmin(() =>
            writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks: [{ title: 'x' }] }),
          ))(),
      ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
      await expect(
        (async () => asAdmin(() => readPort().countInContext({ contextType: 'write_probe', contextId })))(),
      ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    });
    expect(await taskCount(contextId)).toBe(0);
  });
});
