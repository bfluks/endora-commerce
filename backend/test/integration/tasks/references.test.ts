import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRecordReferenceToken,
  RecordDocumentLookupResponseSchema,
  TaskDetailResponseSchema,
  TaskMentionableLookupResponseSchema,
  type RecordReferenceType,
  type TaskDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import {
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

/**
 * References and mentions in a Task's description (`specs/165-task-management/`
 * US1 scenarios 2 and 8, FR-004 – FR-006, research R-5; issue #446).
 *
 * A description holding a token of every one of the seven kinds is resolved
 * **per reader**: each kind only with its owner's read code and while its
 * owner is present; a Task that is gone, or someone else's private Task, like
 * any record the reader may not see, is `available: false` and says nothing
 * about itself. The tokens are kept in `task_references`, refreshed by the
 * Command that saves the text. A person newly mentioned is told once, by the
 * Task's number, unless they are the author or may not see the Task.
 */
describe('tasks — references and mentions in the description (US1, #446)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Reads Tasks and everything referenced, but no Orders. */
  let noOrders: Person;
  /** May be mentioned. */
  let colleague: Person;
  /** May not read Tasks: never told. */
  let outsider: Person;
  let order: { id: string; businessId: string | null };
  let quote: { id: string; businessId: string };
  let opportunity: { id: string; number: string };
  let project: { id: string; number: string };
  let other: TaskDetail;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const createdTasks: string[] = [];
  const createdProjects: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown, cookies = admin) =>
    h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  async function create(body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
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

  const token = (type: RecordReferenceType, id: string) => formatRecordReferenceToken(type, id);
  const stored = async (taskId: string) =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "source_kind", "target_type", "target_id" from "task_references" where "task_id" = ?`, [
          taskId,
        ])) as Array<{ source_kind: string; target_type: string; target_id: string }>
    )
      .map((row) => `${row.source_kind}:${row.target_type}:${row.target_id}`)
      .sort();
  const mentionsOf = (taskId: string) =>
    h
      .em()
      .find(AdminNotification, { subjectId: taskId, kind: 'tasks.task.mention' }, { filters: false, orderBy: { createdAt: 'asc' } });
  const unavailable = (type: RecordReferenceType, id: string) => ({ type, id, available: false, label: null, url: null });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    noOrders = await seedCrmAdmin(h.em(), 'refs-no-orders', [
      'tasks:read',
      'tasks:write',
      'catalog:read',
      'rfqs:handle',
      'crm:read',
      'projects:read',
    ]);
    colleague = await seedCrmAdmin(h.em(), 'refs-colleague', ['tasks:read']);
    outsider = await seedCrmAdmin(h.em(), 'refs-outsider', ['orders:read']);
    order = await seedCrmOrder(h.em());
    quote = await submitCrmQuoteRequest(h);
    opportunity = await createCrmOpportunity(h, { title: 'Referenced deal', organizationId: TEST_ORGANIZATION_ID });
    const projectResponse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/projects',
      cookies: admin,
      payload: {
        title: 'Referenced project',
        organizationIds: [],
        stages: [{ name: 'Only', color: '#3b82f6', plannedDurationDays: 1 }],
      },
    });
    expect(projectResponse.statusCode, projectResponse.body).toBe(201);
    project = (projectResponse.json() as { data: { id: string; number: string } }).data;
    createdProjects.push(project.id);
    other = await create({ title: 'The other Task' });
  });

  afterAll(async () => {
    for (const person of [noOrders, colleague, outsider]) person?.undo();
    const connection = h.em().getConnection();
    if (createdTasks.length > 0) {
      await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${createdTasks.join(',')}}`]);
    }
    if (createdProjects.length > 0) {
      await connection.execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${createdProjects.join(',')}}`]);
    }
    await connection.execute(`delete from "crm_opportunities" where "id" = ?`, [opportunity.id]);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  const allSeven = () =>
    [
      token('admin_user', colleague.adminUserId),
      token('order', order.id),
      token('product', SEED_PRODUCT_101_ID),
      token('quote_request', quote.id),
      token('task', other.id),
      token('opportunity', opportunity.id),
      token('project', project.id),
    ].join(' ');

  it('resolves a token of each of the seven kinds to a named link, and stores one row each', async () => {
    const description = `**Plan** ${allSeven()}`;
    const task = await create({ title: 'Seven kinds', description });
    expect(task.description).toBe(description);
    expect(task.references.map((r) => [r.type, r.available])).toEqual([
      ['admin_user', true],
      ['order', true],
      ['product', true],
      ['quote_request', true],
      ['task', true],
      ['opportunity', true],
      ['project', true],
    ]);
    const byType = new Map(task.references.map((r) => [r.type, r]));
    expect(byType.get('order')).toMatchObject({ label: order.businessId, url: `/orders/${order.id}` });
    expect(byType.get('quote_request')).toMatchObject({ label: quote.businessId, url: `/quote-requests/${quote.id}` });
    expect(byType.get('task')).toMatchObject({ label: other.number, url: `/tasks/${other.id}` });
    expect(byType.get('opportunity')).toMatchObject({
      label: opportunity.number,
      url: `/crm/opportunities/${opportunity.id}`,
    });
    expect(byType.get('project')).toMatchObject({ label: project.number, url: `/projects/${project.id}` });
    expect(byType.get('admin_user')).toMatchObject({ url: null });
    expect(await stored(task.id)).toEqual(
      [
        `description:admin_user:${colleague.adminUserId}`,
        `description:order:${order.id}`,
        `description:product:${SEED_PRODUCT_101_ID}`,
        `description:quote_request:${quote.id}`,
        `description:task:${other.id}`,
        `description:opportunity:${opportunity.id}`,
        `description:project:${project.id}`,
      ].sort(),
    );
  });

  it('shows an Order as unavailable to a reader without orders:read, and leaks nothing of it', async () => {
    const task = await create({ title: 'Order for some', description: `See ${token('order', order.id)}` });
    const response = await call('GET', `/${task.id}`, undefined, noOrders.cookies);
    expect(response.statusCode, response.body).toBe(200);
    expect(TaskDetailResponseSchema.parse(response.json()).data.references).toEqual([unavailable('order', order.id)]);
    expect(response.body).not.toContain(String(order.businessId));
    expect((await read(task.id)).references[0]).toMatchObject({ available: true });
  });

  it('shows an Opportunity as unavailable while CRM is off, and named again once it is back', async () => {
    const task = await create({ title: 'Deal while off', description: token('opportunity', opportunity.id) });
    await withModuleOff('crm', 'deactivated', async () => {
      expect((await read(task.id)).references).toEqual([unavailable('opportunity', opportunity.id)]);
    });
    expect((await read(task.id)).references[0]).toMatchObject({ available: true, label: opportunity.number });
  });

  it('shows a Project as unavailable while Projects is off', async () => {
    const task = await create({ title: 'Project while off', description: token('project', project.id) });
    await withModuleOff('projects', 'deactivated', async () => {
      expect((await read(task.id)).references).toEqual([unavailable('project', project.id)]);
    });
  });

  it('shows a deleted Task, and someone else’s private Task, exactly as one that never existed', async () => {
    const doomed = await create({ title: 'Doomed' });
    expect((await call('DELETE', `/${doomed.id}`)).statusCode).toBe(200);
    const privateId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private", "published_at", "created_at", "updated_at")
         values (?, ?, 'Someone else’s secret', ?, true, now(), now(), now())`,
        [privateId, `TSK-P${privateId.slice(0, 8)}`.toUpperCase(), colleague.adminUserId],
      );
    createdTasks.push(privateId);
    const never = randomUUID();
    const task = await create({
      title: 'Gone and hidden',
      description: `${token('task', doomed.id)} ${token('task', privateId)} ${token('task', never)}`,
    });
    // Read by somebody who does not hold `tasks:see_private` (the harness's administrator holds everything).
    const response = await call('GET', `/${task.id}`, undefined, noOrders.cookies);
    expect(response.statusCode, response.body).toBe(200);
    expect(TaskDetailResponseSchema.parse(response.json()).data.references).toEqual([
      unavailable('task', doomed.id),
      unavailable('task', privateId),
      unavailable('task', never),
    ]);
    expect(response.body).not.toContain('secret');
  });

  it('refreshes the stored rows when the description is edited', async () => {
    const task = await create({ title: 'Edited', description: token('order', order.id) });
    expect(await stored(task.id)).toEqual([`description:order:${order.id}`]);
    const edited = await call('PATCH', `/${task.id}`, { description: `Now ${token('quote_request', quote.id)}` });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(await stored(task.id)).toEqual([`description:quote_request:${quote.id}`]);
    await call('PATCH', `/${task.id}`, { description: 'Nothing referenced' });
    expect(await stored(task.id)).toEqual([]);
  });

  describe('mentions (FR-006)', () => {
    it('tells a newly mentioned colleague once, by number, never on a re-save and never the author', async () => {
      const description = `Ask ${token('admin_user', colleague.adminUserId)} and ${token('admin_user', TEST_ADMIN_ID)}`;
      const task = await create({ title: 'Mentioning', description });
      const told = await mentionsOf(task.id);
      expect(told.map((n) => n.targetAdminUserId)).toEqual([colleague.adminUserId]);
      expect(told[0]!.title).toContain(task.number);
      expect(told[0]!.title).not.toContain('Mentioning');
      expect(told[0]!.linkPath).toBe(`/tasks/${task.id}`);
      // Saving the same text again, or adding words around it, tells nobody again.
      await call('PATCH', `/${task.id}`, { description: `${description} — thanks` });
      expect(await mentionsOf(task.id)).toHaveLength(1);
    });

    it('never tells somebody who may not see the Task', async () => {
      const task = await create({ title: 'Not for them', description: token('admin_user', outsider.adminUserId) });
      expect(await mentionsOf(task.id)).toEqual([]);
    });

    it('offers as mentionable only those who may read the Task', async () => {
      const task = await create({ title: 'Who may be named' });
      const response = await call('GET', `/lookups/mentionable?taskId=${task.id}&q=refs-`);
      expect(response.statusCode, response.body).toBe(200);
      const ids = TaskMentionableLookupResponseSchema.parse(response.json()).data.map((o) => o.id);
      expect(ids).toContain(colleague.adminUserId);
      expect(ids).not.toContain(outsider.adminUserId);
    });

    it('offers as assignees only those who may read Tasks — saving any other answers 422 (T095)', async () => {
      const assignable = async (query: string) => {
        const response = await call('GET', `/lookups/assignees?q=refs-${query}`);
        expect(response.statusCode, response.body).toBe(200);
        return TaskMentionableLookupResponseSchema.parse(response.json()).data.map((o) => o.id);
      };
      // The create form, before there is a Task.
      const onCreate = await assignable('');
      expect(onCreate).toContain(colleague.adminUserId);
      expect(onCreate).not.toContain(outsider.adminUserId);
      // An existing Task, and a draft — whose assignees see it once it is published.
      const task = await create({ title: 'Who may be assigned' });
      const draft = await create({ title: 'A draft to assign', draft: true });
      for (const id of [task.id, draft.id]) {
        const ids = await assignable(`&taskId=${id}`);
        expect(ids, id).toContain(colleague.adminUserId);
        expect(ids, id).not.toContain(outsider.adminUserId);
      }
      expect((await call('PATCH', `/${task.id}`, { assigneeIds: [outsider.adminUserId] })).statusCode).toBe(422);
    });
  });

  describe('the @@ document list', () => {
    it('groups Orders, Quote Requests, Tasks, Opportunities and Projects, each only for its readers and owners', async () => {
      const all = await call('GET', '/lookups/documents?q=');
      expect(all.statusCode, all.body).toBe(200);
      const kinds = RecordDocumentLookupResponseSchema.parse(all.json()).groups.map((g) => g.kind);
      expect(kinds).toEqual(['order', 'quote_request', 'task', 'opportunity', 'project']);

      const narrower = RecordDocumentLookupResponseSchema.parse(
        (await call('GET', '/lookups/documents?q=', undefined, noOrders.cookies)).json(),
      ).groups.map((g) => g.kind);
      expect(narrower).not.toContain('order');

      await withModuleOff('crm', 'deactivated', async () => {
        const groups = RecordDocumentLookupResponseSchema.parse((await call('GET', '/lookups/documents?q=')).json()).groups;
        expect(groups.map((g) => g.kind)).not.toContain('opportunity');
      });

      const byNumber = RecordDocumentLookupResponseSchema.parse(
        (await call('GET', `/lookups/documents?q=${encodeURIComponent(project.number)}`)).json(),
      ).groups.find((g) => g.kind === 'project');
      expect(byNumber?.items.map((i) => i.id)).toEqual([project.id]);
    });
  });
});
