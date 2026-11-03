import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { savedListViewListResponseSchema, savedListViewResponseSchema, type SavedListView } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmSalesRep } from '../../helpers/seed-crm.js';

/**
 * The Tasks list's saved views (`specs/165-task-management/` FR-021, research
 * R-13; T049) on the feature-147 rules: a view is its owner's, optionally
 * shared with everyone who may read Tasks; one view serves the list and the
 * board, since it stores filters and sort, not results; a shared view is
 * modified or deleted only by its owner or a platform administrator (for
 * saved views: an administrator whose tenant scope is `all` — every role but
 * the Sales Representative's); one owner holds no two names that differ only
 * by case and spaces (409 `TASK_VIEW_NAME_TAKEN`).
 *
 * Every name carries a per-run suffix: the stub administrator is shared with
 * other files, and the duplicate rule would trip on another file's leftovers.
 */
describe('tasks — saved views (US3, feature-147 rules)', () => {
  let h: BackendServerHandle;
  type Person = Awaited<ReturnType<typeof seedCrmAdmin>>;
  /** A Sales Representative: not a platform administrator for saved views. */
  let rep: Person;
  /** Another administrator on a custom role: a platform administrator for saved views. */
  let colleague: Person;
  /** No `tasks:read`. */
  let outsider: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const URL = '/api/v1/admin/tasks/list-views';
  const run = randomUUID().slice(0, 8);
  const created: string[] = [];

  async function create(person: { b2b_session: string }, payload: Record<string, unknown>) {
    const response = await h.app.inject({ method: 'POST', url: URL, cookies: person, payload: { filters: {}, shared: false, ...payload } });
    if (response.statusCode === 201) created.push(savedListViewResponseSchema.parse(response.json()).data.id);
    return response;
  }

  async function listAs(person: { b2b_session: string }): Promise<SavedListView[]> {
    const response = await h.app.inject({ method: 'GET', url: URL, cookies: person });
    expect(response.statusCode, response.body).toBe(200);
    return savedListViewListResponseSchema.parse(response.json()).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    rep = await seedCrmSalesRep(h.em(), [], ['tasks:read']);
    colleague = await seedCrmAdmin(h.em(), 'tasks-views-colleague', ['tasks:read']);
    outsider = await seedCrmAdmin(h.em(), 'tasks-views-outsider', ['orders:read']);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from "task_list_saved_views" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    rep.undo();
    colleague.undo();
    outsider.undo();
    await teardownBackendServer(h);
  });

  it('answers the views envelope on GET list-views, not a Task 404 (route precedence)', async () => {
    const response = await h.app.inject({ method: 'GET', url: URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
    expect(Array.isArray((response.json() as { data: unknown }).data)).toBe(true);
  });

  it('saves a view with filters and sort, lists it back with them, and the list applies them', async () => {
    const filters = { statusCategory: ['open'], priority: ['high'], assignee: ['me'], tagId: [randomUUID()] };
    const response = await create(rep.cookies, {
      name: `  My installs ${run}  `,
      filters,
      sort: { field: 'due', dir: 'asc' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const view = savedListViewResponseSchema.parse(response.json()).data;
    expect(view).toMatchObject({ name: `My installs ${run}`, shared: false, ownedByCaller: true, canModify: true });

    const listed = (await listAs(rep.cookies)).find((candidate) => candidate.id === view.id)!;
    expect(listed.filters).toEqual(filters);
    expect(listed.sort).toEqual({ field: 'due', dir: 'asc' });

    // Applying a view is replaying its filters on the list (and the board): the
    // server answers them, an unknown tag matching nothing rather than 422.
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(listed.filters)) {
      for (const value of values as string[]) params.append(key, value);
    }
    for (const path of ['', '/board']) {
      const applied = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/tasks${path}?${params.toString()}`,
        cookies: rep.cookies,
      });
      expect(applied.statusCode, applied.body).toBe(200);
    }
  });

  it('keeps a private view its owner’s alone; another administrator gets 404 on it', async () => {
    const response = await create(admin, { name: `Private ${run}` });
    expect(response.statusCode, response.body).toBe(201);
    const id = savedListViewResponseSchema.parse(response.json()).data.id;
    expect((await listAs(rep.cookies)).some((view) => view.id === id)).toBe(false);
    const patched = await h.app.inject({ method: 'PATCH', url: `${URL}/${id}`, cookies: rep.cookies, payload: { shared: true } });
    expect(patched.statusCode).toBe(404);
  });

  it('shows a shared view to everyone who reads Tasks; only its owner or a platform administrator may change it', async () => {
    const response = await create(admin, { name: `Shared ${run}`, shared: true, filters: { overdue: true } });
    expect(response.statusCode, response.body).toBe(201);
    const id = savedListViewResponseSchema.parse(response.json()).data.id;

    const seenByRep = (await listAs(rep.cookies)).find((view) => view.id === id)!;
    expect(seenByRep).toMatchObject({ shared: true, ownedByCaller: false, canModify: false, filters: { overdue: true } });

    const refusedPatch = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${id}`,
      cookies: rep.cookies,
      payload: { name: `Taken over ${run}` },
    });
    expect(refusedPatch.statusCode).toBe(403);
    const refusedDelete = await h.app.inject({ method: 'DELETE', url: `${URL}/${id}`, cookies: rep.cookies });
    expect(refusedDelete.statusCode).toBe(403);

    const seenByColleague = (await listAs(colleague.cookies)).find((view) => view.id === id)!;
    expect(seenByColleague.canModify).toBe(true);
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${id}`,
      cookies: colleague.cookies,
      payload: { filters: { overdue: false } },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(savedListViewResponseSchema.parse(patched.json()).data.filters).toEqual({ overdue: false });
    const deleted = await h.app.inject({ method: 'DELETE', url: `${URL}/${id}`, cookies: colleague.cookies });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({ data: { deleted: id } });
  });

  it('refuses a second name of one owner that differs only by case and spaces — 409 TASK_VIEW_NAME_TAKEN', async () => {
    expect((await create(rep.cookies, { name: `Due soon ${run}` })).statusCode).toBe(201);
    const again = await create(rep.cookies, { name: `  DUE SOON ${run} ` });
    expect(again.statusCode, again.body).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe('TASK_VIEW_NAME_TAKEN');
    // Another owner may use the name.
    expect((await create(colleague.cookies, { name: `Due soon ${run}` })).statusCode).toBe(201);
  });

  it('refuses filters over 8 KB as a validation failure, as every saved-view list does', async () => {
    const response = await create(rep.cookies, { name: `Big ${run}`, filters: { q: 'x'.repeat(9000) } });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('is `tasks:read`: an administrator without it gets 403 on every route', async () => {
    const id = randomUUID();
    const answers = await Promise.all([
      h.app.inject({ method: 'GET', url: URL, cookies: outsider.cookies }),
      h.app.inject({ method: 'POST', url: URL, cookies: outsider.cookies, payload: { name: `X ${run}`, shared: false, filters: {} } }),
      h.app.inject({ method: 'PATCH', url: `${URL}/${id}`, cookies: outsider.cookies, payload: { shared: true } }),
      h.app.inject({ method: 'DELETE', url: `${URL}/${id}`, cookies: outsider.cookies }),
    ]);
    expect(answers.map((answer) => answer.statusCode)).toEqual([403, 403, 403, 403]);
  });
});
