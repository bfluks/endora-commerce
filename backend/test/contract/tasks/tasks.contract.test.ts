import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MyTasksResponseSchema,
  RecordHistoryPageSchema,
  TaskAssigneeLookupResponseSchema,
  TaskDeleteResponseSchema,
  TaskDetailResponseSchema,
  TaskListResponseSchema,
  TaskStatusChangeResponseSchema,
  TaskWorkflowResponseSchema,
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
 * `specs/163-projects-and-tasks/contracts/admin-api.md` §1, on the shape of
 * `specs/165-task-management/contracts/admin-api.md` §1 (statuses are workflow
 * codes moved through `POST /tasks/:id/status`; assignees are a list), plus the
 * read-only `GET /tasks/workflow` of §4: each answer against its schema, each
 * gate (401 without a session, 403 without the code), and each refusal by its
 * code.
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
    const reads = ['', '/mine', `/${ID}`, `/${ID}/history`, '/workflow'];
    const writes: Array<[Method, string]> = [
      ['POST', ''],
      ['PATCH', `/${ID}`],
      ['POST', `/${ID}/status`],
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
        assigneeIds: [TEST_ADMIN_ID],
        dueOn: '2026-12-01',
      });
      expect(task.number).toMatch(/^TSK-\d{6,}$/);
      expect(task).toMatchObject({
        title: 'Call the supplier',
        description: 'About the racking',
        status: { code: 'todo', name: 'To do', category: 'open' },
        closed: false,
        dueOn: '2026-12-01',
        overdue: false,
        assignees: [{ id: TEST_ADMIN_ID, active: true }],
        draft: false,
        private: false,
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
      const response = await call('POST', '', { payload: { title: 'Nobody', assigneeIds: [randomUUID()] } });
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
      const mine = await create({ title: 'Mine', assigneeIds: [TEST_ADMIN_ID] });
      const response = await call('GET', '/mine');
      expect(response.statusCode, response.body).toBe(200);
      const { data } = MyTasksResponseSchema.parse(response.json());
      expect(data.map((t) => t.id)).toContain(mine.id);
      expect(data.every((t) => t.assignees.some((a) => a.id === TEST_ADMIN_ID))).toBe(true);
    });

    it('answers 404 TASK_NOT_FOUND for a Task that does not exist', async () => {
      for (const path of [`/${randomUUID()}`, '/not-a-uuid', `/${randomUUID()}/history`]) {
        const response = await call('GET', path);
        expect(response.statusCode, `${path}: ${response.body}`).toBe(404);
        expect(code(response)).toBe('TASK_NOT_FOUND');
      }
    });

    it('answers 400 for a query its schema refuses', async () => {
      expect((await call('GET', '?status=Not-A-Code')).statusCode).toBe(400);
      expect((await call('GET', '?sort=popularity')).statusCode).toBe(400);
    });
  });

  describe('PATCH /tasks/:id and DELETE /tasks/:id', () => {
    it('edits against TaskDetail; done sets completedAt and leaving done clears it', async () => {
      const task = await create({ title: 'To edit' });
      const patched = await call('PATCH', `/${task.id}`, { payload: { title: 'Edited' } });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(patched.json()).data).toMatchObject({ title: 'Edited' });
      const done = await call('POST', `/${task.id}/status`, { payload: { from: 'todo', to: 'done' } });
      expect(done.statusCode, done.body).toBe(200);
      const moved = TaskStatusChangeResponseSchema.parse(done.json()).data;
      expect(moved.task).toMatchObject({ title: 'Edited', status: { code: 'done', category: 'done' }, closed: true });
      expect(moved.task.completedAt).not.toBeNull();
      expect(moved.openSubtasks).toBe(0);

      const reopened = await call('POST', `/${task.id}/status`, { payload: { from: 'done', to: 'in_progress' } });
      expect(TaskStatusChangeResponseSchema.parse(reopened.json()).data.task.completedAt).toBeNull();
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

    it('deletes with 200 and how many sub-tasks became top-level (FR-029), after which the Task is not found', async () => {
      const task = await create({ title: 'To delete' });
      const response = await call('DELETE', `/${task.id}`);
      expect(response.statusCode, response.body).toBe(200);
      expect(TaskDeleteResponseSchema.parse(response.json())).toEqual({ data: { subtasksDetached: 0 } });
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
      expect((await call('DELETE', `/${task.id}`)).statusCode).toBe(200);
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

  describe('POST /tasks/:id/status and GET /tasks/workflow (165 research R-1)', () => {
    it('serves the workflow against TaskWorkflow: the four seeded statuses in order, every move', async () => {
      const response = await call('GET', '/workflow', { cookies: reader.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = TaskWorkflowResponseSchema.parse(response.json());
      expect(data.statuses.map((status) => [status.code, status.category])).toEqual([
        ['todo', 'open'],
        ['in_progress', 'open'],
        ['done', 'done'],
        ['cancelled', 'cancelled'],
      ]);
      expect(data.transitions).toHaveLength(12);
    });

    it('refuses a code the workflow does not hold — 422 TASK_STATUS_UNKNOWN', async () => {
      const task = await create({ title: 'Unknown target' });
      const response = await call('POST', `/${task.id}/status`, { payload: { from: 'todo', to: 'in_review' } });
      expect(response.statusCode, response.body).toBe(422);
      expect(code(response)).toBe('TASK_STATUS_UNKNOWN');
    });

    it('refuses a move from a status the Task has left — 409 TASK_TRANSITION_CONFLICT', async () => {
      const task = await create({ title: 'Moved meanwhile' });
      const response = await call('POST', `/${task.id}/status`, { payload: { from: 'in_progress', to: 'done' } });
      expect(response.statusCode, response.body).toBe(409);
      expect(code(response)).toBe('TASK_TRANSITION_CONFLICT');
    });

    it('refuses a move the workflow does not permit — 409 TASK_TRANSITION_FORBIDDEN with allowedTargets', async () => {
      const task = await create({ title: 'Not that way' });
      const connection = h.orm.em.getConnection();
      await connection.execute(`delete from "task_status_transitions" where "from_code" = 'todo' and "to_code" = 'done'`);
      try {
        const response = await call('POST', `/${task.id}/status`, { payload: { from: 'todo', to: 'done' } });
        expect(response.statusCode, response.body).toBe(409);
        const body = response.json() as { error: { code: string; details: { allowedTargets: string[] } } };
        expect(body.error.code).toBe('TASK_TRANSITION_FORBIDDEN');
        expect(body.error.details.allowedTargets).toEqual(['in_progress', 'cancelled']);
      } finally {
        await connection.execute(
          `insert into "task_status_transitions" ("from_code", "to_code") values ('todo', 'done') on conflict do nothing`,
        );
      }
    });

    it('PATCH no longer takes a status — 400', async () => {
      const task = await create({ title: 'Status by PATCH' });
      expect((await call('PATCH', `/${task.id}`, { payload: { status: 'done' } })).statusCode).toBe(400);
    });
  });
});
