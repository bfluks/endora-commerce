// perf-weight: fast — about 25 s locally (2026-10-27: seeding 1 000 Projects with their Stages, Organizations and Members, then 9 × 21 list reads); not yet timed on the CI runner.
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin, seedCrmOrganization } from '../../helpers/seed-crm.js';

/**
 * `specs/163-projects-and-tasks/` T137 — SC-008: the Projects list, filtered
 * or not, answers in under 2 s at 1 000 Projects.
 *
 * 1 000 Projects over the last 300 days across five Organizations — a third
 * open, a third completed, a third lost — each with three Stages (`Design`,
 * `Build`, `Handover`), a current Stage with a deadline, a value on three in
 * four, and the reader a Member of every one, holding the *Project Manager*
 * Role on half. The module setting is *Members only* and the reader holds no
 * `projects:see_all`, so every read carries the visibility predicate in its
 * costliest form (the membership `exists`) over the largest visible set — and
 * every page also counts that set (`total`). The number recorded is each
 * request's p95 through the real HTTP route.
 *
 * Tuning knobs (env):
 *   PERF_RUN                       — set to 'true' to run; otherwise skipped.
 *   PERF_PROJECTS_LIST_PROJECTS    — Projects seeded (default 1 000)
 *   PERF_ITERATIONS                — reads measured per request (default 20)
 *   PERF_PROJECTS_LIST_P95_MS      — p95 budget per request (default 2 000)
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const projectCount = Number(process.env['PERF_PROJECTS_LIST_PROJECTS'] ?? '1000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '20');
const p95Budget = Number(process.env['PERF_PROJECTS_LIST_P95_MS'] ?? '2000');

const PREFIX = 'PRJ-LSPERF-';
const ORGANIZATIONS = 5;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

describe.skipIf(!shouldRun)('projects — the list at 1 000 Projects (T137, SC-008)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let organizationIds: string[];
  let projectManagerRoleId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const setting = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.visibility/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: 'members' },
    });
    expect(setting.statusCode, setting.body).toBeLessThan(400);
    viewer = await seedCrmAdmin(h.em(), 'perf-projects-list', ['projects:read']);
    organizationIds = [];
    for (let index = 0; index < ORGANIZATIONS; index += 1) {
      organizationIds.push(await seedCrmOrganization(h.em(), `perf-projects-list-${index}`));
    }

    // One transaction: an open Project needs its current Stage by commit (a
    // deferred check), and the Stage needs the Project first.
    await h.em().transactional(async (em: EntityManager) => {
      await em.execute(
        `insert into "projects" ("id", "number", "title", "created_by_admin_user_id", "created_at",
                                 "value_amount", "value_currency")
         select gen_random_uuid(), ? || lpad(g::text, 6, '0'), 'List perf ' || g, ?,
                now() - make_interval(days => g % 300, hours => g % 24),
                case when g % 4 = 0 then null else (g * 10)::numeric end,
                case when g % 4 = 0 then null when g % 2 = 0 then 'PLN' else 'EUR' end
           from generate_series(1, ?) g`,
        [PREFIX, TEST_ADMIN_ID, projectCount],
      );
      await em.execute(
        `insert into "project_stages" ("project_id", "name", "color", "position", "started_on", "deadline_on")
         select p."id", s.name, '#3b82f6', s.position,
                p."created_at"::date, p."created_at"::date + 14 * s.position
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
      await em.execute(
        `insert into "project_organizations" ("project_id", "organization_id")
         select p."id", (?::uuid[])[1 + substring(p."number" from '\\d+$')::int % ?]
           from "projects" p where p."number" like ?`,
        [`{${organizationIds.join(',')}}`, ORGANIZATIONS, `${PREFIX}%`],
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
    const [role] = (await h
      .em()
      .getConnection()
      .execute(`select "id" from "project_roles" where "code" = 'project_manager'`)) as Array<{ id: string }>;
    projectManagerRoleId = role!.id;
    await h
      .em()
      .getConnection()
      .execute(`analyze "projects", "project_stages", "project_organizations", "project_members", "project_member_roles"`);
  }, 600_000);

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from "projects" where "number" like ?`, [`${PREFIX}%`]);
    viewer.undo();
    await teardownBackendServer(h);
  }, 600_000);

  it(`the list and each filter, for a Member of every Project under "Members only": < ${p95Budget} ms p95`, async () => {
    const reads: Record<string, string> = {
      'first page': '',
      'state open': 'state=open',
      organization: `organizationId=${organizationIds[0]}`,
      'member me': 'memberId=me',
      'role project manager': `roleId=${projectManagerRoleId}`,
      'stage name': 'stageName=Handover',
      search: `q=${encodeURIComponent('List perf 9')}`,
      'sort value': 'sort=value&order=desc',
      'sort deadline, open': 'state=open&sort=deadline&order=asc',
    };
    const measured: Record<string, number> = {};
    const totals: Record<string, number> = {};
    for (const [name, query] of Object.entries(reads)) {
      const samples: number[] = [];
      for (let run = 0; run <= iterations; run += 1) {
        const started = performance.now();
        const response = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/projects?limit=50${query === '' ? '' : `&${query}`}`,
          cookies: viewer.cookies,
        });
        const elapsed = performance.now() - started;
        expect(response.statusCode, response.body).toBe(200);
        if (run === 0) totals[name] = (response.json() as { total: number }).total;
        // The first read warms the process and is not counted.
        if (run > 0) samples.push(elapsed);
      }
      measured[name] = p95(samples);
    }
    // Every seeded Project is visible to the reader, and each filter narrows.
    expect(totals['first page']).toBeGreaterThanOrEqual(projectCount);
    expect(totals['member me']).toBeGreaterThanOrEqual(projectCount);
    expect(totals['organization']).toBe(projectCount / ORGANIZATIONS);
    expect(totals['state open']).toBeLessThan(totals['first page']!);
    expect(totals['role project manager']).toBe(projectCount / 2);
    // eslint-disable-next-line no-console -- the measurement is the output (T137).
    console.log(
      `[perf] projects list, ${projectCount} Projects, members-only viewer of all: ` +
        Object.keys(reads)
          .map((name) => `${name} p95 ${measured[name]!.toFixed(0)} ms (total ${totals[name]})`)
          .join('; '),
    );
    for (const name of Object.keys(reads)) expect(measured[name], name).toBeLessThan(p95Budget);
  }, 600_000);
});
