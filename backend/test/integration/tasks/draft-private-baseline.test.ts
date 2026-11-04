import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskReadPort, TaskSummary } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * The draft/private baseline (`specs/165-task-management/` research R-3,
 * T012): every read path born in Phase 2 already honours the one predicate.
 *
 * The Tasks are seeded straight into the database — creating a draft or a
 * private Task through the API arrives with User Story 8. Admin A creates a
 * draft and a private Task, both assigned to admin B as well, so that nothing
 * but the visibility rule keeps them out of B's *My Tasks*. For B each is
 * absent from the list, *My Tasks*, the read port and global search, and its
 * address answers exactly as a Task that does not exist. A, the Creator, sees
 * both (the control).
 */
describe('tasks — drafts and private Tasks are invisible to everyone else (R-3 baseline)', () => {
  let h: BackendServerHandle;
  type Person = Awaited<ReturnType<typeof seedCrmAdmin>>;
  let creator: Person;
  let other: Person;
  const API = '/api/v1/admin/tasks';
  /** Lower-case alphanumeric: global search folds case. */
  const token = `dpb${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const ids: Record<'draft' | 'private' | 'published', string> = {
    draft: randomUUID(),
    private: randomUUID(),
    published: randomUUID(),
  };

  async function seed(id: string, flags: { draft: boolean; private: boolean }, label: string): Promise<void> {
    const connection = h.orm.em.getConnection();
    await connection.execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_draft", "is_private", "published_at", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ${flags.draft ? 'null' : 'now()'}, now(), now())`,
      [id, `TSK-DP${id.slice(0, 8)}`, `${token} ${label}`, creator.adminUserId, flags.draft, flags.private],
    );
    await connection.execute(
      `insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at") values (?, ?, now()), (?, ?, now())`,
      [id, creator.adminUserId, id, other.adminUserId],
    );
  }

  function get(path: string, person: Person) {
    return h.app.inject({ method: 'GET', url: `${API}${path}`, cookies: person.cookies });
  }

  async function listed(person: Person): Promise<string[]> {
    const response = await get(`?q=${token}&limit=100`, person);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: TaskSummary[] }).items.map((item) => item.id).sort();
  }

  async function mine(person: Person): Promise<string[]> {
    const response = await get('/mine', person);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: TaskSummary[] }).data
      .map((item) => item.id)
      .filter((id) => Object.values(ids).includes(id))
      .sort();
  }

  async function searched(person: Person): Promise<string[]> {
    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${token}&entityTypes=tasks.task&language=en&limit=25`,
      cookies: person.cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { data: { groups: Array<{ entityType: string; hits: Array<{ id: string }> }> } };
    return (body.data.groups.find((group) => group.entityType === 'tasks.task')?.hits ?? []).map((hit) => hit.id).sort();
  }

  /** The read port, asked under the context one of this person's requests would carry. */
  function asPerson<T>(person: Person, act: (port: TaskReadPort) => Promise<T>): Promise<T> {
    const port = h.container.resolve<TaskReadPort>('taskReadPort');
    return runWithTenantContext({ mode: 'all', actor: { kind: 'admin', id: person.adminUserId } }, () => act(port));
  }

  /** A 404 body without its request id, which differs per request by design. */
  function notFoundShape(body: string) {
    const parsed = JSON.parse(body) as { error: Record<string, unknown> };
    const { requestId: _requestId, ...rest } = parsed.error;
    return rest;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    creator = await seedCrmAdmin(h.em(), 'tasks-dp-creator', ['tasks:read', 'tasks:write']);
    other = await seedCrmAdmin(h.em(), 'tasks-dp-other', ['tasks:read', 'tasks:write']);
    await seed(ids.draft, { draft: true, private: false }, 'draft');
    await seed(ids.private, { draft: false, private: true }, 'private');
    await seed(ids.published, { draft: false, private: false }, 'published');
  });

  afterAll(async () => {
    await h.orm.em
      .getConnection()
      .execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${Object.values(ids).join(',')}}`]);
    creator.undo();
    other.undo();
    await teardownBackendServer(h);
  });

  const sorted = (...values: string[]) => [...values].sort();

  it('the Creator sees their draft and their private Task everywhere (the control)', async () => {
    expect(await listed(creator)).toEqual(sorted(ids.draft, ids.private, ids.published));
    // *My Tasks* implies "no draft" for everyone, the Creator included (admin-api §1).
    expect(await mine(creator)).toEqual(sorted(ids.private, ids.published));
    for (const id of Object.values(ids)) expect((await get(`/${id}`, creator)).statusCode).toBe(200);
    expect(await searched(creator)).toEqual(sorted(ids.draft, ids.private, ids.published));
  });

  it('GET /tasks and /tasks/mine leave both out for another admin', async () => {
    expect(await listed(other)).toEqual([ids.published]);
    expect(await mine(other)).toEqual([ids.published]);
  });

  it('GET /tasks/:id answers both exactly as a Task that does not exist', async () => {
    const missing = await get(`/${randomUUID()}`, other);
    expect(missing.statusCode).toBe(404);
    for (const id of [ids.draft, ids.private]) {
      const hidden = await get(`/${id}`, other);
      expect(hidden.statusCode).toBe(404);
      expect(notFoundShape(hidden.body)).toEqual(notFoundShape(missing.body));
    }
  });

  it('taskReadPort.findById, findByIds and search leave both out', async () => {
    expect(await asPerson(other, (port) => port.findById(ids.draft))).toBeNull();
    expect(await asPerson(other, (port) => port.findById(ids.private))).toBeNull();
    const found = await asPerson(other, (port) => port.findByIds(Object.values(ids)));
    expect(found.map((task) => task.id)).toEqual([ids.published]);
    const searchedByPort = await asPerson(other, (port) => port.search({ q: token, limit: 20 }));
    expect(searchedByPort.map((task) => task.id)).toEqual([ids.published]);
    // The Creator's own reads keep them.
    const own = await asPerson(creator, (port) => port.findByIds(Object.values(ids)));
    expect(own.map((task) => task.id).sort()).toEqual(sorted(ids.draft, ids.private, ids.published));
  });

  it('the global search provider leaves both out', async () => {
    expect(await searched(other)).toEqual([ids.published]);
  });
});
