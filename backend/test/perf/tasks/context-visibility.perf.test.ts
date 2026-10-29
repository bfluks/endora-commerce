// perf-weight: fast — about 20 s locally (2026-10-26: seeding 5 000 Projects and 20 000 Tasks, then 30 list reads); not yet timed on the CI runner.
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MyTasksResponseSchema, TaskListResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * `specs/163-projects-and-tasks/` T070 — measures research R-9 **[unverified]**:
 * the Tasks list narrows hidden contexts with one SQL pre-filter built from
 * every context id the caller may see (`allVisibleContextIds()`), so for the
 * `project` context every request first lists every Project the caller may
 * see. The question is whether that stays cheap at the target scale.
 *
 * 5 000 Projects, 20 000 Tasks in their Stages (four each), the setting
 * *Members only*, and a viewer who is a Member of **every** Project — the
 * largest visible set, so the largest id array the pre-filter carries. The
 * number recorded is `GET /tasks` p95 (one page of 50) through the real HTTP
 * route; the budget is R-9's 500 ms, above which the first fallback (a cached
 * per-request set) applies.
 *
 * Tuning knobs (env):
 *   PERF_RUN                       — set to 'true' to run; otherwise skipped.
 *   PERF_TASKS_PROJECTS            — Projects seeded (default 5 000)
 *   PERF_TASKS_PER_PROJECT         — Tasks per Project (default 4)
 *   PERF_ITERATIONS                — list reads measured (default 30)
 *   PERF_TASKS_LIST_P95_MS         — p95 budget (default 500)
 *
 * ## What the numbers looked like when this landed
 *
 * See the T070 note in `specs/163-projects-and-tasks/tasks.md`.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const projectCount = Number(process.env['PERF_TASKS_PROJECTS'] ?? '5000');
const tasksPerProject = Number(process.env['PERF_TASKS_PER_PROJECT'] ?? '4');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '30');
const p95Budget = Number(process.env['PERF_TASKS_LIST_P95_MS'] ?? '500');

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

describe.skipIf(!shouldRun)('tasks — the context pre-filter at scale (R-9, T070)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

  beforeAll(async () => {
    h = await setupBackendServer();
    const setting = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.visibility/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: 'members' },
    });
    expect(setting.statusCode, setting.body).toBeLessThan(400);
    viewer = await seedCrmAdmin(h.em(), 'perf-tasks-viewer', ['projects:read', 'tasks:read']);

    // One transaction: an open Project needs its current Stage by commit (a
    // deferred check), and the Stage needs the Project first.
    await h.em().transactional(async (em: EntityManager) => {
      await em.execute(
        `insert into "projects" ("id", "number", "title", "created_by_admin_user_id")
         select gen_random_uuid(), 'PRJ-PERF-' || lpad(g::text, 6, '0'), 'Perf project ' || g, ?
           from generate_series(1, ?) g`,
        [TEST_ADMIN_ID, projectCount],
      );
      await em.execute(
        `insert into "project_stages" ("project_id", "name", "color", "position")
         select p."id", 'Stage', '#000000', 1 from "projects" p where p."number" like 'PRJ-PERF-%'`,
      );
      await em.execute(
        `update "projects" p set "current_stage_id" = s."id"
           from "project_stages" s where s."project_id" = p."id" and p."number" like 'PRJ-PERF-%'`,
      );
      await em.execute(
        `insert into "project_members" ("project_id", "admin_user_id")
         select p."id", ? from "projects" p where p."number" like 'PRJ-PERF-%'`,
        [viewer.adminUserId],
      );
      await em.execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "assigned_admin_user_id",
                              "due_on", "context_type", "context_id", "context_group_id")
         select gen_random_uuid(), 'TSK-PERF-' || p."number" || '-' || t, 'Perf task ' || t, ?, ?,
                current_date + t, 'project', p."id", p."current_stage_id"
           from "projects" p cross join generate_series(1, ?) t
          where p."number" like 'PRJ-PERF-%'`,
        [TEST_ADMIN_ID, viewer.adminUserId, tasksPerProject],
      );
    });
  }, 600_000);

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from "tasks" where "number" like 'TSK-PERF-%'`);
    await h.em().getConnection().execute(`delete from "projects" where "number" like 'PRJ-PERF-%'`);
    viewer.undo();
    await teardownBackendServer(h);
  }, 600_000);

  async function measure(url: string, check: (body: unknown) => void): Promise<number> {
    const samples: number[] = [];
    for (let run = 0; run <= iterations; run += 1) {
      const started = performance.now();
      const response = await h.app.inject({ method: 'GET', url, cookies: viewer.cookies });
      const elapsed = performance.now() - started;
      expect(response.statusCode, response.body).toBe(200);
      check(response.json());
      // The first read warms the process and is not counted.
      if (run > 0) samples.push(elapsed);
    }
    return p95(samples);
  }

  it(`GET /tasks for a Member of every Project: < ${p95Budget} ms p95`, async () => {
    const list = await measure('/api/v1/admin/tasks?limit=50', (body) => {
      expect(TaskListResponseSchema.parse(body).items).toHaveLength(50);
    });
    const mine = await measure('/api/v1/admin/tasks/mine', (body) => {
      expect(MyTasksResponseSchema.parse(body).data.length).toBeGreaterThan(0);
    });
    // eslint-disable-next-line no-console -- the measurement is the output (T070).
    console.log(
      `[perf] tasks, ${projectCount} Projects × ${tasksPerProject} Tasks, members-only viewer of all: ` +
        `GET /tasks p95 ${list.toFixed(0)} ms; GET /tasks/mine p95 ${mine.toFixed(0)} ms`,
    );
    expect(list).toBeLessThan(p95Budget);
  }, 600_000);
});
