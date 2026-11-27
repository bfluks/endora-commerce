import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectStageGateOpenTasksDetailsSchema, type ProjectDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { restoreDefaultTaskWorkflow } from '../../helpers/task-workflow.js';
import {
  callProjects,
  callTasks,
  closeProject,
  createProject,
  createStageTask,
  deleteProjects,
  deleteProjectTasks,
  dictionaryIds,
  getProject,
  moveProject,
  moveProjectOk,
  patchStage,
  setTaskStatus,
  stageNamed,
  taskRowsOf,
  withTasksOff,
} from './helpers.js';

/**
 * User Story 2 — the completion gate (`specs/163-projects-and-tasks/quickstart.md`
 * US2; spec US2 scenarios 3–5, FR-012, FR-040, research R-8).
 *
 * A Stage with the gate on is not left — by a move, or by completing the
 * Project — while one of its Tasks is neither done nor cancelled; the refusal
 * names the open Tasks. Losing the Project is not gated. With the gate off the
 * Project leaves and the open Tasks stay under their Stage. With the Tasks
 * module off the gate is not applied and the move says so; back on, it applies
 * again.
 */
describe('projects — the completion gate (US2)', () => {
  let h: BackendServerHandle;
  let reasons: Record<string, string>;
  const created: string[] = [];

  async function gatedProject(title: string, gated: string[] = ['Design']): Promise<ProjectDetail> {
    const project = await createProject(h, { title });
    created.push(project.id);
    for (const name of gated) await patchStage(h, project.id, stageNamed(project, name), { completionGate: true });
    return getProject(h, project.id);
  }

  function openTasksOf(body: string) {
    const parsed = JSON.parse(body) as { error: { code: string; details?: unknown } };
    expect(parsed.error.code).toBe('PROJECT_STAGE_GATE_OPEN_TASKS');
    return ProjectStageGateOpenTasksDetailsSchema.parse(parsed.error.details).openTasks ?? [];
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    reasons = await dictionaryIds(h, 'project_loss_reasons');
  });

  afterAll(async () => {
    await deleteProjectTasks(h, created);
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('refuses to leave a gated Stage with an open Task, naming it — nothing changes', async () => {
    const project = await gatedProject('Gate refuses');
    const design = stageNamed(project, 'Design');
    const open = await createStageTask(h, project.id, design, { title: 'Survey the site' });
    const done = await createStageTask(h, project.id, design, { title: 'Agree the brief' });
    await setTaskStatus(h, done.id, 'done');

    const refused = await moveProject(h, project.id, stageNamed(project, 'Build'), project.version);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(openTasksOf(refused.body)).toEqual([{ id: open.id, number: open.number, title: 'Survey the site' }]);

    const after = await getProject(h, project.id);
    expect(after.currentStage?.id).toBe(design);
    expect(after.version).toBe(project.version);
  });

  it('to a caller who may not read Tasks the refusal counts the open Tasks and names none (T144 F2)', async () => {
    const writer = await seedCrmAdmin(h.em(), 'gate-no-tasks', ['projects:read', 'projects:write', 'projects:see_all']);
    try {
      const project = await gatedProject('Gate counts');
      const design = stageNamed(project, 'Design');
      await createStageTask(h, project.id, design, { title: 'Secret survey' });
      await createStageTask(h, project.id, design, { title: 'Secret brief' });

      const refused = await moveProject(h, project.id, stageNamed(project, 'Build'), project.version, writer.cookies);
      expect(refused.statusCode, refused.body).toBe(409);
      const details = ProjectStageGateOpenTasksDetailsSchema.parse(JSON.parse(refused.body).error.details);
      expect(details).toEqual({ openTaskCount: 2 });
      expect(refused.body).not.toContain('Secret');

      const single = await createProject(h, {
        title: 'Gate counts at the end',
        stages: [{ name: 'Only', color: '#000000', completionGate: true }],
      });
      created.push(single.id);
      await createStageTask(h, single.id, stageNamed(single, 'Only'), { title: 'Secret handover' });
      await createStageTask(h, single.id, stageNamed(single, 'Only'), { title: 'Secret sign-off' });
      const completed = await closeProject(h, single.id, { outcome: 'completed', version: single.version }, writer.cookies);
      expect(completed.statusCode, completed.body).toBe(409);
      expect(completed.body).not.toContain('Secret');
      expect(ProjectStageGateOpenTasksDetailsSchema.parse(JSON.parse(completed.body).error.details)).toEqual({
        openTaskCount: 2,
      });
    } finally {
      writer.undo();
    }
  });

  it('counts a cancelled Task as closed', async () => {
    const project = await gatedProject('Gate and cancelled');
    const design = stageNamed(project, 'Design');
    const task = await createStageTask(h, project.id, design, { title: 'Maybe later' });
    await setTaskStatus(h, task.id, 'cancelled');
    const moved = await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
    expect(moved.project.currentStage?.name).toBe('Build');
    expect(moved.entry.notes).toEqual([]);
  });

  it('refuses completing from a gated Stage with an open Task; losing the Project is not gated', async () => {
    const project = await createProject(h, {
      title: 'Gate at the end',
      stages: [{ name: 'Only', color: '#000000', completionGate: true }],
    });
    created.push(project.id);
    const only = stageNamed(project, 'Only');
    const open = await createStageTask(h, project.id, only, { title: 'Sign the handover' });

    const completed = await closeProject(h, project.id, { outcome: 'completed', version: project.version });
    expect(completed.statusCode, completed.body).toBe(409);
    expect(openTasksOf(completed.body).map((t) => t.id)).toEqual([open.id]);
    expect((await getProject(h, project.id)).state).toBe('open');

    const lost = await closeProject(h, project.id, {
      outcome: 'lost',
      lossReasonId: reasons.price,
      version: project.version,
    });
    expect(lost.statusCode, lost.body).toBe(200);
    expect((await getProject(h, project.id)).state).toBe('lost');
  });

  it('with the gate off the Project leaves, and the open Task stays open under its Stage', async () => {
    const project = await gatedProject('No gate', []);
    const design = stageNamed(project, 'Design');
    const task = await createStageTask(h, project.id, design, { title: 'Still to do' });
    const moved = await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
    expect(moved.project.currentStage?.name).toBe('Build');

    const read = await callTasks(h, 'GET', `/${task.id}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data).toMatchObject({ status: { code: 'todo' }, context: { groupId: design, groupLabel: 'Design' } });
  });

  it('with Tasks off the gate is not applied and the entry says so; back on, it applies again', async () => {
    const project = await gatedProject('Gate and Tasks off', ['Design', 'Build']);
    await createStageTask(h, project.id, stageNamed(project, 'Design'), { title: 'Open in Design' });
    const inBuild = await createStageTask(h, project.id, stageNamed(project, 'Build'), { title: 'Open in Build' });

    const moved = await withTasksOff(() => moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version));
    expect(moved.project.currentStage?.name).toBe('Build');
    expect(moved.entry.notes).toEqual(['gate_not_applied_tasks_off']);
    expect(moved.notes).toContain('gate_not_applied_tasks_off');

    const refused = await moveProject(h, project.id, stageNamed(project, 'Handover'), moved.project.version);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(openTasksOf(refused.body).map((t) => t.id)).toEqual([inBuild.id]);
  });

  /**
   * The gate reads *closed* from the operator's workflow — category `done` or
   * `cancelled` — and not from four literal codes (`specs/165-task-management/`
   * US2 scenario 6, FR-017, quickstart US2 row). The workflow is
   * platform-wide, so this block restores the seeded one around itself.
   */
  describe('with an operator-defined workflow (165 US2)', () => {
    const configure = async (method: 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown, status = 200) => {
      const response = await callTasks(h, method, path, payload === undefined ? {} : { payload });
      expect(response.statusCode, response.body).toBe(status);
    };

    beforeAll(async () => {
      await restoreDefaultTaskWorkflow(h.em());
    });

    afterAll(async () => {
      await restoreDefaultTaskWorkflow(h.em());
    });

    it('a custom done status closes, an added open status blocks, and a draft does not count', async () => {
      // *Accepted* (done) and *In review* (open); *Done* removed, its Tasks moved to *Accepted*.
      await configure(
        'POST',
        '/statuses',
        { code: 'accepted', name: { en: 'Accepted', pl: 'Zaakceptowane' }, category: 'done', color: '#10b981', weight: 35 },
        201,
      );
      await configure(
        'POST',
        '/statuses',
        { code: 'in_review', name: { en: 'In review', pl: 'Do przeglądu' }, category: 'open', color: '#8b5cf6', weight: 25 },
        201,
      );
      await configure('PUT', '/transitions', {
        add: [
          { from: 'todo', to: 'accepted' },
          { from: 'todo', to: 'in_review' },
          { from: 'in_review', to: 'accepted' },
          { from: 'done', to: 'accepted' },
        ],
      });

      const project = await gatedProject('Gate and the workflow');
      const design = stageNamed(project, 'Design');
      const finished = await createStageTask(h, project.id, design, { title: 'Finished before' });
      await setTaskStatus(h, finished.id, 'done');
      await configure('DELETE', '/statuses/done?replacement=accepted');
      expect((await callTasks(h, 'GET', `/${finished.id}`)).json().data.status).toMatchObject({ code: 'accepted' });

      const reviewed = await createStageTask(h, project.id, design, { title: 'Being reviewed' });
      await setTaskStatus(h, reviewed.id, 'in_review');
      const dropped = await createStageTask(h, project.id, design, { title: 'Dropped' });
      await setTaskStatus(h, dropped.id, 'cancelled');
      // A draft in the Stage: drafts are written by User Story 8, so it is set directly.
      const draft = await createStageTask(h, project.id, design, { title: 'Draft idea' });
      await h.em().getConnection().execute(`update "tasks" set "is_draft" = true where "id" = ?`, [draft.id]);

      const refused = await moveProject(h, project.id, stageNamed(project, 'Build'), project.version);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(openTasksOf(refused.body).map((t) => t.id)).toEqual([reviewed.id]);

      await setTaskStatus(h, reviewed.id, 'accepted');
      const moved = await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
      expect(moved.project.currentStage?.name).toBe('Build');
      expect(moved.entry.notes).toEqual([]);
    });

    it('a Stage Task created through the write port starts in the current initial status', async () => {
      await configure(
        'POST',
        '/statuses',
        { code: 'backlog', name: { en: 'Backlog', pl: 'Zaległe' }, category: 'open', color: '#64748b', weight: 5, isInitial: true },
        201,
      );
      const project = await gatedProject('Stage tasks start in the backlog', []);
      const build = stageNamed(project, 'Build');
      const defined = await callProjects(h, 'PUT', `/${project.id}/stages/${build}/tasks`, {
        payload: { tasks: [{ title: 'Templated step', dueOffsetDays: 0 }] },
      });
      expect(defined.statusCode, defined.body).toBe(200);
      const moved = await moveProjectOk(h, project.id, build, project.version);
      expect(moved.createdTaskIds).toHaveLength(1);
      const rows = await taskRowsOf(h, project.id);
      expect(rows.map((row) => row.status)).toEqual(['backlog']);
    });
  });

  it('a gate on a Stage with no Task lets the Project go, with no note', async () => {
    const project = await gatedProject('Empty gate');
    const moved = await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
    expect(moved.entry.notes).toEqual([]);
  });
});
