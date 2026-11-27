import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  TASK_STATUS_REASSIGN_MAX,
  RecordHistoryPageSchema,
  TaskDetailResponseSchema,
  TaskStatusChangeResponseSchema,
  TaskWorkflowResponseSchema,
  type TaskDetail,
  type TaskWorkflow,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { restoreDefaultTaskWorkflow } from '../../helpers/task-workflow.js';

/**
 * User Story 2 — operator-defined statuses and transitions
 * (`specs/165-task-management/` spec US2, FR-012 – FR-017, research R-1;
 * `contracts/admin-api.md` §1 `POST /tasks/:id/status`, §4).
 *
 * The operator adds, renames, recolours and reorders a status and edits the
 * moves as a delta; every configuration write is audited and answers the whole
 * workflow; each FR-013 rule is refused by name and nothing changes. A move the
 * workflow does not permit is refused naming the permitted next statuses, a
 * move from a status the Task has left is a conflict, and removing a status in
 * use moves its Tasks to a reachable replacement, each move in the Task's own
 * history. Only `tasks:configure` configures.
 *
 * The workflow is platform-wide: the file restores the seeded one before and
 * after (`helpers/task-workflow.ts`).
 */
describe('tasks — the workflow (US2)', () => {
  let h: BackendServerHandle;
  /** Reads and writes Tasks, configures nothing. */
  let writer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: { b2b_session: string } = admin,
  ) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function workflowOf(response: Awaited<ReturnType<typeof call>>, status = 200): Promise<TaskWorkflow> {
    expect(response.statusCode, response.body).toBe(status);
    return TaskWorkflowResponseSchema.parse(response.json()).data;
  }

  const workflow = async (): Promise<TaskWorkflow> => workflowOf(await call('GET', '/workflow'));

  async function create(title: string): Promise<TaskDetail> {
    const response = await call('POST', '', { title });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  const read = async (id: string): Promise<TaskDetail> =>
    TaskDetailResponseSchema.parse((await call('GET', `/${id}`)).json()).data;

  async function move(id: string, to: string): Promise<TaskDetail> {
    const from = (await read(id)).status.code;
    const response = await call('POST', `/${id}/status`, { from, to });
    expect(response.statusCode, response.body).toBe(200);
    return TaskStatusChangeResponseSchema.parse(response.json()).data.task;
  }

  function refusal(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    expect(response.statusCode, response.body).toBe(status);
    const error = (response.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
    expect(error.code).toBe(code);
    return error;
  }

  const edges = (flow: TaskWorkflow) => flow.transitions.map((edge) => `${edge.from}>${edge.to}`).sort();

  const configAudit = async (objectType: string, objectId: string) =>
    (await h.auditLogService.query({ objectType, objectId })).map((row) => row.action);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultTaskWorkflow(h.em());
    writer = await seedCrmAdmin(h.em(), 'workflow-writer', ['tasks:read', 'tasks:write']);
  });

  afterAll(async () => {
    writer?.undo();
    const connection = h.em().getConnection();
    if (created.length > 0) {
      await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await connection.execute(`delete from "tasks" where "number" like 'TSK-BULK-%'`);
    await restoreDefaultTaskWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('configuration (FR-012, FR-013)', () => {
    it('adds, renames in both languages, recolours and reorders a status — each audited, each answering the workflow', async () => {
      const added = await workflowOf(
        await call('POST', '/statuses', {
          code: 'in_review',
          name: { en: 'In review', pl: 'Do przeglądu' },
          category: 'open',
          color: '#8b5cf6',
          weight: 25,
        }),
        201,
      );
      expect(added.statuses.map((s) => s.code)).toEqual(['todo', 'in_progress', 'in_review', 'done', 'cancelled']);
      expect(added.statuses.find((s) => s.code === 'in_review')).toMatchObject({
        name: { en: 'In review', pl: 'Do przeglądu' },
        defaultName: 'In review',
        category: 'open',
        isInitial: false,
        inUseCount: 0,
      });

      const renamed = await workflowOf(
        await call('PATCH', '/statuses/in_review', { name: { en: 'Under review', pl: 'W przeglądzie' } }),
      );
      expect(renamed.statuses.find((s) => s.code === 'in_review')?.name).toEqual({ en: 'Under review', pl: 'W przeglądzie' });

      const recoloured = await workflowOf(await call('PATCH', '/statuses/in_review', { color: '#0ea5e9' }));
      expect(recoloured.statuses.find((s) => s.code === 'in_review')?.color).toBe('#0ea5e9');

      const reordered = await workflowOf(await call('PATCH', '/statuses/in_review', { weight: 35 }));
      expect(reordered.statuses.map((s) => s.code)).toEqual(['todo', 'in_progress', 'done', 'in_review', 'cancelled']);
      await workflowOf(await call('PATCH', '/statuses/in_review', { weight: 25 }));

      // The name a reader is shown follows the language.
      const task = await create('Reviewed thing');
      await move(task.id, 'in_progress');
      await workflowOf(await call('PUT', '/transitions', { add: [{ from: 'in_progress', to: 'in_review' }] }));
      await move(task.id, 'in_review');
      expect((await read(task.id)).status).toMatchObject({ code: 'in_review', name: 'Under review', color: '#0ea5e9' });

      expect(await configAudit('task_status', 'in_review')).toEqual([
        'tasks.status.update',
        'tasks.status.update',
        'tasks.status.update',
        'tasks.status.update',
        'tasks.status.create',
      ]);
    });

    it('a code taken is refused, and so is a code that is not snake_case', async () => {
      const taken = await call('POST', '/statuses', {
        code: 'done',
        name: { en: 'Done again', pl: 'Znowu' },
        category: 'done',
        color: '#10b981',
        weight: 31,
      });
      expect(refusal(taken, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({ rule: 'status_code_taken' });
      const shape = await call('POST', '/statuses', {
        code: 'Not Snake',
        name: { en: 'x', pl: 'x' },
        category: 'open',
        color: '#10b981',
        weight: 1,
      });
      expect(shape.statusCode).toBe(400);
    });

    it('refuses every FR-013 rule by name, and changes nothing', async () => {
      const before = await workflow();

      // exactly one initial: the initial status is not unmarked, only moved.
      const unmarked = await call('PATCH', '/statuses/todo', { isInitial: false });
      expect(refusal(unmarked, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({ rule: 'exactly_one_initial' });

      // the initial status is open.
      const closedInitial = await call('POST', '/statuses', {
        code: 'archived',
        name: { en: 'Archived', pl: 'Zarchiwizowane' },
        category: 'done',
        color: '#64748b',
        weight: 90,
        isInitial: true,
      });
      expect(refusal(closedInitial, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({
        rule: 'initial_must_be_open',
      });
      const cancelledInitial = await call('PATCH', '/statuses/cancelled', { isInitial: true });
      expect(refusal(cancelledInitial, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({
        rule: 'initial_must_be_open',
      });

      // at least one done and one cancelled status.
      const noDone = await call('DELETE', '/statuses/done?replacement=cancelled');
      expect(refusal(noDone, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({ rule: 'done_status_required' });
      const noCancelled = await call('DELETE', '/statuses/cancelled?replacement=done');
      expect(refusal(noCancelled, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({
        rule: 'cancelled_status_required',
      });

      // every move names two statuses.
      const ghost = await call('PUT', '/transitions', { add: [{ from: 'todo', to: 'nowhere' }] });
      expect(refusal(ghost, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({
        rule: 'transition_unknown_status',
      });

      expect(await workflow()).toEqual(before);
    });

    it('adds and removes moves as a delta, audited as one change', async () => {
      const changed = await workflowOf(
        await call('PUT', '/transitions', {
          add: [{ from: 'in_review', to: 'done' }],
          remove: [{ from: 'in_progress', to: 'done' }],
        }),
      );
      const now = edges(changed);
      expect(now).toContain('in_progress>in_review');
      expect(now).toContain('in_review>done');
      expect(now).not.toContain('in_progress>done');
      expect(now).toContain('todo>done');
      expect(await configAudit('task_workflow', 'transitions')).toContain('tasks.transitions.change');
    });
  });

  describe('moving a Task (FR-015, FR-017)', () => {
    it('refuses a move the workflow does not permit, naming the permitted next statuses', async () => {
      const task = await create('Straight to done');
      await move(task.id, 'in_progress');
      const refused = await call('POST', `/${task.id}/status`, { from: 'in_progress', to: 'done' });
      const error = refusal(refused, 409, ERROR_CODES.TASK_TRANSITION_FORBIDDEN);
      expect(error.details?.allowedTargets).toEqual(['todo', 'in_review', 'cancelled']);
      expect(error.message).toContain('Under review');
      expect((await read(task.id)).status.code).toBe('in_progress');
    });

    it('a move from a status the Task has left is a conflict; an unknown target is 422', async () => {
      const task = await create('Moved meanwhile');
      await move(task.id, 'in_progress');
      const stale = await call('POST', `/${task.id}/status`, { from: 'todo', to: 'cancelled' });
      refusal(stale, 409, ERROR_CODES.TASK_TRANSITION_CONFLICT);
      const unknown = await call('POST', `/${task.id}/status`, { from: 'in_progress', to: 'nowhere' });
      refusal(unknown, 422, ERROR_CODES.TASK_STATUS_UNKNOWN);
      expect((await read(task.id)).status.code).toBe('in_progress');
    });

    it('entering a done status records the completion time; leaving it clears it; openSubtasks is answered', async () => {
      const task = await create('Walk the workflow');
      await move(task.id, 'in_progress');
      await move(task.id, 'in_review');
      const response = await call('POST', `/${task.id}/status`, { from: 'in_review', to: 'done' });
      expect(response.statusCode, response.body).toBe(200);
      const result = TaskStatusChangeResponseSchema.parse(response.json()).data;
      expect(result.openSubtasks).toBe(0);
      expect(result.task.closed).toBe(true);
      expect(result.task.completedAt).not.toBeNull();
      const reopened = await move(task.id, 'todo');
      expect(reopened.completedAt).toBeNull();
      expect(reopened.closed).toBe(false);
    });

    it('a new Task starts in the current initial status', async () => {
      await workflowOf(
        await call('POST', '/statuses', {
          code: 'backlog',
          name: { en: 'Backlog', pl: 'Zaległe' },
          category: 'open',
          color: '#64748b',
          weight: 5,
          isInitial: true,
        }),
        201,
      );
      let backlogTask: string | null = null;
      try {
        const flow = await workflow();
        expect(flow.statuses.filter((s) => s.isInitial).map((s) => s.code)).toEqual(['backlog']);
        const task = await create('Starts in the backlog');
        backlogTask = task.id;
        expect(task.status.code).toBe('backlog');
      } finally {
        if (backlogTask) expect((await call('DELETE', `/${backlogTask}`)).statusCode).toBe(200);
        await workflowOf(await call('PATCH', '/statuses/todo', { isInitial: true }));
        // Not in use any more: no replacement is asked for.
        await workflowOf(await call('DELETE', '/statuses/backlog'));
      }
      expect((await create('Starts in to do')).status.code).toBe('todo');
    });
  });

  describe('removing a status (FR-016)', () => {
    it('a status in use is removed only with a reachable replacement, which takes its Tasks, each move in its history', async () => {
      const tasks = [await create('Review A'), await create('Review B'), await create('Review C')];
      for (const task of tasks) {
        await move(task.id, 'in_progress');
        await move(task.id, 'in_review');
      }

      const bare = await call('DELETE', '/statuses/in_review');
      expect(refusal(bare, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({ rule: 'replacement_required' });
      const itself = await call('DELETE', '/statuses/in_review?replacement=in_review');
      expect(refusal(itself, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({ rule: 'replacement_required' });
      const unknown = await call('DELETE', '/statuses/in_review?replacement=nowhere');
      refusal(unknown, 422, ERROR_CODES.TASK_STATUS_UNKNOWN);
      // `in_review → todo` is not a permitted move.
      const unreachable = await call('DELETE', '/statuses/in_review?replacement=todo');
      expect(refusal(unreachable, 409, ERROR_CODES.TASK_TRANSITION_FORBIDDEN).details?.allowedTargets).toEqual(['done']);
      for (const task of tasks) expect((await read(task.id)).status.code).toBe('in_review');

      const after = await workflowOf(await call('DELETE', '/statuses/in_review?replacement=done'));
      expect(after.statuses.map((s) => s.code)).not.toContain('in_review');
      expect(edges(after).some((edge) => edge.includes('in_review'))).toBe(false);

      for (const task of tasks) {
        const now = await read(task.id);
        expect(now.status.code).toBe('done');
        expect(now.completedAt).not.toBeNull();
        const history = await h.auditLogService.query({ objectType: 'task', objectId: task.id });
        const removal = history.filter((row) => row.action === 'tasks.task.status_change' && row.stateAfter?.reason === 'status_removed');
        expect(removal).toHaveLength(1);
        expect(removal[0]?.stateBefore).toMatchObject({ status: 'in_review' });
        expect(removal[0]?.stateAfter).toMatchObject({ status: 'done', reason: 'status_removed' });
      }
      const page = RecordHistoryPageSchema.parse((await call('GET', `/${tasks[0]!.id}/history`)).json());
      expect(page.data[0]).toMatchObject({ action: 'tasks.task.status_change', after: { reason: 'status_removed' } });
      expect(await configAudit('task_status', 'in_review')).toContain('tasks.status.delete');
    });

    it(`more than ${TASK_STATUS_REASSIGN_MAX} Tasks in a status give 409 TASK_STATUS_IN_USE_TOO_MANY, and nothing moves`, async () => {
      await workflowOf(
        await call('POST', '/statuses', {
          code: 'on_hold',
          name: { en: 'On hold', pl: 'Wstrzymane' },
          category: 'open',
          color: '#64748b',
          weight: 27,
        }),
        201,
      );
      await workflowOf(await call('PUT', '/transitions', { add: [{ from: 'on_hold', to: 'todo' }] }));
      await h
        .em()
        .getConnection()
        .execute(
          `insert into "tasks" ("number", "title", "status", "created_by_admin_user_id", "published_at")
           select 'TSK-BULK-' || g, 'Bulk ' || g, 'on_hold', ?::uuid, now() from generate_series(1, ?::int) g`,
          [TEST_ADMIN_ID, TASK_STATUS_REASSIGN_MAX + 1],
        );
      const refused = await call('DELETE', '/statuses/on_hold?replacement=todo');
      refusal(refused, 409, ERROR_CODES.TASK_STATUS_IN_USE_TOO_MANY);
      const [held] = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as n from "tasks" where "status" = 'on_hold'`)) as Array<{ n: number }>;
      expect(Number(held?.n)).toBe(TASK_STATUS_REASSIGN_MAX + 1);
      expect((await workflow()).statuses.map((s) => s.code)).toContain('on_hold');
    });
  });

  describe('permissions (FR-041)', () => {
    it('tasks:write without tasks:configure is refused every configuration write, and still reads the workflow', async () => {
      const as = writer.cookies;
      expect((await call('GET', '/workflow', undefined, as)).statusCode).toBe(200);
      const writes = [
        call('POST', '/statuses', { code: 'nope', name: { en: 'n', pl: 'n' }, category: 'open', color: '#000000', weight: 1 }, as),
        call('PATCH', '/statuses/todo', { color: '#000000' }, as),
        call('DELETE', '/statuses/cancelled?replacement=done', undefined, as),
        call('PUT', '/transitions', { remove: [{ from: 'todo', to: 'done' }] }, as),
      ];
      for (const response of await Promise.all(writes)) expect(response.statusCode, response.body).toBe(403);
      expect((await workflow()).statuses.find((s) => s.code === 'todo')?.color).toBe('#64748b');
    });
  });
});
