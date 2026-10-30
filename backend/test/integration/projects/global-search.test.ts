import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskDetailResponseSchema, type ProjectDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCrmAdmin, seedCrmOrganization } from '../../helpers/seed-crm.js';
import {
  callTasks,
  createProject,
  createStageTask,
  deleteProjectTasks,
  deleteProjects,
  setProjectsVisibility,
  stageNamed,
} from './helpers.js';

/**
 * Admin global search over Projects and Tasks (`specs/163-projects-and-tasks/`
 * FR-041, T131; `contracts/admin-surfaces.md` §6).
 *
 * `projects.project` matches a Project's number, title and Organization names
 * and answers only Projects `ProjectAccess` lets the reader see; `tasks.task`
 * matches a Task's number and title and answers only Tasks whose context the
 * reader may see (research R-9). Each group is absent while its module is off,
 * and a Project's Tasks leave the Tasks group with the Project's module.
 */
describe('projects and tasks in admin global search (US11)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let member: Person;
  let other: Person;
  let hidden: ProjectDetail;
  let open: ProjectDetail;
  let hiddenTaskId = '';
  let looseTaskId = '';
  const created: string[] = [];
  /** Lower-case alphanumeric: search folds case, and each name of this file carries it. */
  const token = `gsp${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  async function search(cookies: Person['cookies'], q: string, entityType: string) {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${encodeURIComponent(q)}&entityTypes=${entityType}&language=en&limit=25`,
      cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      data: {
        groups: Array<{
          entityType: string;
          hits: Array<{ id: string; title: string; subtitle: string | null; status: { label: string } | null; targetRoute: string }>;
        }>;
      };
    };
    return body.data.groups.find((group) => group.entityType === entityType)?.hits ?? [];
  }
  const ids = async (cookies: Person['cookies'], q: string, entityType: string) =>
    (await search(cookies, q, entityType)).map((hit) => hit.id).sort();

  async function groupTypes(cookies: Person['cookies']): Promise<string[]> {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${token}&language=en`,
      cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: { groups: Array<{ entityType: string }> } }).data.groups.map((g) => g.entityType);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const permissions = ['projects:read', 'projects:write', 'tasks:read', 'tasks:write'];
    member = await seedCrmAdmin(h.em(), 'gs-member', permissions);
    other = await seedCrmAdmin(h.em(), 'gs-other', permissions);
    await setProjectsVisibility(h, 'members');
    const organization = await seedCrmOrganization(h.em(), `ORG${token} Ltd`);
    hidden = await createProject(h, {
      title: `${token} members only`,
      visibility: 'members_and_listed',
      members: [{ adminUserId: member.adminUserId, roleIds: [] }],
    });
    open = await createProject(h, {
      title: `${token} open to all`,
      visibility: 'everyone',
      organizationIds: [organization],
    });
    created.push(hidden.id, open.id);
    hiddenTaskId = (await createStageTask(h, hidden.id, stageNamed(hidden, 'Design'), { title: `${token} hidden task` })).id;
    const loose = await callTasks(h, 'POST', '', { payload: { title: `${token} loose task` } });
    expect(loose.statusCode, loose.body).toBe(201);
    looseTaskId = TaskDetailResponseSchema.parse(loose.json()).data.id;
  });

  afterAll(async () => {
    for (const person of [member, other]) person?.undo();
    await deleteProjectTasks(h, created);
    if (looseTaskId) await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [looseTaskId]);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('a Project is found by title, number and Organization name, as the reader may see it', async () => {
    expect(await ids(member.cookies, token, 'projects.project')).toEqual([hidden.id, open.id].sort());
    // Somebody who may not see the members-only Project is not told of it.
    expect(await ids(other.cookies, token, 'projects.project')).toEqual([open.id]);
    expect(await ids(other.cookies, hidden.number, 'projects.project')).toEqual([]);
    expect(await ids(member.cookies, hidden.number, 'projects.project')).toEqual([hidden.id]);
    expect(await ids(other.cookies, `ORG${token}`, 'projects.project')).toEqual([open.id]);
    // By id, whatever the fields — and only for a reader who may see it.
    expect(await ids(member.cookies, hidden.id, 'projects.project')).toEqual([hidden.id]);
    expect(await ids(other.cookies, hidden.id, 'projects.project')).toEqual([]);
  });

  it('a Project hit names it, its Organizations and its state, and opens its screen', async () => {
    const [hit] = await search(other.cookies, `ORG${token}`, 'projects.project');
    expect(hit).toEqual({
      id: open.id,
      title: `${open.number} · ${open.title}`,
      subtitle: expect.stringContaining(`ORG${token} Ltd`),
      status: { code: 'open', label: 'Open' },
      targetRoute: `/projects/${open.id}`,
    });
  });

  it('a Task is found by title and number, only where its context is visible to the reader', async () => {
    expect(await ids(member.cookies, token, 'tasks.task')).toEqual([hiddenTaskId, looseTaskId].sort());
    expect(await ids(other.cookies, token, 'tasks.task')).toEqual([looseTaskId]);
    const [hit] = await search(member.cookies, `${token} hidden`, 'tasks.task');
    expect(hit).toMatchObject({
      id: hiddenTaskId,
      title: expect.stringMatching(new RegExp(`^TSK-\\d+ · ${token} hidden task$`)),
      status: { code: 'todo', label: 'To do' },
      targetRoute: `/tasks/${hiddenTaskId}`,
    });
    const number = hit!.title.split(' · ')[0]!;
    expect(await ids(member.cookies, number, 'tasks.task')).toEqual([hiddenTaskId]);
    expect(await ids(other.cookies, number, 'tasks.task')).toEqual([]);
  });

  it('the Projects group is absent while projects is off, and its Tasks leave the Tasks group', async () => {
    expect(await groupTypes(member.cookies)).toEqual(expect.arrayContaining(['projects.project', 'tasks.task']));
    await withModuleOff('projects', 'deactivated', async () => {
      expect(await groupTypes(member.cookies)).not.toContain('projects.project');
      // A Task whose context's owner is off is hidden (fail-closed, R-9).
      expect(await ids(member.cookies, token, 'tasks.task')).toEqual([looseTaskId]);
    });
    expect(await ids(member.cookies, token, 'projects.project')).toEqual([hidden.id, open.id].sort());
  });

  it('the Tasks group is absent while tasks is off; the Projects group stays', async () => {
    await withModuleOff('tasks', 'deactivated', async () => {
      const types = await groupTypes(member.cookies);
      expect(types).not.toContain('tasks.task');
      expect(types).toContain('projects.project');
    });
    expect(await ids(member.cookies, token, 'tasks.task')).toEqual([hiddenTaskId, looseTaskId].sort());
  });
});
