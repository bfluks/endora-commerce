import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRecordReferenceToken,
  ProjectCommentResponseSchema,
  ProjectMentionableLookupResponseSchema,
  RecordDocumentLookupResponseSchema,
  type ProjectComment,
  type ProjectDetail,
  type RecordDocumentLookupResponse,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { seedCrmAdmin, seedCrmOrder, submitCrmQuoteRequest } from '../../helpers/seed-crm.js';
import {
  bellAbout,
  callProjects,
  createProject,
  createStageTask,
  deleteProjectTasks,
  deleteProjects,
  errorShape,
  getProject,
  setProjectsVisibility,
  stageNamed,
  withTasksOff,
} from './helpers.js';

/**
 * User Story 7 — references and mentions in a Project's texts
 * (`specs/163-projects-and-tasks/spec.md` FR-026, FR-044; research R-4, R-14;
 * `contracts/admin-api.md` §2.4).
 *
 * A person newly mentioned in a description, a note or a message is told once,
 * by the Project's number and the author's name — never the text — and only
 * if they may see the Project: an active administrator holding
 * `projects:read` who passes the visibility rule and Organization reach
 * (`ProjectAccess.canSeeAs`). Never the author. In a message, a mentioned
 * Member's entry is the mention, not a second one beside it.
 *
 * `GET /projects/lookups/mentionable` offers exactly those people, and
 * `GET /projects/lookups/documents` the `@@` list: Orders and Quote Requests
 * of the Project's Organizations (none for an internal Project), Tasks the
 * caller may see, each group only with its read code and a present owner.
 */
describe('projects — mentions and the reference lookups (US7)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let author: Person;
  let member: Person;
  let secondMember: Person;
  let listed: Person;
  let seeAll: Person;
  let stranger: Person;
  let memberNoRead: Person;
  let noTasks: Person;
  let project: ProjectDetail;
  let internal: ProjectDetail;
  const created: string[] = [];

  const WRITER = [
    'projects:read',
    'projects:write',
    'orders:read',
    'rfqs:handle',
    'tasks:read',
    'tasks:write',
    'catalog:read',
  ];
  const token = (who: Person) => formatRecordReferenceToken('admin_user', who.adminUserId);
  const nameOf = async (who: Person): Promise<string> => {
    const row = await h.em().findOneOrFail(AdminUser, { id: who.adminUserId }, { filters: false });
    return `${row.firstName} ${row.lastName}`;
  };
  const mentionsOf = async (who: Person, projectId: string) =>
    (await bellAbout(h, projectId, who.adminUserId)).filter((entry) => entry.kind === 'projects.project.mention');

  async function write(projectId: string, kind: 'note' | 'message', body: string): Promise<ProjectComment> {
    const response = await callProjects(h, 'POST', `/${projectId}/comments`, {
      payload: { kind, body },
      cookies: author.cookies,
    });
    expect(response.statusCode, response.body).toBe(201);
    return ProjectCommentResponseSchema.parse(response.json()).data;
  }

  async function fresh(title: string): Promise<ProjectDetail> {
    const made = await createProject(h, {
      title,
      organizationIds: [TEST_ORGANIZATION_ID],
      members: [author, member, secondMember, memberNoRead].map((p) => ({
        adminUserId: p.adminUserId,
        roleIds: [],
      })),
      viewerIds: [listed.adminUserId],
    });
    created.push(made.id);
    return made;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    author = await seedCrmAdmin(h.em(), 'mn-author', WRITER);
    member = await seedCrmAdmin(h.em(), 'mn-member', ['projects:read']);
    secondMember = await seedCrmAdmin(h.em(), 'mn-second', ['projects:read']);
    listed = await seedCrmAdmin(h.em(), 'mn-listed', ['projects:read']);
    seeAll = await seedCrmAdmin(h.em(), 'mn-see-all', ['projects:read', 'projects:see_all']);
    // Holds `projects:read` but is neither a Member nor listed: under *members only* it may not see.
    stranger = await seedCrmAdmin(h.em(), 'mn-stranger', ['projects:read', 'projects:write']);
    memberNoRead = await seedCrmAdmin(h.em(), 'mn-no-read', ['crm:read']);
    noTasks = await seedCrmAdmin(h.em(), 'mn-no-tasks', ['projects:read', 'projects:write']);
    project = await fresh('Mentions');
    internal = await createProject(h, {
      title: 'Internal mentions',
      members: [author, noTasks].map((p) => ({ adminUserId: p.adminUserId, roleIds: [] })),
    });
    created.push(internal.id);
  });

  afterAll(async () => {
    for (const p of [author, member, secondMember, listed, seeAll, stranger, memberNoRead, noTasks]) p?.undo();
    await deleteProjectTasks(h, created);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  describe('who is told', () => {
    it('tells each newly mentioned person who may see the Project once, by number and author — never the text', async () => {
      const target = await fresh('Note mentions');
      const SECRET = `mention-secret-${randomUUID().slice(0, 6)}`;
      await write(
        target.id,
        'note',
        `${token(member)} ${token(listed)} ${token(seeAll)} ${token(stranger)} ${token(memberNoRead)} ${token(author)} ${token(member)} ${SECRET}`,
      );
      const authorName = await nameOf(author);
      for (const told of [member, listed, seeAll]) {
        const entries = await mentionsOf(told, target.id);
        expect(entries, await nameOf(told)).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          title: `${authorName} mentioned you in project ${target.number}`,
          linkPath: `/projects/${target.id}`,
          titleMessage: {
            scope: 'projects',
            key: 'notifications.mentionByAuthor.title',
            params: { author: authorName, number: target.number },
          },
        });
        expect(JSON.stringify(entries)).not.toContain(SECRET);
        expect(JSON.stringify(entries)).not.toContain(target.title);
      }
      // May not see the Project: not a Member, nor listed, under *members only*.
      expect(await mentionsOf(stranger, target.id)).toEqual([]);
      // A Member who does not hold `projects:read`.
      expect(await mentionsOf(memberNoRead, target.id)).toEqual([]);
      // Never the author.
      expect(await mentionsOf(author, target.id)).toEqual([]);
    });

    it('an edit tells only the people it adds', async () => {
      const target = await fresh('Edit mentions');
      const note = await write(target.id, 'note', `Ask ${token(member)}.`);
      const edited = await callProjects(h, 'PATCH', `/${target.id}/comments/${note.id}`, {
        payload: { body: `Ask ${token(member)} and ${token(secondMember)}.` },
        cookies: author.cookies,
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(await mentionsOf(member, target.id)).toHaveLength(1);
      expect(await mentionsOf(secondMember, target.id)).toHaveLength(1);
    });

    it('a mentioned Member gets one entry for a message, not two; the other Members get the message', async () => {
      const target = await fresh('Message mentions');
      await write(target.id, 'message', `${token(member)}, please confirm.`);
      const memberEntries = await bellAbout(h, target.id, member.adminUserId);
      expect(memberEntries.map((entry) => entry.kind)).toEqual(['projects.project.mention']);
      const secondEntries = await bellAbout(h, target.id, secondMember.adminUserId);
      expect(secondEntries.map((entry) => entry.kind)).toEqual(['projects.project.message']);
    });

    it('a description tells the people it newly mentions, on create and on edit, and resolves their names', async () => {
      const described = await createProject(
        h,
        {
          title: 'Described',
          organizationIds: [TEST_ORGANIZATION_ID],
          description: `Lead: ${token(member)}`,
          members: [author, member, secondMember].map((p) => ({
            adminUserId: p.adminUserId,
            roleIds: [],
          })),
        },
        author.cookies,
      );
      created.push(described.id);
      expect(await mentionsOf(member, described.id)).toHaveLength(1);
      expect(described.references).toEqual([
        {
          type: 'admin_user',
          id: member.adminUserId,
          available: true,
          label: await nameOf(member),
          url: null,
        },
      ]);

      const patched = await callProjects(h, 'PATCH', `/${described.id}`, {
        payload: {
          description: `Lead: ${token(member)}, with ${token(secondMember)}`,
          version: described.version,
        },
        cookies: author.cookies,
      });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(await mentionsOf(member, described.id)).toHaveLength(1);
      expect(await mentionsOf(secondMember, described.id)).toHaveLength(1);
      const detail = await getProject(h, described.id);
      expect(detail.references.map((r) => r.id)).toEqual([member.adminUserId, secondMember.adminUserId]);
      const stored = (await h
        .em()
        .getConnection()
        .execute(`select "source_kind", "target_type", "target_id" from "project_references" where "project_id" = ?`, [
          described.id,
        ])) as Array<{ source_kind: string; target_type: string; target_id: string }>;
      expect(stored.map((row) => `${row.source_kind}:${row.target_type}:${row.target_id}`).sort()).toEqual(
        [`description:admin_user:${member.adminUserId}`, `description:admin_user:${secondMember.adminUserId}`].sort(),
      );
    });
  });

  describe('references in a text resolve for the reader', () => {
    it('a Task and an Order resolve to their numbers; an Order is unavailable to a reader without orders:read', async () => {
      const target = await fresh('Resolved references');
      const task = await createStageTask(h, target.id, stageNamed(target, 'Design'), {
        title: 'Referenced task',
      });
      const order = await seedCrmOrder(h.em());
      const note = await write(
        target.id,
        'note',
        `${formatRecordReferenceToken('task', task.id)} ${formatRecordReferenceToken('order', order.id)}`,
      );
      expect(note.references).toEqual([
        {
          type: 'task',
          id: task.id,
          available: true,
          label: task.number,
          url: `/tasks/${task.id}`,
        },
        expect.objectContaining({
          type: 'order',
          id: order.id,
          available: true,
          label: order.businessId,
          url: `/orders/${order.id}`,
        }),
      ]);
      const asMember = await callProjects(h, 'GET', `/${target.id}/comments?kind=note`, {
        cookies: member.cookies,
      });
      expect(asMember.statusCode, asMember.body).toBe(200);
      const seen = (asMember.json().data as ProjectComment[]).find((comment) => comment.id === note.id)!;
      expect(seen.references.map((r) => [r.type, r.available, r.label])).toEqual([
        ['task', false, null],
        ['order', false, null],
      ]);
      // Tasks off: the Task reference is unavailable for everybody, and the text is unchanged.
      await withTasksOff(async () => {
        const off = await callProjects(h, 'GET', `/${target.id}/comments?kind=note`, {
          cookies: author.cookies,
        });
        expect(off.statusCode, off.body).toBe(200);
        const row = (off.json().data as ProjectComment[]).find((comment) => comment.id === note.id)!;
        expect(row.body).toBe(note.body);
        expect(row.references[0]).toEqual({
          type: 'task',
          id: task.id,
          available: false,
          label: null,
          url: null,
        });
      });
    });
  });

  describe('GET /projects/lookups/mentionable', () => {
    const mentionable = async (query: string, who: Person = author) => {
      const response = await callProjects(h, 'GET', `/lookups/mentionable${query}`, {
        cookies: who.cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      return ProjectMentionableLookupResponseSchema.parse(response.json()).data.map((option) => option.id);
    };

    it('offers the active administrators holding projects:read who may see the Project — nobody else', async () => {
      const ids = await mentionable(`?projectId=${project.id}&q=crm-mn-`);
      for (const who of [author, member, secondMember, listed, seeAll])
        expect(ids, await nameOf(who)).toContain(who.adminUserId);
      for (const who of [stranger, memberNoRead, noTasks])
        expect(ids, await nameOf(who)).not.toContain(who.adminUserId);
    });

    it('narrows by name or e-mail', async () => {
      const ids = await mentionable(`?projectId=${project.id}&q=mn-listed`);
      expect(ids).toEqual([listed.adminUserId]);
    });

    it('without a Project (the create form), offers holders of projects:read', async () => {
      const ids = await mentionable(`?q=crm-mn-`);
      expect(ids).toContain(stranger.adminUserId);
      expect(ids).not.toContain(memberNoRead.adminUserId);
    });

    it('a Project the caller may not see answers as one that does not exist; a reader may not ask', async () => {
      const hidden = await callProjects(h, 'GET', `/lookups/mentionable?projectId=${project.id}`, {
        cookies: stranger.cookies,
      });
      const none = await callProjects(h, 'GET', `/lookups/mentionable?projectId=${randomUUID()}`, {
        cookies: stranger.cookies,
      });
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(errorShape(hidden.body)).toEqual(errorShape(none.body));
      const reader = await callProjects(h, 'GET', `/lookups/mentionable?projectId=${project.id}`, {
        cookies: member.cookies,
      });
      expect(reader.statusCode, reader.body).toBe(403);
    });
  });

  describe('GET /projects/lookups/documents', () => {
    const documents = async (query: string, who: Person = author): Promise<RecordDocumentLookupResponse> => {
      const response = await callProjects(h, 'GET', `/lookups/documents${query}`, {
        cookies: who.cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      return RecordDocumentLookupResponseSchema.parse(response.json());
    };

    it('offers the Organizations’ Orders and Quote Requests, and the Tasks the caller may see', async () => {
      const order = await seedCrmOrder(h.em());
      const quoteRequest = await submitCrmQuoteRequest(h);
      const task = await createStageTask(h, project.id, stageNamed(project, 'Design'), {
        title: 'Lookup task',
      });
      const all = await documents(`?projectId=${project.id}`);
      expect(all.groups.map((group) => group.kind)).toEqual(['order', 'quote_request', 'task']);
      const byNumber = await documents(`?projectId=${project.id}&q=${encodeURIComponent(order.businessId ?? '')}`);
      expect(byNumber.groups.find((g) => g.kind === 'order')?.items.map((i) => i.id)).toContain(order.id);
      const byQuote = await documents(`?projectId=${project.id}&q=${encodeURIComponent(quoteRequest.businessId)}`);
      expect(byQuote.groups.find((g) => g.kind === 'quote_request')?.items.map((i) => i.id)).toContain(quoteRequest.id);
      const byTask = await documents(`?projectId=${project.id}&q=${encodeURIComponent(task.number)}`);
      expect(byTask.groups.find((g) => g.kind === 'task')?.items).toEqual([
        { id: task.id, label: task.number, sublabel: 'Lookup task' },
      ]);
    });

    it('an internal Project offers no Orders and no Quote Requests', async () => {
      const answer = await documents(`?projectId=${internal.id}`);
      expect(answer.groups.map((group) => group.kind)).toEqual(['task']);
    });

    it('without a Project (the create form), only Tasks', async () => {
      expect((await documents('')).groups.map((group) => group.kind)).toEqual(['task']);
    });

    it('a group is offered only with its read code and a present owner', async () => {
      const without = await documents(`?projectId=${internal.id}`, noTasks);
      expect(without.groups).toEqual([]);
      await withTasksOff(async () => {
        const off = await documents(`?projectId=${project.id}`);
        expect(off.groups.map((group) => group.kind)).toEqual(['order', 'quote_request']);
      });
    });

    it('a Project the caller may not see answers as one that does not exist', async () => {
      const hidden = await callProjects(h, 'GET', `/lookups/documents?projectId=${project.id}`, {
        cookies: stranger.cookies,
      });
      const none = await callProjects(h, 'GET', `/lookups/documents?projectId=${randomUUID()}`, {
        cookies: stranger.cookies,
      });
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(errorShape(hidden.body)).toEqual(errorShape(none.body));
    });
  });
});
