import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MyTasksResponseSchema,
  TASKS_EVENTS,
  TaskDetailResponseSchema,
  TaskStatusChangeResponseSchema,
  type TaskDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * User Story 2 — a Task on its own (`specs/163-projects-and-tasks/quickstart.md`
 * US2; spec US2 scenarios 1–2, FR-029, FR-030, FR-032, FR-034), on the shape of
 * `specs/165-task-management/` (statuses are workflow codes moved through
 * `POST /tasks/:id/status`, assignees are a list).
 *
 * Create, edit, change status, assign, list *My Tasks*, delete — each write
 * one audited Command with its event; assigning somebody else tells them once
 * in the bell, by the Task's number only; assigning oneself tells nobody, and
 * nor is somebody told who may not read Tasks at all (F-14).
 */
describe('tasks — a Task on its own (US2)', () => {
  let h: BackendServerHandle;
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** An active administrator without `tasks:read` — no Task is theirs to hear about (F-14). */
  let outsider: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];

  function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown, cookies: { b2b_session: string } = admin) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function create(body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('POST', '', body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  async function patch(id: string, body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('PATCH', `/${id}`, body, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  }

  /** A move through the workflow, from the status the Task is in. */
  async function move(task: TaskDetail, to: string, cookies = admin): Promise<TaskDetail> {
    const current = TaskDetailResponseSchema.parse((await call('GET', `/${task.id}`, undefined, cookies)).json()).data;
    const response = await call('POST', `/${task.id}/status`, { from: current.status.code, to }, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskStatusChangeResponseSchema.parse(response.json()).data.task;
  }

  const bellAbout = (taskId: string) =>
    h.em().find(AdminNotification, { subjectId: taskId }, { filters: false, orderBy: { createdAt: 'asc' } });

  const audit = (taskId: string) =>
    h.auditLogService.query({ objectType: 'task', objectId: taskId }).then((rows) => rows.map((r) => r.action).reverse());

  function capture(names: string[]): { events: Array<{ name: string; payload: Record<string, unknown> }>; off: () => void } {
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const offs = names.map((name) =>
      h.eventBus.on(name as never, (payload: unknown) => {
        events.push({ name, payload: payload as Record<string, unknown> });
      }),
    );
    return { events, off: () => offs.forEach((off) => off()) };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    colleague = await seedCrmAdmin(h.em(), 'tasks-colleague', ['tasks:read', 'tasks:write']);
    outsider = await seedCrmAdmin(h.em(), 'tasks-outsider', ['orders:read']);
  });

  afterAll(async () => {
    colleague.undo();
    outsider.undo();
    if (created.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  it('creates a Task numbered and to do, by one audited Command and one event', async () => {
    const seen = capture([TASKS_EVENTS.CREATED]);
    try {
      const task = await create({ title: 'Book the crane', description: 'For Monday', dueOn: '2026-12-07' });
      expect(task.number).toMatch(/^TSK-\d{6,}$/);
      expect(task).toMatchObject({
        status: { code: 'todo', category: 'open' },
        closed: false,
        assignees: [],
        completedAt: null,
        createdBy: { id: TEST_ADMIN_ID },
      });
      expect(await audit(task.id)).toEqual(['tasks.task.create']);
      expect(seen.events).toEqual([
        {
          name: TASKS_EVENTS.CREATED,
          payload: expect.objectContaining({ taskId: task.id, contextType: null, assigneeIds: [] }),
        },
      ]);
      // Numbers are given in order and never reused.
      const next = await create({ title: 'Book the truck' });
      expect(Number(next.number.slice(4))).toBeGreaterThan(Number(task.number.slice(4)));
    } finally {
      seen.off();
    }
  });

  it('edits the fields; a status change sets and clears the completion time, each its own Command and event', async () => {
    const task = await create({ title: 'Measure the hall' });
    const seen = capture([TASKS_EVENTS.STATUS_CHANGED, TASKS_EVENTS.ASSIGNEES_CHANGED]);
    try {
      const edited = await patch(task.id, { title: 'Measure the hall again', description: 'Both floors', dueOn: null });
      expect(edited).toMatchObject({ title: 'Measure the hall again', description: 'Both floors', dueOn: null });

      const done = await move(task, 'done');
      expect(done.status.code).toBe('done');
      expect(done.closed).toBe(true);
      expect(done.completedAt).not.toBeNull();

      const back = await move(task, 'in_progress');
      expect(back.completedAt).toBeNull();

      // The same status again changes nothing and records nothing.
      await move(task, 'in_progress');

      const cancelled = await move(task, 'cancelled');
      expect(cancelled.completedAt).toBeNull();
      expect(cancelled.closed).toBe(true);

      expect(await audit(task.id)).toEqual([
        'tasks.task.create',
        'tasks.task.update',
        'tasks.task.status_change',
        'tasks.task.status_change',
        'tasks.task.status_change',
      ]);
      expect(seen.events.map((e) => [e.payload.from, e.payload.to])).toEqual([
        ['todo', 'done'],
        ['done', 'in_progress'],
        ['in_progress', 'cancelled'],
      ]);
      expect(seen.events[0]!.payload).toMatchObject({ taskId: task.id, toCategory: 'done', contextType: null, contextId: null });
    } finally {
      seen.off();
    }
  });

  it('assigning somebody else tells them once, by number only; assigning oneself tells nobody', async () => {
    const task = await create({ title: 'Secret supplier negotiation' });
    expect(await bellAbout(task.id)).toEqual([]);

    const seen = capture([TASKS_EVENTS.ASSIGNEES_CHANGED]);
    try {
      const assigned = await patch(task.id, { assigneeIds: [colleague.adminUserId] });
      expect(assigned.assignees).toEqual([expect.objectContaining({ id: colleague.adminUserId, active: true })]);

      const bell = await bellAbout(task.id);
      expect(bell).toHaveLength(1);
      expect(bell[0]).toMatchObject({
        audience: 'admin_user',
        targetAdminUserId: colleague.adminUserId,
        kind: 'tasks.task.assigned',
        subjectType: 'task',
        subjectId: task.id,
        linkPath: `/tasks/${task.id}`,
      });
      expect(bell[0]!.title).toContain(task.number);
      expect(bell[0]!.title).not.toContain('Secret');
      expect(bell[0]!.titleMessage).toEqual({
        scope: 'tasks',
        key: 'notifications.assigned.title',
        params: { number: task.number },
      });

      // Saving the same assignee again, unassigning, and the colleague taking
      // it back themselves tell nobody.
      await patch(task.id, { assigneeIds: [colleague.adminUserId], title: 'Supplier negotiation' });
      await patch(task.id, { assigneeIds: [] });
      await patch(task.id, { assigneeIds: [colleague.adminUserId] }, colleague.cookies);
      // …and handing it on to somebody else tells them.
      await patch(task.id, { assigneeIds: [TEST_ADMIN_ID] }, colleague.cookies);
      expect(await bellAbout(task.id)).toHaveLength(2);
      expect((await bellAbout(task.id))[1]).toMatchObject({ targetAdminUserId: TEST_ADMIN_ID });

      expect(seen.events.map((e) => [e.payload.added, e.payload.removed])).toEqual([
        [[colleague.adminUserId], []],
        [[], [colleague.adminUserId]],
        [[colleague.adminUserId], []],
        [[TEST_ADMIN_ID], [colleague.adminUserId]],
      ]);
      expect((await audit(task.id)).filter((a) => a === 'tasks.task.assignees_change')).toHaveLength(4);
    } finally {
      seen.off();
    }
  });

  it('a Task created with somebody else as assignee tells them; created for oneself, nobody', async () => {
    const theirs = await create({ title: 'Theirs', assigneeIds: [colleague.adminUserId] });
    expect((await bellAbout(theirs.id)).map((n) => n.targetAdminUserId)).toEqual([colleague.adminUserId]);
    const own = await create({ title: 'Own', assigneeIds: [colleague.adminUserId] }, colleague.cookies);
    expect(await bellAbout(own.id)).toEqual([]);
  });

  it('several assignees are each told once; the caller among them is not', async () => {
    const shared = await create({ title: 'Shared', assigneeIds: [colleague.adminUserId, TEST_ADMIN_ID] });
    expect((await bellAbout(shared.id)).map((n) => n.targetAdminUserId)).toEqual([colleague.adminUserId]);
    expect(shared.assignees.map((a) => a.id).sort()).toEqual([colleague.adminUserId, TEST_ADMIN_ID].sort());
  });

  // F-14, then `specs/165-task-management/` US1 (`contracts/admin-api.md` §1):
  // somebody who may not read Tasks at all is no longer assigned and left
  // untold — the Tasks screens refuse them, so no bell can reach them.
  it('refuses, and tells nobody, an assignee who may not read Tasks at all — no tasks:read (F-14, US1)', async () => {
    const refused = await call('POST', '', { title: 'Not for outsiders', assigneeIds: [outsider.adminUserId] });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.code).toBe('TASK_ASSIGNEE_INVALID');
    const later = await create({ title: 'Assigned later' });
    const added = await call('PATCH', `/${later.id}`, { addAssigneeIds: [outsider.adminUserId] });
    expect(added.statusCode, added.body).toBe(422);
    expect(await bellAbout(later.id)).toEqual([]);
  });

  it('still assigns, and tells nobody, while admin_notifications is off', async () => {
    const task = await create({ title: 'Quiet' });
    await withModuleOff('admin_notifications', 'deactivated', async () => {
      const assigned = await patch(task.id, { assigneeIds: [colleague.adminUserId] });
      expect(assigned.assignees.map((a) => a.id)).toEqual([colleague.adminUserId]);
    });
    expect(await bellAbout(task.id)).toEqual([]);
  });

  it('My Tasks: the caller’s open Tasks by due date, undated last, overdue marked', async () => {
    const mine = (title: string, extra: Record<string, unknown> = {}) =>
      create({ title, assigneeIds: [colleague.adminUserId], ...extra }, colleague.cookies);
    const later = await mine('Later', { dueOn: '2999-01-02' });
    const undated = await mine('Undated');
    const overdue = await mine('Overdue', { dueOn: '2001-01-01' });
    const sooner = await mine('Sooner', { dueOn: '2999-01-01' });
    const finished = await mine('Finished', { dueOn: '2001-01-01' });
    await move(finished, 'done', colleague.cookies);
    const cancelled = await mine('Cancelled');
    await move(cancelled, 'cancelled', colleague.cookies);
    await create({ title: 'Somebody else’s', assigneeIds: [TEST_ADMIN_ID] });

    const response = await call('GET', '/mine', undefined, colleague.cookies);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = MyTasksResponseSchema.parse(response.json());
    const ids = data.map((t) => t.id);
    expect(ids.filter((id) => [later, undated, overdue, sooner].some((t) => t.id === id))).toEqual([
      overdue.id,
      sooner.id,
      later.id,
      undated.id,
    ]);
    expect(ids).not.toContain(finished.id);
    expect(ids).not.toContain(cancelled.id);
    expect(data.find((t) => t.id === overdue.id)!.overdue).toBe(true);
    expect(data.find((t) => t.id === sooner.id)!.overdue).toBe(false);
    // `overdue` on the list says the same.
    const list = await call('GET', `?overdue=true&assignee=${colleague.adminUserId}`);
    expect((list.json() as { items: Array<{ id: string }> }).items.map((t) => t.id)).toEqual([overdue.id]);
  });

  it('deletes a Task by one audited Command and one event; it is gone everywhere', async () => {
    const task = await create({ title: 'Short-lived', assigneeIds: [TEST_ADMIN_ID] });
    const seen = capture([TASKS_EVENTS.DELETED]);
    try {
      const response = await call('DELETE', `/${task.id}`);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ data: { subtasksDetached: 0 } });
      expect((await call('GET', `/${task.id}`)).statusCode).toBe(404);
      const mine = MyTasksResponseSchema.parse((await call('GET', '/mine')).json()).data;
      expect(mine.map((t) => t.id)).not.toContain(task.id);
      expect(await audit(task.id)).toEqual(['tasks.task.create', 'tasks.task.delete']);
      expect(seen.events).toEqual([
        { name: TASKS_EVENTS.DELETED, payload: expect.objectContaining({ taskId: task.id, contextType: null }) },
      ]);
    } finally {
      seen.off();
    }
  });
});
