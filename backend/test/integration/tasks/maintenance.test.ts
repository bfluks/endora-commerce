import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDetail, TaskContextDescriptor, TaskContextRegistryPort } from '@endora-commerce/contracts';
import { attachEscapeHatchAuditWriter } from '@endora-commerce/platform/lifecycle';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  deleteProjectTasks,
  stageNamed,
  withTasksOff,
} from '../projects/helpers.js';
import {
  createTasksRemindersJob,
  runTasksRemindersJob,
  TASKS_MAINTENANCE_SCOPE_REASON,
  type TasksRemindersJob,
} from '../../../../packages/modules/tasks/src/backend/workers/tasks-reminders-worker.js';

/**
 * User Story 10 — Tasks never stay orphaned (`specs/165-task-management/` spec
 * US10 scenarios 2 and 3, FR-040, SC-006; research R-19; issue #450).
 *
 * A Project deleted while Tasks was off keeps its Tasks — Projects asks Tasks
 * to delete them only while Tasks is on — and a Stage deleted then is not
 * checked for Tasks. The maintenance pass, the third of the `tasks-reminders`
 * tick, asks each **present** context owner that implements
 * `existingContexts` which of its contexts still exist: the Tasks of a gone
 * one are deleted (`tasks.task.delete`, `reason: 'context_gone'`), the Tasks
 * of a gone group lose it (`tasks.task.update`, `reason:
 * 'context_group_gone'`). An owner that is off is never asked, and a
 * contributor without the method is never cleaned.
 *
 * Each pass is driven through the composed job with a fresh cadence, so the
 * maintenance pass runs on every call; the other two passes find nothing of
 * this file's.
 */
describe('tasks — the maintenance pass (US10)', () => {
  let h: BackendServerHandle;
  const projects: string[] = [];
  const PROBE = 'maintenance_probe';
  const probeContext = randomUUID();

  const pass = (): Promise<void> => {
    const composed = h.container.resolve('tasksRemindersJob') as TasksRemindersJob;
    return runWithoutTenantContext(() => runTasksRemindersJob(createTasksRemindersJob(composed.deps), new Date()));
  };

  async function project(title: string): Promise<ProjectDetail> {
    const made = await createProject(h, { title });
    projects.push(made.id);
    return made;
  }

  /** A Task in a context, seeded directly: the pass reads the table, whoever created it. */
  async function seedTask(contextType: string, contextId: string, groupId: string | null, title: string): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "tasks" ("id", "number", "title", "status", "created_by_admin_user_id", "context_type", "context_id",
                              "context_group_id", "published_at")
         values (?, ?, ?, 'todo', ?, ?, ?, ?, now())`,
        [id, `TSK-M${id.slice(0, 6).toUpperCase()}`, title, TEST_ADMIN_ID, contextType, contextId, groupId],
      );
    return id;
  }

  async function rows(ids: readonly string[]): Promise<Map<string, string | null>> {
    const found = (await h
      .em()
      .getConnection()
      .execute(`select "id", "context_group_id" from "tasks" where "id" = any(?::uuid[])`, [`{${ids.join(',')}}`])) as Array<{
      id: string;
      context_group_id: string | null;
    }>;
    return new Map(found.map((row) => [row.id, row.context_group_id]));
  }

  async function deleteProject(id: string): Promise<void> {
    const response = await callProjects(h, 'DELETE', `/${id}`);
    expect(response.statusCode, response.body).toBe(204);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    // A context owner that cannot say which of its contexts exist.
    const probe: TaskContextDescriptor = {
      contextType: PROBE,
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [probeContext],
      visibleContextIds: async (ids) => new Set(ids.filter((id) => id === probeContext)),
      canSeeAs: async () => false,
      canChangeTasks: async () => false,
      describe: async () => new Map(),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);
  });

  afterAll(async () => {
    await deleteProjectTasks(h, projects);
    await deleteProjects(h, projects);
    await h.em().getConnection().execute(`delete from "tasks" where "context_type" = ?`, [PROBE]);
    await teardownBackendServer(h);
  });

  it('deletes the Tasks of a Project deleted while Tasks was off, and ungroups those of a deleted Stage', async () => {
    const gone = await project('Deleted while Tasks was off');
    const kept = await project('Stage deleted while Tasks was off');
    const [keptDesign, keptBuild] = [stageNamed(kept, 'Design'), stageNamed(kept, 'Build')];
    const doomed = [
      await seedTask('project', gone.id, stageNamed(gone, 'Design'), 'Gone 1'),
      await seedTask('project', gone.id, stageNamed(gone, 'Build'), 'Gone 2'),
      await seedTask('project', gone.id, null, 'Gone 3'),
    ];
    const orphaned = [
      await seedTask('project', kept.id, keptBuild, 'Stage gone 1'),
      await seedTask('project', kept.id, keptBuild, 'Stage gone 2'),
    ];
    const untouched = [
      await seedTask('project', kept.id, keptDesign, 'Stage kept'),
      await seedTask('project', kept.id, null, 'No stage'),
    ];

    await withTasksOff(async () => {
      await deleteProject(gone.id);
      const stage = await callProjects(h, 'DELETE', `/${kept.id}/stages/${keptBuild}`);
      expect(stage.statusCode, stage.body).toBe(204);
    });
    // Nothing happened to them while Tasks was off.
    expect((await rows([...doomed, ...orphaned])).size).toBe(5);

    await pass();

    const after = await rows([...doomed, ...orphaned, ...untouched]);
    for (const id of doomed) expect(after.has(id), id).toBe(false);
    for (const id of orphaned) expect(after.get(id), id).toBeNull();
    expect(after.get(untouched[0]!)).toBe(keptDesign);
    expect(after.has(untouched[1]!)).toBe(true);

    for (const id of doomed) {
      const audit = await h.auditLogService.query({ objectType: 'task', objectId: id, action: 'tasks.task.delete' });
      expect(audit, id).toHaveLength(1);
      // As the system: no administrator asked for it.
      expect(audit[0]!.actorAdminUserId ?? null).toBeNull();
      expect(audit[0]).toMatchObject({ stateAfter: { reason: 'context_gone' } });
      expect(audit[0]!.stateBefore).toMatchObject({ contextType: 'project', contextId: gone.id });
    }
    for (const id of orphaned) {
      const audit = await h.auditLogService.query({ objectType: 'task', objectId: id, action: 'tasks.task.update' });
      expect(audit, id).toHaveLength(1);
      expect(audit[0]!.actorAdminUserId ?? null).toBeNull();
      expect(audit[0]).toMatchObject({
        stateBefore: { contextGroupId: keptBuild },
        stateAfter: { contextGroupId: null, reason: 'context_group_gone' },
      });
    }
    for (const id of untouched) {
      expect(await h.auditLogService.query({ objectType: 'task', objectId: id }), id).toEqual([]);
    }

    // A second pass finds nothing more to do.
    await pass();
    expect((await rows(orphaned)).size).toBe(2);
  });

  it('with Projects off a pass deletes nothing; once Projects is back the next pass does', async () => {
    const gone = await project('Deleted, then Projects off');
    const ids = [await seedTask('project', gone.id, null, 'Waits 1'), await seedTask('project', gone.id, null, 'Waits 2')];
    await withTasksOff(() => deleteProject(gone.id));

    await withModuleOff('projects', 'deactivated', async () => {
      await pass();
      expect((await rows(ids)).size).toBe(2);
    });
    await withModuleOff('projects', 'platform-unavailable', async () => {
      await pass();
      expect((await rows(ids)).size).toBe(2);
    });

    await pass();
    expect((await rows(ids)).size).toBe(0);
  });

  it('with Tasks off a pass does nothing at all', async () => {
    const gone = await project('Deleted, Tasks still off');
    const id = await seedTask('project', gone.id, null, 'Waits for Tasks');
    await withTasksOff(async () => {
      await deleteProject(gone.id);
      await pass();
      expect((await rows([id])).size).toBe(1);
    });
    await pass();
    expect((await rows([id])).size).toBe(0);
  });

  it('never cleans the Tasks of a contributor that cannot say which of its contexts exist', async () => {
    const stranger = randomUUID();
    const ids = [await seedTask(PROBE, probeContext, randomUUID(), 'Probe'), await seedTask(PROBE, stranger, null, 'Unknown')];
    await pass();
    const after = await rows(ids);
    expect(after.size).toBe(2);
    expect(after.get(ids[0]!)).not.toBeNull();
  });

  describe('an idle pass enters no system scope (issue #120)', () => {
    let writer: ReturnType<typeof attachEscapeHatchAuditWriter>;

    beforeAll(() => {
      writer = attachEscapeHatchAuditWriter({
        em: () => h.orm.em.fork() as EntityManager,
        flushIntervalMs: 3_600_000,
        log: () => undefined,
      });
    });

    afterAll(async () => {
      await writer.detach();
    });

    async function recorded(): Promise<number> {
      await writer.flush();
      const found = (await h
        .em()
        .getConnection()
        .execute(
          `select coalesce(sum(("state_after"->>'occurrences')::int), 0)::text as "n"
             from "audit_log_entries"
            where "action" = 'tenant.escape_hatch' and "state_after"->>'reason' = ?`,
          [TASKS_MAINTENANCE_SCOPE_REASON],
        )) as Array<{ n: string }>;
      return Number(found[0]!.n);
    }

    it('with no present owner able to answer, the pass asks nothing and enters no scope; with one, it does', async () => {
      const before = await recorded();
      await withModuleOff('projects', 'deactivated', async () => {
        for (let i = 0; i < 3; i += 1) await pass();
      });
      expect(await recorded()).toBe(before);

      const gone = await project('Work for a pass');
      const id = await seedTask('project', gone.id, null, 'Work');
      await withTasksOff(() => deleteProject(gone.id));
      await pass();
      expect(await recorded()).toBeGreaterThan(before);
      expect((await rows([id])).size).toBe(0);
    });
  });
});
