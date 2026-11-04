import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  TASK_STATUS_REASSIGN_MAX,
  TaskDetailResponseSchema,
  TaskListResponseSchema,
  TaskPriorityListResponseSchema,
  TaskTagListResponseSchema,
  TaskTagResponseSchema,
  type TaskDetail,
  type TaskPriorityConfig,
  type TaskTag,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * User Story 9 — Tags and Priorities configured by the operator
 * (`specs/165-task-management/` spec US9, FR-009 – FR-011, FR-024, FR-041;
 * research R-9, R-10; `contracts/admin-api.md` §4).
 *
 * Tags: renamed and recoloured, a name unique whatever its case, a deletion
 * taking the tag off every Task — one audit row on the tag, carrying how many
 * Tasks carried it, whoever may see them. Priorities: added, renamed in both
 * languages and reordered, the list's sort following the new order; removing
 * one in use names the priority its Tasks get, or none, and each Task's
 * history records the change — drafts included, which nobody but their
 * Creator sees. Only `tasks:configure` configures either list.
 *
 * Both lists are platform-wide: the file adds its own priorities and tags,
 * suffixed, and leaves the seeded ones as they are, so files running beside it
 * see the four seeded priorities throughout.
 */
describe('tasks — tags and priorities (US9)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Reads and writes Tasks, configures nothing. */
  let writer: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const code = (base: string) => `${base}_${suffix}`;
  const created: string[] = [];
  const tags: string[] = [];
  const priorities: string[] = [];

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  function refusal(response: Awaited<ReturnType<typeof call>>, status: number, errorCode: string) {
    expect(response.statusCode, response.body).toBe(status);
    const error = (response.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
    expect(error.code).toBe(errorCode);
    return error;
  }

  async function create(body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('POST', '', body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  /** A Task as its Creator reads it — a draft is nobody else's. */
  const read = async (id: string, cookies = admin): Promise<TaskDetail> => {
    const response = await call('GET', `/${id}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  };

  async function tag(name: string, color?: string): Promise<TaskTag> {
    const response = await call('POST', '/tags', { name, ...(color ? { color } : {}) });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskTagResponseSchema.parse(response.json());
    tags.push(data.id);
    return data;
  }

  const tagList = async (): Promise<TaskTag[]> => TaskTagListResponseSchema.parse((await call('GET', '/tags')).json()).data;

  async function priorityList(response: Awaited<ReturnType<typeof call>>, status = 200): Promise<TaskPriorityConfig[]> {
    expect(response.statusCode, response.body).toBe(status);
    return TaskPriorityListResponseSchema.parse(response.json()).data;
  }

  async function addPriority(base: string, weight: number): Promise<string> {
    const priorityCode = code(base);
    await priorityList(
      await call('POST', '/priorities', {
        code: priorityCode,
        name: { en: `${base} ${suffix}`, pl: `${base} ${suffix} pl` },
        color: '#dc2626',
        weight,
      }),
      201,
    );
    priorities.push(priorityCode);
    return priorityCode;
  }

  const auditOf = (objectType: string, objectId: string) => h.auditLogService.query({ objectType, objectId });

  beforeAll(async () => {
    h = await setupBackendServer();
    writer = await seedCrmAdmin(h.em(), 'tags-priorities-writer', ['tasks:read', 'tasks:write']);
  });

  afterAll(async () => {
    writer?.undo();
    const connection = h.em().getConnection();
    if (created.length > 0) await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    await connection.execute(`delete from "tasks" where "number" like ?`, [`TSK-PRIO-${suffix}-%`]);
    if (tags.length > 0) await connection.execute(`delete from "task_tags" where "id" = any(?::uuid[])`, [`{${tags.join(',')}}`]);
    if (priorities.length > 0) {
      await connection.execute(`delete from "task_priorities" where "code" = any(?::text[])`, [`{${priorities.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  describe('tags (FR-010, R-10)', () => {
    it('renames and recolours a tag — each audited, the new name on the Task', async () => {
      const installation = await tag(`Installation ${suffix}`, '#16a34a');
      const task = await create({ title: 'Install the shelves', tagIds: [installation.id] });

      const renamed = await call('PATCH', `/tags/${installation.id}`, { name: `Fitting ${suffix}` });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(TaskTagResponseSchema.parse(renamed.json()).data).toMatchObject({
        id: installation.id,
        name: `Fitting ${suffix}`,
        color: '#16a34a',
        usageCount: 1,
      });
      const recoloured = await call('PATCH', `/tags/${installation.id}`, { color: '#0ea5e9' });
      expect(TaskTagResponseSchema.parse(recoloured.json()).data.color).toBe('#0ea5e9');

      expect((await read(task.id)).tags).toEqual([
        expect.objectContaining({ id: installation.id, name: `Fitting ${suffix}`, color: '#0ea5e9' }),
      ]);
      const audit = await auditOf('task_tag', installation.id);
      const updates = audit.filter((row) => row.action === 'tasks.tag.update');
      expect(updates).toHaveLength(2);
      expect(updates.map((row) => row.stateAfter)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: `Fitting ${suffix}`, color: '#16a34a' }),
          expect.objectContaining({ name: `Fitting ${suffix}`, color: '#0ea5e9' }),
        ]),
      );
    });

    it('refuses a name taken in any letter case with 409 TASK_TAG_NAME_TAKEN, on create and on rename', async () => {
      const taken = await tag(`Urgent site ${suffix}`);
      const other = await tag(`Calm site ${suffix}`);
      refusal(await call('POST', '/tags', { name: `URGENT SITE ${suffix}` }), 409, ERROR_CODES.TASK_TAG_NAME_TAKEN);
      refusal(
        await call('PATCH', `/tags/${other.id}`, { name: `urgent Site ${suffix}` }),
        409,
        ERROR_CODES.TASK_TAG_NAME_TAKEN,
      );
      // Its own name in another case is a rename, not a collision.
      const recased = await call('PATCH', `/tags/${taken.id}`, { name: `URGENT site ${suffix}` });
      expect(recased.statusCode, recased.body).toBe(200);
      expect((await tagList()).find((t) => t.id === other.id)?.name).toBe(`Calm site ${suffix}`);
    });

    it('a missing tag is 404 on rename and delete', async () => {
      for (const id of [randomUUID(), 'not-a-uuid']) {
        refusal(await call('PATCH', `/tags/${id}`, { color: '#000000' }), 404, ERROR_CODES.NOT_FOUND);
        refusal(await call('DELETE', `/tags/${id}`), 404, ERROR_CODES.NOT_FOUND);
      }
    });

    it('deleting a tag takes it off every Task, and the one audit row counts them all — a draft nobody else sees included', async () => {
      const doomed = await tag(`Doomed ${suffix}`);
      const keeper = await tag(`Keeper ${suffix}`);
      const visible = await create({ title: 'Carries both', tagIds: [doomed.id, keeper.id] });
      // The writer's draft: invisible to the administrator deleting the tag.
      const draft = await create({ title: 'A draft with the tag', tagIds: [doomed.id], draft: true }, writer.cookies);
      expect((await tagList()).find((t) => t.id === doomed.id)?.usageCount).toBe(1);

      const deleted = await call('DELETE', `/tags/${doomed.id}`);
      expect(deleted.statusCode, deleted.body).toBe(204);

      expect((await tagList()).some((t) => t.id === doomed.id)).toBe(false);
      expect((await read(visible.id)).tags.map((t) => t.id)).toEqual([keeper.id]);
      expect((await read(draft.id, writer.cookies)).tags).toEqual([]);

      const audit = await auditOf('task_tag', doomed.id);
      const deletion = audit.filter((row) => row.action === 'tasks.tag.delete');
      expect(deletion).toHaveLength(1);
      expect(deletion[0]?.stateBefore).toMatchObject({ name: `Doomed ${suffix}`, usageCount: 2 });
      // No per-Task row: removing a vocabulary entry is not an edit of each Task (R-10).
      for (const id of [visible.id, draft.id]) {
        const rows = await auditOf('task', id);
        expect(rows.filter((row) => row.action === 'tasks.task.tags_change')).toEqual([]);
      }
    });

    it('tasks:write without tasks:configure cannot create, rename or delete a tag — and still reads and assigns them', async () => {
      const existing = await tag(`Guarded ${suffix}`);
      const as = writer.cookies;
      const writes = [
        call('POST', '/tags', { name: `Writer ${suffix}` }, as),
        call('PATCH', `/tags/${existing.id}`, { name: `Renamed ${suffix}` }, as),
        call('DELETE', `/tags/${existing.id}`, undefined, as),
      ];
      for (const response of await Promise.all(writes)) refusal(response, 403, ERROR_CODES.FORBIDDEN);
      expect((await call('GET', '/tags', undefined, as)).statusCode).toBe(200);
      const task = await create({ title: 'Tagged by a writer', tagIds: [existing.id] }, as);
      expect(task.tags.map((t) => t.id)).toEqual([existing.id]);
      expect((await tagList()).find((t) => t.id === existing.id)?.name).toBe(`Guarded ${suffix}`);
    });
  });

  describe('priorities (FR-009, FR-024, R-9)', () => {
    it('adds, renames in both languages, recolours and reorders a priority — each audited, each answering the list', async () => {
      const blocker = await addPriority('blocker', 5);
      const listed = await priorityList(await call('GET', '/priorities'));
      expect(listed.findIndex((p) => p.code === blocker)).toBeLessThan(listed.findIndex((p) => p.code === 'urgent'));
      expect(listed.find((p) => p.code === blocker)).toMatchObject({
        name: { en: `blocker ${suffix}`, pl: `blocker ${suffix} pl` },
        defaultName: `blocker ${suffix}`,
        weight: 5,
        inUseCount: 0,
      });

      const renamed = await priorityList(
        await call('PATCH', `/priorities/${blocker}`, { name: { en: `Blocker ${suffix}`, pl: `Blokujący ${suffix}` } }),
      );
      expect(renamed.find((p) => p.code === blocker)?.name).toEqual({ en: `Blocker ${suffix}`, pl: `Blokujący ${suffix}` });
      const recoloured = await priorityList(await call('PATCH', `/priorities/${blocker}`, { color: '#7c3aed' }));
      expect(recoloured.find((p) => p.code === blocker)?.color).toBe('#7c3aed');
      const reordered = await priorityList(await call('PATCH', `/priorities/${blocker}`, { weight: 25 }));
      const order = reordered.map((p) => p.code);
      expect(order.indexOf('high')).toBeLessThan(order.indexOf(blocker));
      expect(order.indexOf(blocker)).toBeLessThan(order.indexOf('normal'));

      const actions = (await auditOf('task_priority', blocker)).map((row) => row.action);
      expect(actions.filter((a) => a === 'tasks.priority.update')).toHaveLength(3);
      expect(actions).toContain('tasks.priority.create');
    });

    it('refuses a taken code, and 404s a missing priority', async () => {
      const taken = await call('POST', '/priorities', {
        code: 'urgent',
        name: { en: 'Again', pl: 'Znowu' },
        color: '#000000',
        weight: 1,
      });
      expect(refusal(taken, 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({ rule: 'priority_code_taken' });
      refusal(await call('PATCH', `/priorities/${code('nowhere')}`, { weight: 3 }), 404, ERROR_CODES.NOT_FOUND);
      refusal(await call('DELETE', `/priorities/${code('nowhere')}`), 404, ERROR_CODES.NOT_FOUND);
    });

    it('sorting by priority follows the operator’s order, a Task without one last', async () => {
      const first = await addPriority('first', 15);
      const token = `Sortable ${suffix}`;
      const atFirst = await create({ title: `${token} first`, priorityCode: first });
      const atUrgent = await create({ title: `${token} urgent`, priorityCode: 'urgent' });
      const atNone = await create({ title: `${token} none` });
      const sorted = async (): Promise<string[]> => {
        const response = await call('GET', `?q=${encodeURIComponent(token)}&sort=priority&dir=asc`);
        expect(response.statusCode, response.body).toBe(200);
        return TaskListResponseSchema.parse(response.json()).items.map((item) => item.id);
      };
      expect(await sorted()).toEqual([atUrgent.id, atFirst.id, atNone.id]);
      await priorityList(await call('PATCH', `/priorities/${first}`, { weight: 1 }));
      expect(await sorted()).toEqual([atFirst.id, atUrgent.id, atNone.id]);
    });

    it('removing a priority in use asks for a replacement, then moves every Task to it — each in its own history, a draft included', async () => {
      const going = await addPriority('going', 35);
      const tasks = [
        await create({ title: 'Going A', priorityCode: going }),
        await create({ title: 'Going B', priorityCode: going }),
      ];
      const draft = await create({ title: 'Going draft', priorityCode: going, draft: true }, writer.cookies);
      const listed = await priorityList(await call('GET', '/priorities'));
      // The administrator does not see the writer's draft.
      expect(listed.find((p) => p.code === going)?.inUseCount).toBe(2);

      expect(refusal(await call('DELETE', `/priorities/${going}`), 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details).toMatchObject({
        rule: 'priority_replacement_required',
      });
      expect(
        refusal(await call('DELETE', `/priorities/${going}?replacement=${going}`), 422, ERROR_CODES.TASK_WORKFLOW_INVALID).details,
      ).toMatchObject({ rule: 'priority_replacement_required' });
      refusal(await call('DELETE', `/priorities/${going}?replacement=${code('nowhere')}`), 422, ERROR_CODES.TASK_PRIORITY_UNKNOWN);
      for (const task of tasks) expect((await read(task.id)).priority?.code).toBe(going);

      const after = await priorityList(await call('DELETE', `/priorities/${going}?replacement=high`));
      expect(after.map((p) => p.code)).not.toContain(going);

      for (const [task, cookies] of [...tasks.map((t) => [t, admin] as const), [draft, writer.cookies] as const]) {
        expect((await read(task.id, cookies)).priority?.code).toBe('high');
        const history = await auditOf('task', task.id);
        const removal = history.filter((row) => row.action === 'tasks.task.priority_change');
        expect(removal.filter((row) => row.stateAfter?.reason === 'priority_removed')).toHaveLength(1);
        expect(removal.find((row) => row.stateAfter?.reason === 'priority_removed')).toMatchObject({
          stateBefore: { priorityCode: going },
          stateAfter: { priorityCode: 'high', reason: 'priority_removed' },
        });
      }
      const deletion = (await auditOf('task_priority', going)).filter((row) => row.action === 'tasks.priority.delete');
      expect(deletion).toHaveLength(1);
      expect(deletion[0]?.stateBefore).toMatchObject({ code: going, replacement: 'high', moved: 3 });
    });

    it('removing a priority with `none` clears it from its Tasks', async () => {
      const fading = await addPriority('fading', 36);
      const task = await create({ title: 'Fading', priorityCode: fading });
      const after = await priorityList(await call('DELETE', `/priorities/${fading}?replacement=none`));
      expect(after.map((p) => p.code)).not.toContain(fading);
      expect((await read(task.id)).priority).toBeNull();
      const removal = (await auditOf('task', task.id)).find(
        (row) => row.action === 'tasks.task.priority_change' && row.stateAfter?.reason === 'priority_removed',
      );
      expect(removal).toMatchObject({ stateBefore: { priorityCode: fading }, stateAfter: { priorityCode: null } });
    });

    /**
     * Issue #507: a Task given a priority while that priority is being removed.
     * A second connection holds the priority row as the removal does, and
     * deletes it once the Task's write is seen waiting on it — so the code check
     * made before the Task's Command has passed, and only a lock inside the
     * Command can refuse. Without one the write commits the removed code.
     */
    describe('a priority removed while a Task is being given it (issue #507)', () => {
      async function whileRemoving(priorityCode: string, write: () => Promise<Awaited<ReturnType<typeof call>>>) {
        const holder = h.em().fork();
        await holder.begin();
        let finished = false;
        try {
          await holder.execute(`select "code" from "task_priorities" where "code" = ? for update`, [priorityCode]);
          const pending = write().finally(() => {
            finished = true;
          });
          // By observation, never by a sleep alone: the write is waiting on the
          // priority row — or it finished without waiting, which is the defect.
          const deadline = Date.now() + 10_000;
          for (;;) {
            const [waiting] = (await h
              .em()
              .getConnection()
              .execute(
                `select count(*)::int as n from pg_stat_activity
                  where wait_event_type = 'Lock' and query ilike '%from "task_priorities"%for share%'`,
              )) as Array<{ n: number }>;
            if (Number(waiting?.n) > 0 || finished) break;
            if (Date.now() > deadline) throw new Error('the Task write neither waited on the priority row nor finished');
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await holder.execute(`delete from "task_priorities" where "code" = ?`, [priorityCode]);
          await holder.commit();
          return await pending;
        } catch (error) {
          await holder.rollback().catch(() => undefined);
          throw error;
        }
      }

      const priorityOf = async (id: string): Promise<string | null> => {
        const [row] = (await h.em().getConnection().execute(`select "priority_code" from "tasks" where "id" = ?`, [
          id,
        ])) as Array<{ priority_code: string | null }>;
        return row?.priority_code ?? null;
      };

      it('a priority change waits for the removal, then answers 422 TASK_PRIORITY_UNKNOWN and keeps the Task’s priority', async () => {
        const going = await addPriority('going', 39);
        const task = await create({ title: 'Raced priority change' });
        const response = await whileRemoving(going, () => call('PATCH', `/${task.id}`, { priorityCode: going }));
        refusal(response, 422, ERROR_CODES.TASK_PRIORITY_UNKNOWN);
        expect(await priorityOf(task.id)).toBeNull();
      });

      it('a create waits for the removal, then answers 422 TASK_PRIORITY_UNKNOWN and creates nothing', async () => {
        const gone = await addPriority('gone', 40);
        const title = `Raced create ${suffix}`;
        const response = await whileRemoving(gone, () => call('POST', '', { title, priorityCode: gone }));
        refusal(response, 422, ERROR_CODES.TASK_PRIORITY_UNKNOWN);
        const rows = (await h.em().getConnection().execute(`select "id" from "tasks" where "title" = ?`, [title])) as unknown[];
        expect(rows).toEqual([]);
      });
    });

    it('a priority nobody holds is removed without a replacement', async () => {
      const unused = await addPriority('unused', 37);
      const after = await priorityList(await call('DELETE', `/priorities/${unused}`));
      expect(after.map((p) => p.code)).not.toContain(unused);
    });

    it(`more than ${TASK_STATUS_REASSIGN_MAX} Tasks holding a priority give 409 TASK_STATUS_IN_USE_TOO_MANY, and nothing moves`, async () => {
      const crowded = await addPriority('crowded', 38);
      const connection = h.em().getConnection();
      await connection.execute(
        `insert into "tasks" ("number", "title", "status", "priority_code", "created_by_admin_user_id", "published_at")
         select ? || g, 'Bulk ' || g, 'todo', ?, ?::uuid, now() from generate_series(1, ?::int) g`,
        [`TSK-PRIO-${suffix}-`, crowded, TEST_ADMIN_ID, TASK_STATUS_REASSIGN_MAX + 1],
      );
      const refused = refusal(
        await call('DELETE', `/priorities/${crowded}?replacement=none`),
        409,
        ERROR_CODES.TASK_STATUS_IN_USE_TOO_MANY,
      );
      expect(refused.details).toMatchObject({ priorityCode: crowded, max: TASK_STATUS_REASSIGN_MAX });
      const [held] = (await connection.execute(`select count(*)::int as n from "tasks" where "priority_code" = ?`, [
        crowded,
      ])) as Array<{ n: number }>;
      expect(Number(held?.n)).toBe(TASK_STATUS_REASSIGN_MAX + 1);
      await connection.execute(`delete from "tasks" where "number" like ?`, [`TSK-PRIO-${suffix}-%`]);
    });

    it('tasks:write without tasks:configure is refused every priority write, and still reads the list', async () => {
      const as = writer.cookies;
      expect((await call('GET', '/priorities', undefined, as)).statusCode).toBe(200);
      const writes = [
        call('POST', '/priorities', { code: code('nope'), name: { en: 'n', pl: 'n' }, color: '#000000', weight: 1 }, as),
        call('PATCH', '/priorities/low', { color: '#000000' }, as),
        call('DELETE', '/priorities/low?replacement=none', undefined, as),
      ];
      for (const response of await Promise.all(writes)) refusal(response, 403, ERROR_CODES.FORBIDDEN);
      const low = (await priorityList(await call('GET', '/priorities'))).find((p) => p.code === 'low');
      expect(low).toBeDefined();
      expect(low?.color).not.toBe('#000000');
    });
  });
});
