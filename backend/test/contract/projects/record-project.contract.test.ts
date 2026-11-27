import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectSummaryResponseSchema, type ProjectDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  createCrmOpportunity,
  seedCrmAdmin,
  seedCrmOrder,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';
import {
  callProjects,
  callTasks,
  createProject,
  createStageTask,
  deleteProjectTasks,
  deleteProjects,
  errorShape,
  stageNamed,
} from '../../integration/projects/helpers.js';

/**
 * `GET /projects/records/:kind/:recordId/project` — which Project a record is
 * in, for the panel on that record's own screen
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.3, research R-11).
 *
 * `projects:read`, and the code the record's owner reads it with: `orders:read`
 * for an Order, `rfqs:handle` for a Quote Request, `crm:read` for an
 * Opportunity, `tasks:read` for a Task. The answer is the Project's summary —
 * number, title, current Stage — or 404 `PROJECT_NOT_FOUND` when the record is
 * in no Project **or in one the caller may not see**: the two are the same
 * answer, byte for byte (FR-020, US5 sc.5). A Task answers through its context.
 */
describe('projects (contract) — the Project of a record', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let reader: Person;
  let projectsOnly: Person;
  let project: ProjectDetail;
  let hidden: ProjectDetail;
  let order: { id: string };
  let unlinkedOrder: { id: string };
  let hiddenOrder: { id: string };
  let quoteRequest: { id: string };
  let opportunity: { id: string };
  let task: { id: string };
  let hiddenTask: { id: string };
  let looseTask: { id: string };
  const created: string[] = [];

  const path = (kind: string, id: string) => `/records/${kind}/${id}/project`;

  async function linkOk(projectId: string, kind: string, recordId: string): Promise<void> {
    const response = await callProjects(h, 'POST', `/${projectId}/links`, { payload: { kind, recordId } });
    expect(response.statusCode, response.body).toBe(201);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    reader = await seedCrmAdmin(h.em(), 'record-reader', [
      'projects:read',
      'orders:read',
      'rfqs:handle',
      'crm:read',
      'tasks:read',
    ]);
    projectsOnly = await seedCrmAdmin(h.em(), 'record-projects-only', ['projects:read']);
    project = await createProject(h, {
      title: 'Record panel',
      organizationIds: [TEST_ORGANIZATION_ID],
      visibility: 'everyone',
    });
    hidden = await createProject(h, {
      title: 'Record panel, hidden',
      organizationIds: [TEST_ORGANIZATION_ID],
      visibility: 'members_and_listed',
    });
    created.push(project.id, hidden.id);
    order = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    unlinkedOrder = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    hiddenOrder = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    quoteRequest = await submitCrmQuoteRequest(h);
    opportunity = await createCrmOpportunity(h, { title: 'Record panel opportunity' });
    await linkOk(project.id, 'order', order.id);
    await linkOk(project.id, 'quote_request', quoteRequest.id);
    await linkOk(project.id, 'opportunity', opportunity.id);
    await linkOk(hidden.id, 'order', hiddenOrder.id);
    task = await createStageTask(h, project.id, stageNamed(project, 'Design'));
    hiddenTask = await createStageTask(h, hidden.id, stageNamed(hidden, 'Design'));
    const loose = await callTasks(h, 'POST', '', { payload: { title: 'A task of nothing' } });
    expect(loose.statusCode, loose.body).toBe(201);
    looseTask = (loose.json() as { data: { id: string } }).data;
  });

  afterAll(async () => {
    for (const p of [reader, projectsOnly]) p?.undo();
    await deleteProjectTasks(h, created);
    if (looseTask) await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [looseTask.id]);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('401 without a session', async () => {
    const response = await callProjects(h, 'GET', path('order', order.id), { cookies: null });
    expect(response.statusCode).toBe(401);
  });

  it('answers the Project of each kind of record — number, title and current Stage', async () => {
    for (const [kind, id] of [
      ['order', order.id],
      ['quote_request', quoteRequest.id],
      ['opportunity', opportunity.id],
      ['task', task.id],
    ] as const) {
      const response = await callProjects(h, 'GET', path(kind, id), { cookies: reader.cookies });
      expect(response.statusCode, `${kind}: ${response.body}`).toBe(200);
      const { data } = ProjectSummaryResponseSchema.parse(response.json());
      expect(data).toMatchObject({ id: project.id, number: project.number, title: project.title });
      expect(data.currentStage?.name).toBe('Design');
    }
  });

  it('a record in no Project, and one in a Project the caller may not see, answer alike — 404 PROJECT_NOT_FOUND', async () => {
    const none = await callProjects(h, 'GET', path('order', unlinkedOrder.id), { cookies: reader.cookies });
    const invisible = await callProjects(h, 'GET', path('order', hiddenOrder.id), { cookies: reader.cookies });
    const missing = await callProjects(h, 'GET', path('order', randomUUID()), { cookies: reader.cookies });
    for (const response of [none, invisible, missing]) expect(response.statusCode, response.body).toBe(404);
    expect(errorShape(none.body)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(errorShape(invisible.body)).toEqual(errorShape(none.body));
    expect(errorShape(missing.body)).toEqual(errorShape(none.body));
  });

  it('a Task answers through its context: none without one, none for a Project the caller may not see', async () => {
    const loose = await callProjects(h, 'GET', path('task', looseTask.id), { cookies: reader.cookies });
    const invisible = await callProjects(h, 'GET', path('task', hiddenTask.id), { cookies: reader.cookies });
    expect(loose.statusCode, loose.body).toBe(404);
    expect(invisible.statusCode, invisible.body).toBe(404);
    expect(errorShape(invisible.body)).toEqual(errorShape(loose.body));
  });

  it('asks for the code the record’s owner reads it with — 403 to a projects:read holder without it', async () => {
    for (const [kind, id] of [
      ['order', order.id],
      ['quote_request', quoteRequest.id],
      ['opportunity', opportunity.id],
      ['task', task.id],
    ] as const) {
      const response = await callProjects(h, 'GET', path(kind, id), { cookies: projectsOnly.cookies });
      expect(response.statusCode, `${kind}: ${response.body}`).toBe(403);
    }
  });

  it('403 without projects:read, whatever else is held', async () => {
    const other = await seedCrmAdmin(h.em(), 'record-no-projects', ['orders:read']);
    try {
      const response = await callProjects(h, 'GET', path('order', order.id), { cookies: other.cookies });
      expect(response.statusCode, response.body).toBe(403);
    } finally {
      other.undo();
    }
  });

  it('refuses a kind that is not a record kind, and an id that is not one — 400', async () => {
    expect((await callProjects(h, 'GET', path('invoice', order.id))).statusCode).toBe(400);
    expect((await callProjects(h, 'GET', path('order', 'not-a-uuid'))).statusCode).toBe(400);
  });
});
