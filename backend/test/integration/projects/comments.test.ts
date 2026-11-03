import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectCommentListResponseSchema,
  ProjectCommentResponseSchema,
  ProjectUnreadMessagesResponseSchema,
  type ProjectComment,
  type ProjectDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCrmAdmin, seedCrmOrder } from '../../helpers/seed-crm.js';
import {
  bellAbout,
  callProjects,
  createProject,
  deleteProjects,
  errorShape,
  getProject,
  setProjectsVisibility,
} from './helpers.js';

/**
 * User Story 7 — notes and the message thread of a Project
 * (`specs/163-projects-and-tasks/spec.md` FR-025, FR-043; research R-13;
 * `contracts/admin-api.md` §2.4).
 *
 * A note is its author's: only they edit or delete it (403
 * `PROJECT_NOTE_NOT_AUTHOR`, whatever else they hold), and a deleted note is
 * kept and marked, not listed. A message is nobody's to change (409
 * `PROJECT_MESSAGE_IMMUTABLE`) and tells every Member except its author, once,
 * by the Project's number — never the text. The audit trail says that
 * something was written, by whom and how long, never what. Each reader's
 * unread count is theirs and their read marker only moves forward. Nothing of
 * either reaches a storefront customer.
 */
describe('projects — notes and messages (US7)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let author: Person;
  let colleague: Person;
  let third: Person;
  let noRead: Person;
  let outsider: Person;
  let project: ProjectDetail;
  const created: string[] = [];

  const WRITER = ['projects:read', 'projects:write'];

  async function add(
    projectId: string,
    kind: 'note' | 'message',
    body: string,
    who: Person = author,
  ): Promise<ProjectComment> {
    const response = await callProjects(h, 'POST', `/${projectId}/comments`, {
      payload: { kind, body },
      cookies: who.cookies,
    });
    expect(response.statusCode, response.body).toBe(201);
    return ProjectCommentResponseSchema.parse(response.json()).data;
  }

  async function list(projectId: string, kind: 'note' | 'message', who: Person = author): Promise<ProjectComment[]> {
    const response = await callProjects(h, 'GET', `/${projectId}/comments?kind=${kind}`, {
      cookies: who.cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    return ProjectCommentListResponseSchema.parse(response.json()).data;
  }

  const audit = async (objectId: string) => h.auditLogService.query({ objectType: 'project', objectId });

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    author = await seedCrmAdmin(h.em(), 'cm-author', WRITER);
    colleague = await seedCrmAdmin(h.em(), 'cm-colleague', WRITER);
    third = await seedCrmAdmin(h.em(), 'cm-third', ['projects:read']);
    // A Member who has lost `projects:read` may not see the Project, so is not told.
    noRead = await seedCrmAdmin(h.em(), 'cm-no-read', ['tasks:read']);
    outsider = await seedCrmAdmin(h.em(), 'cm-outsider', WRITER);
    project = await createProject(h, {
      title: 'Collaboration',
      organizationIds: [TEST_ORGANIZATION_ID],
      members: [author, colleague, third, noRead].map((p) => ({
        adminUserId: p.adminUserId,
        roleIds: [],
      })),
    });
    created.push(project.id);
  });

  afterAll(async () => {
    for (const p of [author, colleague, third, noRead, outsider]) p?.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  describe('a note', () => {
    it('is listed with its author, and edited only by its author — 403 PROJECT_NOTE_NOT_AUTHOR for anybody else', async () => {
      const note = await add(project.id, 'note', 'Measure the showroom first.');
      expect(note).toMatchObject({
        kind: 'note',
        author: { id: author.adminUserId },
        editedAt: null,
        references: [],
      });
      expect((await list(project.id, 'note', colleague)).map((n) => n.id)).toContain(note.id);

      for (const who of [colleague, { cookies: { b2b_session: 'stub-admin-session' } } as Person]) {
        const refused = await callProjects(h, 'PATCH', `/${project.id}/comments/${note.id}`, {
          payload: { body: 'Not mine to change.' },
          cookies: who.cookies,
        });
        expect(refused.statusCode, refused.body).toBe(403);
        expect(refused.json().error.code).toBe('PROJECT_NOTE_NOT_AUTHOR');
        const deleteRefused = await callProjects(h, 'DELETE', `/${project.id}/comments/${note.id}`, {
          cookies: who.cookies,
        });
        expect(deleteRefused.statusCode, deleteRefused.body).toBe(403);
        expect(deleteRefused.json().error.code).toBe('PROJECT_NOTE_NOT_AUTHOR');
      }

      const edited = await callProjects(h, 'PATCH', `/${project.id}/comments/${note.id}`, {
        payload: { body: 'Measure the showroom first — twice.' },
        cookies: author.cookies,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      const after = ProjectCommentResponseSchema.parse(edited.json()).data;
      expect(after.body).toBe('Measure the showroom first — twice.');
      expect(after.editedAt).not.toBeNull();
    });

    it('is soft-deleted by its author: gone from the list, kept as a row, audited without its text', async () => {
      const SECRET = `note-secret-${randomUUID().slice(0, 6)}`;
      const note = await add(project.id, 'note', `Keep ${SECRET} between us.`);
      const removed = await callProjects(h, 'DELETE', `/${project.id}/comments/${note.id}`, {
        cookies: author.cookies,
      });
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await list(project.id, 'note')).map((n) => n.id)).not.toContain(note.id);
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "deleted_at" from "project_comments" where "id" = ?`, [note.id])) as Array<{
        deleted_at: unknown;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted_at ?? null).not.toBeNull();
      // A deleted note is not there to edit or delete again.
      const again = await callProjects(h, 'DELETE', `/${project.id}/comments/${note.id}`, {
        cookies: author.cookies,
      });
      expect(again.statusCode, again.body).toBe(404);

      const entries = (await audit(project.id)).filter((row) =>
        ['projects.project.note_add', 'projects.project.note_delete'].includes(row.action),
      );
      const own = entries.filter((row) => JSON.stringify(row).includes(note.id));
      expect(own.map((row) => row.action).sort()).toEqual([
        'projects.project.note_add',
        'projects.project.note_delete',
      ]);
      expect(own.find((row) => row.action === 'projects.project.note_add')?.stateAfter).toMatchObject({
        commentId: note.id,
        kind: 'note',
        length: note.body.length,
      });
      expect(JSON.stringify(entries)).not.toContain(SECRET);
    });

    it('tells nobody', async () => {
      const before = await bellAbout(h, project.id, colleague.adminUserId);
      await add(project.id, 'note', 'Nobody is told of a note.');
      expect(await bellAbout(h, project.id, colleague.adminUserId)).toEqual(before);
    });
  });

  describe('a message', () => {
    it('cannot be edited or deleted, by its author or anybody — 409 PROJECT_MESSAGE_IMMUTABLE', async () => {
      const message = await add(project.id, 'message', 'The fit-out starts Monday.');
      for (const who of [author, colleague]) {
        const patch = await callProjects(h, 'PATCH', `/${project.id}/comments/${message.id}`, {
          payload: { body: 'Changed.' },
          cookies: who.cookies,
        });
        expect(patch.statusCode, patch.body).toBe(409);
        expect(patch.json().error.code).toBe('PROJECT_MESSAGE_IMMUTABLE');
        const remove = await callProjects(h, 'DELETE', `/${project.id}/comments/${message.id}`, {
          cookies: who.cookies,
        });
        expect(remove.statusCode, remove.body).toBe(409);
        expect(remove.json().error.code).toBe('PROJECT_MESSAGE_IMMUTABLE');
      }
    });

    it('tells every Member who may see the Project except its author — once each, by number, never the text', async () => {
      const SECRET = `message-secret-${randomUUID().slice(0, 6)}`;
      const fresh = await createProject(h, {
        title: 'Message fan-out',
        organizationIds: [TEST_ORGANIZATION_ID],
        members: [author, colleague, third, noRead].map((p) => ({
          adminUserId: p.adminUserId,
          roleIds: [],
        })),
      });
      created.push(fresh.id);
      await add(fresh.id, 'message', `The code is ${SECRET}.`);

      for (const recipient of [colleague, third]) {
        const entries = await bellAbout(h, fresh.id, recipient.adminUserId);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          kind: 'projects.project.message',
          title: `New message on project ${fresh.number}`,
          linkPath: `/projects/${fresh.id}?tab=messages`,
          titleMessage: {
            scope: 'projects',
            key: 'notifications.message.title',
            params: { number: fresh.number },
          },
        });
        expect(JSON.stringify(entries)).not.toContain(SECRET);
        expect(JSON.stringify(entries)).not.toContain(fresh.title);
      }
      expect(await bellAbout(h, fresh.id, author.adminUserId)).toEqual([]);
      // A Member without `projects:read` may not see the Project, and is not told.
      expect(await bellAbout(h, fresh.id, noRead.adminUserId)).toEqual([]);
      // Nobody but Members: the stub administrator wrote nothing and is no Member.
      expect(await bellAbout(h, fresh.id, outsider.adminUserId)).toEqual([]);

      const entries = (await audit(fresh.id)).filter((row) => row.action === 'projects.project.message_add');
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain(SECRET);
    });

    it('is stored, and tells nobody, while admin_notifications is deactivated', async () => {
      const fresh = await createProject(h, {
        title: 'Bell off',
        members: [author, colleague].map((p) => ({ adminUserId: p.adminUserId, roleIds: [] })),
      });
      created.push(fresh.id);
      await withModuleOff('admin_notifications', 'deactivated', async () => {
        await add(fresh.id, 'message', 'Nobody hears this.');
      });
      expect((await list(fresh.id, 'message')).map((m) => m.body)).toEqual(['Nobody hears this.']);
      expect(await bellAbout(h, fresh.id, colleague.adminUserId)).toEqual([]);
    });
  });

  describe('unread messages and the read marker', () => {
    it('counts the messages somebody else wrote since the reader’s marker, which only moves forward', async () => {
      const fresh = await createProject(h, {
        title: 'Unread',
        members: [author, colleague].map((p) => ({ adminUserId: p.adminUserId, roleIds: [] })),
      });
      created.push(fresh.id);
      const first = await add(fresh.id, 'message', 'One.');
      const second = await add(fresh.id, 'message', 'Two.');
      await add(fresh.id, 'message', 'Mine.', colleague);
      await add(fresh.id, 'note', 'A note is no message.');

      expect((await getProject(h, fresh.id, colleague.cookies)).unreadMessageCount).toBe(2);
      // One's own messages are never unread.
      expect((await getProject(h, fresh.id, author.cookies)).unreadMessageCount).toBe(1);

      const read = async (throughMessageId: string, who: Person = colleague) => {
        const response = await callProjects(h, 'POST', `/${fresh.id}/messages/read`, {
          payload: { throughMessageId },
          cookies: who.cookies,
        });
        expect(response.statusCode, response.body).toBe(200);
        return ProjectUnreadMessagesResponseSchema.parse(response.json()).data.unreadMessageCount;
      };
      expect(await read(first.id)).toBe(1);
      expect(await read(second.id)).toBe(0);
      // An older tab answering late does not make read messages unread again.
      expect(await read(first.id)).toBe(0);
      expect((await getProject(h, fresh.id, colleague.cookies)).unreadMessageCount).toBe(0);

      // Reading writes no audit row: it is the reader's place, not a change to the Project.
      expect((await audit(fresh.id)).map((row) => row.action)).not.toContain('projects.project.messages_read');

      // A note, or another Project's message, is not a message of this thread.
      const note = (await list(fresh.id, 'note'))[0]!;
      const refused = await callProjects(h, 'POST', `/${fresh.id}/messages/read`, {
        payload: { throughMessageId: note.id },
        cookies: colleague.cookies,
      });
      expect(refused.statusCode, refused.body).toBe(404);
      const otherMessage = await add(project.id, 'message', 'Elsewhere.');
      const foreign = await callProjects(h, 'POST', `/${fresh.id}/messages/read`, {
        payload: { throughMessageId: otherMessage.id },
        cookies: colleague.cookies,
      });
      expect(foreign.statusCode, foreign.body).toBe(404);
    });

    it('a reader holding only projects:read may mark the thread read', async () => {
      const message = await add(project.id, 'message', 'For the reader.');
      const response = await callProjects(h, 'POST', `/${project.id}/messages/read`, {
        payload: { throughMessageId: message.id },
        cookies: third.cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
    });
  });

  describe('a Project the caller may not see', () => {
    it('answers every comment route as for a Project that does not exist', async () => {
      const note = await add(project.id, 'note', 'Hidden note.');
      const message = await add(project.id, 'message', 'Hidden message.');
      const missing = randomUUID();
      const cases: Array<[string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown]> = [
        ['list', 'GET', '/:id/comments?kind=note', undefined],
        ['add', 'POST', '/:id/comments', { kind: 'note', body: 'x' }],
        ['edit', 'PATCH', `/:id/comments/${note.id}`, { body: 'x' }],
        ['delete', 'DELETE', `/:id/comments/${note.id}`, undefined],
        ['read', 'POST', '/:id/messages/read', { throughMessageId: message.id }],
      ];
      for (const [label, method, path, payload] of cases) {
        const hidden = await callProjects(h, method, path.replace(':id', project.id), {
          cookies: outsider.cookies,
          ...(payload === undefined ? {} : { payload }),
        });
        const none = await callProjects(h, method, path.replace(':id', missing), {
          cookies: outsider.cookies,
          ...(payload === undefined ? {} : { payload }),
        });
        expect(hidden.statusCode, `${label}: ${hidden.body}`).toBe(404);
        expect(errorShape(hidden.body), label).toEqual(errorShape(none.body));
      }
    });

    it('a comment of another Project addressed under one the caller sees is not found', async () => {
      const other = await createProject(h, {
        title: 'Other',
        members: [{ adminUserId: author.adminUserId, roleIds: [] }],
      });
      created.push(other.id);
      const note = await add(other.id, 'note', 'Belongs elsewhere.');
      const response = await callProjects(h, 'PATCH', `/${project.id}/comments/${note.id}`, {
        payload: { body: 'x' },
        cookies: author.cookies,
      });
      expect(response.statusCode, response.body).toBe(404);
    });
  });

  describe('nothing of either reaches the storefront (FR-043)', () => {
    it('keeps notes and messages out of the customer’s routes of that Organization', async () => {
      const NOTE = `project-note-${randomUUID().slice(0, 6)}`;
      const MESSAGE = `project-message-${randomUUID().slice(0, 6)}`;
      const order = await seedCrmOrder(h.em());
      const linked = await callProjects(h, 'POST', `/${project.id}/links`, {
        payload: { kind: 'order', recordId: order.id },
      });
      expect(linked.statusCode, linked.body).toBe(201);
      await add(project.id, 'note', NOTE);
      await add(project.id, 'message', MESSAGE);

      const customer = { b2b_session: 'stub-customer-session' };
      let answered = 0;
      for (const url of [
        '/api/v1/orders',
        `/api/v1/orders/${order.id}`,
        `/api/v1/orders/${order.id}/comments`,
        '/api/v1/quote-requests',
      ]) {
        const response = await h.app.inject({ method: 'GET', url, cookies: customer });
        if (response.statusCode === 200) answered += 1;
        expect(response.body, url).not.toContain(NOTE);
        expect(response.body, url).not.toContain(MESSAGE);
      }
      expect(answered).toBeGreaterThanOrEqual(2);
      for (const kind of ['note', 'message']) {
        const response = await callProjects(h, 'GET', `/${project.id}/comments?kind=${kind}`, {
          cookies: customer,
        });
        expect([401, 403], response.body).toContain(response.statusCode);
        expect(response.body).not.toContain(NOTE);
        expect(response.body).not.toContain(MESSAGE);
      }
      // The link goes, so the Project can be deleted after the file.
      const links = (await callProjects(h, 'GET', `/${project.id}/links`)).json().data as Array<{
        id: string;
      }>;
      for (const link of links) await callProjects(h, 'DELETE', `/${project.id}/links/${link.id}`);
    });
  });
});
