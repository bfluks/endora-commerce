import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TASK_LIST_SORTS, TaskListResponseSchema, type TaskListSort, type TaskSummary } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * `GET /tasks`, generalised (`specs/165-task-management/` research R-12, T023):
 * every sort in both directions on the keyset cursor, nulls last, and every
 * filter the list gained — one case each. Unknown codes and ids match nothing
 * (200, empty), never 422.
 *
 * Five Tasks carry one token in their titles, so `q` scopes every request to
 * them; they are seeded in SQL because priorities, tags, parents and links get
 * their write paths in later stories. A sixth, a draft of another admin, is a
 * sub-task the caller may not see: the sub-task count must leave it out.
 */
describe('tasks (contract) — the generalised list (R-12)', () => {
  let h: BackendServerHandle;
  let other: Awaited<ReturnType<typeof seedCrmAdmin>>;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const token = `lst${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const id = { t1: randomUUID(), t2: randomUUID(), t3: randomUUID(), t4: randomUUID(), t5: randomUUID(), hidden: randomUUID() };
  const tag = { a: randomUUID(), b: randomUUID() };
  const linkedOrder = randomUUID();

  interface Seed {
    id: string;
    number: string;
    title: string;
    status: string;
    priority: string | null;
    dueOn: string | null;
    dueAt: string | null;
    createdAt: string;
    updatedAt: string;
    parent: string | null;
  }
  let seeds: Seed[] = [];

  /** The joined weights of the seeded workflow and priorities. */
  const STATUS_WEIGHT: Record<string, number> = { todo: 10, in_progress: 20, done: 30, cancelled: 40 };
  const PRIORITY_WEIGHT: Record<string, number> = { urgent: 10, high: 20, normal: 30, low: 40 };

  function keyOf(seed: Seed, sort: TaskListSort): string | number | null {
    switch (sort) {
      case 'created':
        return seed.createdAt;
      case 'updated':
        return seed.updatedAt;
      case 'number':
        return seed.number;
      case 'title':
        return seed.title.toLowerCase();
      case 'due':
        return seed.dueOn === null ? null : `${seed.dueOn}${seed.dueAt ? `T${seed.dueAt.slice(11, 19)}` : 'T~'}`;
      case 'priority':
        return seed.priority === null ? null : PRIORITY_WEIGHT[seed.priority]!;
      case 'status':
        return STATUS_WEIGHT[seed.status] ?? null;
    }
  }

  /** The order the list must answer: the key in `dir`, nulls last in both directions, then the id in `dir`. */
  function expected(sort: TaskListSort, dir: 'asc' | 'desc'): string[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...seeds]
      .sort((x, y) => {
        const a = keyOf(x, sort);
        const b = keyOf(y, sort);
        if (a === null && b !== null) return 1;
        if (b === null && a !== null) return -1;
        if (a !== null && b !== null && a !== b) return (a < b ? -1 : 1) * sign;
        return (x.id < y.id ? -1 : 1) * sign;
      })
      .map((seed) => seed.id);
  }

  async function page(query: string): Promise<{ items: TaskSummary[]; nextCursor: string | null }> {
    const response = await h.app.inject({ method: 'GET', url: `${API}?q=${token}&${query}`, cookies: admin });
    expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
    return TaskListResponseSchema.parse(response.json());
  }

  /** Every Task of the token under `query`, paging two at a time. */
  async function all(query: string): Promise<TaskSummary[]> {
    const out: TaskSummary[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const result: { items: TaskSummary[]; nextCursor: string | null } = await page(
        `${query}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      out.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) return out;
    }
    throw new Error('the list did not end');
  }

  const ids = async (query: string) => (await all(query)).map((task) => task.id).sort();
  const sorted = (...values: string[]) => [...values].sort();

  beforeAll(async () => {
    h = await setupBackendServer();
    other = await seedCrmAdmin(h.em(), 'tasks-list-other', ['tasks:read', 'tasks:write']);
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 8, minutes)).toISOString();
    seeds = [
      { id: id.t1, number: `TSK-L${token}-3`, title: `b ${token}`, status: 'todo', priority: 'urgent', dueOn: '2026-12-01', dueAt: null, createdAt: at(1), updatedAt: at(50), parent: null },
      { id: id.t2, number: `TSK-L${token}-1`, title: `A ${token}`, status: 'done', priority: 'low', dueOn: '2026-12-01', dueAt: '2026-12-01T08:00:00.000Z', createdAt: at(2), updatedAt: at(40), parent: null },
      { id: id.t3, number: `TSK-L${token}-5`, title: `c ${token}`, status: 'in_progress', priority: null, dueOn: null, dueAt: null, createdAt: at(3), updatedAt: at(30), parent: id.t1 },
      { id: id.t4, number: `TSK-L${token}-2`, title: `d ${token}`, status: 'cancelled', priority: 'high', dueOn: '2026-11-01', dueAt: null, createdAt: at(4), updatedAt: at(20), parent: id.t1 },
      { id: id.t5, number: `TSK-L${token}-4`, title: `e ${token}`, status: 'in_review', priority: null, dueOn: null, dueAt: null, createdAt: at(5), updatedAt: at(10), parent: null },
    ];
    const connection = h.orm.em.getConnection();
    for (const seed of seeds) {
      await connection.execute(
        `insert into "tasks" ("id", "number", "title", "status", "priority_code", "due_on", "due_at", "parent_task_id",
           "created_by_admin_user_id", "published_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seed.id,
          seed.number,
          seed.title,
          seed.status,
          seed.priority,
          seed.dueOn,
          seed.dueAt,
          seed.parent,
          seed.id === id.t2 ? other.adminUserId : TEST_ADMIN_ID,
          seed.createdAt,
          seed.createdAt,
          seed.updatedAt,
        ],
      );
    }
    // A sub-task of T1 nobody but its Creator may see — a draft of another admin.
    await connection.execute(
      `insert into "tasks" ("id", "number", "title", "status", "parent_task_id", "is_draft", "created_by_admin_user_id", "created_at", "updated_at")
       values (?, ?, 'hidden draft', 'done', ?, true, ?, now(), now())`,
      [id.hidden, `TSK-L${token}-9`, id.t1, other.adminUserId],
    );
    await connection.execute(
      `insert into "task_tags" ("id", "name") values (?, ?), (?, ?)`,
      [tag.a, `${token} A`, tag.b, `${token} B`],
    );
    await connection.execute(
      `insert into "task_tag_assignments" ("task_id", "tag_id") values (?, ?), (?, ?), (?, ?), (?, ?)`,
      [id.t1, tag.a, id.t1, tag.b, id.t2, tag.a, id.t4, tag.b],
    );
    await connection.execute(
      `insert into "task_assignees" ("task_id", "admin_user_id") values (?, ?), (?, ?), (?, ?)`,
      [id.t1, TEST_ADMIN_ID, id.t2, other.adminUserId, id.t2, TEST_ADMIN_ID],
    );
    await connection.execute(
      `insert into "task_record_links" ("task_id", "record_kind", "record_id", "linked_by_admin_user_id") values (?, 'order', ?, ?)`,
      [id.t4, linkedOrder, TEST_ADMIN_ID],
    );
  });

  afterAll(async () => {
    const connection = h.orm.em.getConnection();
    await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${Object.values(id).join(',')}}`]);
    await connection.execute(`delete from "task_tags" where "id" = any(?::uuid[])`, [`{${tag.a},${tag.b}}`]);
    other.undo();
    await teardownBackendServer(h);
  });

  describe('sorts — every key, both directions, nulls last, across pages', () => {
    for (const sort of TASK_LIST_SORTS) {
      for (const dir of ['asc', 'desc'] as const) {
        it(`sort=${sort}&dir=${dir}`, async () => {
          const listed = (await all(`sort=${sort}&dir=${dir}`)).map((task) => task.id);
          expect(listed).toEqual(expected(sort, dir));
        });
      }
    }

    it('without a sort: newest first, as in 163', async () => {
      expect((await all('')).map((task) => task.id)).toEqual(expected('created', 'desc'));
    });

    it('a cursor issued for one sort is refused under another — 400', async () => {
      const first = await page('sort=title&dir=asc&limit=2');
      const response = await h.app.inject({
        method: 'GET',
        url: `${API}?q=${token}&sort=due&dir=asc&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
        cookies: admin,
      });
      expect(response.statusCode, response.body).toBe(400);
    });
  });

  describe('filters', () => {
    it('status (codes): any of; an unknown code matches nothing', async () => {
      expect(await ids('status=in_progress')).toEqual([id.t3]);
      expect(await ids('status=todo&status=done')).toEqual(sorted(id.t1, id.t2));
      expect(await ids('status=not_a_status')).toEqual([]);
    });

    it('statusCategory: any of; a status the workflow does not hold closes nothing, so it is open', async () => {
      expect(await ids('statusCategory=open')).toEqual(sorted(id.t1, id.t3, id.t5));
      expect(await ids('statusCategory=done')).toEqual([id.t2]);
      expect(await ids('statusCategory=cancelled')).toEqual([id.t4]);
      expect(await ids('statusCategory=open&statusCategory=done')).toEqual(sorted(id.t1, id.t2, id.t3, id.t5));
    });

    it('assignee: any of me, none and ids', async () => {
      expect(await ids(`assignee=${other.adminUserId}`)).toEqual([id.t2]);
      expect(await ids('assignee=none')).toEqual(sorted(id.t3, id.t4, id.t5));
      expect(await ids('assignee=me')).toEqual(sorted(id.t1, id.t2));
      expect(await ids('assignee=me&assignee=none')).toEqual(sorted(id.t1, id.t2, id.t3, id.t4, id.t5));
      expect(await ids(`assignee=${randomUUID()}`)).toEqual([]);
    });

    it('creator: me or an id', async () => {
      expect(await ids('creator=me')).toEqual(sorted(id.t1, id.t3, id.t4, id.t5));
      expect(await ids(`creator=${other.adminUserId}`)).toEqual([id.t2]);
    });

    it('priority: any of, `none` for a Task without one; an unknown code matches nothing', async () => {
      expect(await ids('priority=urgent')).toEqual([id.t1]);
      expect(await ids('priority=urgent&priority=high')).toEqual(sorted(id.t1, id.t4));
      expect(await ids('priority=none')).toEqual(sorted(id.t3, id.t5));
      expect(await ids('priority=not_a_priority')).toEqual([]);
    });

    it('tagId: every tag named must be carried (AND); an unknown tag matches nothing', async () => {
      expect(await ids(`tagId=${tag.a}`)).toEqual(sorted(id.t1, id.t2));
      expect(await ids(`tagId=${tag.a}&tagId=${tag.b}`)).toEqual([id.t1]);
      expect(await ids(`tagId=${randomUUID()}`)).toEqual([]);
    });

    it('parentId, isSubtask and hasSubtasks', async () => {
      expect(await ids(`parentId=${id.t1}`)).toEqual(sorted(id.t3, id.t4));
      expect(await ids('isSubtask=true')).toEqual(sorted(id.t3, id.t4));
      expect(await ids('isSubtask=false')).toEqual(sorted(id.t1, id.t2, id.t5));
      expect(await ids('hasSubtasks=true')).toEqual([id.t1]);
      expect(await ids('hasSubtasks=false')).toEqual(sorted(id.t2, id.t3, id.t4, id.t5));
      expect(await ids(`parentId=${randomUUID()}`)).toEqual([]);
    });

    it('linkedKind with linkedId: the Tasks linked to that record; an unknown record matches nothing', async () => {
      expect(await ids(`linkedKind=order&linkedId=${linkedOrder}`)).toEqual([id.t4]);
      expect(await ids(`linkedKind=opportunity&linkedId=${linkedOrder}`)).toEqual([]);
      expect(await ids(`linkedKind=order&linkedId=${randomUUID()}`)).toEqual([]);
    });
  });

  describe('each row', () => {
    it('counts the sub-tasks the reader may see, closed and in all — the hidden draft left out', async () => {
      const rows = await all('');
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(id.t1)!.subtasks).toEqual({ closed: 1, total: 2 });
      expect(byId.get(id.t2)!.subtasks).toEqual({ closed: 0, total: 0 });
      expect(byId.get(id.t3)!.parent).toEqual({ id: id.t1, number: `TSK-L${token}-3`, available: true });
    });

    it('carries the status, the closed flag, the priority, the tags and the assignees', async () => {
      const rows = await all('');
      const t1 = rows.find((row) => row.id === id.t1)!;
      expect(t1.status).toEqual({ code: 'todo', name: 'To do', color: '#64748b', category: 'open' });
      expect(t1.closed).toBe(false);
      expect(t1.priority).toMatchObject({ code: 'urgent', name: 'Urgent' });
      expect(t1.tags.map((t) => t.id).sort()).toEqual(sorted(tag.a, tag.b));
      expect(t1.assignees.map((a) => a.id)).toEqual([TEST_ADMIN_ID]);
      const t2 = rows.find((row) => row.id === id.t2)!;
      expect(t2.closed).toBe(true);
      expect(t2.dueAt).toBe('2026-12-01T08:00:00.000Z');
      expect(t2.assignees.map((a) => a.id).sort()).toEqual(sorted(TEST_ADMIN_ID, other.adminUserId));
    });
  });
});
