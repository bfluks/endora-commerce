import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TASK_BOARD_DEFAULT_CARD_FIELDS,
  TaskBoardCardConfigResponseSchema,
  TaskBoardResponseSchema,
  TaskListResponseSchema,
  TaskWorkflowResponseSchema,
  type TaskBoard,
  type TaskSummary,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * `GET /tasks/board` (`specs/165-task-management/` research R-11, FR-019,
 * FR-020, FR-022; T048) — one column per status in workflow order, each with
 * the count of **every** visible Task in it under the filters, its first
 * `perColumn` cards and whether there are more; and the card fields the
 * operator chose, with their values.
 *
 * The board and the list are two views of one set: for every filter of US3
 * scenario 4 — custom fields included — each column's count equals the number
 * of Tasks the list answers in that status under the same filters (quickstart
 * US3 row). Drafts and private Tasks are counted only for their Creator: the
 * viewer here is an administrator **without** `tasks:see_private` (the stub
 * administrator holds `*`, so it would see someone else's private Task).
 *
 * Tasks are seeded in SQL, as the list's contract test does; every title
 * carries one token, so `q` scopes every request to them.
 */
describe('tasks (contract) — the board (R-11)', () => {
  let h: BackendServerHandle;
  type Person = Awaited<ReturnType<typeof seedCrmAdmin>>;
  /** Reads and writes Tasks; no `tasks:see_private`. The viewer of every comparison. */
  let viewer: Person;
  /** Creator of a draft and a private Task the viewer must not count. */
  let other: Person;
  /** Reads Tasks; may not configure them. */
  let reader: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const DEFINITIONS = '/api/v1/admin/custom-fields/definitions';
  const token = `brd${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const region = `region_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const linkedOrder = randomUUID();
  const tag = { a: randomUUID(), b: randomUUID() };
  const id = {
    t1: randomUUID(),
    t2: randomUUID(),
    t3: randomUUID(),
    t4: randomUUID(),
    t5: randomUUID(),
    t6: randomUUID(),
    ownDraft: randomUUID(),
    otherDraft: randomUUID(),
    otherPrivate: randomUUID(),
  };
  const definitionIds: string[] = [];

  async function board(person: { b2b_session: string }, query: string): Promise<TaskBoard> {
    const response = await h.app.inject({ method: 'GET', url: `${API}/board?q=${token}&${query}`, cookies: person });
    expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
    return TaskBoardResponseSchema.parse(response.json()).data;
  }

  /** Every Task the list answers under `query`, paging. */
  async function listed(person: { b2b_session: string }, query: string): Promise<TaskSummary[]> {
    const out: TaskSummary[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const response = await h.app.inject({
        method: 'GET',
        url: `${API}?q=${token}&${query}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        cookies: person,
      });
      expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
      const page = TaskListResponseSchema.parse(response.json());
      out.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) return out;
    }
    throw new Error('the list did not end');
  }

  /** Per status code, how many Tasks the list answers. */
  function perStatus(items: readonly TaskSummary[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of items) out[item.status.code] = (out[item.status.code] ?? 0) + 1;
    return out;
  }

  /** Per status code, the board's count — zero columns left out, as `perStatus` leaves them. */
  function counts(answer: TaskBoard): Record<string, number> {
    return Object.fromEntries(answer.columns.filter((c) => c.count > 0).map((c) => [c.status.code, c.count]));
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    viewer = await seedCrmAdmin(h.em(), 'tasks-board-viewer', ['tasks:read', 'tasks:write']);
    other = await seedCrmAdmin(h.em(), 'tasks-board-other', ['tasks:read', 'tasks:write']);
    reader = await seedCrmAdmin(h.em(), 'tasks-board-reader', ['tasks:read']);

    const definition = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS,
      cookies: admin,
      payload: {
        entityType: 'task',
        key: region,
        label: { en: 'Region' },
        labelDefault: 'Region',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        listFilter: true,
        options: [],
      },
    });
    expect(definition.statusCode, definition.body).toBe(201);
    definitionIds.push((definition.json() as { data: { id: string } }).data.id);

    const connection = h.orm.em.getConnection();
    const rows: Array<{
      id: string;
      status: string;
      priority: string | null;
      dueOn: string | null;
      parent: string | null;
      creator: string;
      draft?: boolean;
      private?: boolean;
      region?: string;
    }> = [
      { id: id.t1, status: 'todo', priority: 'urgent', dueOn: '2020-01-10', parent: null, creator: viewer.adminUserId, region: 'North' },
      { id: id.t2, status: 'todo', priority: 'high', dueOn: '2099-06-01', parent: null, creator: TEST_ADMIN_ID, region: 'South' },
      { id: id.t3, status: 'todo', priority: null, dueOn: null, parent: id.t1, creator: viewer.adminUserId },
      { id: id.t4, status: 'in_progress', priority: 'urgent', dueOn: '2020-02-01', parent: null, creator: TEST_ADMIN_ID, region: 'North' },
      { id: id.t5, status: 'done', priority: 'low', dueOn: '2020-01-10', parent: null, creator: viewer.adminUserId },
      { id: id.t6, status: 'cancelled', priority: null, dueOn: null, parent: id.t4, creator: TEST_ADMIN_ID },
      { id: id.ownDraft, status: 'todo', priority: null, dueOn: null, parent: null, creator: viewer.adminUserId, draft: true },
      { id: id.otherDraft, status: 'todo', priority: null, dueOn: null, parent: null, creator: other.adminUserId, draft: true },
      { id: id.otherPrivate, status: 'in_progress', priority: null, dueOn: null, parent: null, creator: other.adminUserId, private: true },
    ];
    let n = 0;
    for (const row of rows) {
      n += 1;
      await connection.execute(
        `insert into "tasks" ("id", "number", "title", "status", "priority_code", "due_on", "parent_task_id",
           "created_by_admin_user_id", "is_draft", "is_private", "published_at", "custom_field_values", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${row.draft ? 'null' : 'now()'}, ?::jsonb, now() - make_interval(mins => ?::int), now())`,
        [
          row.id,
          `TSK-B${token}-${n}`,
          `${token} ${n}`,
          row.status,
          row.priority,
          row.dueOn,
          row.parent,
          row.creator,
          row.draft ?? false,
          row.private ?? false,
          JSON.stringify(row.region ? { [region]: row.region } : {}),
          n,
        ],
      );
    }
    await connection.execute(`insert into "task_tags" ("id", "name") values (?, ?), (?, ?)`, [
      tag.a,
      `${token} A`,
      tag.b,
      `${token} B`,
    ]);
    await connection.execute(
      `insert into "task_tag_assignments" ("task_id", "tag_id") values (?, ?), (?, ?), (?, ?), (?, ?)`,
      [id.t1, tag.a, id.t1, tag.b, id.t2, tag.a, id.t4, tag.b],
    );
    await connection.execute(
      `insert into "task_assignees" ("task_id", "admin_user_id") values (?, ?), (?, ?), (?, ?), (?, ?)`,
      [id.t1, viewer.adminUserId, id.t2, other.adminUserId, id.t4, viewer.adminUserId, id.t5, other.adminUserId],
    );
    await connection.execute(
      `insert into "task_record_links" ("task_id", "record_kind", "record_id", "linked_by_admin_user_id") values (?, 'order', ?, ?)`,
      [id.t2, linkedOrder, TEST_ADMIN_ID],
    );
  });

  afterAll(async () => {
    const connection = h.orm.em.getConnection();
    await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${Object.values(id).join(',')}}`]);
    await connection.execute(`delete from "task_tags" where "id" = any(?::uuid[])`, [`{${tag.a},${tag.b}}`]);
    await h.app.inject({
      method: 'PUT',
      url: `${API}/board/card-fields`,
      cookies: admin,
      payload: { fields: [...TASK_BOARD_DEFAULT_CARD_FIELDS] },
    });
    for (const definitionId of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS}/${definitionId}`, cookies: admin });
    }
    viewer.undo();
    other.undo();
    reader.undo();
    await teardownBackendServer(h);
  });

  it('answers one column per status, in the workflow’s weight order, even an empty one', async () => {
    const workflow = await h.app.inject({ method: 'GET', url: `${API}/workflow`, cookies: viewer.cookies });
    const statuses = TaskWorkflowResponseSchema.parse(workflow.json()).data.statuses;
    const expected = [...statuses].sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code)).map((s) => s.code);
    const answer = await board(viewer.cookies, '');
    expect(answer.columns.map((column) => column.status.code)).toEqual(expected);
    const todo = answer.columns.find((column) => column.status.code === 'todo')!;
    expect(todo.status).toEqual({ code: 'todo', name: 'To do', color: '#64748b', category: 'open' });
  });

  it('counts every Task of a column, sends the first `perColumn` and says whether there are more', async () => {
    const answer = await board(viewer.cookies, 'perColumn=2');
    const column = (code: string) => answer.columns.find((c) => c.status.code === code)!;
    // To do: t1, t2, t3 and the viewer's own draft.
    expect(column('todo').count).toBe(4);
    expect(column('todo').items).toHaveLength(2);
    expect(column('todo').hasMore).toBe(true);
    expect(column('in_progress').count).toBe(1);
    expect(column('in_progress').items.map((item) => item.id)).toEqual([id.t4]);
    expect(column('in_progress').hasMore).toBe(false);
    // The cards are the list's own page for that status, in the list's order.
    const firstTwo = (await listed(viewer.cookies, 'status=todo')).slice(0, 2).map((item) => item.id);
    expect(column('todo').items.map((item) => item.id)).toEqual(firstTwo);
  });

  it('refuses a `perColumn` outside 1–50 and a cursor or a sort — 400', async () => {
    for (const query of ['perColumn=0', 'perColumn=51', 'sort=title', 'cursor=abc']) {
      const response = await h.app.inject({ method: 'GET', url: `${API}/board?${query}`, cookies: viewer.cookies });
      expect(response.statusCode, query).toBe(400);
    }
  });

  describe('a column’s count equals the list’s total in that status, under every filter (US3 scenario 4)', () => {
    const filters = (): string[] => [
      '',
      'status=todo',
      'status=todo&status=done',
      'status=not_a_status',
      'statusCategory=open',
      'statusCategory=done&statusCategory=cancelled',
      'assignee=me',
      'assignee=none',
      `assignee=${other.adminUserId}`,
      'assignee=me&assignee=none',
      'creator=me',
      `creator=${TEST_ADMIN_ID}`,
      'priority=urgent',
      'priority=none&priority=high',
      'priority=not_a_priority',
      `tagId=${tag.a}`,
      `tagId=${tag.a}&tagId=${tag.b}`,
      'dueFrom=2020-01-01&dueTo=2020-01-31',
      'dueFrom=2050-01-01',
      'overdue=true',
      'overdue=false',
      `linkedKind=order&linkedId=${linkedOrder}`,
      `parentId=${id.t1}`,
      'isSubtask=true',
      'isSubtask=false',
      'hasSubtasks=true',
      'hasSubtasks=false',
      'draft=true',
      'draft=false',
      'private=false',
      `customFieldFilters=${encodeURIComponent(JSON.stringify({ [region]: { contains: 'nor' } }))}`,
      `customFieldFilters=${encodeURIComponent(JSON.stringify({ [region]: { contains: 'sou' } }))}&priority=high`,
    ];

    it('for each filter', async () => {
      for (const query of filters()) {
        const list = perStatus(await listed(viewer.cookies, query));
        expect(counts(await board(viewer.cookies, query)), query).toEqual(list);
      }
    });

    it('and the filters narrow as the list does — spot checks', async () => {
      expect(counts(await board(viewer.cookies, 'overdue=true'))).toEqual({ todo: 1, in_progress: 1 });
      expect(counts(await board(viewer.cookies, `tagId=${tag.a}&tagId=${tag.b}`))).toEqual({ todo: 1 });
      expect(
        counts(
          await board(
            viewer.cookies,
            `customFieldFilters=${encodeURIComponent(JSON.stringify({ [region]: { contains: 'nor' } }))}`,
          ),
        ),
      ).toEqual({ todo: 1, in_progress: 1 });
      expect(counts(await board(viewer.cookies, 'status=not_a_status'))).toEqual({});
    });
  });

  it('counts drafts and private Tasks only for their Creator', async () => {
    const forViewer = await board(viewer.cookies, '');
    const forOther = await board(other.cookies, '');
    const count = (answer: TaskBoard, code: string) => answer.columns.find((c) => c.status.code === code)!.count;
    // The viewer: t1, t2, t3 and their own draft — not the other's draft.
    expect(count(forViewer, 'todo')).toBe(4);
    expect(count(forViewer, 'in_progress')).toBe(1);
    // The other: t1, t2, t3 and their own draft; t4 and their private Task.
    expect(count(forOther, 'todo')).toBe(4);
    expect(count(forOther, 'in_progress')).toBe(2);
    const cards = (answer: TaskBoard) => answer.columns.flatMap((c) => c.items.map((item) => item.id));
    expect(cards(forViewer)).not.toContain(id.otherDraft);
    expect(cards(forViewer)).not.toContain(id.otherPrivate);
    expect(cards(forOther)).not.toContain(id.ownDraft);
    expect(cards(forOther)).toEqual(expect.arrayContaining([id.otherDraft, id.otherPrivate]));
  });

  it('*My Tasks* takes the same filters, with `assignee=me`, open and published implied (US3 scenario 6)', async () => {
    const mine = async (query: string) => {
      const response = await h.app.inject({ method: 'GET', url: `${API}/mine?q=${token}&${query}`, cookies: viewer.cookies });
      expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
      return (response.json() as { data: TaskSummary[] }).data.map((item) => item.id);
    };
    // The viewer is assigned t1 (To do) and t4 (In progress); soonest due first.
    expect(await mine('')).toEqual([id.t1, id.t4]);
    expect(await mine(`tagId=${tag.a}`)).toEqual([id.t1]);
    expect(await mine('priority=high')).toEqual([]);
    expect(await mine('status=in_progress')).toEqual([id.t4]);
    // What is implied is not taken.
    const refused = await h.app.inject({ method: 'GET', url: `${API}/mine?assignee=none`, cookies: viewer.cookies });
    expect(refused.statusCode).toBe(400);
  });

  describe('card fields (FR-022)', () => {
    it('are read on `tasks:read`, written on `tasks:configure`, and validated against what is offered', async () => {
      const read = await h.app.inject({ method: 'GET', url: `${API}/board/card-fields`, cookies: reader.cookies });
      expect(read.statusCode, read.body).toBe(200);
      const config = TaskBoardCardConfigResponseSchema.parse(read.json()).data;
      expect(config.maxFields).toBe(6);
      expect(config.available.map((field) => field.ref)).toEqual(
        expect.arrayContaining(['builtin:number', 'builtin:assignees', 'builtin:due', `custom:${region}`]),
      );

      const refused = await h.app.inject({
        method: 'PUT',
        url: `${API}/board/card-fields`,
        cookies: viewer.cookies,
        payload: { fields: ['builtin:number'] },
      });
      expect(refused.statusCode).toBe(403);

      const unknown = await h.app.inject({
        method: 'PUT',
        url: `${API}/board/card-fields`,
        cookies: admin,
        payload: { fields: ['builtin:number', 'custom:not_a_field'] },
      });
      expect(unknown.statusCode, unknown.body).toBe(422);

      const tooMany = await h.app.inject({
        method: 'PUT',
        url: `${API}/board/card-fields`,
        cookies: admin,
        payload: {
          fields: ['builtin:number', 'builtin:assignees', 'builtin:due', 'builtin:priority', 'builtin:tags', 'builtin:startOn', 'builtin:context'],
        },
      });
      expect(tooMany.statusCode).toBe(400);
    });

    it('carry the configured values on each card, in the configured order', async () => {
      const set = await h.app.inject({
        method: 'PUT',
        url: `${API}/board/card-fields`,
        cookies: admin,
        payload: { fields: [`custom:${region}`, 'builtin:number', 'builtin:priority', 'builtin:tags'] },
      });
      expect(set.statusCode, set.body).toBe(200);
      expect(TaskBoardCardConfigResponseSchema.parse(set.json()).data.fields.map((field) => field.ref)).toEqual([
        `custom:${region}`,
        'builtin:number',
        'builtin:priority',
        'builtin:tags',
      ]);

      const answer = await board(viewer.cookies, 'status=todo&perColumn=50');
      const card = answer.columns.find((c) => c.status.code === 'todo')!.items.find((item) => item.id === id.t1)!;
      expect(card.cardFields?.map((field) => field.ref)).toEqual([
        `custom:${region}`,
        'builtin:number',
        'builtin:priority',
        'builtin:tags',
      ]);
      const value = (ref: string) => card.cardFields!.find((field) => field.ref === ref)!.value;
      expect(value(`custom:${region}`)).toBe('North');
      expect(value('builtin:number')).toBe(card.number);
      expect(value('builtin:priority')).toMatchObject({ code: 'urgent' });
      expect((value('builtin:tags') as Array<{ id: string }>).map((t) => t.id).sort()).toEqual([tag.a, tag.b].sort());
      // A Task without a value for the field shows nothing for it.
      const t3 = answer.columns.find((c) => c.status.code === 'todo')!.items.find((item) => item.id === id.t3)!;
      expect(t3.cardFields!.find((field) => field.ref === `custom:${region}`)!.value).toBeNull();

      // The list carries no card fields unless asked — a board lane's further cards ask.
      const page = await listed(viewer.cookies, 'status=todo');
      expect(page.every((item) => item.cardFields === undefined)).toBe(true);
      const lane = await listed(viewer.cookies, 'status=todo&cardValues=true');
      expect(lane.find((item) => item.id === id.t1)!.cardFields).toEqual(card.cardFields);
    });
  });
});
