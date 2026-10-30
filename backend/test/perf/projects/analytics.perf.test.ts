// perf-weight: fast — about 15 s locally (2026-10-27: seeding 1 000 Projects with their Stages, entries and Members, then 7 × 21 figure reads); not yet timed on the CI runner.
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * `specs/163-projects-and-tasks/` T129 — plan *Performance Goals*: each
 * analytics figure answers in under 2 s at 1 000 Projects.
 *
 * 1 000 Projects over the last 300 days — a third open, a third completed, a
 * third lost — each with three Stages, its Stage entries (creation, two or
 * three moves, the close), a value on three in four, and the reader a Member
 * of every one, holding the *Project Manager* Role on half. The module setting
 * is *Members only* and the reader holds no `projects:see_all`, so every
 * statement carries the visibility predicate in its costliest form (the
 * membership `exists`), over the largest visible set. The number recorded is
 * each figure's p95 through the real HTTP route, over a range covering every
 * Project.
 *
 * Tuning knobs (env):
 *   PERF_RUN                           — set to 'true' to run; otherwise skipped.
 *   PERF_PROJECTS_ANALYTICS_PROJECTS   — Projects seeded (default 1 000)
 *   PERF_ITERATIONS                    — reads measured per figure (default 20)
 *   PERF_PROJECTS_ANALYTICS_P95_MS     — p95 budget per figure (default 2 000)
 *
 * ## What the numbers looked like when this landed
 *
 * See the T129 note in `specs/163-projects-and-tasks/tasks.md`.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const projectCount = Number(process.env['PERF_PROJECTS_ANALYTICS_PROJECTS'] ?? '1000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '20');
const p95Budget = Number(process.env['PERF_PROJECTS_ANALYTICS_P95_MS'] ?? '2000');

const FIGURES = ['summary', 'durations', 'time-in-stage', 'losses', 'value', 'top-open', 'managers'] as const;
const PREFIX = 'PRJ-ANPERF-';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!shouldRun)('projects — analytics at 1 000 Projects (T129)', () => {
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
    viewer = await seedCrmAdmin(h.em(), 'perf-projects-analytics', ['projects:read', 'projects:analytics']);

    // One transaction: an open Project needs its current Stage by commit (a
    // deferred check), and the Stage needs the Project first.
    await h.em().transactional(async (em: EntityManager) => {
      await em.execute(
        `insert into "projects" ("id", "number", "title", "created_by_admin_user_id", "created_at",
                                 "value_amount", "value_currency")
         select gen_random_uuid(), ? || lpad(g::text, 6, '0'), 'Analytics perf ' || g, ?,
                now() - make_interval(days => g % 300, hours => g % 24),
                case when g % 4 = 0 then null else (g * 10)::numeric end,
                case when g % 4 = 0 then null when g % 2 = 0 then 'PLN' else 'EUR' end
           from generate_series(1, ?) g`,
        [PREFIX, TEST_ADMIN_ID, projectCount],
      );
      await em.execute(
        `insert into "project_stages" ("project_id", "name", "color", "position")
         select p."id", s.name, '#3b82f6', s.position
           from "projects" p
           cross join (values ('Design', 1), ('Build', 2), ('Handover', 3)) as s(name, position)
          where p."number" like ?`,
        [`${PREFIX}%`],
      );
      // g mod 3: 0 open in Build, 1 completed from Handover, 2 lost in Handover.
      await em.execute(
        `update "projects" p
            set "current_stage_id" = s."id",
                "state" = case substring(p."number" from '\\d+$')::int % 3 when 0 then 'open' when 1 then 'completed' else 'lost' end,
                "closed_at" = case when substring(p."number" from '\\d+$')::int % 3 = 0 then null
                                   else p."created_at" + make_interval(days => 7 + substring(p."number" from '\\d+$')::int % 40) end,
                "lost_stage_id" = case when substring(p."number" from '\\d+$')::int % 3 = 2 then s."id" end,
                "loss_reason_id" = case when substring(p."number" from '\\d+$')::int % 3 = 2
                                        then (select r."id" from "project_loss_reasons" r where r."code" = 'price') end
           from "project_stages" s
          where s."project_id" = p."id" and p."number" like ?
            and s."position" = case when substring(p."number" from '\\d+$')::int % 3 = 0 then 2 else 3 end`,
        [`${PREFIX}%`],
      );
      // The entries: created into Design, moved to Build after 3 days and, when
      // closed, to Handover after 6 and closed at `closed_at`.
      await em.execute(
        `insert into "project_stage_entries" ("project_id", "kind", "from_stage_name", "to_stage_name", "at")
         select p."id", 'enter', null, 'Design', p."created_at" from "projects" p where p."number" like ?
         union all
         select p."id", 'enter', 'Design', 'Build', p."created_at" + interval '3 days' from "projects" p where p."number" like ?
         union all
         select p."id", 'enter', 'Build', 'Handover', p."created_at" + interval '6 days'
           from "projects" p where p."number" like ? and p."state" <> 'open'
         union all
         select p."id", case p."state" when 'completed' then 'close_completed' else 'close_lost' end, 'Handover', null, p."closed_at"
           from "projects" p where p."number" like ? and p."state" <> 'open'`,
        [`${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`, `${PREFIX}%`],
      );
      await em.execute(
        `insert into "project_members" ("project_id", "admin_user_id")
         select p."id", ? from "projects" p where p."number" like ?`,
        [viewer.adminUserId, `${PREFIX}%`],
      );
      await em.execute(
        `insert into "project_member_roles" ("member_id", "role_id")
         select pm."id", (select r."id" from "project_roles" r where r."code" = 'project_manager')
           from "project_members" pm join "projects" p on p."id" = pm."project_id"
          where p."number" like ? and substring(p."number" from '\\d+$')::int % 2 = 0`,
        [`${PREFIX}%`],
      );
    });
    await h.em().getConnection().execute(`analyze "projects", "project_stage_entries", "project_members"`);
  }, 600_000);

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from "projects" where "number" like ?`, [`${PREFIX}%`]);
    viewer.undo();
    await teardownBackendServer(h);
  }, 600_000);

  it(`every figure, for a Member of every Project under "Members only": < ${p95Budget} ms p95`, async () => {
    const range = `from=${day(-400)}&to=${day(1)}`;
    const measured: Record<string, number> = {};
    for (const figure of FIGURES) {
      const samples: number[] = [];
      for (let run = 0; run <= iterations; run += 1) {
        const started = performance.now();
        const response = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/projects/analytics/${figure}?${range}`,
          cookies: viewer.cookies,
        });
        const elapsed = performance.now() - started;
        expect(response.statusCode, response.body).toBe(200);
        // The first read warms the process and is not counted.
        if (run > 0) samples.push(elapsed);
      }
      measured[figure] = p95(samples);
    }
    const summary = (await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/projects/analytics/summary?${range}`,
      cookies: viewer.cookies,
    })).json() as { projectCount: number };
    // Every seeded Project is in the range and visible to the reader.
    expect(summary.projectCount).toBeGreaterThanOrEqual(projectCount);
    // eslint-disable-next-line no-console -- the measurement is the output (T129).
    console.log(
      `[perf] projects analytics, ${projectCount} Projects, members-only viewer of all: ` +
        FIGURES.map((figure) => `${figure} p95 ${measured[figure]!.toFixed(0)} ms`).join('; '),
    );
    for (const figure of FIGURES) expect(measured[figure], figure).toBeLessThan(p95Budget);
  }, 600_000);
});
