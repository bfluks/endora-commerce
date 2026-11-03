import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  ProjectStageEntryListResponseSchema,
  type ProjectDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrganization } from '../../helpers/seed-crm.js';
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
  plusDays,
  reopenProject,
  stageNamed,
  warsawToday,
  withTasksOff,
} from './helpers.js';

/**
 * User Story 1 — run a Project through its Stages, **with the Tasks module
 * switched off** (`specs/163-projects-and-tasks/quickstart.md` US1; spec US1
 * scenarios 1–8, FR-001 – FR-006, FR-010 – FR-013, SC-002).
 *
 * Project A is created with two Organizations, three Members (one holding two
 * Roles) and three Stages, walked to the last and closed as completed. Project
 * B is lost in its second Stage and reopened. Every refusal is checked to have
 * changed nothing.
 */
describe('projects — a Project walked through its Stages, Tasks off (US1)', () => {
  let h: BackendServerHandle;
  let orgA: string;
  let orgB: string;
  let roles: Record<string, string>;
  let reasons: Record<string, string>;
  const people: Array<{ adminUserId: string; undo: () => void }> = [];
  const created: string[] = [];
  let a: ProjectDetail;
  let b: ProjectDetail;

  async function history(id: string) {
    const response = await callProjects(h, 'GET', `/${id}/stage-history`);
    expect(response.statusCode, response.body).toBe(200);
    return ProjectStageEntryListResponseSchema.parse(response.json()).data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    orgA = await seedCrmOrganization(h.em(), 'projects walk A');
    orgB = await seedCrmOrganization(h.em(), 'projects walk B');
    for (const label of ['walk-ann', 'walk-bob', 'walk-cid']) {
      people.push(await seedCrmAdmin(h.em(), label, ['projects:read']));
    }
    roles = await dictionaryIds(h, 'project_roles');
    reasons = await dictionaryIds(h, 'project_loss_reasons');
  });

  afterAll(async () => {
    for (const person of people) person.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('creates Project A: numbered, open, in its first Stage, with its Organizations, Members and Roles', async () =>
    withTasksOff(async () => {
      const [ann, bob, cid] = people;
      a = await createProject(h, {
        title: 'Showroom fit-out',
        description: 'Two floors',
        value: { amount: '125000.50', currency: 'PLN' },
        organizationIds: [orgA, orgB],
        members: [
          { adminUserId: ann!.adminUserId, roleIds: [roles.sales_rep!, roles.project_manager!] },
          { adminUserId: bob!.adminUserId, roleIds: [roles.project_manager!] },
          { adminUserId: cid!.adminUserId, roleIds: [] },
        ],
      });
      created.push(a.id);

      expect(a.number).toMatch(/^PRJ-\d{6,}$/);
      expect(a).toMatchObject({
        title: 'Showroom fit-out',
        state: 'open',
        value: { amount: '125000.50', currency: 'PLN' },
        visibility: 'inherit',
        closedAt: null,
        lostStageId: null,
        lossReason: null,
        unreachableStageIds: [],
        version: 1,
      });
      expect(a.organizations.map((o) => o.id).sort()).toEqual([orgA, orgB].sort());
      expect(a.stages.map((s) => [s.name, s.position])).toEqual([
        ['Design', 1],
        ['Build', 2],
        ['Handover', 3],
      ]);
      // The default workflow: each Stage to the next one; completing from the last.
      const [design, build, handover] = a.stages;
      expect(a.moves).toEqual([
        { fromStageId: design!.id, toStageId: build!.id },
        { fromStageId: build!.id, toStageId: handover!.id },
      ]);
      expect(a.stages.map((s) => s.completionPermitted)).toEqual([false, false, true]);
      // Entering the first Stage recorded its start and deadline (FR-013).
      const today = warsawToday();
      expect(a.currentStage).toMatchObject({ id: design!.id, name: 'Design', deadlineOn: plusDays(today, 10) });
      expect(design).toMatchObject({ startedOn: today, deadlineOn: plusDays(today, 10), deadlineManual: false });
      expect(build).toMatchObject({ startedOn: null, deadlineOn: null });

      const ownRoles = a.members.find((m) => m.adminUser.id === ann!.adminUserId)!.roles.map((r) => r.id).sort();
      expect(ownRoles).toEqual([roles.sales_rep, roles.project_manager].sort());
      expect(a.members).toHaveLength(3);
      expect(a.projectManagers.map((p) => p.id).sort()).toEqual([ann!.adminUserId, bob!.adminUserId].sort());

      const list = await callProjects(h, 'GET', `?q=${encodeURIComponent(a.number)}`);
      expect(list.statusCode, list.body).toBe(200);
      expect(ProjectListResponseSchema.parse(list.json()).items.map((p) => p.id)).toEqual([a.id]);
    }));

  it('walks A to its last Stage — each entry dated, a zero duration due the day it starts', async () =>
    withTasksOff(async () => {
      const today = warsawToday();
      const first = await moveProjectOk(h, a.id, stageNamed(a, 'Build'), a.version);
      expect(first.project.currentStage).toMatchObject({ name: 'Build', deadlineOn: today });
      expect(first.entry).toMatchObject({ kind: 'enter', fromStageName: 'Design', toStageName: 'Build', notes: [] });
      expect(first.createdTaskIds).toEqual([]);
      expect(first.project.version).toBe(a.version + 1);

      const second = await moveProjectOk(h, a.id, stageNamed(a, 'Handover'), first.project.version);
      expect(second.project.currentStage).toMatchObject({ name: 'Handover', deadlineOn: plusDays(today, 5) });
      a = second.project;
    }));

  it('closes A as completed from the Stage that permits it, with the time it closed', async () =>
    withTasksOff(async () => {
      const before = Date.now();
      const response = await closeProject(h, a.id, { outcome: 'completed', version: a.version });
      expect(response.statusCode, response.body).toBe(200);
      a = ProjectDetailResponseSchema.parse(response.json()).data;
      expect(a.state).toBe('completed');
      expect(new Date(a.closedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(a.currentStage?.name).toBe('Handover');

      const rows = await history(a.id);
      expect(rows.map((row) => [row.kind, row.fromStageName, row.toStageName])).toEqual([
        ['enter', null, 'Design'],
        ['enter', 'Design', 'Build'],
        ['enter', 'Build', 'Handover'],
        ['close_completed', 'Handover', null],
      ]);
      expect(rows.every((row) => row.actor !== null)).toBe(true);
    }));

  it('refuses completing from a Stage that does not permit it, with nothing changed', async () =>
    withTasksOff(async () => {
      b = await createProject(h, { title: 'Pilot line', organizationIds: [orgA] });
      created.push(b.id);
      const refused = await closeProject(h, b.id, { outcome: 'completed', version: b.version });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_COMPLETION_NOT_PERMITTED' });
      expect(await getProject(h, b.id)).toMatchObject({ state: 'open', version: b.version });
    }));

  it('refuses a move the workflow does not permit, with nothing changed', async () =>
    withTasksOff(async () => {
      const refused = await moveProject(h, b.id, stageNamed(b, 'Handover'), b.version);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_MOVE_NOT_PERMITTED' });
      const after = await getProject(h, b.id);
      expect(after.currentStage?.name).toBe('Design');
      expect(after.version).toBe(b.version);
      expect(await history(b.id)).toHaveLength(1);
    }));

  it('a stale version is refused with PROJECT_CHANGED and nothing applied', async () =>
    withTasksOff(async () => {
      const moved = await moveProjectOk(h, b.id, stageNamed(b, 'Build'), b.version);
      const stale = await moveProject(h, b.id, stageNamed(b, 'Handover'), b.version);
      expect(stale.statusCode, stale.body).toBe(409);
      expect(errorShape(stale.body)).toMatchObject({ code: 'PROJECT_CHANGED' });
      expect((await getProject(h, b.id)).currentStage?.name).toBe('Build');
      b = moved.project;
    }));

  it('closes B as lost in Stage 2 — a reason is required, an unknown one refused, the lost Stage recorded', async () =>
    withTasksOff(async () => {
      const missing = await closeProject(h, b.id, { outcome: 'lost', version: b.version });
      expect(missing.statusCode, missing.body).toBe(400);
      const unknown = await closeProject(h, b.id, {
        outcome: 'lost',
        lossReasonId: '00000000-0000-4000-8000-00000000dead',
        version: b.version,
      });
      expect(unknown.statusCode, unknown.body).toBe(422);
      expect(errorShape(unknown.body)).toMatchObject({ code: 'PROJECT_LOSS_REASON_INVALID' });
      expect((await getProject(h, b.id)).state).toBe('open');

      const response = await closeProject(h, b.id, {
        outcome: 'lost',
        lossReasonId: reasons.competitor,
        comment: 'Went with a local firm',
        version: b.version,
      });
      expect(response.statusCode, response.body).toBe(200);
      b = ProjectDetailResponseSchema.parse(response.json()).data;
      expect(b).toMatchObject({
        state: 'lost',
        lostStageId: stageNamed(b, 'Build'),
        lossReason: { id: reasons.competitor },
        lossComment: 'Went with a local firm',
      });
      expect(b.closedAt).not.toBeNull();
      const rows = await history(b.id);
      expect(rows.at(-1)).toMatchObject({ kind: 'close_lost', fromStageName: 'Build', toStageName: null });
    }));

  it('reopens B into the Stage it was lost in, its outcome cleared and the reopening in its history', async () =>
    withTasksOff(async () => {
      const response = await reopenProject(h, b.id, b.version);
      expect(response.statusCode, response.body).toBe(200);
      b = ProjectDetailResponseSchema.parse(response.json()).data;
      expect(b).toMatchObject({ state: 'open', closedAt: null, lostStageId: null, lossReason: null, lossComment: null });
      expect(b.currentStage?.name).toBe('Build');
      expect((await history(b.id)).at(-1)).toMatchObject({ kind: 'reopen', toStageName: 'Build' });

      // Reopened, it walks on.
      const moved = await moveProjectOk(h, b.id, stageNamed(b, 'Handover'), b.version);
      b = moved.project;
      expect(b.currentStage?.name).toBe('Handover');
    }));

  it('two moves of the same version at once: one applies, the other is told the Project changed', async () =>
    withTasksOff(async () => {
      const c = await createProject(h, { title: 'Race', organizationIds: [] });
      created.push(c.id);
      const results = await Promise.all([
        moveProject(h, c.id, stageNamed(c, 'Build'), c.version),
        moveProject(h, c.id, stageNamed(c, 'Build'), c.version),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const loser = results.find((r) => r.statusCode === 409)!;
      expect(errorShape(loser.body)).toMatchObject({ code: 'PROJECT_CHANGED' });
      expect(await history(c.id)).toHaveLength(2);
      expect((await getProject(h, c.id)).version).toBe(c.version + 1);
    }));

  it('the same person is Sales Rep on one Project and Project Manager on another', async () =>
    withTasksOff(async () => {
      const [, , cid] = people;
      const one = await createProject(h, {
        title: 'Role A',
        organizationIds: [],
        members: [{ adminUserId: cid!.adminUserId, roleIds: [roles.sales_rep!] }],
      });
      const two = await createProject(h, {
        title: 'Role B',
        organizationIds: [],
        members: [{ adminUserId: cid!.adminUserId, roleIds: [roles.project_manager!] }],
      });
      created.push(one.id, two.id);
      const roleOn = (project: ProjectDetail) =>
        project.members.find((m) => m.adminUser.id === cid!.adminUserId)!.roles.map((r) => r.id);
      expect(roleOn(await getProject(h, one.id))).toEqual([roles.sales_rep]);
      expect(roleOn(await getProject(h, two.id))).toEqual([roles.project_manager]);
    }));
});
