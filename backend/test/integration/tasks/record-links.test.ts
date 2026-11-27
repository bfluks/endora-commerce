import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RecordHistoryPageSchema,
  TaskContextLookupResponseSchema,
  TaskDetailResponseSchema,
  TaskLinkResponseSchema,
  TaskListResponseSchema,
  TaskRecordLookupResponseSchema,
  type TaskDetail,
  type TaskLink,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

/**
 * Links from a Task to an Opportunity, an Order and a Quote Request
 * (`specs/165-task-management/` User Story 6, FR-031 – FR-033, research R-16;
 * quickstart US6 row).
 *
 * A link is validated when it is made — the record's owner present, the
 * caller holding the owner's read code, the record findable through its port
 * — and refused otherwise with 422 `TASK_LINK_INVALID`. Linking a record twice
 * is **idempotent**: the second call answers the existing link (200) and
 * records nothing. A link **does not narrow or widen who sees the Task**
 * (Q2 = A): a reader who may not read the record still sees the Task, with
 * the link unavailable. While the owner is off the link is unavailable and
 * kept; it is named again when the owner is back. Each link and unlink is in
 * the Task's history. `GET /tasks?linkedKind=&linkedId=` lists the visible
 * Tasks linked to one record — what the record's *Tasks* panel reads.
 *
 * The Project/Stage picker (scenario 3: a Task placed in a Project behaves as
 * in feature 163) reads `GET /tasks/lookups/contexts`, through each present
 * context owner's descriptor.
 */
describe('tasks — links to Opportunities, Orders and Quote Requests (US6)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Reads and writes Tasks and reads Orders and Quote Requests, but not CRM. */
  let noCrm: Person;
  /** Reads Tasks only. */
  let reader: Person;
  let order: { id: string; businessId: string | null };
  let quote: { id: string; businessId: string };
  let opportunity: { id: string; number: string };
  let project: { id: string; number: string; stageId: string };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const createdTasks: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown, cookies = admin) =>
    h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  function refusal(response: Awaited<ReturnType<typeof call>>, status: number, code: string): void {
    expect(response.statusCode, response.body).toBe(status);
    expect((response.json() as { error: { code: string } }).error.code).toBe(code);
  }

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

  async function link(taskId: string, kind: string, id: string, cookies = admin): Promise<{ status: number; link: TaskLink }> {
    const response = await call('POST', `/${taskId}/links`, { kind, id }, cookies);
    expect([200, 201], response.body).toContain(response.statusCode);
    return { status: response.statusCode, link: TaskLinkResponseSchema.parse(response.json()).data };
  }

  async function history(id: string): Promise<Array<{ action: string; before: unknown; after: unknown }>> {
    const response = await call('GET', `/${id}/history?limit=50`);
    expect(response.statusCode, response.body).toBe(200);
    return RecordHistoryPageSchema.parse(response.json()).data;
  }

  async function linkedTo(kind: string, id: string, cookies = admin): Promise<string[]> {
    const response = await call('GET', `?linkedKind=${kind}&linkedId=${id}&limit=100`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskListResponseSchema.parse(response.json()).items.map((task) => task.id);
  }

  const storedLinks = async (taskId: string): Promise<string[]> =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "record_kind", "record_id" from "task_record_links" where "task_id" = ?`, [taskId])) as Array<{
        record_kind: string;
        record_id: string;
      }>
    )
      .map((row) => `${row.record_kind}:${row.record_id}`)
      .sort();

  const unavailable = (kind: string, recordId: string) =>
    expect.objectContaining({ kind, recordId, available: false, label: null, url: null });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    noCrm = await seedCrmAdmin(h.em(), 'links-no-crm', ['tasks:read', 'tasks:write', 'orders:read', 'rfqs:handle']);
    reader = await seedCrmAdmin(h.em(), 'links-reader', ['tasks:read']);
    order = await seedCrmOrder(h.em());
    quote = await submitCrmQuoteRequest(h);
    opportunity = await createCrmOpportunity(h, { title: 'Linked deal', organizationId: TEST_ORGANIZATION_ID });
    const projectResponse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/projects',
      cookies: admin,
      payload: {
        title: 'Linked project picker',
        organizationIds: [],
        stages: [{ name: 'Survey', color: '#3b82f6', plannedDurationDays: 1 }],
      },
    });
    expect(projectResponse.statusCode, projectResponse.body).toBe(201);
    const created = (projectResponse.json() as { data: { id: string; number: string; stages: Array<{ id: string }> } })
      .data;
    project = { id: created.id, number: created.number, stageId: created.stages[0]!.id };
  });

  afterAll(async () => {
    for (const person of [noCrm, reader]) person?.undo();
    const connection = h.em().getConnection();
    if (createdTasks.length > 0) {
      await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${createdTasks.join(',')}}`]);
    }
    if (project) await connection.execute(`delete from "projects" where "id" = ?`, [project.id]);
    if (opportunity) await connection.execute(`delete from "crm_opportunities" where "id" = ?`, [opportunity.id]);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('links a new Task to an Opportunity, an Order and a Quote Request, each shown named, with its address', async () => {
    const task = await create({
      title: 'Follow up the deal',
      links: [
        { kind: 'quote_request', id: quote.id },
        { kind: 'order', id: order.id },
        { kind: 'opportunity', id: opportunity.id },
        // The same record twice is one link.
        { kind: 'order', id: order.id },
      ],
    });
    expect(task.links.map((l) => [l.kind, l.recordId, l.available, l.label, l.url])).toEqual([
      ['opportunity', opportunity.id, true, opportunity.number, `/crm/opportunities/${opportunity.id}`],
      ['order', order.id, true, order.businessId, `/orders/${order.id}`],
      ['quote_request', quote.id, true, quote.businessId, `/quote-requests/${quote.id}`],
    ]);
    expect(await storedLinks(task.id)).toEqual(
      [`opportunity:${opportunity.id}`, `order:${order.id}`, `quote_request:${quote.id}`].sort(),
    );
    const [creation] = (await history(task.id)).filter((entry) => entry.action === 'tasks.task.create');
    expect(creation?.after).toMatchObject({
      links: [
        { kind: 'quote_request', recordId: quote.id },
        { kind: 'order', recordId: order.id },
        { kind: 'opportunity', recordId: opportunity.id },
      ],
    });
  });

  it('links and unlinks an existing Task — idempotently — and records each in its history', async () => {
    const task = await create({ title: 'Linked later' });
    const first = await link(task.id, 'order', order.id);
    expect(first.status).toBe(201);
    expect(first.link).toMatchObject({ kind: 'order', recordId: order.id, available: true, label: order.businessId });
    const again = await link(task.id, 'order', order.id);
    expect(again.status).toBe(200);
    expect(again.link.id).toBe(first.link.id);
    expect((await read(task.id)).links.map((l) => l.id)).toEqual([first.link.id]);

    const removed = await call('DELETE', `/${task.id}/links/${first.link.id}`);
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await read(task.id)).links).toEqual([]);
    refusal(await call('DELETE', `/${task.id}/links/${first.link.id}`), 404, 'NOT_FOUND');

    const entries = (await history(task.id)).filter((entry) => entry.action.startsWith('tasks.task.'));
    const linkEntries = entries.filter((e) => e.action === 'tasks.task.link' || e.action === 'tasks.task.unlink');
    // Newest first: one link, one unlink — the second link call recorded nothing.
    expect(linkEntries.map((e) => [e.action, e.before, e.after])).toEqual([
      ['tasks.task.unlink', { link: { kind: 'order', recordId: order.id } }, { link: null }],
      ['tasks.task.link', { link: null }, { link: { kind: 'order', recordId: order.id } }],
    ]);
  });

  it('refuses a record that does not exist, of any kind — 422 TASK_LINK_INVALID — and creates nothing', async () => {
    const task = await create({ title: 'Nothing to link' });
    for (const kind of ['opportunity', 'order', 'quote_request']) {
      refusal(await call('POST', `/${task.id}/links`, { kind, id: randomUUID() }), 422, 'TASK_LINK_INVALID');
    }
    const before = await h.em().getConnection().execute(`select count(*)::int as n from "tasks"`);
    refusal(
      await call('POST', '', { title: 'Never made', links: [{ kind: 'order', id: randomUUID() }] }),
      422,
      'TASK_LINK_INVALID',
    );
    expect(await h.em().getConnection().execute(`select count(*)::int as n from "tasks"`)).toEqual(before);
    expect(await storedLinks(task.id)).toEqual([]);
  });

  it('refuses a record the caller may not read — no crm:read — with the same 422', async () => {
    const task = await create({ title: 'Not my deal', assigneeIds: [] }, noCrm.cookies);
    refusal(
      await call('POST', `/${task.id}/links`, { kind: 'opportunity', id: opportunity.id }, noCrm.cookies),
      422,
      'TASK_LINK_INVALID',
    );
    refusal(
      await call('POST', '', { title: 'Not my deal either', links: [{ kind: 'opportunity', id: opportunity.id }] }, noCrm.cookies),
      422,
      'TASK_LINK_INVALID',
    );
    // What they may read, they may link.
    expect((await link(task.id, 'order', order.id, noCrm.cookies)).status).toBe(201);
  });

  it('refuses a reader without tasks:write (403), and a Task the caller may not see (404)', async () => {
    const task = await create({ title: 'Read only' });
    refusal(await call('POST', `/${task.id}/links`, { kind: 'order', id: order.id }, reader.cookies), 403, 'FORBIDDEN');
    refusal(await call('POST', `/${randomUUID()}/links`, { kind: 'order', id: order.id }), 404, 'TASK_NOT_FOUND');
    refusal(await call('POST', `/${task.id}/links`, { kind: 'project', id: project.id }), 400, 'VALIDATION_FAILED');
  });

  it('leaves the Task visible to a reader who may not read the record, with the link unavailable (Q2 = A)', async () => {
    const task = await create({ title: 'Visible anyway', links: [{ kind: 'opportunity', id: opportunity.id }] });
    const response = await call('GET', `/${task.id}`, undefined, noCrm.cookies);
    expect(response.statusCode, response.body).toBe(200);
    const seen = TaskDetailResponseSchema.parse(response.json()).data;
    expect(seen.links).toEqual([unavailable('opportunity', opportunity.id)]);
    expect(response.body).not.toContain(opportunity.number);
    // The link widens nothing either: the record's Tasks are listed by visibility alone.
    expect(await linkedTo('opportunity', opportunity.id, noCrm.cookies)).toContain(task.id);
  });

  it('lists the visible Tasks linked to one record — and not a private Task the reader may not see', async () => {
    const shown = await create({ title: 'On the order', links: [{ kind: 'order', id: order.id }] });
    const hidden = await create({ title: 'Private on the order', links: [{ kind: 'order', id: order.id }] });
    await h.em().getConnection().execute(`update "tasks" set "is_private" = true where "id" = ?`, [hidden.id]);
    const elsewhere = await create({ title: 'Not on the order' });
    const forReader = await linkedTo('order', order.id, reader.cookies);
    expect(forReader).toContain(shown.id);
    expect(forReader).not.toContain(hidden.id);
    expect(forReader).not.toContain(elsewhere.id);
  });

  it('shows a link unavailable while CRM is off, keeps it, refuses a new one, and names it again when CRM is back', async () => {
    const task = await create({ title: 'Deal while off', links: [{ kind: 'opportunity', id: opportunity.id }] });
    const spare = await create({ title: 'Spare' });
    await withModuleOff('crm', 'deactivated', async () => {
      expect((await read(task.id)).links).toEqual([unavailable('opportunity', opportunity.id)]);
      refusal(
        await call('POST', `/${spare.id}/links`, { kind: 'opportunity', id: opportunity.id }),
        422,
        'TASK_LINK_INVALID',
      );
      expect(await storedLinks(task.id)).toEqual([`opportunity:${opportunity.id}`]);
    });
    expect((await read(task.id)).links).toEqual([
      expect.objectContaining({ kind: 'opportunity', available: true, label: opportunity.number }),
    ]);
  });

  it('lets a link of a switched-off owner be removed', async () => {
    const task = await create({ title: 'Removed while off', links: [{ kind: 'quote_request', id: quote.id }] });
    const [only] = (await read(task.id)).links;
    await withModuleOff('quote_requests', 'deactivated', async () => {
      expect((await read(task.id)).links).toEqual([unavailable('quote_request', quote.id)]);
      const removed = await call('DELETE', `/${task.id}/links/${only!.id}`);
      expect(removed.statusCode, removed.body).toBe(204);
    });
    expect(await storedLinks(task.id)).toEqual([]);
  });

  it('refuses another Task’s link id, and a malformed one — 404', async () => {
    const one = await create({ title: 'One', links: [{ kind: 'order', id: order.id }] });
    const two = await create({ title: 'Two' });
    const [theirs] = (await read(one.id)).links;
    refusal(await call('DELETE', `/${two.id}/links/${theirs!.id}`), 404, 'NOT_FOUND');
    refusal(await call('DELETE', `/${two.id}/links/not-a-uuid`), 404, 'NOT_FOUND');
    expect(await storedLinks(one.id)).toEqual([`order:${order.id}`]);
  });

  describe('the link picker — GET /tasks/lookups/records', () => {
    const records = async (kind: string, q: string, cookies = admin) => {
      const response = await call('GET', `/lookups/records?kind=${kind}&q=${encodeURIComponent(q)}`, undefined, cookies);
      expect(response.statusCode, response.body).toBe(200);
      return TaskRecordLookupResponseSchema.parse(response.json()).data;
    };

    it('offers the records of each kind by number, each only to its readers and while its owner is on', async () => {
      expect((await records('opportunity', opportunity.number)).map((o) => o.id)).toEqual([opportunity.id]);
      expect((await records('order', String(order.businessId))).map((o) => o.id)).toContain(order.id);
      expect((await records('quote_request', quote.businessId)).map((o) => o.id)).toEqual([quote.id]);
      expect(await records('opportunity', opportunity.number, noCrm.cookies)).toEqual([]);
      await withModuleOff('crm', 'deactivated', async () => {
        expect(await records('opportunity', opportunity.number)).toEqual([]);
      });
    });

    it('is a writer’s — 403 for a reader', async () => {
      refusal(await call('GET', '/lookups/records?kind=order&q=', undefined, reader.cookies), 403, 'FORBIDDEN');
    });
  });

  describe('the Project/Stage picker — GET /tasks/lookups/contexts (scenario 3)', () => {
    const contexts = async (q: string) => {
      const response = await call('GET', `/lookups/contexts?q=${encodeURIComponent(q)}`);
      expect(response.statusCode, response.body).toBe(200);
      return TaskContextLookupResponseSchema.parse(response.json()).data;
    };

    it('offers a Project with its Stages, and a Task placed there behaves as in feature 163', async () => {
      const found = await contexts(project.number);
      expect(found).toEqual([
        { contextType: 'project', id: project.id, label: expect.stringContaining(project.number), groups: [{ id: project.stageId, label: 'Survey' }] },
      ]);
      const task = await create({ title: 'Into the Project' });
      const placed = await call('PATCH', `/${task.id}`, {
        context: { contextType: 'project', contextId: project.id, contextGroupId: project.stageId },
      });
      expect(placed.statusCode, placed.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(placed.json()).data.context).toMatchObject({
        type: 'project',
        id: project.id,
        groupId: project.stageId,
        groupLabel: 'Survey',
      });
    });

    it('offers nothing of a context owner that is off', async () => {
      await withModuleOff('projects', 'deactivated', async () => {
        expect(await contexts(project.number)).toEqual([]);
      });
    });
  });
});
