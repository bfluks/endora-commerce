import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects, errorShape, moveProject, stageNamed } from './helpers.js';

/**
 * A write and an Organization added by somebody else at the same moment
 * (`specs/163-projects-and-tasks/` T144 F3; FR-004, FR-020).
 *
 * A write loads its Project through `ProjectAccess.loadVisible` before its
 * Command; if another administrator adds an Organization out of the writer's
 * reach in between, the Command must refuse under its lock as if the Project
 * did not exist, and the answer after a committed write must not carry an
 * Organization out of the writer's reach either. Neither is measured with a
 * timing race: the other administrator's write is made by a hook on the shared
 * `projectsAccess` singleton, between the load and the lock, or between the
 * commit and the answer.
 */
describe('projects — a write and an Organization added out of the writer’s reach (T144 F3)', () => {
  let h: BackendServerHandle;
  type Access = {
    loadVisible: (id: string) => Promise<unknown>;
    rowAfterWrite: (id: string) => Promise<unknown>;
  };
  let access: Access;
  const original: Partial<Access> = {};
  let orgA: string;
  let orgB: string;
  const orgBName = `Out of reach ${randomUUID().slice(0, 8)}`;
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const created: string[] = [];

  async function addOrgB(projectId: string): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(`insert into "project_organizations" ("project_id", "organization_id") values (?, ?)`, [projectId, orgB]);
  }

  async function titleOf(projectId: string): Promise<string> {
    const [row] = (await h.em().getConnection().execute(`select "title" from "projects" where "id" = ?`, [projectId])) as Array<{
      title: string;
    }>;
    return row!.title;
  }

  async function projectOfA(title: string): Promise<ProjectDetail> {
    const project = await createProject(h, { title, organizationIds: [orgA], visibility: 'everyone' });
    created.push(project.id);
    return project;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    access = h.container.resolve<Access>('projectsAccess');
    original.loadVisible = access.loadVisible;
    original.rowAfterWrite = access.rowAfterWrite;
    orgA = await seedCrmOrganization(h.em(), `Reach A ${randomUUID().slice(0, 8)}`);
    orgB = await seedCrmOrganization(h.em(), orgBName);
    rep = await seedCrmSalesRep(h.em(), [orgA], ['projects:read', 'projects:write']);
  });

  afterEach(() => {
    access.loadVisible = original.loadVisible!;
    access.rowAfterWrite = original.rowAfterWrite!;
  });

  afterAll(async () => {
    rep.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  /** Between `loadVisible` and the Command's lock, somebody else adds Organization B. */
  function orgBAddedAfterLoad(): void {
    const load = original.loadVisible!;
    access.loadVisible = async function (this: unknown, id: string) {
      const row = await load.call(access, id);
      await addOrgB(id);
      return row;
    };
  }

  it('a field edit refuses under its lock, as if the Project did not exist, and writes nothing', async () => {
    const project = await projectOfA('Edited while B is added');
    orgBAddedAfterLoad();
    const refused = await callProjects(h, 'PATCH', `/${project.id}`, {
      cookies: rep.cookies,
      payload: { title: 'Should not land', version: project.version },
    });
    const missing = await callProjects(h, 'PATCH', `/${randomUUID()}`, {
      cookies: rep.cookies,
      payload: { title: 'Should not land', version: project.version },
    });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorShape(refused.body)).toEqual(errorShape(missing.body));
    expect(await titleOf(project.id)).toBe('Edited while B is added');
  });

  it('a move refuses under its lock the same way', async () => {
    const project = await projectOfA('Moved while B is added');
    orgBAddedAfterLoad();
    const refused = await moveProject(h, project.id, stageNamed(project, 'Build'), project.version, rep.cookies);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    const [row] = (await h
      .em()
      .getConnection()
      .execute(`select "current_stage_id" from "projects" where "id" = ?`, [project.id])) as Array<{
      current_stage_id: string;
    }>;
    expect(row!.current_stage_id).toBe(stageNamed(project, 'Design'));
  });

  it('a Stage edit refuses under its lock the same way', async () => {
    const project = await projectOfA('Stage edited while B is added');
    orgBAddedAfterLoad();
    const refused = await callProjects(h, 'PATCH', `/${project.id}/stages/${stageNamed(project, 'Design')}`, {
      cookies: rep.cookies,
      payload: { name: 'Renamed' },
    });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('the answer after a committed write carries nothing of an Organization out of reach', async () => {
    const project = await projectOfA('Answered after B is added');
    // Between the commit and the answer, somebody else adds Organization B.
    const after = original.rowAfterWrite!;
    access.rowAfterWrite = async function (this: unknown, id: string) {
      await addOrgB(id);
      return after.call(access, id);
    };
    const response = await callProjects(h, 'PATCH', `/${project.id}`, {
      cookies: rep.cookies,
      payload: { title: 'Landed', version: project.version },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(response.body).not.toContain(orgBName);
    expect(response.body).not.toContain(orgB);
    // The write itself committed before B arrived.
    expect(await titleOf(project.id)).toBe('Landed');
  });

  it('a representative who makes a Project internal is told so, and is shown nothing of it', async () => {
    const project = await projectOfA('Made internal by the rep');
    const response = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
      cookies: rep.cookies,
      payload: { organizationIds: [] },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ data: { id: project.id, outOfReach: true } });
    // Out of their reach from now on; the administrator sees it internal.
    expect((await callProjects(h, 'GET', `/${project.id}`, { cookies: rep.cookies })).statusCode).toBe(404);
    const internal = await callProjects(h, 'GET', `/${project.id}`);
    expect(internal.statusCode, internal.body).toBe(200);
    expect(internal.json().data.organizations).toEqual([]);
  });

  it('an administrator unrestricted in reach who makes a Project internal gets its detail', async () => {
    const project = await projectOfA('Made internal by the admin');
    const response = await callProjects(h, 'PUT', `/${project.id}/organizations`, { payload: { organizationIds: [] } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({ id: project.id, title: 'Made internal by the admin', organizations: [] });
  });
});
