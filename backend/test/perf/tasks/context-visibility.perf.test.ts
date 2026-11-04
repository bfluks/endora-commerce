// perf-weight: fast — about 20 s locally (2026-10-26: seeding 5 000 Projects and 20 000 Tasks, then 30 list reads; 165 T024 adds 5 000 Tasks with assignees and tags and 15 more reads per sort); not yet timed on the CI runner.
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MyTasksResponseSchema,
  TASK_LIST_SORTS,
  TaskBoardResponseSchema,
  TaskListResponseSchema,
} from '@endora-commerce/contracts';
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
 * `specs/165-task-management/` T024 (SC-002) adds **5 000 Tasks of no context**,
 * each with two assignees (the viewer and another administrator), three tags
 * of a pool of a hundred and a priority, and measures the first page of
 * `GET /tasks` under **every sort** and *My Tasks* against SC-002's 2 s:
 *
 *   PERF_TASKS_FREE               — context-less Tasks seeded (default 5 000)
 *   PERF_TASKS_SC002_MS           — per-sort and My Tasks p95 budget (default 2 000)
 *
 * ## What the numbers looked like when this landed
 *
 * See the T070 note in `specs/163-projects-and-tasks/tasks.md` and the T024
 * note in `specs/165-task-management/tasks.md`.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const projectCount = Number(process.env['PERF_TASKS_PROJECTS'] ?? '5000');
const tasksPerProject = Number(process.env['PERF_TASKS_PER_PROJECT'] ?? '4');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '30');
const p95Budget = Number(process.env['PERF_TASKS_LIST_P95_MS'] ?? '500');
const freeTasks = Number(process.env['PERF_TASKS_FREE'] ?? '5000');
const sc002Budget = Number(process.env['PERF_TASKS_SC002_MS'] ?? '2000');
const sortIterations = Math.max(5, Math.floor(iterations / 2));

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
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id",
                              "due_on", "context_type", "context_id", "context_group_id", "published_at")
         select gen_random_uuid(), 'TSK-PERF-' || p."number" || '-' || t, 'Perf task ' || t, ?,
                current_date + t, 'project', p."id", p."current_stage_id", now()
           from "projects" p cross join generate_series(1, ?) t
          where p."number" like 'PRJ-PERF-%'`,
        [TEST_ADMIN_ID, tasksPerProject],
      );
      await em.execute(
        `insert into "task_assignees" ("task_id", "admin_user_id")
         select t."id", ? from "tasks" t where t."number" like 'TSK-PERF-%'`,
        [viewer.adminUserId],
      );

      // 165 T024: Tasks of no context, two assignees, three tags, a priority.
      await em.execute(
        `insert into "task_tags" ("id", "name")
         select gen_random_uuid(), 'perf-tag-' || lpad(g::text, 3, '0') from generate_series(1, 100) g`,
      );
      await em.execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "status", "priority_code",
                              "due_on", "due_at", "published_at", "created_at", "updated_at")
         select gen_random_uuid(), 'TSK-PERF5K-' || lpad(g::text, 6, '0'), 'Free perf task ' || g, ?,
                (array['todo', 'in_progress', 'done', 'cancelled'])[1 + g % 4],
                (array['urgent', 'high', 'normal', 'low', null])[1 + g % 5],
                current_date + (g % 90),
                case when g % 3 = 0 then now() + (g % 90) * interval '1 day' else null end,
                now(), now() - g * interval '1 minute', now() - (g % 977) * interval '1 minute'
           from generate_series(1, ?) g`,
        [TEST_ADMIN_ID, freeTasks],
      );
      await em.execute(
        `insert into "task_assignees" ("task_id", "admin_user_id")
         select t."id", a."id" from "tasks" t cross join (values (?::uuid), (?::uuid)) as a("id")
          where t."number" like 'TSK-PERF5K-%'`,
        [viewer.adminUserId, TEST_ADMIN_ID],
      );
      await em.execute(
        `insert into "task_tag_assignments" ("task_id", "tag_id")
         select t."id", g."id"
           from (select "id", row_number() over (order by "number") as n from "tasks" where "number" like 'TSK-PERF5K-%') t
           join (select "id", row_number() over (order by "name") - 1 as k from "task_tags" where "name" like 'perf-tag-%') g
             on g.k in (t.n % 100, (t.n + 33) % 100, (t.n + 66) % 100)`,
      );
    });
  }, 600_000);

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from "tasks" where "number" like 'TSK-PERF%'`);
    await h.em().getConnection().execute(`delete from "task_tags" where "name" like 'perf-tag-%'`);
    await h.em().getConnection().execute(`delete from "projects" where "number" like 'PRJ-PERF-%'`);
    viewer.undo();
    await teardownBackendServer(h);
  }, 600_000);

  async function measure(url: string, check: (body: unknown) => void, runs = iterations): Promise<number> {
    const samples: number[] = [];
    for (let run = 0; run <= runs; run += 1) {
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

  it(`SC-002 (165 T024): the first page under every sort, and My Tasks, < ${sc002Budget} ms p95`, async () => {
    const measured: string[] = [];
    for (const sort of TASK_LIST_SORTS) {
      for (const dir of ['asc', 'desc'] as const) {
        const elapsed = await measure(
          `/api/v1/admin/tasks?limit=50&sort=${sort}&dir=${dir}`,
          (body) => {
            expect(TaskListResponseSchema.parse(body).items).toHaveLength(50);
          },
          sortIterations,
        );
        measured.push(`${sort} ${dir} ${elapsed.toFixed(0)}`);
        expect(elapsed, `${sort} ${dir}`).toBeLessThan(sc002Budget);
      }
    }
    const mine = await measure(
      '/api/v1/admin/tasks/mine',
      (body) => {
        expect(MyTasksResponseSchema.parse(body).data.length).toBeGreaterThan(0);
      },
      sortIterations,
    );
    // eslint-disable-next-line no-console -- the measurement is the output (165 T024).
    console.log(
      `[perf] tasks SC-002, ${freeTasks} free Tasks × 2 assignees × 3 tags beside ${projectCount * tasksPerProject} in Projects: ` +
        `first page p95 ms — ${measured.join('; ')}; GET /tasks/mine p95 ${mine.toFixed(0)} ms`,
    );
    expect(mine).toBeLessThan(sc002Budget);
  }, 600_000);

  it(`SC-002 (165 T091): the board over every Task, and filtered to one tag, < ${sc002Budget} ms p95`, async () => {
    // The board answers a count per column over the whole filtered set and the
    // first cards of each; the viewer sees all ${projectCount * tasksPerProject + freeTasks}.
    const all = await measure(
      '/api/v1/admin/tasks/board',
      (body) => {
        const total = TaskBoardResponseSchema.parse(body).data.columns.reduce((sum, column) => sum + column.count, 0);
        expect(total).toBeGreaterThanOrEqual(freeTasks);
      },
      sortIterations,
    );
    const tag = (
      (await h.em().getConnection().execute(`select "id" from "task_tags" where "name" = 'perf-tag-001'`)) as Array<{
        id: string;
      }>
    )[0]!.id;
    const tagged = await measure(
      `/api/v1/admin/tasks/board?tagId=${tag}`,
      (body) => {
        expect(TaskBoardResponseSchema.parse(body).data.columns.some((column) => column.count > 0)).toBe(true);
      },
      sortIterations,
    );
    // eslint-disable-next-line no-console -- the measurement is the output (165 T091).
    console.log(`[perf] tasks SC-002 board: all p95 ${all.toFixed(0)} ms; one tag p95 ${tagged.toFixed(0)} ms`);
    expect(all).toBeLessThan(sc002Budget);
    expect(tagged).toBeLessThan(sc002Budget);
  }, 600_000);
});
