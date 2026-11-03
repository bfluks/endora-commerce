import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRecordReferenceToken,
  ProjectListResponseSchema,
  ProjectMentionableLookupResponseSchema,
  TaskListResponseSchema,
  type ProjectDetail,
  type ProjectVisibility,
  type ProjectVisibilitySetting,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { AdminNotification } from '../../helpers/package-entities.js';
import type { StageAlertService } from '../../../../packages/modules/projects/src/backend/services/stage-alert-service.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import {
  PROJECTS_ADMIN,
  callProjects,
  callTasks,
  createProject,
  createStageTask,
  deleteProjectTasks,
  deleteProjects,
  errorShape,
  getProject,
  patchStage,
  stageNamed,
} from './helpers.js';

/**
 * User Story 5 — who sees a Project (`specs/163-projects-and-tasks/quickstart.md`
 * US5, SC-003; spec FR-018 – FR-020, owner ruling Q2 = A, research R-3).
 *
 * The matrix: the module setting {everyone, members} × the Project's own
 * visibility {inherit, everyone, members_and_listed} × the reader {Member,
 * listed person, anybody else, holder of `projects:see_all`}. Every reader
 * here is unrestricted in Organization reach, so the visibility rule is the
 * only thing measured; `organization-reach.test.ts` measures the other rule,
 * and one case below proves `projects:see_all` never widens it.
 *
 * FR-020 names every read of a Project. The ones that exist are measured for
 * each cell — the list and its total, the detail, the Stage history, the
 * Project's Tasks tab, its Tasks in the Tasks module, the record panel of its
 * Task, the mention list, analytics, global search — and every invisible answer is
 * byte-for-byte the answer for an id that does not exist. No `todo` row is left: each read a
 * later story brought was turned into a measurement by the task that brought it.
 */
describe('projects — who sees a Project (US5)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let member: Person;
  let listed: Person;
  let other: Person;
  let seeAll: Person;
  /** One Project per visibility; `member` is its Member, `listed` its listed person. */
  const projects = {} as Record<ProjectVisibility, ProjectDetail>;
  /** One Task in each Project's first Stage. */
  const tasks = {} as Record<ProjectVisibility, string>;
  const created: string[] = [];
  /** Every title of this file carries it, so `q` narrows the list to this file's Projects. */
  const token = `vis${randomUUID().slice(0, 8)}`;

  const PERMISSIONS = ['projects:read', 'projects:write', 'projects:analytics', 'tasks:read', 'tasks:write'];
  const VISIBILITIES: ProjectVisibility[] = ['inherit', 'everyone', 'members_and_listed'];
  const SETTINGS: ProjectVisibilitySetting[] = ['everyone', 'members'];
  type Reader = 'member' | 'listed' | 'other' | 'seeAll';
  const READERS: Reader[] = ['member', 'listed', 'other', 'seeAll'];
  const person = (reader: Reader): Person => ({ member, listed, other, seeAll })[reader];

  /** R-3, written out as the owner's ruling reads — the oracle every cell is held to. */
  function expected(setting: ProjectVisibilitySetting, visibility: ProjectVisibility, reader: Reader): boolean {
    if (reader !== 'other') return true;
    if (visibility === 'everyone') return true;
    if (visibility === 'members_and_listed') return false;
    return setting === 'everyone';
  }

  async function setSetting(value: ProjectVisibilitySetting): Promise<void> {
    const response = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.visibility/value',
      cookies: PROJECTS_ADMIN,
      payload: { scope: 'all', value },
    });
    expect(response.statusCode, response.body).toBeLessThan(400);
  }

  async function projectList(cookies: Person['cookies']): Promise<{ ids: string[]; total: number }> {
    const response = await callProjects(h, 'GET', `?limit=100&q=${token}`, { cookies });
    expect(response.statusCode, response.body).toBe(200);
    const page = ProjectListResponseSchema.parse(response.json());
    expect(page.nextCursor).toBeNull();
    return { ids: page.items.map((item) => item.id), total: page.total };
  }

  async function taskList(cookies: Person['cookies']): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await callTasks(h, 'GET', `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      const page = TaskListResponseSchema.parse(response.json());
      ids.push(...page.items.map((task) => task.id));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  /** The answer for a Project nobody has — what every invisible one must be byte-for-byte. */
  async function missing(path: string, cookies: Person['cookies'], method: 'GET' | 'PATCH' = 'GET', payload?: unknown) {
    const response = await callProjects(h, method, path.replace(':id', randomUUID()), {
      cookies,
      ...(payload === undefined ? {} : { payload }),
    });
    expect(response.statusCode, response.body).toBe(404);
    return errorShape(response.body);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    member = await seedCrmAdmin(h.em(), 'vis-member', PERMISSIONS);
    listed = await seedCrmAdmin(h.em(), 'vis-listed', PERMISSIONS);
    other = await seedCrmAdmin(h.em(), 'vis-other', PERMISSIONS);
    seeAll = await seedCrmAdmin(h.em(), 'vis-see-all', [...PERMISSIONS, 'projects:see_all']);
    for (const visibility of VISIBILITIES) {
      const project = await createProject(h, {
        title: `${token} ${visibility}`,
        visibility,
        members: [{ adminUserId: member.adminUserId, roleIds: [] }],
        viewerIds: [listed.adminUserId],
      });
      created.push(project.id);
      projects[visibility] = project;
      tasks[visibility] = (await createStageTask(h, project.id, stageNamed(project, 'Design'), { title: `${token} task` })).id;
    }
  });

  afterAll(async () => {
    for (const p of [member, listed, other, seeAll]) p?.undo();
    await deleteProjectTasks(h, created);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  for (const setting of SETTINGS) {
    describe(`module setting "${setting}"`, () => {
      beforeAll(async () => {
        await setSetting(setting);
      });

      for (const reader of READERS) {
        it(`${reader}: the list and its total hold exactly the Projects the rule allows`, async () => {
          const wanted = VISIBILITIES.filter((v) => expected(setting, v, reader)).map((v) => projects[v].id);
          const { ids, total } = await projectList(person(reader).cookies);
          expect(new Set(ids)).toEqual(new Set(wanted));
          expect(total).toBe(wanted.length);
        });

        it(`${reader}: the Tasks module lists a Project's Tasks exactly where the Project is visible`, async () => {
          const seen = new Set(await taskList(person(reader).cookies));
          for (const visibility of VISIBILITIES) {
            expect(seen.has(tasks[visibility]), `${visibility}`).toBe(expected(setting, visibility, reader));
          }
        });

        for (const visibility of VISIBILITIES) {
          const visible = expected(setting, visibility, reader);
          it(`${reader} × ${visibility}: ${visible ? 'every read answers' : 'every read answers as for a Project that does not exist'}`, async () => {
            const { cookies } = person(reader);
            const id = projects[visibility].id;
            for (const path of ['/:id', '/:id/stage-history', '/:id/tasks']) {
              const response = await callProjects(h, 'GET', path.replace(':id', id), { cookies });
              if (visible) {
                expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
              } else {
                expect(response.statusCode, `${path}: ${response.body}`).toBe(404);
                expect(errorShape(response.body)).toEqual(await missing(path, cookies));
              }
            }
            // A write starts from the same read: invisible is missing there too.
            if (!visible) {
              const patch = { title: 'x', version: 1 };
              const response = await callProjects(h, 'PATCH', `/${id}`, { cookies, payload: patch });
              expect(response.statusCode, response.body).toBe(404);
              expect(errorShape(response.body)).toEqual(await missing('/:id', cookies, 'PATCH', patch));
            }
            // The Project's Task by id, in the Tasks module.
            const task = await callTasks(h, 'GET', `/${tasks[visibility]}`, { cookies });
            if (visible) {
              expect(task.statusCode, task.body).toBe(200);
            } else {
              const none = await callTasks(h, 'GET', `/${randomUUID()}`, { cookies });
              expect(task.statusCode, task.body).toBe(404);
              expect(errorShape(task.body)).toEqual(errorShape(none.body));
            }
            // The record panel (T093): the Project of its Task — a Project the
            // reader may not see is the answer for a record in none.
            const panel = await callProjects(h, 'GET', `/records/task/${tasks[visibility]}/project`, { cookies });
            if (visible) {
              expect(panel.statusCode, panel.body).toBe(200);
              expect((panel.json() as { data: { id: string } }).data.id).toBe(id);
            } else {
              expect(panel.statusCode, panel.body).toBe(404);
              expect(errorShape(panel.body)).toEqual(await missing(`/records/task/:id/project`, cookies));
            }
            // The mention list (T115): asked by this reader, it is the Project
            // they may see — or the answer for one that does not exist.
            const mentionable = await callProjects(h, 'GET', `/lookups/mentionable?projectId=${id}&q=crm-vis-`, {
              cookies,
            });
            if (visible) {
              expect(mentionable.statusCode, mentionable.body).toBe(200);
            } else {
              expect(mentionable.statusCode, mentionable.body).toBe(404);
              expect(errorShape(mentionable.body)).toEqual(await missing(`/lookups/mentionable?projectId=:id`, cookies));
            }
          });

          it(`${reader} × ${visibility}: is offered in the mention list exactly when the Project is visible to them`, async () => {
            // Asked by the stub administrator, who sees every Project.
            const response = await callProjects(
              h,
              'GET',
              `/lookups/mentionable?projectId=${projects[visibility].id}&q=crm-vis-`,
            );
            expect(response.statusCode, response.body).toBe(200);
            const offered = ProjectMentionableLookupResponseSchema.parse(response.json()).data.map((option) => option.id);
            expect(offered.includes(person(reader).adminUserId)).toBe(visible);
          });
        }
      }
    });
  }

  describe('changing who sees a Project (PATCH)', () => {
    let project: ProjectDetail;

    beforeAll(async () => {
      await setSetting('members');
      project = await createProject(h, {
        title: `${token} patched`,
        members: [{ adminUserId: member.adminUserId, roleIds: [] }],
      });
      created.push(project.id);
    });

    const auditOf = async (id: string) =>
      (await h.auditLogService.query({ objectType: 'project', objectId: id })).map((row) => row.action);

    it('opening a Project to everyone lets anybody with projects:read in; following the setting again shuts them out', async () => {
      expect((await callProjects(h, 'GET', `/${project.id}`, { cookies: other.cookies })).statusCode).toBe(404);
      const opened = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { visibility: 'everyone', version: project.version },
      });
      expect(opened.statusCode, opened.body).toBe(200);
      project = opened.json().data as ProjectDetail;
      expect(project.visibility).toBe('everyone');
      expect((await callProjects(h, 'GET', `/${project.id}`, { cookies: other.cookies })).statusCode).toBe(200);

      const back = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { visibility: 'inherit', version: project.version },
      });
      expect(back.statusCode, back.body).toBe(200);
      project = back.json().data as ProjectDetail;
      expect((await callProjects(h, 'GET', `/${project.id}`, { cookies: other.cookies })).statusCode).toBe(404);
      expect((await auditOf(project.id)).filter((a) => a === 'projects.project.visibility_set')).toHaveLength(2);
    });

    it('listing somebody lets them in, and removing them shuts them out again', async () => {
      const add = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { visibility: 'members_and_listed', viewerIds: [other.adminUserId], version: project.version },
      });
      expect(add.statusCode, add.body).toBe(200);
      project = add.json().data as ProjectDetail;
      expect(project.viewers.map((v) => v.id)).toEqual([other.adminUserId]);
      expect((await callProjects(h, 'GET', `/${project.id}`, { cookies: other.cookies })).statusCode).toBe(200);
      expect((await projectList(other.cookies)).ids).toContain(project.id);

      const remove = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { viewerIds: [], version: project.version },
      });
      expect(remove.statusCode, remove.body).toBe(200);
      project = remove.json().data as ProjectDetail;
      expect(project.viewers).toEqual([]);
      expect((await callProjects(h, 'GET', `/${project.id}`, { cookies: other.cookies })).statusCode).toBe(404);

      const actions = await auditOf(project.id);
      expect(actions.filter((a) => a === 'projects.project.viewers_set')).toHaveLength(2);
    });

    it('the same values again change nothing and write no audit row', async () => {
      const before = await auditOf(project.id);
      const same = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { visibility: project.visibility, viewerIds: [], version: project.version },
      });
      expect(same.statusCode, same.body).toBe(200);
      expect(await auditOf(project.id)).toEqual(before);
      project = same.json().data as ProjectDetail;
    });

    it('a listed person must be an active administrator — 422, nothing changed', async () => {
      const response = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { viewerIds: [randomUUID()], visibility: 'everyone', version: project.version },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe('PROJECT_MEMBER_INVALID');
      const after = await getProject(h, project.id);
      expect(after.visibility).toBe(project.visibility);
      expect(after.version).toBe(project.version);
    });

    it('a stale version is refused — 409 PROJECT_CHANGED', async () => {
      const response = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { visibility: 'everyone', version: project.version + 1 },
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('PROJECT_CHANGED');
    });
  });

  it('projects:see_all never widens Organization reach (Q1 = C)', async () => {
    await setSetting('members');
    const orgA = await seedCrmOrganization(h.em(), 'vis reach A');
    const orgB = await seedCrmOrganization(h.em(), 'vis reach B');
    const rep = await seedCrmSalesRep(h.em(), [orgA], ['projects:read', 'projects:see_all']);
    try {
      const inReach = await createProject(h, { title: `${token} A`, organizationIds: [orgA], visibility: 'members_and_listed' });
      const outOfReach = await createProject(h, { title: `${token} B`, organizationIds: [orgB], visibility: 'everyone' });
      created.push(inReach.id, outOfReach.id);
      expect((await callProjects(h, 'GET', `/${inReach.id}`, { cookies: rep.cookies })).statusCode).toBe(200);
      const hidden = await callProjects(h, 'GET', `/${outOfReach.id}`, { cookies: rep.cookies });
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(errorShape(hidden.body)).toEqual(await missing('/:id', rep.cookies));
    } finally {
      rep.undo();
    }
  });

  describe('the Task assignment bell (FR-020 "notifications")', () => {
    const bellAbout = (taskId: string) =>
      h.em().find(AdminNotification, { subjectId: taskId }, { filters: false, orderBy: { createdAt: 'asc' } });

    it('is rung for an assignee who may see the Task’s Project; one who may not is refused, and told nothing (#506)', async () => {
      await setSetting('members');
      const project = projects.members_and_listed;
      const design = stageNamed(project, 'Design');
      // Before #506 this assignment was accepted and the bell stayed silent; now it is refused.
      const refused = await callTasks(h, 'POST', '', {
        payload: {
          title: `${token} for the outsider`,
          context: { contextType: 'project', contextId: project.id, contextGroupId: design },
          assigneeIds: [other.adminUserId],
        },
      });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe('TASK_ASSIGNEE_INVALID');

      const toListed = await createStageTask(h, project.id, design, { title: `${token} for the listed` });
      const assign = await callTasks(h, 'PATCH', `/${toListed.id}`, { payload: { assigneeIds: [listed.adminUserId] } });
      expect(assign.statusCode, assign.body).toBe(200);
      expect((await bellAbout(toListed.id)).map((n) => n.targetAdminUserId)).toEqual([listed.adminUserId]);

      // Handing it on to somebody who may see it rings for them; to somebody who may not is refused, and tells nobody.
      const handOn = await callTasks(h, 'PATCH', `/${toListed.id}`, { payload: { assigneeIds: [seeAll.adminUserId] } });
      expect(handOn.statusCode, handOn.body).toBe(200);
      expect((await bellAbout(toListed.id)).map((n) => n.targetAdminUserId)).toEqual([listed.adminUserId, seeAll.adminUserId]);
      const away = await callTasks(h, 'PATCH', `/${toListed.id}`, { payload: { assigneeIds: [other.adminUserId] } });
      expect(away.statusCode, away.body).toBe(422);
      expect(away.json().error.code).toBe('TASK_ASSIGNEE_INVALID');
      expect((await bellAbout(toListed.id)).map((n) => n.targetAdminUserId)).toEqual([listed.adminUserId, seeAll.adminUserId]);
    });

    it('a mention and a message ring only for people who may see the Project (T111)', async () => {
      await setSetting('members');
      const project = projects.members_and_listed;
      const mention = (who: Person) => formatRecordReferenceToken('admin_user', who.adminUserId);
      const bell = async (who: Person) =>
        (
          await h
            .em()
            .find(AdminNotification, { subjectId: project.id, targetAdminUserId: who.adminUserId }, { filters: false })
        ).map((row) => row.kind);
      const response = await callProjects(h, 'POST', `/${project.id}/comments`, {
        payload: { kind: 'message', body: `${token} ${mention(member)} ${mention(listed)} ${mention(other)} ${mention(seeAll)}` },
      });
      expect(response.statusCode, response.body).toBe(201);
      // The Member's mention stands for the message too; the listed person and
      // the holder of `projects:see_all` may see the Project, so are told.
      expect(await bell(member)).toEqual(['projects.project.mention']);
      expect(await bell(listed)).toEqual(['projects.project.mention']);
      expect(await bell(seeAll)).toEqual(['projects.project.mention']);
      // Somebody who may not see it is told of neither.
      expect(await bell(other)).toEqual([]);
    });

    it('a Task in a Project open to everyone rings for anybody who may read Projects', async () => {
      await setSetting('members');
      const project = projects.everyone;
      const task = await createStageTask(h, project.id, stageNamed(project, 'Design'), {
        title: `${token} open`,
        assigneeIds: [other.adminUserId],
      });
      expect((await bellAbout(task.id)).map((n) => n.targetAdminUserId)).toEqual([other.adminUserId]);
    });
  });

  it('global search (`projects.project`) answers only visible Projects (T132)', async () => {
    const found = async (cookies: Person['cookies'], q: string): Promise<string[]> => {
      const response = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/global-search?q=${encodeURIComponent(q)}&entityTypes=projects.project&language=en&limit=25`,
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      const groups = (response.json() as { data: { groups: Array<{ entityType: string; hits: Array<{ id: string }> }> } })
        .data.groups;
      return groups.find((group) => group.entityType === 'projects.project')?.hits.map((hit) => hit.id) ?? [];
    };
    for (const setting of SETTINGS) {
      await setSetting(setting);
      for (const reader of READERS) {
        const { cookies } = person(reader);
        const matrix = new Set(VISIBILITIES.map((v) => projects[v].id));
        const hits = (await found(cookies, token)).filter((id) => matrix.has(id));
        const wanted = VISIBILITIES.filter((v) => expected(setting, v, reader)).map((v) => projects[v].id);
        expect(new Set(hits), `${setting} × ${reader}`).toEqual(new Set(wanted));
        // By number and by id: an invisible Project is not found either way.
        for (const visibility of VISIBILITIES) {
          const visible = expected(setting, visibility, reader);
          const { id, number } = projects[visibility];
          expect((await found(cookies, number)).includes(id), `${setting} × ${reader} × ${visibility} by number`).toBe(visible);
          expect((await found(cookies, id)).includes(id), `${setting} × ${reader} × ${visibility} by id`).toBe(visible);
        }
      }
    }
  });

  it('analytics count only visible Projects (T127)', async () => {
    // Three Projects of their own, one per visibility, from a Template of this
    // case alone — the Template filter keeps every other Project out of the figures.
    const template = await callProjects(h, 'POST', '/templates', {
      payload: {
        name: `${token} analytics`,
        roleIds: [],
        stages: [{ key: 'only', name: 'Only', color: '#3b82f6', completionPermitted: true }],
        moves: [],
      },
    });
    expect(template.statusCode, template.body).toBe(201);
    const templateId = (template.json() as { data: { id: string } }).data.id;
    try {
      for (const visibility of VISIBILITIES) {
        const project = await createProject(h, {
          title: `${token} analytics ${visibility}`,
          templateId,
          stages: undefined,
          visibility,
          members: [{ adminUserId: member.adminUserId, roleIds: [] }],
          viewerIds: [listed.adminUserId],
        });
        created.push(project.id);
      }
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const range = `from=${day(-1)}&to=${day(1)}&templateId=${templateId}`;
      for (const setting of SETTINGS) {
        await setSetting(setting);
        for (const reader of READERS) {
          const wanted = VISIBILITIES.filter((v) => expected(setting, v, reader)).length;
          const summary = await callProjects(h, 'GET', `/analytics/summary?${range}`, { cookies: person(reader).cookies });
          expect(summary.statusCode, summary.body).toBe(200);
          expect(summary.json(), `${setting} × ${reader}`).toMatchObject({ projectCount: wanted, data: { opened: wanted } });
          const value = await callProjects(h, 'GET', `/analytics/value?${range}`, { cookies: person(reader).cookies });
          expect(value.statusCode, value.body).toBe(200);
          expect(value.json(), `${setting} × ${reader}`).toMatchObject({ projectCount: wanted, excluded: { noValue: wanted } });
        }
      }
    } finally {
      await h.em().getConnection().execute(`delete from "project_templates" where "id" = ?`, [templateId]);
    }
  });

  it('Stage-deadline notifications reach only Members who may see the Project (T118)', async () => {
    await setSetting('members');
    // A Member out of reach (a sales representative; the Project is internal)
    // and a Member who may not read Projects at all, beside one who may see it.
    const reach = await seedCrmOrganization(h.em(), 'vis-alerts');
    const rep = await seedCrmSalesRep(h.em(), [reach], PERMISSIONS);
    const noRead = await seedCrmAdmin(h.em(), 'vis-no-read', ['tasks:read']);
    try {
      const project = await createProject(h, {
        title: `${token} alerts`,
        visibility: 'members_and_listed',
        members: [member, rep, noRead].map((who) => ({ adminUserId: who.adminUserId, roleIds: [] })),
        viewerIds: [listed.adminUserId],
      });
      created.push(project.id);
      await patchStage(h, project.id, stageNamed(project, 'Design'), { alertOffsetsDays: [1], deadlineOn: '2032-03-11' });
      // 10 March 2032, 08:30 in Warsaw.
      const summary = await enterSystemScope('test: projects visibility alerts', () =>
        (h.container.resolve('projectsStageAlertService') as StageAlertService).sweep(new Date('2032-03-10T07:30:00.000Z')),
      );
      expect(summary.claimed).toBeGreaterThanOrEqual(1);
      const told = async (who: { adminUserId: string }) =>
        h.em().count(
          AdminNotification,
          { subjectId: project.id, targetAdminUserId: who.adminUserId, kind: 'projects.project.stage_deadline' },
          { filters: false },
        );
      expect(await told(member)).toBe(1);
      // Out of reach, or without `projects:read`: a Member who may not see the Project is skipped.
      expect(await told(rep)).toBe(0);
      expect(await told(noRead)).toBe(0);
      // People who may see it but are no Members are not told either: alerts go to Members only.
      expect(await told(listed)).toBe(0);
      expect(await told(seeAll)).toBe(0);
      expect(await told(other)).toBe(0);
    } finally {
      rep.undo();
      noRead.undo();
    }
  });
});
