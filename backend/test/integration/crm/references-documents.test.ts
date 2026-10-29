import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatOpportunityReferenceToken,
  OpportunityCommentResponseSchema,
  OpportunityDetailResponseSchema,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { CrmOpportunityReference } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

/**
 * One reference standard in CRM (`specs/163-projects-and-tasks/` FR-044,
 * research R-14): a Quote Request and a Task referred to in an Opportunity's
 * description, note and message are stored, resolved to their number and a
 * link, and shown as unavailable to a reader who may not read them in their
 * owner (`rfqs:handle`, `tasks:read`), when the Task's context hides it, when
 * the target is gone, and while the owning module is off. A text CRM stored
 * before reads exactly as it did.
 */
describe('crm references to Quote Requests and Tasks (FR-044)', () => {
  let h: BackendServerHandle;
  let quote: { id: string; businessId: string };
  let task: { id: string; number: string };
  let hiddenTask: { id: string; number: string };
  /** Reads Opportunities and Orders, and neither Quote Requests nor Tasks. */
  let plainReader: Seeded;
  /** Reads Quote Requests and Tasks too. */
  let fullReader: Seeded;
  const createdTasks: string[] = [];
  const createdOpportunities: string[] = [];

  /** The probe context's visible ids: `hiddenTask`'s context is never among them. */
  const visibleContexts = new Set<string>();
  const shownContext = randomUUID();
  const hiddenContext = randomUUID();

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const detail = async (id: string, cookies: Record<string, string> = CRM_ADMIN) => {
    const response = await call('GET', `/opportunities/${id}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const opportunity = async (body: Record<string, unknown> = {}) => {
    const created = await createCrmOpportunity(h, body);
    createdOpportunities.push(created.id);
    return created;
  };

  const storedReferences = async (opportunityId: string) =>
    (await h.em().find(CrmOpportunityReference, { opportunityId }, { filters: false }))
      .map((row) => `${row.sourceKind}:${row.sourceId ?? '-'}:${row.targetType}:${row.targetId}`)
      .sort();

  async function seedTask(context: { type: string; id: string } | null): Promise<{ id: string; number: string }> {
    const id = randomUUID();
    const number = `TSK-R${id.slice(0, 8)}`.toUpperCase();
    await h.orm.em.getConnection().execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "context_type", "context_id", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, now(), now())`,
      [id, number, `reference ${id}`, TEST_ADMIN_ID, context?.type ?? null, context?.id ?? null],
    );
    createdTasks.push(id);
    return { id, number };
  }

  const quoteToken = (): string => formatOpportunityReferenceToken('quote_request', quote.id);
  const taskToken = (): string => formatOpportunityReferenceToken('task', task.id);
  const resolvedQuote = () => ({
    type: 'quote_request',
    id: quote.id,
    available: true,
    label: quote.businessId,
    url: `/quote-requests/${quote.id}`,
  });
  const resolvedTask = () => ({ type: 'task', id: task.id, available: true, label: task.number, url: `/tasks/${task.id}` });
  const unavailable = (type: 'quote_request' | 'task', id: string) => ({ type, id, available: false, label: null, url: null });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    const probe: TaskContextDescriptor = {
      contextType: 'crm_reference_probe',
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [...visibleContexts],
      visibleContextIds: async (ids) => new Set(ids.filter((id) => visibleContexts.has(id))),
      canSeeAs: async (_adminUserId, id) => visibleContexts.has(id),
      canChangeTasks: async () => false,
      describe: async (ids) =>
        new Map(ids.map((id) => [id, { label: `Probe ${id.slice(0, 4)}`, href: `/probe/${id}`, groups: new Map() }])),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);
    visibleContexts.add(shownContext);

    quote = await submitCrmQuoteRequest(h);
    task = await seedTask({ type: 'crm_reference_probe', id: shownContext });
    hiddenTask = await seedTask({ type: 'crm_reference_probe', id: hiddenContext });
    plainReader = await seedCrmAdmin(h.em(), 'refdoc-plain', ['crm:read', 'crm:write', 'orders:read']);
    fullReader = await seedCrmAdmin(h.em(), 'refdoc-full', ['crm:read', 'crm:write', 'orders:read', 'rfqs:handle', 'tasks:read']);
  });

  afterAll(async () => {
    // The rows of the two new types are removed with their Opportunities, so
    // no later file of this worker meets them under a narrower constraint.
    for (const id of createdOpportunities) await call('DELETE', `/opportunities/${id}`);
    if (createdTasks.length > 0) {
      await h.orm.em.getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${createdTasks.join(',')}}`]);
    }
    plainReader?.undo();
    fullReader?.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('stored and resolved', () => {
    it('in the description: a number and a link each, in the order they are mentioned, and one row each', async () => {
      const description = `Quote ${quoteToken()}, follow-up ${taskToken()}.`;
      const created = await opportunity({ description });

      const read = await detail(created.id);
      expect(read.description).toBe(description);
      expect(read.references).toEqual([resolvedQuote(), resolvedTask()]);
      expect(await storedReferences(created.id)).toEqual(
        [`description:-:quote_request:${quote.id}`, `description:-:task:${task.id}`].sort(),
      );
    });

    it('in a note and in a message, when written', async () => {
      const created = await opportunity();
      for (const kind of ['note', 'message'] as const) {
        const body = `${kind}: ${taskToken()} and ${quoteToken()}`;
        const written = await call('POST', `/opportunities/${created.id}/comments`, { kind, body });
        expect(written.statusCode, written.body).toBe(201);
        const comment = OpportunityCommentResponseSchema.parse(written.json()).data;
        expect(comment.body).toBe(body);
        expect(comment.references).toEqual([resolvedTask(), resolvedQuote()]);
        expect(await storedReferences(created.id)).toEqual(
          expect.arrayContaining([`comment:${comment.id}:task:${task.id}`, `comment:${comment.id}:quote_request:${quote.id}`]),
        );
      }
      expect(await storedReferences(created.id)).toHaveLength(4);
    });
  });

  describe('unavailable', () => {
    it('to a reader without rfqs:handle and tasks:read — no number, no link; the control reads both', async () => {
      const description = `${quoteToken()} ${taskToken()}`;
      const created = await opportunity({ description });

      const response = await call('GET', `/opportunities/${created.id}`, undefined, plainReader.cookies);
      expect(response.statusCode, response.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(response.json()).data.references).toEqual([
        unavailable('quote_request', quote.id),
        unavailable('task', task.id),
      ]);
      // Nothing of either leaks elsewhere in the answer (a quote number may be as short as `1`).
      expect(response.body).not.toContain(`/quote-requests/${quote.id}`);
      expect(response.body).not.toContain(task.number);

      expect((await detail(created.id, fullReader.cookies)).references).toEqual([resolvedQuote(), resolvedTask()]);
    });

    it('for a Task its context hides, exactly as for a Task that does not exist', async () => {
      const gone = randomUUID();
      const description = `${formatOpportunityReferenceToken('task', hiddenTask.id)} ${formatOpportunityReferenceToken('task', gone)} ${taskToken()}`;
      const created = await opportunity({ description });
      const read = await detail(created.id);
      expect(read.references).toEqual([unavailable('task', hiddenTask.id), unavailable('task', gone), resolvedTask()]);
      expect(JSON.stringify(read)).not.toContain(hiddenTask.number);
      // Stored all the same: what a reader may see is decided when it is read.
      expect(await storedReferences(created.id)).toEqual(
        [`description:-:task:${hiddenTask.id}`, `description:-:task:${gone}`, `description:-:task:${task.id}`].sort(),
      );
    });

    it('for a Quote Request that does not exist', async () => {
      const gone = randomUUID();
      const created = await opportunity({ description: formatOpportunityReferenceToken('quote_request', gone) });
      expect((await detail(created.id)).references).toEqual([unavailable('quote_request', gone)]);
    });

    it('while Tasks are off, and resolved again once they are back', async () => {
      const description = `${taskToken()} ${quoteToken()}`;
      const created = await opportunity({ description });
      await withModuleOff('tasks', 'deactivated', async () => {
        const read = await detail(created.id);
        expect(read.description).toBe(description);
        expect(read.references).toEqual([unavailable('task', task.id), resolvedQuote()]);
        // A text is still saved with a Task in it while Tasks are off.
        const written = await call('POST', `/opportunities/${created.id}/comments`, { kind: 'note', body: taskToken() });
        expect(written.statusCode, written.body).toBe(201);
        expect(OpportunityCommentResponseSchema.parse(written.json()).data.references).toEqual([unavailable('task', task.id)]);
      });
      expect((await detail(created.id)).references).toEqual([resolvedTask(), resolvedQuote()]);
    });

    it('while Quote Requests are off, and resolved again once they are back', async () => {
      const description = `${quoteToken()} ${taskToken()}`;
      const created = await opportunity({ description });
      await withModuleOff('quote_requests', 'deactivated', async () => {
        expect((await detail(created.id)).references).toEqual([unavailable('quote_request', quote.id), resolvedTask()]);
      });
      expect((await detail(created.id)).references).toEqual([resolvedQuote(), resolvedTask()]);
    });
  });

  it('reads a text written with the three earlier types byte for byte as before, and stores the same rows', async () => {
    const order = await seedCrmOrder(h.em());
    const person = randomUUID();
    const description =
      `**Deal** with ${formatOpportunityReferenceToken('admin_user', person)} — ` +
      `${formatOpportunityReferenceToken('order', order.id)} and ${formatOpportunityReferenceToken('product', SEED_PRODUCT_101_ID)}` +
      ` [[order:not-a-uuid]] [[invoice:${randomUUID()}]] <b>x</b>\n- one\n2. two`;
    const created = await opportunity({ description });
    const body = `Note ${formatOpportunityReferenceToken('order', order.id)} ~~struck~~ [site](https://example.com)`;
    const written = await call('POST', `/opportunities/${created.id}/comments`, { kind: 'note', body });
    expect(written.statusCode, written.body).toBe(201);
    const noteId = OpportunityCommentResponseSchema.parse(written.json()).data.id;

    const read = await detail(created.id);
    expect(Buffer.from(read.description ?? '', 'utf8').equals(Buffer.from(description, 'utf8'))).toBe(true);
    expect(read.references.map((reference) => `${reference.type}:${reference.available}`)).toEqual([
      'admin_user:false',
      'order:true',
      'product:true',
    ]);
    const listed = (await call('GET', `/opportunities/${created.id}/comments?kind=note`)).json() as {
      data: Array<{ id: string; body: string }>;
    };
    expect(listed.data.find((comment) => comment.id === noteId)?.body).toBe(body);
    expect(await storedReferences(created.id)).toEqual(
      [
        `description:-:admin_user:${person}`,
        `description:-:order:${order.id}`,
        `description:-:product:${SEED_PRODUCT_101_ID}`,
        `comment:${noteId}:order:${order.id}`,
      ].sort(),
    );
  });
});
