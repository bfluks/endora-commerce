import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectRoleResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects, dictionaryIds } from './helpers.js';

/**
 * A Project Role grants nothing (`specs/163-projects-and-tasks/`, User Story 4
 * scenario 4, FR-009): a Role is a label a Member holds on one Project. Holding
 * every Role there is — the two seeded ones and one the operator added — on a
 * Project leaves the person's permission set exactly what their RBAC role
 * says, and every write their RBAC role does not allow is still refused.
 */
describe('projects — a Project Role grants no permission (FR-009)', () => {
  let h: BackendServerHandle;
  let person: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let installerId: string;
  const projects: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    person = await seedCrmAdmin(h.em(), 'role-holder', ['projects:read']);
  });

  afterAll(async () => {
    person.undo();
    await deleteProjects(h, projects);
    if (installerId) {
      await h.em().getConnection().execute(`delete from "project_roles" where "id" = ?`, [installerId]);
    }
    await teardownBackendServer(h);
  });

  it('assigning every Role, an operator-added one included, leaves listPermissions unchanged', async () => {
    const before = [...(await h.permissionService.listPermissions(person.adminUserId))].sort();
    expect(before).toEqual(['projects:read']);

    const added = await callProjects(h, 'POST', '/roles', {
      payload: { defaultName: 'Installer', name: { en: 'Installer', pl: 'Instalator' } },
    });
    expect(added.statusCode, added.body).toBe(201);
    installerId = ProjectRoleResponseSchema.parse(added.json()).data.id;

    const seeded = await dictionaryIds(h, 'project_roles');
    const project = await createProject(h, {
      title: 'Every role at once',
      visibility: 'members_and_listed',
      members: [{ adminUserId: person.adminUserId, roleIds: [seeded.sales_rep!, seeded.project_manager!, installerId] }],
    });
    projects.push(project.id);
    expect(project.members.find((m) => m.adminUser.id === person.adminUserId)?.roles.map((r) => r.id).sort()).toEqual(
      [seeded.sales_rep, seeded.project_manager, installerId].sort(),
    );

    expect([...(await h.permissionService.listPermissions(person.adminUserId))].sort()).toEqual(before);
    for (const code of ['projects:write', 'projects:configure', 'projects:see_all']) {
      expect(await h.permissionService.hasPermission(person.adminUserId, code), code).toBe(false);
    }
  });

  it('a Project Manager by Role still cannot write the Project, nor configure — 403', async () => {
    const [projectId] = projects;
    const read = await callProjects(h, 'GET', `/${projectId}`, { cookies: person.cookies });
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { data: { permissions: unknown } }).data.permissions).toEqual({
      canWrite: false,
      canConfigure: false,
    });
    const edit = await callProjects(h, 'PATCH', `/${projectId}`, { cookies: person.cookies, payload: { title: 'Mine now' } });
    expect(edit.statusCode, edit.body).toBe(403);
    const configure = await callProjects(h, 'POST', '/roles', {
      cookies: person.cookies,
      payload: { defaultName: 'Self-made', name: {} },
    });
    expect(configure.statusCode, configure.body).toBe(403);
  });
});
