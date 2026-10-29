import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectStageEntryListResponseSchema,
  ProjectTemplateListResponseSchema,
  ProjectTemplateResponseSchema,
  type ProjectDetail,
  type ProjectTemplateDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  deleteProjectTasks,
  dictionaryIds,
  errorShape,
  getProject,
  moveProjectOk,
  stageNamed,
  taskRowsOf,
  withTasksOff,
} from './helpers.js';

/**
 * User Story 3 — Project Templates (`specs/163-projects-and-tasks/spec.md`
 * US3, research R-7: a Template is **copied** into a Project, never
 * referenced).
 *
 * A Project created from a Template carries its Stages, workflow, gates,
 * alerts, Stage Task definitions and default description; the first Stage's
 * Tasks are created with the Project, a later Stage's on entry. Editing,
 * duplicating, archiving or deleting the Template afterwards changes nothing
 * on the Project, which names the Template while it exists.
 */
describe('projects — Templates (US3)', () => {
  let h: BackendServerHandle;
  let roles: Record<string, string>;
  let installer: string;
  let archivedRole: string;
  let fitter: { adminUserId: string; undo: () => void };
  const projects: string[] = [];
  const templates: string[] = [];

  /** Roles, three Stages, two Stage Tasks in the first, one in the second, an alert on the second, a backward move. */
  const showroom = () => ({
    name: 'Showroom fit-out',
    description: 'Fit out a showroom for the client.',
    roleIds: [roles.project_manager, installer],
    stages: [
      {
        key: 'survey',
        name: 'Survey',
        color: '#0ea5e9',
        plannedDurationDays: 5,
        responsibleRoleIds: [roles.project_manager],
        tasks: [
          { title: 'Measure the floor', description: 'All three halls', dueOffsetDays: 1, responsibleRoleId: installer },
          { title: 'Photograph the site', dueOffsetDays: 2 },
        ],
      },
      {
        key: 'build',
        name: 'Build',
        color: '#f59e0b',
        plannedDurationDays: 20,
        alertOffsetsDays: [7, 1],
        completionGate: true,
        tasks: [{ title: 'Install the racks', dueOffsetDays: 3, responsibleRoleId: installer }],
      },
      { key: 'handover', name: 'Handover', color: '#22c55e', plannedDurationDays: 2, completionPermitted: true },
    ],
    moves: [
      { fromStageKey: 'survey', toStageKey: 'build' },
      { fromStageKey: 'build', toStageKey: 'handover' },
      { fromStageKey: 'build', toStageKey: 'survey' },
    ],
  });

  async function saveTemplate(payload: unknown): Promise<ProjectTemplateDetail> {
    const response = await callProjects(h, 'POST', '/templates', { payload });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = ProjectTemplateResponseSchema.parse(response.json());
    templates.push(data.id);
    return data;
  }

  async function fromTemplate(templateId: string, body: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const response = await callProjects(h, 'POST', '', {
      payload: { title: 'From a template', organizationIds: [], templateId, visibility: 'everyone', ...body },
    });
    expect(response.statusCode, response.body).toBe(201);
    const project = (response.json() as { data: ProjectDetail }).data;
    projects.push(project.id);
    return project;
  }

  /** The Project's structure as a Template would see it — what must not change. */
  function structureOf(project: ProjectDetail) {
    const nameOf = (id: string) => project.stages.find((s) => s.id === id)!.name;
    return {
      description: project.description,
      stages: project.stages.map((s) => ({
        name: s.name,
        color: s.color,
        position: s.position,
        plannedDurationDays: s.plannedDurationDays,
        responsibleRoleIds: s.responsibleRoleIds,
        alertOffsetsDays: s.alertOffsetsDays,
        completionGate: s.completionGate,
        completionPermitted: s.completionPermitted,
        stageTasks: s.stageTasks.map((t) => ({
          title: t.title,
          description: t.description,
          responsibleRoleId: t.responsibleRoleId,
          dueOffsetDays: t.dueOffsetDays,
          position: t.position,
        })),
      })),
      moves: project.moves.map((m) => [nameOf(m.fromStageId), nameOf(m.toStageId)]),
    };
  }

  async function insertRole(code: string, name: string, archived: boolean): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "project_roles" ("id", "code", "name", "default_name", "position", "archived_at")
         values (?, ?, ?, ?, 901, ${archived ? 'now()' : 'null'})`,
        [id, `${code}_${id.slice(0, 8)}`, JSON.stringify({ en: name, pl: `${name} (pl)` }), name],
      );
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    roles = await dictionaryIds(h, 'project_roles');
    installer = await insertRole('tpl_installer', 'Installer', false);
    archivedRole = await insertRole('tpl_retired', 'Retired role', false);
    fitter = await seedCrmAdmin(h.em(), 'tpl-fitter', ['projects:read', 'tasks:read']);
  });

  afterAll(async () => {
    fitter.undo();
    await deleteProjectTasks(h, projects);
    await deleteProjects(h, projects);
    const connection = h.em().getConnection();
    if (templates.length > 0) {
      await connection.execute(`delete from "project_templates" where "id" = any(?::uuid[])`, [`{${templates.join(',')}}`]);
    }
    await connection.execute(`delete from "project_roles" where "id" = any(?::uuid[])`, [`{${installer},${archivedRole}}`]);
    await teardownBackendServer(h);
  });

  it('a Project created from a Template carries its structure; the first Stage’s Tasks are created, a later Stage’s on entry', async () => {
    const template = await saveTemplate(showroom());
    const project = await fromTemplate(template.id, {
      members: [
        { adminUserId: fitter.adminUserId, roleIds: [installer] },
        { adminUserId: TEST_ADMIN_ID, roleIds: [roles.project_manager] },
      ],
    });

    expect(project.template).toEqual({ id: template.id, name: 'Showroom fit-out' });
    expect(project.description).toBe('Fit out a showroom for the client.');
    expect(project.currentStage?.name).toBe('Survey');
    expect(structureOf(project)).toEqual({
      description: 'Fit out a showroom for the client.',
      stages: [
        {
          name: 'Survey',
          color: '#0ea5e9',
          position: 1,
          plannedDurationDays: 5,
          responsibleRoleIds: [roles.project_manager],
          alertOffsetsDays: [],
          completionGate: false,
          completionPermitted: false,
          stageTasks: [
            { title: 'Measure the floor', description: 'All three halls', responsibleRoleId: installer, dueOffsetDays: 1, position: 1 },
            { title: 'Photograph the site', description: '', responsibleRoleId: null, dueOffsetDays: 2, position: 2 },
          ],
        },
        {
          name: 'Build',
          color: '#f59e0b',
          position: 2,
          plannedDurationDays: 20,
          responsibleRoleIds: [],
          alertOffsetsDays: [7, 1],
          completionGate: true,
          completionPermitted: false,
          stageTasks: [
            { title: 'Install the racks', description: '', responsibleRoleId: installer, dueOffsetDays: 3, position: 1 },
          ],
        },
        {
          name: 'Handover',
          color: '#22c55e',
          position: 3,
          plannedDurationDays: 2,
          responsibleRoleIds: [],
          alertOffsetsDays: [],
          completionGate: false,
          completionPermitted: true,
          stageTasks: [],
        },
      ],
      moves: [
        ['Survey', 'Build'],
        ['Build', 'Survey'],
        ['Build', 'Handover'],
      ],
    });
    // The copies are the Project's own rows, not the Template's.
    const templateStageIds = new Set(template.stages.map((s) => s.id));
    expect(project.stages.some((s) => templateStageIds.has(s.id))).toBe(false);

    // The first Stage's Stage Tasks became Tasks with the Project; the Build Stage's did not.
    const survey = stageNamed(project, 'Survey');
    const first = await taskRowsOf(h, project.id);
    expect(first.map((t) => [t.title, t.context_group_id])).toEqual([
      ['Measure the floor', survey],
      ['Photograph the site', survey],
    ]);
    expect(project.stages.find((s) => s.id === survey)!.tasksMaterializedAt).not.toBeNull();
    const assigned = (await h
      .em()
      .getConnection()
      .execute(`select "title", "assigned_admin_user_id" from "tasks" where "context_id" = ? order by "title"`, [
        project.id,
      ])) as Array<{ title: string; assigned_admin_user_id: string | null }>;
    expect(assigned).toEqual([
      { title: 'Measure the floor', assigned_admin_user_id: fitter.adminUserId },
      { title: 'Photograph the site', assigned_admin_user_id: null },
    ]);

    // Survey has no gate, so it is left with its Tasks open; entering Build creates Build's.
    const build = stageNamed(project, 'Build');
    const moved = await moveProjectOk(h, project.id, build, project.version);
    expect(moved.createdTaskIds).toHaveLength(1);
    expect((await taskRowsOf(h, project.id)).map((t) => t.title)).toEqual([
      'Measure the floor',
      'Photograph the site',
      'Install the racks',
    ]);
  });

  it('the body’s own fields win over the Template’s; `stages` beside a Template is refused', async () => {
    const template = await saveTemplate(showroom());
    const project = await fromTemplate(template.id, { title: 'Own title', description: 'Own description' });
    expect(project).toMatchObject({ title: 'Own title', description: 'Own description' });

    const both = await callProjects(h, 'POST', '', {
      payload: {
        title: 'Both',
        organizationIds: [],
        templateId: template.id,
        stages: [{ name: 'Mine', color: '#000000' }],
      },
    });
    expect(both.statusCode, both.body).toBe(422);
    expect(errorShape(both.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('with Tasks off the first Stage’s Tasks are skipped and the entry says so', async () => {
    const template = await saveTemplate(showroom());
    const project = await withTasksOff(() => fromTemplate(template.id));
    const survey = project.stages.find((s) => s.name === 'Survey')!;
    expect(survey.tasksSkippedAt).not.toBeNull();
    expect(survey.tasksMaterializedAt).toBeNull();
    expect(await taskRowsOf(h, project.id)).toEqual([]);
    const history = ProjectStageEntryListResponseSchema.parse(
      (await callProjects(h, 'GET', `/${project.id}/stage-history`)).json(),
    ).data;
    expect(history[0]).toMatchObject({ kind: 'enter', toStageName: 'Survey', notes: ['stage_tasks_skipped'] });
  });

  it('editing and deleting the Template leaves the Project unchanged; delete sets its template to none', async () => {
    const template = await saveTemplate(showroom());
    const project = await fromTemplate(template.id);
    const before = structureOf(await getProject(h, project.id));

    const edited = await callProjects(h, 'PUT', `/templates/${template.id}`, {
      payload: {
        name: 'Showroom fit-out (revised)',
        description: 'Changed.',
        stages: [{ key: 'only', name: 'Everything', color: '#111111', tasks: [{ title: 'Do it all', dueOffsetDays: 0 }] }],
        moves: [],
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const afterEdit = await getProject(h, project.id);
    expect(structureOf(afterEdit)).toEqual(before);
    // It still names the Template it came from, by its current name.
    expect(afterEdit.template).toEqual({ id: template.id, name: 'Showroom fit-out (revised)' });

    // No route deletes a Template (archive retires it); the schema's `on delete set null` is what keeps the Project.
    await h.em().getConnection().execute(`delete from "project_templates" where "id" = ?`, [template.id]);
    const afterDelete = await getProject(h, project.id);
    expect(afterDelete.template).toBeNull();
    expect(structureOf(afterDelete)).toEqual(before);
  });

  it('a duplicate is independent of its original', async () => {
    const template = await saveTemplate(showroom());
    const response = await callProjects(h, 'POST', `/templates/${template.id}/duplicate`);
    expect(response.statusCode, response.body).toBe(201);
    const copy = ProjectTemplateResponseSchema.parse(response.json()).data;
    templates.push(copy.id);

    const changed = await callProjects(h, 'PUT', `/templates/${copy.id}`, {
      payload: { name: 'The copy', stages: [{ key: 'one', name: 'One', color: '#000000' }], moves: [] },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const original = ProjectTemplateResponseSchema.parse(
      (await callProjects(h, 'GET', `/templates/${template.id}`)).json(),
    ).data;
    expect(original).toEqual(template);
  });

  it('an archived Template is not offered and no Project is created from it; restored, it is again', async () => {
    const template = await saveTemplate(showroom());
    expect((await callProjects(h, 'POST', `/templates/${template.id}/archive`)).statusCode).toBe(200);

    const offered = ProjectTemplateListResponseSchema.parse((await callProjects(h, 'GET', '/templates?active=true')).json()).data;
    expect(offered.map((t) => t.id)).not.toContain(template.id);
    const refused = await callProjects(h, 'POST', '', {
      payload: { title: 'From archived', organizationIds: [], templateId: template.id },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_FOUND' });
    const unknown = await callProjects(h, 'POST', '', {
      payload: { title: 'From nothing', organizationIds: [], templateId: randomUUID() },
    });
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect(errorShape(unknown.body)).toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_FOUND' });

    expect((await callProjects(h, 'POST', `/templates/${template.id}/restore`)).statusCode).toBe(200);
    await fromTemplate(template.id);
  });

  it('a Template Role archived later is still copied, and may still be handed to a Member of a Project made from it', async () => {
    const template = await saveTemplate({
      ...showroom(),
      roleIds: [archivedRole],
      stages: [{ key: 'only', name: 'Only', color: '#000000', responsibleRoleIds: [archivedRole] }],
      moves: [],
    });
    await h.em().getConnection().execute(`update "project_roles" set "archived_at" = now() where "id" = ?`, [archivedRole]);
    const project = await fromTemplate(template.id, {
      members: [{ adminUserId: fitter.adminUserId, roleIds: [archivedRole] }],
    });
    expect(project.stages[0]!.responsibleRoleIds).toEqual([archivedRole]);
    expect(project.members[0]!.roles).toEqual([expect.objectContaining({ id: archivedRole, archived: true })]);

    // Without the Template, the archived Role is not handed out.
    const refused = await callProjects(h, 'POST', '', {
      payload: {
        title: 'No template',
        organizationIds: [],
        stages: [{ name: 'S', color: '#000000' }],
        members: [{ adminUserId: fitter.adminUserId, roleIds: [archivedRole] }],
      },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_MEMBER_INVALID' });
  });

  it('more than 100 Stage Tasks in one Stage are refused', async () => {
    const response = await callProjects(h, 'POST', '/templates', {
      payload: {
        name: 'Too many',
        stages: [
          {
            key: 'one',
            name: 'One',
            color: '#000000',
            tasks: Array.from({ length: 101 }, (_, index) => ({ title: `Task ${index + 1}`, dueOffsetDays: 0 })),
          },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(400);
  });

  it('a Project created by hand still works as before (no Template)', async () => {
    const project = await createProject(h, { title: 'By hand' });
    projects.push(project.id);
    expect(project.template).toBeNull();
  });
});
