import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECTS_EVENTS,
  ProjectDetailResponseSchema,
  type ProjectStageGuardContext,
  type ProjectStageGuardRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import {
  callProjects,
  closeProject,
  createProject,
  deleteProjects,
  dictionaryIds,
  errorShape,
  getProject,
  moveProject,
  moveProjectOk,
  reopenProject,
  stageNamed,
  withTasksOff,
} from './helpers.js';

/**
 * Logic registered on a Stage move (FR-014, research R-6): a guard in
 * `projectStageGuardRegistry` may refuse a move, a close or a reopen with a
 * sentence of its own, and nothing is written; a guard whose module is
 * switched off is skipped; and the "after" side is the module's events,
 * emitted once per Command, on commit.
 *
 * A guard cannot be withdrawn from the registry, so the probe refuses only
 * the Projects this file puts in its set. Its owner is `crm`, a module an
 * operator can switch off.
 */
describe('projects — Stage guards and events (FR-014)', () => {
  let h: BackendServerHandle;
  let registry: ProjectStageGuardRegistryPort;
  const refused = new Set<string>();
  const asked: ProjectStageGuardContext[] = [];
  const created: string[] = [];
  let reasons: Record<string, string>;

  beforeAll(async () => {
    h = await setupBackendServer();
    registry = h.container.resolve<ProjectStageGuardRegistryPort>('projectStageGuardRegistry');
    registry.register({
      ownerModuleId: 'crm',
      before: async (ctx) => {
        if (!refused.has(ctx.projectId)) return { allow: true };
        asked.push(ctx);
        return { allow: false, reason: 'The client has not signed the acceptance protocol.' };
      },
    });
    reasons = await dictionaryIds(h, 'project_loss_reasons');
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('lists the probe’s owner among the registry’s contributors', () => {
    expect(registry.owners()).toContain('crm');
  });

  it('a guard refuses a move with its own sentence, and nothing is written', async () =>
    withTasksOff(async () => {
      const project = await createProject(h, { title: 'Guarded move' });
      created.push(project.id);
      refused.add(project.id);
      const audit = async () => (await h.auditLogService.query({ objectId: project.id })).length;
      const auditBefore = await audit();

      const response = await moveProject(h, project.id, stageNamed(project, 'Build'), project.version);
      expect(response.statusCode, response.body).toBe(409);
      expect(errorShape(response.body)).toMatchObject({
        code: 'PROJECT_GUARD_REFUSED',
        message: 'The client has not signed the acceptance protocol.',
        details: { reason: 'The client has not signed the acceptance protocol.' },
      });
      expect(asked.at(-1)).toEqual({
        projectId: project.id,
        fromStageId: stageNamed(project, 'Design'),
        toStageId: stageNamed(project, 'Build'),
        kind: 'move',
      });
      const after = await getProject(h, project.id);
      expect(after.currentStage?.name).toBe('Design');
      expect(after.version).toBe(project.version);
      expect(await audit()).toBe(auditBefore);
    }));

  it('a guard is asked about closing as completed, as lost, and reopening — each with its kind', async () =>
    withTasksOff(async () => {
      const project = await createProject(h, {
        title: 'Guarded close',
        stages: [{ name: 'Only', color: '#64748b', completionPermitted: true }],
      });
      created.push(project.id);
      refused.add(project.id);
      const only = stageNamed(project, 'Only');

      const completed = await closeProject(h, project.id, { outcome: 'completed', version: project.version });
      expect(completed.statusCode, completed.body).toBe(409);
      expect(asked.at(-1)).toMatchObject({ kind: 'close_completed', fromStageId: only, toStageId: null });

      const lost = await closeProject(h, project.id, {
        outcome: 'lost',
        lossReasonId: reasons.price,
        version: project.version,
      });
      expect(lost.statusCode, lost.body).toBe(409);
      expect(asked.at(-1)).toMatchObject({ kind: 'close_lost', fromStageId: only, toStageId: null });

      refused.delete(project.id);
      const closed = await closeProject(h, project.id, { outcome: 'completed', version: project.version });
      expect(closed.statusCode, closed.body).toBe(200);
      const version = ProjectDetailResponseSchema.parse(closed.json()).data.version;

      refused.add(project.id);
      const reopened = await reopenProject(h, project.id, version);
      expect(reopened.statusCode, reopened.body).toBe(409);
      expect(asked.at(-1)).toMatchObject({ kind: 'reopen', fromStageId: null, toStageId: only });
      expect((await getProject(h, project.id)).state).toBe('completed');
    }));

  it('a guard whose module is switched off is skipped — and asked again once it is back', async () => {
    const project = await withTasksOff(() => createProject(h, { title: 'Owner off' }));
    created.push(project.id);
    refused.add(project.id);
    const calls = asked.length;

    const moved = await withModulesDeactivated(['tasks', 'crm'], () =>
      moveProject(h, project.id, stageNamed(project, 'Build'), project.version),
    );
    expect(moved.statusCode, moved.body).toBe(200);
    expect(asked.length).toBe(calls);

    const after = await getProject(h, project.id);
    const again = await withTasksOff(() => moveProject(h, project.id, stageNamed(project, 'Handover'), after.version));
    expect(again.statusCode, again.body).toBe(409);
    expect(asked.length).toBe(calls + 1);
  });

  it('emits projects.stage.moved.v1, .closed.v1 and .reopened.v1 once per Command, with their payloads', async () =>
    withTasksOff(async () => {
      const project = await createProject(h, { title: 'Observed' });
      created.push(project.id);
      const seen: Array<{ name: string; payload: Record<string, unknown> }> = [];
      const offs = [
        PROJECTS_EVENTS.PROJECT_CREATED,
        PROJECTS_EVENTS.STAGE_MOVED,
        PROJECTS_EVENTS.PROJECT_CLOSED,
        PROJECTS_EVENTS.PROJECT_REOPENED,
      ].map((name) =>
        h.eventBus.on(name, (payload: unknown) => {
          const record = payload as Record<string, unknown>;
          if (record.projectId === project.id) seen.push({ name, payload: record });
        }),
      );
      try {
        const moved = await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
        const closed = await closeProject(h, project.id, {
          outcome: 'lost',
          lossReasonId: reasons.no_decision,
          version: moved.project.version,
        });
        expect(closed.statusCode, closed.body).toBe(200);
        const reopened = await reopenProject(h, project.id, ProjectDetailResponseSchema.parse(closed.json()).data.version);
        expect(reopened.statusCode, reopened.body).toBe(200);
        // A refused move emits nothing.
        const refusedMove = await moveProject(h, project.id, stageNamed(project, 'Design'), 1);
        expect(refusedMove.statusCode).toBe(409);
      } finally {
        for (const off of offs) off();
      }

      expect(seen.map((event) => event.name)).toEqual([
        PROJECTS_EVENTS.STAGE_MOVED,
        PROJECTS_EVENTS.PROJECT_CLOSED,
        PROJECTS_EVENTS.PROJECT_REOPENED,
      ]);
      expect(seen[0]!.payload).toMatchObject({
        projectId: project.id,
        fromStageId: stageNamed(project, 'Design'),
        toStageId: stageNamed(project, 'Build'),
        fromStageName: 'Design',
        toStageName: 'Build',
      });
      expect(seen[1]!.payload).toMatchObject({
        projectId: project.id,
        outcome: 'lost',
        stageId: stageNamed(project, 'Build'),
        lossReasonCode: 'no_decision',
      });
      expect(seen[2]!.payload).toMatchObject({ projectId: project.id, stageId: stageNamed(project, 'Build') });
      for (const event of seen) {
        expect(typeof event.payload.eventId).toBe('string');
        expect(typeof event.payload.occurredAt).toBe('string');
      }
    }));

  it('emits projects.project.created.v1 once on creation', async () =>
    withTasksOff(async () => {
      const seen: unknown[] = [];
      const off = h.eventBus.on(PROJECTS_EVENTS.PROJECT_CREATED, (payload: unknown) => {
        seen.push(payload);
      });
      let id = '';
      try {
        const project = await createProject(h, { title: 'Announced' });
        id = project.id;
        created.push(id);
      } finally {
        off();
      }
      const mine = seen.filter((payload) => (payload as { projectId: string }).projectId === id);
      expect(mine).toEqual([expect.objectContaining({ projectId: id, templateId: null })]);
      const listed = await callProjects(h, 'GET', `/${id}`);
      expect(listed.statusCode).toBe(200);
    }));
});
