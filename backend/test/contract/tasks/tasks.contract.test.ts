import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MyTasksResponseSchema,
  RecordHistoryPageSchema,
  TaskAssigneeLookupResponseSchema,
  TaskDetailResponseSchema,
  TaskListResponseSchema,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
  type TaskDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * The Tasks API — every endpoint of
 * `specs/163-projects-and-tasks/contracts/admin-api.md` §1: each answer against
 * its schema, each gate (401 without a session, 403 without the code), and each
 * refusal by its code.
 *
 * A probe context type, `contract_probe`, is owned by `crm` (a module that is
 * on) for the length of the file: it lists one id as visible, with one group.
 */
describe('tasks (contract) — §1 Tasks', () => {
  let h: BackendServerHandle;
  let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let nobody: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const shown = randomUUID();
  const shownGroup = randomUUID();
  /** The probe owner's answer to `canChangeTasks` — whether a Task may go into, out of or be deleted from its record. */
  let mayChangeTasks = true;
  const created: string[] = [];

  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  function call(
    method: Method,
    path: string,
    options: { payload?: unknown; cookies?: Record<string, string> | null } = {},
  ): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      ...(options.cookies === null ? {} : { cookies: options.cookies ?? admin }),
      ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
    });
  }

  function code(response: LightMyRequestResponse): string {
    return (response.json() as { error: { code: string } }).error.code;
  }

  async function create(body: Record<string, unknown>): Promise<TaskDetail> {
    const response = await call('POST', '', { payload: body });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    reader = await seedCrmAdmin(h.em(), 'tasks-reader', ['tasks:read']);
    nobody = await seedCrmAdmin(h.em(), 'tasks-nobody', ['orders:read']);
    const probe: TaskContextDescriptor = {
      contextType: 'contract_probe',
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [shown],
      visibleContextIds: async (ids) => new Set(ids.filter((id) => id === shown)),
      canSeeAs: async (_adminUserId, id) => id === shown,
      canChangeTasks: async () => mayChangeTasks,
      describe: async (ids) =>
        new Map(
          ids
            .filter((id) => id === shown)
            .map((id) => [id, { label: 'Probe record', href: `/probe/${id}`, groups: new Map([[shownGroup, 'Group']]) }]),
        ),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);
  });

  afterAll(async () => {
    reader.undo();
    nobody.undo();
    if (created.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  describe('gates', () => {
    const ID = '00000000-0000-4000-8000-0000000071b1';
    const reads = ['', '/mine', `/${ID}`, `/${ID}/history`];
    const writes: Array<[Method, string]> = [
      ['POST', ''],
      ['PATCH', `/${ID}`],
      ['DELETE', `/${ID}`],
      ['GET', '/lookups/assignees'],
    ];

    it('every route answers 401 without a session', async () => {
      for (const path of reads) {
        expect((await call('GET', path, { cookies: null })).statusCode, `GET ${path}`).toBe(401);
      }
      for (const [method, path] of writes) {
        const payload = method === 'GET' || method === 'DELETE' ? undefined : {};
        expect((await call(method, path, { cookies: null, payload })).statusCode, `${method} ${path}`).toBe(401);
      }
    });

    it('reads need tasks:read; writes and the assignee lookup need tasks:write — 403 otherwise', async () => {
      for (const path of reads) {
        expect((await call('GET', path, { cookies: nobody.cookies })).statusCode, `GET ${path}`).toBe(403);
      }
      for (const [method, path] of writes) {
        const payload = method === 'GET' || method === 'DELETE' ? undefined : { title: 'x' };
        const response = await call(method, path, { cookies: reader.cookies, payload });
        expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(403);
      }
    });
  });

  describe('POST /tasks', () => {
    it('answers 201 with a TaskDetail: numbered, to do, created by the caller', async () => {
      const task = await create({
        title: '  Call the supplier  ',
        description: 'About the racking',
        assignedAdminUserId: TEST_ADMIN_ID,
        dueOn: '2026-12-01',
      });
      expect(task.number).toMatch(/^TSK-\d{6,}$/);
      expect(task).toMatchObject({
        title: 'Call the supplier',
        description: 'About the racking',
        status: 'todo',
        dueOn: '2026-12-01',
        overdue: false,
        assignee: { id: TEST_ADMIN_ID, active: true },
        context: null,
        contextNote: null,
        createdBy: { id: TEST_ADMIN_ID },
        completedAt: null,
        references: [],
      });
    });

    it('accepts a context its owner lists as visible, and describes it', async () => {
      const task = await create({
        title: 'In the probe',
        context: { contextType: 'contract_probe', contextId: shown, contextGroupId: shownGroup },
      });
      expect(task.context).toEqual({
        type: 'contract_probe',
        id: shown,
        groupId: shownGroup,
        available: true,
        label: 'Probe record',
        href: `/probe/${shown}`,
        groupLabel: 'Group',
        canChangeTasks: true,
      });
      // The owner's answer is the reader's, read per request (T147 follow-up).
      mayChangeTasks = false;
      try {
        const read = await call('GET', `/${task.id}`);
        expect(TaskDetailResponseSchema.parse(read.json()).data.context?.canChangeTasks).toBe(false);
      } finally {
        mayChangeTasks = true;
      }
    });

    it('answers 400 for a body its schema refuses', async () => {
      for (const payload of [{ title: '' }, { title: 'x', context: { contextType: 'contract_probe' } }, { title: 'x', extra: 1 }]) {
        const response = await call('POST', '', { payload });
        expect(response.statusCode, response.body).toBe(400);
      }
    });

    it('refuses a context nobody owns, one the caller may not see, or a group the record has not — 422 TASK_CONTEXT_INVALID', async () => {
      for (const context of [
        { contextType: 'nobody_owns_this', contextId: randomUUID() },
        { contextType: 'contract_probe', contextId: randomUUID() },
        { contextType: 'contract_probe', contextId: shown, contextGroupId: randomUUID() },
        // The record has groups, so a Task in it belongs to one of them.
        { contextType: 'contract_probe', contextId: shown },
      ]) {
        const response = await call('POST', '', { payload: { title: 'Refused', context } });
        expect(response.statusCode, `${JSON.stringify(context)}: ${response.body}`).toBe(422);
        expect(code(response)).toBe('TASK_CONTEXT_INVALID');
      }
    });

    it('refuses a context whose owner does not let the caller add to it — 422 TASK_CONTEXT_INVALID (T147)', async () => {
      mayChangeTasks = false;
      try {
        const response = await call('POST', '', {
          payload: { title: 'Not let in', context: { contextType: 'contract_probe', contextId: shown, contextGroupId: shownGroup } },
        });
        expect(response.statusCode, response.body).toBe(422);
        expect(code(response)).toBe('TASK_CONTEXT_INVALID');
      } finally {
        mayChangeTasks = true;
      }
    });

    it('refuses an assignee who is no active administrator — 422 TASK_ASSIGNEE_INVALID', async () => {
      const response = await call('POST', '', { payload: { title: 'Nobody', assignedAdminUserId: randomUUID() } });
      expect(response.statusCode, response.body).toBe(422);
      expect(code(response)).toBe('TASK_ASSIGNEE_INVALID');
    });
  });

  describe('GET /tasks, GET /tasks/mine, GET /tasks/:id', () => {
    it('lists against TaskListResponse and reads a TaskDetail', async () => {
      const task = await create({ title: 'Listed', dueOn: '2026-11-15' });
      const list = await call('GET', `?q=${encodeURIComponent(task.number)}`);
      expect(list.statusCode, list.body).toBe(200);
      expect(TaskListResponseSchema.parse(list.json()).items.map((t) => t.id)).toEqual([task.id]);

      const one = await call('GET', `/${task.id}`);
      expect(one.statusCode, one.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(one.json()).data.id).toBe(task.id);
    });

    it('answers My Tasks against MyTasksResponse — the caller’s open Tasks', async () => {
      const mine = await create({ title: 'Mine', assignedAdminUserId: TEST_ADMIN_ID });
      const response = await call('GET', '/mine');
      expect(response.statusCode, response.body).toBe(200);
      const { data } = MyTasksResponseSchema.parse(response.json());
      expect(data.map((t) => t.id)).toContain(mine.id);
      expect(data.every((t) => t.assignee?.id === TEST_ADMIN_ID)).toBe(true);
    });

    it('answers 404 TASK_NOT_FOUND for a Task that does not exist', async () => {
      for (const path of [`/${randomUUID()}`, '/not-a-uuid', `/${randomUUID()}/history`]) {
        const response = await call('GET', path);
        expect(response.statusCode, `${path}: ${response.body}`).toBe(404);
        expect(code(response)).toBe('TASK_NOT_FOUND');
      }
    });

    it('answers 400 for a query its schema refuses', async () => {
      expect((await call('GET', '?status=open')).statusCode).toBe(400);
    });
  });

  describe('PATCH /tasks/:id and DELETE /tasks/:id', () => {
    it('edits against TaskDetail; done sets completedAt and leaving done clears it', async () => {
      const task = await create({ title: 'To edit' });
      const done = await call('PATCH', `/${task.id}`, { payload: { status: 'done', title: 'Edited' } });
      expect(done.statusCode, done.body).toBe(200);
      const edited = TaskDetailResponseSchema.parse(done.json()).data;
      expect(edited).toMatchObject({ title: 'Edited', status: 'done' });
      expect(edited.completedAt).not.toBeNull();

      const reopened = await call('PATCH', `/${task.id}`, { payload: { status: 'in_progress' } });
      expect(TaskDetailResponseSchema.parse(reopened.json()).data.completedAt).toBeNull();
    });

    it('answers 400 for an empty or unknown body, 404 for a missing Task, 422 for a bad context', async () => {
      const task = await create({ title: 'Refusals' });
      expect((await call('PATCH', `/${task.id}`, { payload: {} })).statusCode).toBe(400);
      expect((await call('PATCH', `/${task.id}`, { payload: { status: 'open' } })).statusCode).toBe(400);
      const missing = await call('PATCH', `/${randomUUID()}`, { payload: { title: 'x' } });
      expect(missing.statusCode).toBe(404);
      expect(code(missing)).toBe('TASK_NOT_FOUND');
      const context = await call('PATCH', `/${task.id}`, {
        payload: { context: { contextType: 'nobody_owns_this', contextId: randomUUID() } },
      });
      expect(context.statusCode, context.body).toBe(422);
      expect(code(context)).toBe('TASK_CONTEXT_INVALID');
    });

    it('deletes with 204, after which the Task is not found', async () => {
      const task = await create({ title: 'To delete' });
      const response = await call('DELETE', `/${task.id}`);
      expect(response.statusCode, response.body).toBe(204);
      expect(response.body).toBe('');
      const gone = await call('DELETE', `/${task.id}`);
      expect(gone.statusCode).toBe(404);
      expect(code(gone)).toBe('TASK_NOT_FOUND');
    });

    it('refuses deleting a Task of a record whose owner does not let the caller — 403 FORBIDDEN (T147)', async () => {
      const task = await create({
        title: 'Held by the probe',
        context: { contextType: 'contract_probe', contextId: shown, contextGroupId: shownGroup },
      });
      mayChangeTasks = false;
      try {
        const refused = await call('DELETE', `/${task.id}`);
        expect(refused.statusCode, refused.body).toBe(403);
        expect(code(refused)).toBe('FORBIDDEN');
      } finally {
        mayChangeTasks = true;
      }
      expect((await call('DELETE', `/${task.id}`)).statusCode).toBe(204);
    });
  });

  describe('GET /tasks/lookups/assignees and GET /tasks/:id/history', () => {
    it('offers active administrators, searchable', async () => {
      const response = await call('GET', `/lookups/assignees?q=${encodeURIComponent('tasks-reader')}`);
      expect(response.statusCode, response.body).toBe(200);
      const { data } = TaskAssigneeLookupResponseSchema.parse(response.json());
      expect(data.map((o) => o.id)).toContain(reader.adminUserId);
    });

    it('answers the Task’s audit trail against RecordHistoryPage, newest first', async () => {
      const task = await create({ title: 'With a past' });
      expect((await call('PATCH', `/${task.id}`, { payload: { title: 'With a longer past' } })).statusCode).toBe(200);
      const response = await call('GET', `/${task.id}/history`);
      expect(response.statusCode, response.body).toBe(200);
      const page = RecordHistoryPageSchema.parse(response.json());
      expect(page.data.map((entry) => entry.action)).toEqual(['tasks.task.update', 'tasks.task.create']);
      expect(page.data[0]!.actor).toMatchObject({ kind: 'admin', id: TEST_ADMIN_ID });
      expect(page.truncated).toBe(false);
    });
  });
});
