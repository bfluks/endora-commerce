import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectListResponse, ProjectSummary } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';

/**
 * Organization reach over Projects — FR-004, owner ruling Q1 = C,
 * `specs/163-projects-and-tasks/research.md` R-2.
 *
 * A Project belongs to zero or more Organizations, and an administrator whose
 * reach is a set of Organizations (a sales representative) sees a Project only
 * when **every** one of its Organizations is in that set; an internal Project
 * (no Organization) is visible only to administrators unrestricted in reach.
 * Out of reach answers exactly as a Project that does not exist does — in the
 * list, in its total, and by id.
 *
 * The Projects here are written by hand, in one transaction each, because no
 * write route exists yet (Phase 2). Each is `visibility = 'everyone'`, so the
 * visibility rule (R-3) lets every reader through and the Organization rule is
 * the only thing measured.
 */
describe('projects — Organization reach (Q1 = C)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/projects';

  let orgA: string;
  let orgB: string;
  let rep: { cookies: { b2b_session: string }; undo: () => void };
  /** Organizations A and B — the representative reaches A only. */
  let twoOrgs: string;
  /** No Organization. */
  let internal: string;
  /** Organization A alone — the representative's positive control. */
  let onlyA: string;
  const created: string[] = [];

  async function insertProject(title: string, organizationIds: string[]): Promise<string> {
    const projectId = randomUUID();
    const stageId = randomUUID();
    const connection = h.orm.em.getConnection();
    await connection.transactional(async (trx) => {
      await connection.execute(
        `insert into "projects" ("id", "number", "title", "visibility", "created_by_admin_user_id")
         values (?, ?, ?, 'everyone', ?)`,
        [projectId, `PRJ-R${projectId.slice(0, 8)}`, title, TEST_ADMIN_ID],
        'run',
        trx,
      );
      await connection.execute(
        `insert into "project_stages" ("id", "project_id", "name", "color", "position") values (?, ?, 'Design', '#3b82f6', 1)`,
        [stageId, projectId],
        'run',
        trx,
      );
      await connection.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, projectId], 'run', trx);
      for (const organizationId of organizationIds) {
        await connection.execute(
          `insert into "project_organizations" ("project_id", "organization_id") values (?, ?)`,
          [projectId, organizationId],
          'run',
          trx,
        );
      }
    });
    created.push(projectId);
    return projectId;
  }

  async function list(cookies: Record<string, string>): Promise<{ ids: string[]; total: number }> {
    const ids: string[] = [];
    let cursor: string | null = null;
    let total = -1;
    do {
      const response = await h.app.inject({
        method: 'GET',
        url: `${API}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      const page = response.json() as ProjectListResponse;
      ids.push(...page.items.map((item: ProjectSummary) => item.id));
      total = page.total;
      cursor = page.nextCursor;
    } while (cursor);
    return { ids, total };
  }

  function detail(id: string, cookies: Record<string, string>) {
    return h.app.inject({ method: 'GET', url: `${API}/${id}`, cookies });
  }

  /** A 404's body without its request id, which differs per request by design. */
  function notFoundShape(body: string) {
    const parsed = JSON.parse(body) as { error: Record<string, unknown> };
    const { requestId: _requestId, ...rest } = parsed.error;
    return rest;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    orgA = await seedCrmOrganization(em, 'projects reach A');
    orgB = await seedCrmOrganization(em, 'projects reach B');
    rep = await seedCrmSalesRep(em, [orgA], ['projects:read']);
    twoOrgs = await insertProject('reach: A and B', [orgA, orgB]);
    internal = await insertProject('reach: internal', []);
    onlyA = await insertProject('reach: A only', [orgA]);
  });

  afterAll(async () => {
    rep?.undo();
    if (created.length > 0) {
      await h.orm.em
        .getConnection()
        .execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  it('positive control: the representative sees a Project of the one Organization they reach', async () => {
    const response = await detail(onlyA, rep.cookies);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { data: ProjectSummary };
    expect(body.data).toMatchObject({ id: onlyA, title: 'reach: A only', state: 'open' });
    expect(body.data.organizations.map((o) => o.id)).toEqual([orgA]);
  });

  it('a representative reaching one of a Project’s two Organizations gets nothing — 404, identical to a missing id', async () => {
    const hidden = await detail(twoOrgs, rep.cookies);
    const missing = await detail(randomUUID(), rep.cookies);
    expect(hidden.statusCode, hidden.body).toBe(404);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(notFoundShape(hidden.body)).toEqual(notFoundShape(missing.body));
    expect(notFoundShape(hidden.body)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('an internal Project is out of a representative’s reach — 404, identical to a missing id', async () => {
    const hidden = await detail(internal, rep.cookies);
    const missing = await detail(randomUUID(), rep.cookies);
    expect(hidden.statusCode, hidden.body).toBe(404);
    expect(notFoundShape(hidden.body)).toEqual(notFoundShape(missing.body));
  });

  it('the representative’s list and its total hold only the Project they reach', async () => {
    const { ids, total } = await list(rep.cookies);
    expect(ids).toContain(onlyA);
    expect(ids).not.toContain(twoOrgs);
    expect(ids).not.toContain(internal);
    // Organization A is this file's own, so nothing another file wrote is in reach.
    expect(ids).toEqual([onlyA]);
    expect(total).toBe(1);
  });

  it('an administrator unrestricted in reach sees all three, internal included', async () => {
    const { ids, total } = await list(admin);
    expect(ids).toEqual(expect.arrayContaining([twoOrgs, internal, onlyA]));
    expect(total).toBe(ids.length);
    for (const id of [twoOrgs, internal, onlyA]) {
      const response = await detail(id, admin);
      expect(response.statusCode, response.body).toBe(200);
    }
    const internalBody = (await detail(internal, admin)).json() as { data: ProjectSummary };
    expect(internalBody.data.organizations).toEqual([]);
    const twoBody = (await detail(twoOrgs, admin)).json() as { data: ProjectSummary };
    expect(twoBody.data.organizations.map((o) => o.id).sort()).toEqual([orgA, orgB].sort());
  });

  it('a malformed id answers as a missing one', async () => {
    const malformed = await detail('not-a-uuid', admin);
    const missing = await detail(randomUUID(), admin);
    expect(malformed.statusCode, malformed.body).toBe(404);
    expect(notFoundShape(malformed.body)).toEqual(notFoundShape(missing.body));
  });
});
