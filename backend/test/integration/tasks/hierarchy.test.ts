import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RecordHistoryPageSchema,
  TASK_HIERARCHY_DEPTH_MAX,
  TaskDeleteResponseSchema,
  TaskDetailResponseSchema,
  TaskStatusChangeResponseSchema,
  type TaskDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * Sub-tasks and related Tasks (`specs/165-task-management/` User Story 5,
 * FR-027–FR-030, research R-15; quickstart US5 row).
 *
 * A Task has at most one parent. A parent change is refused when it would
 * close a cycle (422 `TASK_PARENT_CYCLE`) or nest deeper than five levels
 * (422 `TASK_HIERARCHY_TOO_DEEP`), and every change runs under one advisory
 * lock, so two that would together form a cycle cannot both succeed. Deleting
 * a parent makes its children top-level and says how many. A parent counts
 * and lists only the sub-tasks its reader may see; a parent its reader may
 * not see is named unavailable. Two Tasks may be related, which both show,
 * idempotently, and either side may undo.
 */
describe('tasks — sub-tasks and related Tasks (US5)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Reads and writes Tasks, holds no `tasks:see_private`. */
  let carol: Person;
  /** Reads Tasks only. */
  let reader: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const createdTasks: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: unknown, cookies = admin) =>
    h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  function refusal(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    expect(response.statusCode, response.body).toBe(status);
    const error = (response.json() as { error: { code: string } }).error;
    expect(error.code).toBe(code);
    return error;
  }

  async function createTask(body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('POST', '', body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    createdTasks.push(data.id);
    return data;
  }

  async function read(id: string, cookies = admin): Promise<TaskDetail> {
    const response = await call('GET', `/${id}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  }

  const setParent = (id: string, parentTaskId: string | null, cookies = admin) =>
    call('PATCH', `/${id}`, { parentTaskId }, cookies);

  async function history(id: string): Promise<Array<{ action: string; before: unknown; after: unknown }>> {
    const response = await call('GET', `/${id}/history?limit=50`);
    expect(response.statusCode, response.body).toBe(200);
    return RecordHistoryPageSchema.parse(response.json()).data;
  }

  /** Seeded the way US8 will write it: the flag set directly (drafts and private Tasks are written in Phase 10). */
  async function makePrivate(id: string): Promise<void> {
    await h.em().getConnection().execute(`update "tasks" set "is_private" = true where "id" = ?`, [id]);
  }

  async function closeTask(task: TaskDetail): Promise<void> {
    const response = await call('POST', `/${task.id}/status`, { from: task.status.code, to: 'done' });
    expect(response.statusCode, response.body).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    carol = await seedCrmAdmin(h.em(), 'hierarchy-carol', ['tasks:read', 'tasks:write']);
    reader = await seedCrmAdmin(h.em(), 'hierarchy-reader', ['tasks:read']);
  });

  afterAll(async () => {
    for (const person of [carol, reader]) person?.undo();
    if (createdTasks.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${createdTasks.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  describe('sub-tasks', () => {
    it('creates a sub-task, makes an existing Task a child, and detaches it again — each in the child’s history', async () => {
      const parent = await createTask({ title: 'Fit out the warehouse' });
      const created = await createTask({ title: 'Order the racking', parentTaskId: parent.id });
      expect(created.parent).toEqual({ id: parent.id, number: parent.number, available: true });

      const existing = await createTask({ title: 'Book the electrician' });
      const adopted = await setParent(existing.id, parent.id);
      expect(adopted.statusCode, adopted.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(adopted.json()).data.parent).toEqual({
        id: parent.id,
        number: parent.number,
        available: true,
      });

      const shown = await read(parent.id);
      expect(shown.subtaskItems.map((task) => task.id)).toEqual([created.id, existing.id]);
      expect(shown.subtasks).toEqual({ closed: 0, total: 2 });
      expect(shown.subtaskItems[0]).toMatchObject({ status: { code: 'todo' }, assignees: [], dueOn: null });

      // The same parent again changes nothing and records nothing.
      expect((await setParent(existing.id, parent.id)).statusCode).toBe(200);
      const detached = await setParent(existing.id, null);
      expect(detached.statusCode, detached.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(detached.json()).data.parent).toBeNull();
      expect((await read(parent.id)).subtasks).toEqual({ closed: 0, total: 1 });

      const changes = (await history(existing.id)).filter((entry) => entry.action === 'tasks.task.parent_change');
      expect(changes.map((entry) => [entry.before, entry.after])).toEqual([
        [{ parentTaskId: parent.id }, { parentTaskId: null }],
        [{ parentTaskId: null }, { parentTaskId: parent.id }],
      ]);
      // A sub-task created under its parent says so in its creation entry.
      const [creation] = (await history(created.id)).filter((entry) => entry.action === 'tasks.task.create');
      expect(creation?.after).toMatchObject({ parentTaskId: parent.id });
    });

    it('refuses a Task as its own parent and as a child of its own descendant — 422 TASK_PARENT_CYCLE', async () => {
      const root = await createTask({ title: 'Root' });
      const child = await createTask({ title: 'Child', parentTaskId: root.id });
      const grandchild = await createTask({ title: 'Grandchild', parentTaskId: child.id });

      refusal(await setParent(root.id, root.id), 422, 'TASK_PARENT_CYCLE');
      refusal(await setParent(root.id, child.id), 422, 'TASK_PARENT_CYCLE');
      refusal(await setParent(root.id, grandchild.id), 422, 'TASK_PARENT_CYCLE');
      expect((await read(root.id)).parent).toBeNull();
    });

    it(`refuses nesting deeper than ${TASK_HIERARCHY_DEPTH_MAX} levels — on create and on a move — 422 TASK_HIERARCHY_TOO_DEEP`, async () => {
      const chain: TaskDetail[] = [await createTask({ title: 'Level 1' })];
      for (let level = 2; level <= TASK_HIERARCHY_DEPTH_MAX; level += 1) {
        chain.push(await createTask({ title: `Level ${level}`, parentTaskId: chain[chain.length - 1]!.id }));
      }
      const deepest = chain[chain.length - 1]!;
      refusal(await call('POST', '', { title: 'Level 6', parentTaskId: deepest.id }), 422, 'TASK_HIERARCHY_TOO_DEEP');

      // A Task with one sub-task is two levels: under level 4 it would reach six.
      const pair = await createTask({ title: 'Pair' });
      await createTask({ title: 'Pair child', parentTaskId: pair.id });
      refusal(await setParent(pair.id, chain[3]!.id), 422, 'TASK_HIERARCHY_TOO_DEEP');
      // Under level 3 it reaches exactly five.
      expect((await setParent(pair.id, chain[2]!.id)).statusCode).toBe(200);
    });

    it('lets one of two concurrent re-parentings that would form a cycle win and refuses the other', async () => {
      for (let round = 0; round < 3; round += 1) {
        const a = await createTask({ title: `Race A${round}` });
        const b = await createTask({ title: `Race B${round}` });
        const [first, second] = await Promise.all([setParent(a.id, b.id), setParent(b.id, a.id)]);
        expect([first.statusCode, second.statusCode].sort()).toEqual([200, 422]);
        const refused = first.statusCode === 422 ? first : second;
        expect((refused.json() as { error: { code: string } }).error.code).toBe('TASK_PARENT_CYCLE');
        const [aNow, bNow] = [await read(a.id), await read(b.id)];
        expect([aNow.parent?.id ?? null, bNow.parent?.id ?? null].filter((id) => id !== null)).toHaveLength(1);
      }
    });

    it('refuses a parent the caller may not see (404) and someone else’s private Task as a parent (403)', async () => {
      const hidden = await createTask({ title: 'Somebody’s private plan' });
      await makePrivate(hidden.id);
      const mine = await createTask({ title: 'Carol’s task' }, carol.cookies);
      refusal(await setParent(mine.id, hidden.id, carol.cookies), 404, 'TASK_NOT_FOUND');
      refusal(
        await call('POST', '', { title: 'Under a hidden parent', parentTaskId: hidden.id }, carol.cookies),
        404,
        'TASK_NOT_FOUND',
      );
      // The administrator sees it (`tasks:see_private`) but may not change somebody else's private Task —
      // nor hang a Task under it.
      const theirs = await createTask({ title: 'Carol’s private one' }, carol.cookies);
      await makePrivate(theirs.id);
      refusal(await call('POST', '', { title: 'Under it', parentTaskId: theirs.id }), 403, 'TASK_PRIVATE_READ_ONLY');
    });

    it('deleting a parent detaches its children, says how many the reader may see, and records it on each child', async () => {
      const parent = await createTask({ title: 'Doomed parent' }, carol.cookies);
      const first = await createTask({ title: 'Survivor 1', parentTaskId: parent.id }, carol.cookies);
      const second = await createTask({ title: 'Survivor 2', parentTaskId: parent.id }, carol.cookies);
      const hidden = await createTask({ title: 'Survivor hidden', parentTaskId: parent.id });
      await makePrivate(hidden.id);

      const response = await call('DELETE', `/${parent.id}`, undefined, carol.cookies);
      expect(response.statusCode, response.body).toBe(200);
      // A sub-task Carol may not see is counted in no number of hers (scenario 7).
      expect(TaskDeleteResponseSchema.parse(response.json()).data).toEqual({ subtasksDetached: 2 });

      for (const survivor of [first, second, hidden]) {
        const now = await read(survivor.id);
        expect(now.parent).toBeNull();
        const [entry] = (await history(survivor.id)).filter((e) => e.action === 'tasks.task.parent_change');
        // The history serves a deleted parent as no Task at all — the same answer a
        // hidden one gets, so the two cannot be told apart (T093 F3) — while the
        // audit log keeps its id.
        expect(entry).toMatchObject({
          before: { parentTaskId: null },
          after: { parentTaskId: null, reason: 'parent_deleted' },
        });
        const [recorded] = (await h.auditLogService.query({ objectType: 'task', objectId: survivor.id })).filter(
          (e) => e.action === 'tasks.task.parent_change',
        );
        expect(recorded?.stateBefore).toEqual({ parentTaskId: parent.id });
      }
      expect((await call('GET', `/${parent.id}`)).statusCode).toBe(404);

      // A Task without sub-tasks reports none.
      const lone = await createTask({ title: 'Lone' });
      const gone = await call('DELETE', `/${lone.id}`);
      expect(gone.statusCode, gone.body).toBe(200);
      expect(TaskDeleteResponseSchema.parse(gone.json()).data).toEqual({ subtasksDetached: 0 });
    });

    it('counts and lists only the sub-tasks the reader may see, in the detail and in the list', async () => {
      const parent = await createTask({ title: 'Visible parent' });
      const closed = await createTask({ title: 'Closed child', parentTaskId: parent.id });
      await closeTask(closed);
      await createTask({ title: 'Open child', parentTaskId: parent.id });
      const hidden = await createTask({ title: 'Private child', parentTaskId: parent.id });
      await makePrivate(hidden.id);

      expect((await read(parent.id)).subtasks).toEqual({ closed: 1, total: 3 });
      const forCarol = await read(parent.id, carol.cookies);
      expect(forCarol.subtasks).toEqual({ closed: 1, total: 2 });
      expect(forCarol.subtaskItems.map((task) => task.id)).not.toContain(hidden.id);
      expect(forCarol.subtaskItems).toHaveLength(2);

      const listed = await call('GET', `?parentId=${parent.id}`, undefined, carol.cookies);
      expect(listed.statusCode, listed.body).toBe(200);
      expect((listed.json() as { items: Array<{ id: string }> }).items.map((task) => task.id)).not.toContain(hidden.id);
      const asRow = await call('GET', `?q=${encodeURIComponent('Visible parent')}`, undefined, carol.cookies);
      const row = (asRow.json() as { items: Array<{ id: string; subtasks: unknown }> }).items.find((t) => t.id === parent.id);
      expect(row?.subtasks).toEqual({ closed: 1, total: 2 });
    });

    it('names a parent the reader may not see as unavailable, without its number', async () => {
      const parent = await createTask({ title: 'Private parent' });
      const child = await createTask({ title: 'Public child', parentTaskId: parent.id });
      await makePrivate(parent.id);
      expect((await read(child.id, carol.cookies)).parent).toEqual({ id: parent.id, number: null, available: false });
      expect((await read(child.id)).parent).toEqual({ id: parent.id, number: parent.number, available: true });
    });

    it('closes a parent with open sub-tasks and says how many are still open; they stay open', async () => {
      const parent = await createTask({ title: 'Closing parent' });
      const open = await createTask({ title: 'Still open 1', parentTaskId: parent.id });
      await createTask({ title: 'Still open 2', parentTaskId: parent.id });
      const done = await createTask({ title: 'Done child', parentTaskId: parent.id });
      await closeTask(done);

      const response = await call('POST', `/${parent.id}/status`, { from: 'todo', to: 'done' });
      expect(response.statusCode, response.body).toBe(200);
      const result = TaskStatusChangeResponseSchema.parse(response.json()).data;
      expect(result.openSubtasks).toBe(2);
      expect(result.task.closed).toBe(true);
      expect((await read(open.id)).closed).toBe(false);
    });
  });

  describe('related Tasks', () => {
    it('relates two Tasks, shown on both sides, idempotently; either side unrelates, idempotently', async () => {
      const a = await createTask({ title: 'Related A' });
      const b = await createTask({ title: 'Related B' });

      const related = await call('PUT', `/${a.id}/relations/${b.id}`);
      expect(related.statusCode, related.body).toBe(204);
      expect((await call('PUT', `/${b.id}/relations/${a.id}`)).statusCode).toBe(204);
      expect((await read(a.id)).relatedTasks.map((task) => task.id)).toEqual([b.id]);
      expect((await read(b.id)).relatedTasks.map((task) => task.id)).toEqual([a.id]);
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as "n" from "task_relations" where ? in ("task_a_id", "task_b_id")`, [a.id])) as Array<{
        n: number;
      }>;
      expect(rows[0]!.n).toBe(1);

      expect((await call('DELETE', `/${b.id}/relations/${a.id}`)).statusCode).toBe(204);
      expect((await call('DELETE', `/${a.id}/relations/${b.id}`)).statusCode).toBe(204);
      expect((await read(a.id)).relatedTasks).toEqual([]);
      expect((await read(b.id)).relatedTasks).toEqual([]);

      // One entry each way on both sides: relating twice and unrelating twice recorded once.
      for (const id of [a.id, b.id]) {
        const actions = (await history(id))
          .map((entry) => entry.action)
          .filter((action) => action === 'tasks.task.relate' || action === 'tasks.task.unrelate');
        expect(actions).toEqual(['tasks.task.unrelate', 'tasks.task.relate']);
      }
    });

    it('lists only the related Tasks the reader may see', async () => {
      const a = await createTask({ title: 'Seen by Carol' });
      const visible = await createTask({ title: 'Also seen' });
      const hidden = await createTask({ title: 'Not seen' });
      await makePrivate(hidden.id);
      expect((await call('PUT', `/${a.id}/relations/${visible.id}`)).statusCode).toBe(204);
      expect((await call('PUT', `/${a.id}/relations/${hidden.id}`)).statusCode).toBe(204);
      expect((await read(a.id)).relatedTasks).toHaveLength(2);
      expect((await read(a.id, carol.cookies)).relatedTasks.map((task) => task.id)).toEqual([visible.id]);
    });

    it('refuses a Task related to itself (400), a Task the caller may not see (404) and a reader (403)', async () => {
      const a = await createTask({ title: 'Self' });
      const other = await createTask({ title: 'Other' });
      refusal(await call('PUT', `/${a.id}/relations/${a.id}`), 400, 'VALIDATION_FAILED');
      const hidden = await createTask({ title: 'Hidden other' });
      await makePrivate(hidden.id);
      refusal(await call('PUT', `/${a.id}/relations/${hidden.id}`, undefined, carol.cookies), 404, 'TASK_NOT_FOUND');
      refusal(await call('PUT', `/${hidden.id}/relations/${a.id}`, undefined, carol.cookies), 404, 'TASK_NOT_FOUND');
      expect((await call('PUT', `/${a.id}/relations/${other.id}`, undefined, reader.cookies)).statusCode).toBe(403);
      expect((await call('DELETE', `/${a.id}/relations/${other.id}`, undefined, reader.cookies)).statusCode).toBe(403);
    });
  });
});
