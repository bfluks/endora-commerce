import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MyTasksResponseSchema,
  RecordDocumentLookupResponseSchema,
  TaskListResponseSchema,
  type AuditReferenceRegistryPort,
  type ProjectDetail,
  type ProjectReadPort,
} from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import {
  callProjects,
  callTasks,
  createProject,
  createStageTask,
  deleteProjects,
  deleteProjectTasks,
  stageNamed,
  taskRowsOf,
} from './helpers.js';

/**
 * User Story 2 — a Task in a Project is the Project's to show (spec US2
 * scenario 6, FR-020, FR-031, research R-9).
 *
 * Under the setting *Members only* a Project Task is in the Tasks list, in
 * *My Tasks* and by id only for somebody who may see the Project; everybody
 * else is answered as if it did not exist. With Projects switched off its
 * Tasks are absent from the Tasks module, and back when it is on. Deleting a
 * Project deletes its Tasks.
 */
describe('projects — the `project` Task context (US2)', () => {
  let h: BackendServerHandle;
  let member: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let outsider: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let project: ProjectDetail;
  let forMember: string;
  let forOutsider: string;
  let free: string;
  const created: string[] = [];

  const PERMISSIONS = ['projects:read', 'tasks:read', 'tasks:write'];

  async function listed(cookies: { b2b_session: string }): Promise<string[]> {
    const response = await callTasks(h, 'GET', '?limit=100', { cookies });
    expect(response.statusCode, response.body).toBe(200);
    return TaskListResponseSchema.parse(response.json()).items.map((t) => t.id);
  }

  async function mine(cookies: { b2b_session: string }): Promise<string[]> {
    const response = await callTasks(h, 'GET', '/mine', { cookies });
    expect(response.statusCode, response.body).toBe(200);
    return MyTasksResponseSchema.parse(response.json()).data.map((t) => t.id);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const write = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.visibility/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: 'members' },
    });
    expect(write.statusCode, write.body).toBeLessThan(400);
    member = await seedCrmAdmin(h.em(), 'ctx-member', PERMISSIONS);
    outsider = await seedCrmAdmin(h.em(), 'ctx-outsider', PERMISSIONS);
    project = await createProject(h, {
      title: 'Members only',
      members: [{ adminUserId: member.adminUserId, roleIds: [] }],
    });
    created.push(project.id);
    const design = stageNamed(project, 'Design');
    forMember = (await createStageTask(h, project.id, design, { title: 'For the member', assignedAdminUserId: member.adminUserId })).id;
    // Assigned to somebody who may not see the Project: still not theirs to see.
    forOutsider = (await createStageTask(h, project.id, design, { title: 'For the outsider', assignedAdminUserId: outsider.adminUserId })).id;
    const response = await callTasks(h, 'POST', '', { payload: { title: 'Free-standing', assignedAdminUserId: outsider.adminUserId } });
    expect(response.statusCode, response.body).toBe(201);
    free = response.json().data.id;
  });

  afterAll(async () => {
    member.undo();
    outsider.undo();
    await deleteProjectTasks(h, created);
    await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [free]);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('a Member sees the Project’s Tasks in the list, in My Tasks and by id', async () => {
    expect(await listed(member.cookies)).toEqual(expect.arrayContaining([forMember, forOutsider]));
    expect(await mine(member.cookies)).toContain(forMember);
    const one = await callTasks(h, 'GET', `/${forMember}`, { cookies: member.cookies });
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().data.context).toMatchObject({ type: 'project', id: project.id, label: `${project.number} Members only` });
  });

  it('somebody who may not see the Project does not see its Tasks anywhere — not even one assigned to them', async () => {
    const theirs = await listed(outsider.cookies);
    expect(theirs).toContain(free);
    expect(theirs).not.toContain(forMember);
    expect(theirs).not.toContain(forOutsider);
    expect(await mine(outsider.cookies)).toEqual([free]);
    for (const id of [forMember, forOutsider]) {
      const one = await callTasks(h, 'GET', `/${id}`, { cookies: outsider.cookies });
      expect(one.statusCode).toBe(404);
      expect(one.json().error.code).toBe('TASK_NOT_FOUND');
      const edit = await callTasks(h, 'PATCH', `/${id}`, { cookies: outsider.cookies, payload: { status: 'done' } });
      expect(edit.statusCode).toBe(404);
    }
    // Nor can they put a Task into it.
    const into = await callTasks(h, 'POST', '', {
      cookies: outsider.cookies,
      payload: {
        title: 'Sneaking in',
        context: { contextType: 'project', contextId: project.id, contextGroupId: stageNamed(project, 'Design') },
      },
    });
    expect(into.statusCode, into.body).toBe(422);
    expect(into.json().error.code).toBe('TASK_CONTEXT_INVALID');
  });

  it('somebody with `tasks:read` but not `projects:read` sees no Project Task, label or Stage anywhere (T144 F1)', async () => {
    const token = `tro${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const tasksOnly = await seedCrmAdmin(h.em(), 'ctx-tasks-only', ['tasks:read', 'tasks:write', 'crm:read', 'crm:write']);
    try {
      // Open to everyone who may read Projects: only the missing `projects:read` hides it.
      const open = await createProject(h, { title: `Open ${token}`, visibility: 'everyone' });
      created.push(open.id);
      const task = await createStageTask(h, open.id, stageNamed(open, 'Design'), {
        title: `Task ${token}`,
        assignedAdminUserId: tasksOnly.adminUserId,
      });

      expect(await listed(tasksOnly.cookies)).not.toContain(task.id);
      expect(await mine(tasksOnly.cookies)).not.toContain(task.id);
      const one = await callTasks(h, 'GET', `/${task.id}`, { cookies: tasksOnly.cookies });
      expect(one.statusCode, one.body).toBe(404);
      expect(one.json().error.code).toBe('TASK_NOT_FOUND');

      const search = async (cookies: { b2b_session: string }) => {
        const response = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/global-search?q=${token}&entityTypes=tasks.task&language=en&limit=25`,
          cookies,
        });
        expect(response.statusCode, response.body).toBe(200);
        const groups = (response.json() as { data: { groups: Array<{ entityType: string; hits: Array<{ id: string }> }> } })
          .data.groups;
        return groups.flatMap((group) => group.hits.map((hit) => hit.id));
      };
      // Not vacuous: the harness's administrator finds it.
      expect(await search({ b2b_session: 'stub-admin-session' })).toContain(task.id);
      expect(await search(tasksOnly.cookies)).not.toContain(task.id);

      const documents = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/crm/lookups/documents?q=${token}`,
        cookies: tasksOnly.cookies,
      });
      expect(documents.statusCode, documents.body).toBe(200);
      const groups = RecordDocumentLookupResponseSchema.parse(documents.json()).groups;
      expect(groups.flatMap((group) => group.items.map((item) => item.id))).not.toContain(task.id);

      const as = <T>(body: () => Promise<T>) =>
        runWithTenantContext(
          resolveTenantContext({ kind: 'admin', adminUserId: tasksOnly.adminUserId }, { allowAll: true, allowedOrganizationIds: [] }),
          body,
        );
      expect(await as(() => h.container.resolve<ProjectReadPort>('projectReadPort').findById(open.id))).toBeNull();
      const labels = await as(() =>
        h.container.resolve<AuditReferenceRegistryPort>('auditReferenceRegistry').resolve('project', [open.id]),
      );
      expect(labels.has(open.id)).toBe(false);
    } finally {
      tasksOnly.undo();
    }
  });

  it('a Task that left a Project keeps no trace of it in the history of a reader who may not see the Project (T144 F4)', async () => {
    const leaving = await createStageTask(h, project.id, stageNamed(project, 'Design'), { title: 'Leaves the project' });
    const detached = await callTasks(h, 'PATCH', `/${leaving.id}`, { payload: { context: null } });
    expect(detached.statusCode, detached.body).toBe(200);
    const historyOf = async (cookies: { b2b_session: string }) => {
      const response = await callTasks(h, 'GET', `/${leaving.id}/history?limit=50`, { cookies });
      expect(response.statusCode, response.body).toBe(200);
      return response;
    };
    const theirs = await historyOf(outsider.cookies);
    expect(theirs.body).not.toContain(project.id);
    expect(theirs.body).not.toContain(stageNamed(project, 'Design'));
    const create = (theirs.json() as { data: Array<{ action: string; after: Record<string, unknown> | null }> }).data.find(
      (entry) => entry.action === 'tasks.task.create',
    );
    expect(create?.after).toMatchObject({ contextId: null, contextGroupId: null });
    // Somebody who sees the Project sees where the Task was.
    expect((await historyOf(member.cookies)).body).toContain(project.id);
    await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [leaving.id]);
  });

  it('taking a Task out of a Project needs projects:write on it — tasks:write alone does not (T144 info item)', async () => {
    const writer = await seedCrmAdmin(h.em(), 'ctx-task-writer', ['projects:read', 'tasks:read', 'tasks:write']);
    try {
      const open = await createProject(h, { title: 'Open to every reader', visibility: 'everyone' });
      const other = await createProject(h, { title: 'Another open one', visibility: 'everyone' });
      created.push(open.id, other.id);
      const task = await createStageTask(h, open.id, stageNamed(open, 'Design'), { title: 'Stays put' });
      const inProject = { contextType: 'project', contextId: open.id };

      const detach = await callTasks(h, 'PATCH', `/${task.id}`, { cookies: writer.cookies, payload: { context: null } });
      expect(detach.statusCode, detach.body).toBe(422);
      expect(detach.json().error.code).toBe('TASK_CONTEXT_INVALID');
      const move = await callTasks(h, 'PATCH', `/${task.id}`, {
        cookies: writer.cookies,
        payload: { context: { contextType: 'project', contextId: other.id, contextGroupId: stageNamed(other, 'Design') } },
      });
      expect(move.statusCode, move.body).toBe(422);
      expect(move.json().error.code).toBe('TASK_CONTEXT_INVALID');
      const [row] = await taskRowsOf(h, open.id);
      expect(row?.id).toBe(task.id);

      // Within the Project, from one Stage to another, is the Task's own edit.
      const restaged = await callTasks(h, 'PATCH', `/${task.id}`, {
        cookies: writer.cookies,
        payload: { context: { ...inProject, contextGroupId: stageNamed(open, 'Build') } },
      });
      expect(restaged.statusCode, restaged.body).toBe(200);
      // A holder of projects:write may take it out.
      const out = await callTasks(h, 'PATCH', `/${task.id}`, { payload: { context: null } });
      expect(out.statusCode, out.body).toBe(200);
      await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [task.id]);
    } finally {
      writer.undo();
    }
  });

  it('putting a Task into a Project, and deleting a Project Task, need projects:write on it too (T147, #472)', async () => {
    const writer = await seedCrmAdmin(h.em(), 'ctx-task-putter', ['projects:read', 'tasks:read', 'tasks:write']);
    try {
      const open = await createProject(h, { title: 'Open to every reader, again', visibility: 'everyone' });
      created.push(open.id);
      const into = { contextType: 'project', contextId: open.id, contextGroupId: stageNamed(open, 'Design') };

      // Created inside the Project: refused.
      const create = await callTasks(h, 'POST', '', {
        cookies: writer.cookies,
        payload: { title: 'Created into a project', context: into },
      });
      expect(create.statusCode, create.body).toBe(422);
      expect(create.json().error.code).toBe('TASK_CONTEXT_INVALID');

      // A Task of nobody's, moved into the Project: refused, and it stays where it was.
      const loose = await callTasks(h, 'POST', '', { cookies: writer.cookies, payload: { title: 'Loose' } });
      expect(loose.statusCode, loose.body).toBe(201);
      const looseId = (loose.json() as { data: { id: string } }).data.id;
      const attach = await callTasks(h, 'PATCH', `/${looseId}`, { cookies: writer.cookies, payload: { context: into } });
      expect(attach.statusCode, attach.body).toBe(422);
      expect(attach.json().error.code).toBe('TASK_CONTEXT_INVALID');
      expect(await taskRowsOf(h, open.id)).toEqual([]);

      // A Project Task they see: deleting it is refused, and it stays.
      const task = await createStageTask(h, open.id, stageNamed(open, 'Design'), { title: 'Not theirs to delete' });
      const seen = await callTasks(h, 'GET', `/${task.id}`, { cookies: writer.cookies });
      expect(seen.statusCode, seen.body).toBe(200);
      // The detail says so, so the screen offers no Delete; to a projects:write holder it says yes.
      expect((seen.json() as { data: { context: { canChangeTasks: boolean } } }).data.context.canChangeTasks).toBe(false);
      const asWriter = await callTasks(h, 'GET', `/${task.id}`);
      expect((asWriter.json() as { data: { context: { canChangeTasks: boolean } } }).data.context.canChangeTasks).toBe(true);
      const removal = await callTasks(h, 'DELETE', `/${task.id}`, { cookies: writer.cookies });
      expect(removal.statusCode, removal.body).toBe(403);
      expect(removal.json().error.code).toBe('FORBIDDEN');
      expect((await taskRowsOf(h, open.id)).map((row) => row.id)).toEqual([task.id]);

      // A Task of nobody's is theirs to delete; a holder of projects:write may do all three.
      expect((await callTasks(h, 'DELETE', `/${looseId}`, { cookies: writer.cookies })).statusCode).toBe(204);
      const putIn = await callTasks(h, 'POST', '', { payload: { title: 'Put in by a projects writer', context: into } });
      expect(putIn.statusCode, putIn.body).toBe(201);
      for (const id of [task.id, (putIn.json() as { data: { id: string } }).data.id]) {
        const deleted = await callTasks(h, 'DELETE', `/${id}`);
        expect(deleted.statusCode, deleted.body).toBe(204);
      }
    } finally {
      writer.undo();
    }
  });

  it('with Projects off its Tasks are absent from Tasks; on again, they are back', async () => {
    await withModulesDeactivated(['projects'], async () => {
      expect(await listed(member.cookies)).not.toContain(forMember);
      expect(await mine(member.cookies)).not.toContain(forMember);
      expect((await callTasks(h, 'GET', `/${forMember}`, { cookies: member.cookies })).statusCode).toBe(404);
    });
    expect(await listed(member.cookies)).toContain(forMember);
    expect((await callTasks(h, 'GET', `/${forMember}`, { cookies: member.cookies })).statusCode).toBe(200);
  });

  it('deleting a Project deletes its Tasks', async () => {
    const doomed = await createProject(h, { title: 'Doomed' });
    created.push(doomed.id);
    await createStageTask(h, doomed.id, stageNamed(doomed, 'Design'), { title: 'Goes with it' });
    await createStageTask(h, doomed.id, stageNamed(doomed, 'Build'), { title: 'Goes too' });
    expect(await taskRowsOf(h, doomed.id)).toHaveLength(2);

    const response = await callProjects(h, 'DELETE', `/${doomed.id}`);
    expect(response.statusCode, response.body).toBe(204);
    expect(await taskRowsOf(h, doomed.id)).toEqual([]);
  });

  it('a Stage that holds a Task cannot be deleted — 409 PROJECT_STAGE_HAS_TASKS', async () => {
    const response = await callProjects(h, 'DELETE', `/${project.id}/stages/${stageNamed(project, 'Design')}`);
    // Design is current too; Build holds no Task and goes.
    expect(response.statusCode).toBe(409);
    const holder = await createProject(h, { title: 'Stage holds a Task' });
    created.push(holder.id);
    await createStageTask(h, holder.id, stageNamed(holder, 'Build'), { title: 'Keeps the Stage' });
    const refused = await callProjects(h, 'DELETE', `/${holder.id}/stages/${stageNamed(holder, 'Build')}`);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('PROJECT_STAGE_HAS_TASKS');
    const free = await callProjects(h, 'DELETE', `/${holder.id}/stages/${stageNamed(holder, 'Handover')}`);
    expect(free.statusCode, free.body).toBe(204);
  });
});
