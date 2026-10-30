import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  formatRecordReferenceToken,
  RecordDocumentLookupResponseSchema,
  TASKS_EVENTS,
  TaskBoardResponseSchema,
  TaskDetailResponseSchema,
  type TaskDetail,
  type TaskReadPort,
  type TaskSummary,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { multipartBody } from '../../helpers/crm-attachment-upload.js';
import { createCrmOpportunity, restoreDefaultCrmWorkflow, seedCrmAdmin } from '../../helpers/seed-crm.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import type { TaskReminderService } from '../../../../packages/modules/tasks/src/backend/services/reminder-service.js';

/**
 * User Story 8 — drafts and private Tasks, the write side
 * (`specs/165-task-management/` spec US8, FR-037, FR-038, FR-041, SC-005;
 * research R-3; T076). `draft-private-baseline.test.ts` (T012) holds the read
 * paths of Phase 2 over seeded rows; this file creates both through the API
 * and covers every surface added since.
 *
 * The people: Ann creates; Ben may read and write Tasks, CRM and Projects but
 * not see private Tasks; Sam holds `tasks:see_private` with `tasks:write`;
 * Rae holds `tasks:see_private` with `tasks:read` only. The harness's
 * administrator holds `*` and sets up the records.
 */
describe('tasks — drafts and private Tasks (US8)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let ann: Person;
  let ben: Person;
  let sam: Person;
  let rae: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  /** Lower-case alphanumeric: searches fold case. */
  const token = `dpw${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const createdTasks: string[] = [];
  const createdProjects: string[] = [];
  const createdOpportunities: string[] = [];

  type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  const call = (method: Method, path: string, payload?: unknown, cookies: Record<string, string> = ann.cookies) =>
    h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  async function create(body: Record<string, unknown>, cookies: Record<string, string> = ann.cookies): Promise<TaskDetail> {
    const response = await call('POST', '', { ...body, title: `${token} ${String(body['title'] ?? 'Task')}` }, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    createdTasks.push(data.id);
    return data;
  }

  async function read(id: string, cookies: Record<string, string> = ann.cookies): Promise<TaskDetail> {
    const response = await call('GET', `/${id}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  }

  function errorOf(body: string): { code: string; details?: unknown } {
    return (JSON.parse(body) as { error: { code: string; details?: unknown } }).error;
  }

  /** A 404 body without its request id, which differs per request by design. */
  function notFoundShape(body: string) {
    const { requestId: _requestId, ...rest } = JSON.parse(body).error as Record<string, unknown>;
    return rest;
  }

  async function missingShape(cookies: Record<string, string>) {
    const response = await call('GET', `/${randomUUID()}`, undefined, cookies);
    expect(response.statusCode).toBe(404);
    return notFoundShape(response.body);
  }

  async function listed(cookies: Record<string, string>, query = ''): Promise<string[]> {
    const response = await call('GET', `?q=${token}&limit=100${query}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: TaskSummary[] }).items.map((item) => item.id);
  }

  async function mine(cookies: Record<string, string>): Promise<string[]> {
    const response = await call('GET', `/mine?q=${token}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: TaskSummary[] }).data.map((item) => item.id);
  }

  async function boarded(cookies: Record<string, string>): Promise<string[]> {
    const response = await call('GET', `/board?q=${token}&perColumn=50`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    const board = TaskBoardResponseSchema.parse(response.json()).data;
    return board.columns.flatMap((column) => column.items.map((item) => item.id));
  }

  const bellsAbout = (taskId: string, kind: string, who: Person) =>
    h
      .em()
      .find(AdminNotification, { subjectId: taskId, kind, targetAdminUserId: who.adminUserId }, { filters: false });

  const audit = (taskId: string) =>
    h.auditLogService.query({ objectType: 'task', objectId: taskId }).then((rows) => rows.map((r) => r.action).reverse());

  function capture(names: string[]): { events: Array<{ name: string; payload: Record<string, unknown> }>; off: () => void } {
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const offs = names.map((name) =>
      h.eventBus.on(name as never, (payload: unknown) => {
        events.push({ name, payload: payload as Record<string, unknown> });
      }),
    );
    return { events, off: () => offs.forEach((off) => off()) };
  }

  /** The read port, asked under the context one of this person's requests would carry. */
  function asPerson<T>(person: Person, act: (port: TaskReadPort) => Promise<T>): Promise<T> {
    const port = h.container.resolve<TaskReadPort>('taskReadPort');
    return runWithTenantContext({ mode: 'all', actor: { kind: 'admin', id: person.adminUserId } }, () => act(port));
  }

  async function setProjectsVisibility(value: 'everyone' | 'members'): Promise<void> {
    const response = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.visibility/value',
      cookies: admin,
      payload: { scope: 'all', value },
    });
    expect(response.statusCode, response.body).toBeLessThan(400);
  }

  async function createProject(description = ''): Promise<{ id: string; number: string; stageId: string }> {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/projects',
      cookies: admin,
      payload: {
        title: `${token} project`,
        description,
        organizationIds: [],
        stages: [{ name: 'Only', color: '#3b82f6', plannedDurationDays: 1 }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const data = (response.json() as { data: { id: string; number: string; stages: Array<{ id: string }> } }).data;
    createdProjects.push(data.id);
    return { id: data.id, number: data.number, stageId: data.stages[0]!.id };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await setProjectsVisibility('everyone');
    ann = await seedCrmAdmin(h.em(), 'dp-ann', ['tasks:read', 'tasks:write', 'projects:read', 'projects:write']);
    ben = await seedCrmAdmin(h.em(), 'dp-ben', [
      'tasks:read',
      'tasks:write',
      'crm:read',
      'crm:write',
      'projects:read',
      'projects:write',
      'assets.read',
    ]);
    sam = await seedCrmAdmin(h.em(), 'dp-sam', ['tasks:read', 'tasks:write', 'tasks:see_private', 'assets.read']);
    rae = await seedCrmAdmin(h.em(), 'dp-rae', ['tasks:read', 'tasks:see_private']);
  });

  afterAll(async () => {
    for (const person of [ann, ben, sam, rae]) person?.undo();
    const connection = h.em().getConnection();
    if (createdTasks.length > 0) {
      await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${createdTasks.join(',')}}`]);
    }
    if (createdProjects.length > 0) {
      await connection.execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${createdProjects.join(',')}}`]);
    }
    if (createdOpportunities.length > 0) {
      await connection.execute(`delete from "crm_opportunities" where "id" = any(?::uuid[])`, [
        `{${createdOpportunities.join(',')}}`,
      ]);
    }
    await setProjectsVisibility('members');
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  // ---------------------------------------------------------------------------
  // Drafts (FR-037)
  // ---------------------------------------------------------------------------

  describe('drafts', () => {
    it('a draft tells nobody, emits nothing, and is its Creator’s alone', async () => {
      const seen = capture([TASKS_EVENTS.CREATED, TASKS_EVENTS.ASSIGNEES_CHANGED, TASKS_EVENTS.STATUS_CHANGED]);
      try {
        const draft = await create({
          title: 'Draft for Ben',
          draft: true,
          assigneeIds: [ben.adminUserId],
          description: `Ask ${formatRecordReferenceToken('admin_user', ben.adminUserId)} first`,
        });
        expect(draft).toMatchObject({ draft: true, private: false, publishedAt: null });
        expect(draft.permissions.canPublish).toBe(true);
        // Edited while a draft: still nobody told, still nothing emitted.
        const patched = await call('PATCH', `/${draft.id}`, { addAssigneeIds: [ann.adminUserId] });
        expect(patched.statusCode, patched.body).toBe(200);
        const moved = await call('POST', `/${draft.id}/status`, { from: 'todo', to: 'in_progress' });
        expect(moved.statusCode, moved.body).toBe(200);

        expect(seen.events).toEqual([]);
        expect(await bellsAbout(draft.id, 'tasks.task.assigned', ben)).toEqual([]);
        expect(await bellsAbout(draft.id, 'tasks.task.mention', ben)).toEqual([]);
        expect(await audit(draft.id)).toEqual([
          'tasks.task.create',
          'tasks.task.assignees_change',
          'tasks.task.status_change',
        ]);

        // Ben, an assignee, does not see it anywhere, nor at its address.
        const hidden = await call('GET', `/${draft.id}`, undefined, ben.cookies);
        expect(hidden.statusCode).toBe(404);
        expect(notFoundShape(hidden.body)).toEqual(await missingShape(ben.cookies));
        expect(await listed(ben.cookies)).not.toContain(draft.id);
        expect(await listed(ben.cookies, '&draft=true')).not.toContain(draft.id);
        expect(await mine(ben.cookies)).not.toContain(draft.id);
        expect(await boarded(ben.cookies)).not.toContain(draft.id);
        // Its Creator sees it on the list and the board, marked a draft.
        expect(await listed(ann.cookies, '&draft=true')).toContain(draft.id);
        expect(await boarded(ann.cookies)).toContain(draft.id);
      } finally {
        seen.off();
      }
    });

    it('no reminder of a draft fires, even to its Creator', async () => {
      const draft = await create({ title: 'Draft with a reminder', draft: true });
      const remindAt = '2031-06-03T08:00:00.000Z';
      const added = await call('POST', `/${draft.id}/reminders`, { remindAt, recipientIds: [ann.adminUserId] });
      expect(added.statusCode, added.body).toBe(201);
      const reminders = h.container.resolve('tasksReminderService') as TaskReminderService;
      await enterSystemScope('test: tasks reminders', () => reminders.sweep(new Date('2031-06-03T08:01:00.000Z')));
      const outcomes = (await h
        .em()
        .getConnection()
        .execute(
          `select d."outcome" from "task_reminder_deliveries" d join "task_reminders" r on r."id" = d."reminder_id"
            where r."task_id" = ?`,
          [draft.id],
        )) as Array<{ outcome: string }>;
      expect(outcomes.map((row) => row.outcome)).toEqual(['skipped']);
      expect(await bellsAbout(draft.id, 'tasks.task.reminder', ann)).toEqual([]);
    });

    it('a draft in a Project counts towards no completion gate', async () => {
      const project = await createProject();
      const context = { contextType: 'project', contextId: project.id, contextGroupId: project.stageId };
      const published = await create({ title: 'Stage work', context }, admin);
      const draft = await create({ title: 'Stage idea', context, draft: true }, admin);
      // As the completion gate asks it: the system, which sees every Task of the Project.
      const port = h.container.resolve<TaskReadPort>('taskReadPort');
      const open = await enterSystemScope('test: completion gate', () => port.listOpenInContext(context));
      expect(open.map((task) => task.id)).toEqual([published.id]);
      expect(open.map((task) => task.id)).not.toContain(draft.id);
    });

    it('only its Creator publishes it: another admin finds no such Task', async () => {
      const draft = await create({ title: 'Not Ben’s to publish', draft: true });
      const refused = await call('POST', `/${draft.id}/publish`, undefined, ben.cookies);
      expect(refused.statusCode).toBe(404);
      expect(notFoundShape(refused.body)).toEqual(await missingShape(ben.cookies));
      // Not even a holder of `tasks:see_private`: a draft is its Creator's alone (R-3).
      expect((await call('POST', `/${draft.id}/publish`, undefined, sam.cookies)).statusCode).toBe(404);
      expect((await read(draft.id)).draft).toBe(true);
    });

    it('publishing notifies the assignees and the mentioned, emits tasks.task.created.v1, and is one-way', async () => {
      const draft = await create({
        title: 'Publish me',
        draft: true,
        assigneeIds: [ben.adminUserId, ann.adminUserId],
        description: `Over to ${formatRecordReferenceToken('admin_user', ben.adminUserId)}`,
      });
      const seen = capture([TASKS_EVENTS.CREATED]);
      let published: TaskDetail;
      try {
        const response = await call('POST', `/${draft.id}/publish`);
        expect(response.statusCode, response.body).toBe(200);
        published = TaskDetailResponseSchema.parse(response.json()).data;
        expect(seen.events).toEqual([
          {
            name: TASKS_EVENTS.CREATED,
            payload: expect.objectContaining({
              taskId: draft.id,
              contextType: null,
              assigneeIds: [ben.adminUserId, ann.adminUserId],
            }),
          },
        ]);
      } finally {
        seen.off();
      }
      expect(published).toMatchObject({ draft: false, permissions: expect.objectContaining({ canPublish: false }) });
      expect(published.publishedAt).not.toBeNull();
      expect(await bellsAbout(draft.id, 'tasks.task.assigned', ben)).toHaveLength(1);
      expect(await bellsAbout(draft.id, 'tasks.task.mention', ben)).toHaveLength(1);
      // The publisher is never told about their own Task.
      expect(await bellsAbout(draft.id, 'tasks.task.assigned', ann)).toEqual([]);
      expect(await audit(draft.id)).toEqual(['tasks.task.create', 'tasks.task.publish']);
      // Ben sees it now, everywhere.
      expect((await read(draft.id, ben.cookies)).id).toBe(draft.id);
      expect(await listed(ben.cookies)).toContain(draft.id);
      expect(await mine(ben.cookies)).toContain(draft.id);

      // One-way: publishing again is a conflict, and nothing returns a Task to draft.
      const again = await call('POST', `/${draft.id}/publish`);
      expect(again.statusCode, again.body).toBe(409);
      expect(errorOf(again.body).code).toBe(ERROR_CODES.TASK_ALREADY_PUBLISHED);
      expect((await call('PATCH', `/${draft.id}`, { draft: true })).statusCode).toBe(400);
      expect(await bellsAbout(draft.id, 'tasks.task.assigned', ben)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Private Tasks (FR-038, Q1 = B)
  // ---------------------------------------------------------------------------

  describe('private Tasks', () => {
    it('has no assignee but its Creator: 422 TASK_PRIVATE_ASSIGNEE on create and on edit', async () => {
      const refused = await call('POST', '', { title: `${token} mine only`, private: true, assigneeIds: [ben.adminUserId] });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(errorOf(refused.body).code).toBe(ERROR_CODES.TASK_PRIVATE_ASSIGNEE);

      const own = await create({ title: 'Mine only', private: true, assigneeIds: [ann.adminUserId] });
      expect(own).toMatchObject({ private: true, assignees: [expect.objectContaining({ id: ann.adminUserId })] });
      for (const body of [{ assigneeIds: [ben.adminUserId] }, { addAssigneeIds: [ben.adminUserId] }]) {
        const response = await call('PATCH', `/${own.id}`, body);
        expect(response.statusCode, response.body).toBe(422);
        expect(errorOf(response.body).code).toBe(ERROR_CODES.TASK_PRIVATE_ASSIGNEE);
      }

      // Made private while somebody else is assigned: refused, unless they leave in the same write.
      const shared = await create({ title: 'Shared then private', assigneeIds: [ben.adminUserId] });
      const blocked = await call('PATCH', `/${shared.id}`, { private: true });
      expect(blocked.statusCode, blocked.body).toBe(422);
      expect(errorOf(blocked.body).code).toBe(ERROR_CODES.TASK_PRIVATE_ASSIGNEE);
      const made = await call('PATCH', `/${shared.id}`, { private: true, assigneeIds: [] });
      expect(made.statusCode, made.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(made.json()).data).toMatchObject({ private: true, assignees: [] });
      expect(await audit(shared.id)).toEqual(
        expect.arrayContaining(['tasks.task.assignees_change', 'tasks.task.privacy_change']),
      );
      expect((await call('GET', `/${shared.id}`, undefined, ben.cookies)).statusCode).toBe(404);
      // And back: public again, by its Creator.
      const back = await call('PATCH', `/${shared.id}`, { private: false });
      expect(back.statusCode, back.body).toBe(200);
      expect((await read(shared.id, ben.cookies)).private).toBe(false);
    });

    it('only its Creator changes whether a Task is private', async () => {
      const task = await create({ title: 'Ann’s to decide' });
      const response = await call('PATCH', `/${task.id}`, { private: true }, ben.cookies);
      expect(response.statusCode, response.body).toBe(403);
      expect(errorOf(response.body).code).toBe(ERROR_CODES.FORBIDDEN);
      expect((await read(task.id)).private).toBe(false);
    });

    it('is never placed in a Project: 400 on create, 422 on any edit that would', async () => {
      const project = await createProject();
      const context = { contextType: 'project', contextId: project.id, contextGroupId: project.stageId };
      const both = await call('POST', '', { title: `${token} both`, private: true, context }, admin);
      expect(both.statusCode, both.body).toBe(400);

      const secret = await create({ title: 'Private, no Project', private: true }, admin);
      const into = await call('PATCH', `/${secret.id}`, { context }, admin);
      expect(into.statusCode, into.body).toBe(422);
      expect(errorOf(into.body).code).toBe(ERROR_CODES.TASK_CONTEXT_INVALID);

      const inProject = await create({ title: 'In a Project', context }, admin);
      const made = await call('PATCH', `/${inProject.id}`, { private: true }, admin);
      expect(made.statusCode, made.body).toBe(422);
      expect(errorOf(made.body).code).toBe(ERROR_CODES.TASK_CONTEXT_INVALID);
      // Taken out of the Project in the same write, it may become private.
      const out = await call('PATCH', `/${inProject.id}`, { private: true, context: null }, admin);
      expect(out.statusCode, out.body).toBe(200);
      expect(TaskDetailResponseSchema.parse(out.json()).data).toMatchObject({ private: true, context: null });
    });

    it('the assignee lookup offers only the Creator for a private Task', async () => {
      const secret = await create({ title: 'Lookup', private: true });
      const response = await call('GET', `/lookups/assignees?taskId=${secret.id}`);
      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: Array<{ id: string }> }).data.map((option) => option.id)).toEqual([
        ann.adminUserId,
      ]);
      expect((await call('GET', `/lookups/assignees?taskId=${secret.id}`, undefined, ben.cookies)).statusCode).toBe(404);
    });

    describe('a holder of tasks:see_private', () => {
      let secret: TaskDetail;
      let other: TaskDetail;

      beforeAll(async () => {
        secret = await create({ title: 'Ann’s secret', private: true, dueOn: '2031-01-01' });
        other = await create({ title: 'A public neighbour' });
      });

      it('reads it, read-only', async () => {
        const seenBySam = await read(secret.id, sam.cookies);
        expect(seenBySam).toMatchObject({ private: true });
        expect(seenBySam.permissions).toEqual({ canChange: false, canDelete: true, canPublish: false });
        expect(await listed(sam.cookies)).toContain(secret.id);
        const seenByRae = await read(secret.id, rae.cookies);
        expect(seenByRae.permissions).toMatchObject({ canChange: false, canDelete: true });
      });

      it('gets 403 TASK_PRIVATE_READ_ONLY on every write route of the Task but delete', async () => {
        const id = secret.id;
        const any = randomUUID();
        const upload = multipartBody([{ name: 'file', filename: 'note.txt', mime: 'text/plain', value: 'hello' }]);
        /** Every write route under `/tasks/{id}`, keyed as the OpenAPI document names it. */
        const writes: Record<string, () => ReturnType<typeof call>> = {
          'PATCH /{id}': () => call('PATCH', `/${id}`, { title: 'Renamed' }, sam.cookies),
          'POST /{id}/status': () => call('POST', `/${id}/status`, { from: 'todo', to: 'in_progress' }, sam.cookies),
          'POST /{id}/publish': () => call('POST', `/${id}/publish`, undefined, sam.cookies),
          'POST /{id}/links': () => call('POST', `/${id}/links`, { kind: 'order', id: any }, sam.cookies),
          'DELETE /{id}/links/{linkId}': () => call('DELETE', `/${id}/links/${any}`, undefined, sam.cookies),
          'PUT /{id}/relations/{otherId}': () => call('PUT', `/${id}/relations/${other.id}`, undefined, sam.cookies),
          'DELETE /{id}/relations/{otherId}': () => call('DELETE', `/${id}/relations/${other.id}`, undefined, sam.cookies),
          'POST /{id}/comments': () => call('POST', `/${id}/comments`, { body: 'A note' }, sam.cookies),
          'PATCH /{id}/comments/{commentId}': () =>
            call('PATCH', `/${id}/comments/${any}`, { body: 'Edited' }, sam.cookies),
          'DELETE /{id}/comments/{commentId}': () => call('DELETE', `/${id}/comments/${any}`, undefined, sam.cookies),
          'POST /{id}/attachments': () => call('POST', `/${id}/attachments`, { assetId: any }, sam.cookies),
          'POST /{id}/attachments/upload': () =>
            h.app.inject({
              method: 'POST',
              url: `${API}/${id}/attachments/upload`,
              headers: { 'content-type': upload.contentType },
              cookies: sam.cookies,
              payload: upload.body,
            }),
          'DELETE /{id}/attachments/{attachmentId}': () =>
            call('DELETE', `/${id}/attachments/${any}`, undefined, sam.cookies),
          'POST /{id}/reminders': () =>
            call('POST', `/${id}/reminders`, { remindAt: '2031-01-01T08:00:00.000Z', recipientIds: [sam.adminUserId] }, sam.cookies),
          'DELETE /{id}/reminders/{reminderId}': () =>
            call('DELETE', `/${id}/reminders/${any}`, undefined, sam.cookies),
        };

        // The table is the route table: every write route of one Task the API serves, delete aside.
        const document = await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json', cookies: admin });
        expect(document.statusCode).toBe(200);
        const served = Object.entries((document.json() as { paths: Record<string, Record<string, unknown>> }).paths)
          .filter(([path]) => path.startsWith(`${API}/{id}`))
          .flatMap(([path, methods]) =>
            Object.keys(methods)
              .filter((method) => ['post', 'put', 'patch', 'delete'].includes(method))
              .map((method) => `${method.toUpperCase()} ${path.slice(API.length)}`),
          )
          .filter((route) => route !== 'DELETE /{id}')
          .sort();
        expect(Object.keys(writes).sort()).toEqual(served);

        for (const [route, write] of Object.entries(writes)) {
          const response = await write();
          expect(response.statusCode, `${route}: ${response.body}`).toBe(403);
          expect(errorOf(response.body).code, route).toBe(ERROR_CODES.TASK_PRIVATE_READ_ONLY);
        }
        // From the other side too: relating a Task to it, or putting a Task under it.
        const reverse = await call('PUT', `/${other.id}/relations/${id}`, undefined, sam.cookies);
        expect(errorOf(reverse.body).code).toBe(ERROR_CODES.TASK_PRIVATE_READ_ONLY);
        const adopted = await call('PATCH', `/${other.id}`, { parentTaskId: id }, sam.cookies);
        expect(errorOf(adopted.body).code).toBe(ERROR_CODES.TASK_PRIVATE_READ_ONLY);
        const child = await call('POST', '', { title: `${token} child`, parentTaskId: id }, sam.cookies);
        expect(errorOf(child.body).code).toBe(ERROR_CODES.TASK_PRIVATE_READ_ONLY);

        const unchanged = await read(id);
        expect(unchanged).toMatchObject({ title: secret.title, status: { code: 'todo' }, commentsCount: 0 });
      });

      it('deletes it — with tasks:write, or with tasks:read alone', async () => {
        const bySam = await create({ title: 'Sam removes it', private: true });
        const removed = await call('DELETE', `/${bySam.id}`, undefined, sam.cookies);
        expect(removed.statusCode, removed.body).toBe(200);
        expect((await call('GET', `/${bySam.id}`)).statusCode).toBe(404);

        const byRae = await create({ title: 'Rae removes it', private: true });
        const removedByRae = await call('DELETE', `/${byRae.id}`, undefined, rae.cookies);
        expect(removedByRae.statusCode, removedByRae.body).toBe(200);
        expect(await audit(byRae.id)).toEqual(['tasks.task.create', 'tasks.task.delete']);

        // `tasks:read` with `tasks:see_private` deletes a private Task, nothing else.
        const plain = await create({ title: 'Not private' });
        const refused = await call('DELETE', `/${plain.id}`, undefined, rae.cookies);
        expect(refused.statusCode, refused.body).toBe(403);
        expect(errorOf(refused.body).code).toBe(ERROR_CODES.FORBIDDEN);
      });
    });

    describe('absent for anyone else, on every surface', () => {
      let secret: TaskDetail;
      let project: { id: string; number: string };
      let opportunityId: string;
      const linkedOrderId = randomUUID();

      beforeAll(async () => {
        secret = await create({ title: 'Nobody else’s', private: true, assigneeIds: [ann.adminUserId], dueOn: '2020-01-01' });
        // A link row straight in the database: the record need not exist for the panel's list to filter on it.
        await h
          .em()
          .getConnection()
          .execute(
            `insert into "task_record_links" ("id", "task_id", "record_kind", "record_id", "linked_by_admin_user_id", "created_at")
             values (?, ?, 'order', ?, ?, now())`,
            [randomUUID(), secret.id, linkedOrderId, ann.adminUserId],
          );
        const reference = formatRecordReferenceToken('task', secret.id);
        project = await createProject(`See ${reference}`);
        const opportunity = await createCrmOpportunity(h, { title: `${token} deal`, description: `See ${reference}` });
        createdOpportunities.push(opportunity.id);
        opportunityId = opportunity.id;
      });

      it('the list, a saved view’s filters, the board, My Tasks and the address', async () => {
        expect(await listed(ann.cookies)).toContain(secret.id);
        expect(await listed(ben.cookies)).not.toContain(secret.id);
        expect(await listed(ben.cookies, '&private=true')).not.toContain(secret.id);
        expect(await listed(ben.cookies, `&creator=${ann.adminUserId}&overdue=true`)).not.toContain(secret.id);
        expect(await boarded(ben.cookies)).not.toContain(secret.id);
        expect(await mine(ann.cookies)).toContain(secret.id);
        expect(await mine(ben.cookies)).not.toContain(secret.id);
        const hidden = await call('GET', `/${secret.id}`, undefined, ben.cookies);
        expect(hidden.statusCode).toBe(404);
        expect(notFoundShape(hidden.body)).toEqual(await missingShape(ben.cookies));
      });

      it('a record’s Tasks panel', async () => {
        const query = `?linkedKind=order&linkedId=${linkedOrderId}`;
        const forAnn = await call('GET', query);
        expect((forAnn.json() as { items: TaskSummary[] }).items.map((item) => item.id)).toEqual([secret.id]);
        const forBen = await call('GET', query, undefined, ben.cookies);
        expect(forBen.statusCode, forBen.body).toBe(200);
        expect((forBen.json() as { items: TaskSummary[] }).items).toEqual([]);
      });

      it('its comments, attachments, reminders, history and mention list answer 404', async () => {
        const missing = await missingShape(ben.cookies);
        for (const path of [
          `/${secret.id}/comments`,
          `/${secret.id}/attachments`,
          `/${secret.id}/reminders`,
          `/${secret.id}/history`,
          `/lookups/mentionable?taskId=${secret.id}`,
        ]) {
          const response = await call('GET', path, undefined, ben.cookies);
          expect(response.statusCode, path).toBe(404);
          expect(notFoundShape(response.body), path).toEqual(missing);
        }
        const comment = await call('POST', `/${secret.id}/comments`, { body: 'Hello?' }, ben.cookies);
        expect(comment.statusCode).toBe(404);
      });

      it('the @@ lists of Tasks, CRM and Projects', async () => {
        const groups = async (url: string, cookies: Record<string, string>) => {
          const response = await h.app.inject({ method: 'GET', url: `${url}?q=${token}`, cookies });
          expect(response.statusCode, response.body).toBe(200);
          const parsed = RecordDocumentLookupResponseSchema.parse(response.json()).groups;
          return parsed.find((group) => group.kind === 'task')?.items.map((item) => item.id) ?? [];
        };
        expect(await groups(`${API}/lookups/documents`, ann.cookies)).toContain(secret.id);
        expect(await groups(`${API}/lookups/documents`, ben.cookies)).not.toContain(secret.id);
        expect(await groups('/api/v1/admin/crm/lookups/documents', ben.cookies)).not.toContain(secret.id);
        expect(await groups('/api/v1/admin/projects/lookups/documents', ben.cookies)).not.toContain(secret.id);
        expect(await groups('/api/v1/admin/projects/lookups/documents', admin)).toContain(secret.id);
      });

      it('a reference to it in a CRM description or a Project resolves as unavailable', async () => {
        const unavailable = { type: 'task', id: secret.id, available: false, label: null, url: null };
        const deal = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/crm/opportunities/${opportunityId}`,
          cookies: ben.cookies,
        });
        expect(deal.statusCode, deal.body).toBe(200);
        expect((deal.json() as { data: { references: unknown[] } }).data.references).toEqual([unavailable]);
        const forAdmin = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/crm/opportunities/${opportunityId}`,
          cookies: admin,
        });
        expect((forAdmin.json() as { data: { references: unknown[] } }).data.references).toEqual([
          expect.objectContaining({ type: 'task', id: secret.id, available: true }),
        ]);

        const projectRead = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/projects/${project.id}`,
          cookies: ben.cookies,
        });
        expect(projectRead.statusCode, projectRead.body).toBe(200);
        expect((projectRead.json() as { data: { references: unknown[] } }).data.references).toEqual([unavailable]);
      });

      it('the read port, as other modules ask it', async () => {
        expect(await asPerson(ben, (port) => port.findById(secret.id))).toBeNull();
        expect(await asPerson(ben, (port) => port.findByIds([secret.id]))).toEqual([]);
        expect((await asPerson(ben, (port) => port.search({ q: token, limit: 20 }))).map((t) => t.id)).not.toContain(
          secret.id,
        );
        expect((await asPerson(ann, (port) => port.findByIds([secret.id]))).map((t) => t.id)).toEqual([secret.id]);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // The history (T093, review finding F3)
  // ---------------------------------------------------------------------------

  describe('the history of a Task the reader may see', () => {
    type Entry = { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

    async function historyOf(id: string, cookies: Record<string, string>): Promise<Entry[]> {
      const response = await call('GET', `/${id}/history?limit=100`, undefined, cookies);
      expect(response.statusCode, response.body).toBe(200);
      return (response.json() as { data: Entry[] }).data;
    }

    it('names a related or parent Task the reader may not see as no Task at all', async () => {
      const shared = await create({ title: 'Shared, related to a secret' });
      const open = await create({ title: 'Open neighbour' });
      const secret = await create({ title: 'Secret neighbour', private: true });
      const draft = await create({ title: 'Draft parent', draft: true });
      expect((await call('PUT', `/${shared.id}/relations/${secret.id}`)).statusCode).toBe(204);
      expect((await call('PUT', `/${shared.id}/relations/${open.id}`)).statusCode).toBe(204);
      const child = await create({ title: 'Child of a draft' });
      const adopted = await call('PATCH', `/${child.id}`, { parentTaskId: draft.id });
      expect(adopted.statusCode, adopted.body).toBe(200);

      const relatedIds = (entries: Entry[]) =>
        entries
          .filter((entry) => entry.action.startsWith('tasks.task.relat'))
          .map((entry) => entry.after?.['relatedTaskId'])
          .sort();
      expect(relatedIds(await historyOf(shared.id, ann.cookies))).toEqual([open.id, secret.id].sort());
      // Ben sees the open neighbour; the secret one is no Task, exactly as one that does not exist.
      expect(relatedIds(await historyOf(shared.id, ben.cookies))).toEqual([open.id, null].sort());
      expect(JSON.stringify(await historyOf(shared.id, ben.cookies))).not.toContain(secret.id);
      // Rae holds tasks:see_private: the private neighbour is hers to see.
      expect(relatedIds(await historyOf(shared.id, rae.cookies))).toEqual([open.id, secret.id].sort());

      const parentIds = (entries: Entry[]) =>
        entries
          .filter((entry) => entry.action === 'tasks.task.parent_change')
          .map((entry) => [entry.before?.['parentTaskId'], entry.after?.['parentTaskId']]);
      expect(parentIds(await historyOf(child.id, ann.cookies))).toEqual([[null, draft.id]]);
      expect(parentIds(await historyOf(child.id, sam.cookies))).toEqual([[null, null]]);
      expect(JSON.stringify(await historyOf(child.id, sam.cookies))).not.toContain(draft.id);
    });

    it('shows a reminder only to the person who set it and to those it names (admin-api §1)', async () => {
      const task = await create({ title: 'Reminded', assigneeIds: [ann.adminUserId, ben.adminUserId] });
      const own = await call('POST', `/${task.id}/reminders`, {
        remindAt: '2032-03-10T09:00:00.000Z',
        recipientIds: [ann.adminUserId],
      });
      expect(own.statusCode, own.body).toBe(201);
      const naming = await call('POST', `/${task.id}/reminders`, {
        remindAt: '2032-03-11T09:00:00.000Z',
        recipientIds: [ben.adminUserId],
      });
      expect(naming.statusCode, naming.body).toBe(201);
      const ownId = (own.json() as { data: { id: string } }).data.id;
      const namingId = (naming.json() as { data: { id: string } }).data.id;
      expect((await call('DELETE', `/${task.id}/reminders/${ownId}`)).statusCode).toBe(204);

      const reminders = (entries: Entry[]) =>
        entries
          .filter((entry) => entry.action.startsWith('tasks.reminder.'))
          .map((entry) => `${entry.action}:${String((entry.after ?? entry.before)?.['reminderId'])}`)
          .sort();
      expect(reminders(await historyOf(task.id, ann.cookies))).toEqual(
        [`tasks.reminder.add:${ownId}`, `tasks.reminder.add:${namingId}`, `tasks.reminder.remove:${ownId}`].sort(),
      );
      // Ben is named by one; Ann's own reminder, set and removed, is not his to see.
      expect(reminders(await historyOf(task.id, ben.cookies))).toEqual([`tasks.reminder.add:${namingId}`]);
      expect(JSON.stringify(await historyOf(task.id, ben.cookies))).not.toContain(ownId);
      // Sam sees the Task and neither reminder.
      expect(reminders(await historyOf(task.id, sam.cookies))).toEqual([]);
      // A page is counted over what the reader is shown, not over what was recorded.
      const first = await call('GET', `/${task.id}/history?limit=1`, undefined, sam.cookies);
      expect((first.json() as { data: Entry[] }).data.map((entry) => entry.action)).toEqual(['tasks.task.create']);
      expect((first.json() as { pagination: { hasMore: boolean } }).pagination.hasMore).toBe(false);
    });
  });
});
