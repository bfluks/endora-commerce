import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectTemplateListResponseSchema,
  ProjectTemplateResponseSchema,
  type ProjectTemplateDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { callProjects, dictionaryIds, errorShape } from '../../integration/projects/helpers.js';

/**
 * Project Templates — `specs/163-projects-and-tasks/contracts/admin-api.md`
 * §2.5 (User Story 3): reading is `projects:read`, every write
 * `projects:configure`. Each answer against its schema, each gate, each
 * refusal by its code. What a Project created from a Template carries is
 * `integration/projects/templates.test.ts`.
 */
describe('projects (contract) — §2.5 Templates', () => {
  let h: BackendServerHandle;
  let roles: Record<string, string>;
  let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let writer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let nobody: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let configurer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const created: string[] = [];

  const body = (overrides: Record<string, unknown> = {}) => ({
    name: 'Showroom fit-out',
    description: 'A showroom, start to finish.',
    roleIds: [roles.project_manager],
    stages: [
      {
        key: 'survey',
        name: 'Survey',
        color: '#0ea5e9',
        plannedDurationDays: 5,
        responsibleRoleIds: [roles.sales_rep],
        tasks: [{ title: 'Measure the floor', dueOffsetDays: 1, responsibleRoleId: roles.project_manager }],
      },
      { key: 'build', name: 'Build', color: '#f59e0b', alertOffsetsDays: [3], completionGate: true },
    ],
    moves: [{ fromStageKey: 'survey', toStageKey: 'build' }],
    ...overrides,
  });

  async function make(overrides: Record<string, unknown> = {}): Promise<ProjectTemplateDetail> {
    const response = await callProjects(h, 'POST', '/templates', { payload: body(overrides) });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = ProjectTemplateResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    roles = await dictionaryIds(h, 'project_roles');
    reader = await seedCrmAdmin(h.em(), 'templates-reader', ['projects:read']);
    writer = await seedCrmAdmin(h.em(), 'templates-writer', ['projects:read', 'projects:write']);
    nobody = await seedCrmAdmin(h.em(), 'templates-nobody', ['orders:read']);
    configurer = await seedCrmAdmin(h.em(), 'templates-configurer', ['projects:read', 'projects:configure']);
  });

  afterAll(async () => {
    for (const person of [reader, writer, nobody, configurer]) person.undo();
    if (created.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from "project_templates" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  describe('gates', () => {
    const ID = '00000000-0000-4000-8000-0000000073a1';
    const reads = ['/templates', `/templates/${ID}`];
    const writes: Array<[method: 'POST' | 'PUT', path: string]> = [
      ['POST', '/templates'],
      ['PUT', `/templates/${ID}`],
      ['POST', `/templates/${ID}/duplicate`],
      ['POST', `/templates/${ID}/archive`],
      ['POST', `/templates/${ID}/restore`],
    ];

    it('every route answers 401 without a session', async () => {
      for (const path of reads) {
        expect((await callProjects(h, 'GET', path, { cookies: null })).statusCode, `GET ${path}`).toBe(401);
      }
      for (const [method, path] of writes) {
        expect((await callProjects(h, method, path, { cookies: null, payload: {} })).statusCode, `${method} ${path}`).toBe(
          401,
        );
      }
    });

    it('reads need projects:read; writes need projects:configure, which projects:write is not — 403 otherwise', async () => {
      for (const path of reads) {
        expect((await callProjects(h, 'GET', path, { cookies: nobody.cookies })).statusCode, `GET ${path}`).toBe(403);
      }
      for (const who of [reader, writer]) {
        for (const [method, path] of writes) {
          const response = await callProjects(h, method, path, { cookies: who.cookies, payload: body() });
          expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(403);
        }
      }
    });

    it('a projects:configure holder writes', async () => {
      const response = await callProjects(h, 'POST', '/templates', { cookies: configurer.cookies, payload: body() });
      expect(response.statusCode, response.body).toBe(201);
      created.push(ProjectTemplateResponseSchema.parse(response.json()).data.id);
    });
  });

  describe('POST /projects/templates', () => {
    it('answers 201 with the whole Template', async () => {
      const template = await make();
      expect(template).toMatchObject({
        name: 'Showroom fit-out',
        description: 'A showroom, start to finish.',
        roleIds: [roles.project_manager],
        archivedAt: null,
      });
      expect(template.stages.map((s) => [s.name, s.position])).toEqual([
        ['Survey', 1],
        ['Build', 2],
      ]);
      const [survey, build] = template.stages;
      expect(survey).toMatchObject({
        color: '#0ea5e9',
        plannedDurationDays: 5,
        responsibleRoleIds: [roles.sales_rep],
        completionPermitted: false,
        tasks: [{ title: 'Measure the floor', dueOffsetDays: 1, responsibleRoleId: roles.project_manager, position: 1 }],
      });
      // The last Stage permits completing unless the body says otherwise.
      expect(build).toMatchObject({ alertOffsetsDays: [3], completionGate: true, completionPermitted: true, tasks: [] });
      expect(template.moves).toEqual([{ fromStageId: survey!.id, toStageId: build!.id }]);
    });

    it('without `moves` the workflow is the default one — each Stage to the next', async () => {
      const template = await make({ moves: undefined });
      const [survey, build] = template.stages;
      expect(template.moves).toEqual([{ fromStageId: survey!.id, toStageId: build!.id }]);
    });

    it('answers 400 for a body its schema refuses — duplicate Stage keys, a move to an unknown key, > 100 Stage Tasks', async () => {
      const duplicateKeys = body({
        stages: [
          { key: 'x', name: 'A', color: '#000000' },
          { key: 'x', name: 'B', color: '#000000' },
        ],
        moves: [],
      });
      const unknownKey = body({ moves: [{ fromStageKey: 'survey', toStageKey: 'nowhere' }] });
      const tooManyTasks = body({
        stages: [
          {
            key: 'only',
            name: 'Only',
            color: '#000000',
            tasks: Array.from({ length: 101 }, (_, index) => ({ title: `Task ${index}`, dueOffsetDays: 0 })),
          },
        ],
        moves: [],
      });
      for (const payload of [duplicateKeys, unknownKey, tooManyTasks, { name: '' }]) {
        const response = await callProjects(h, 'POST', '/templates', { payload });
        expect(response.statusCode, response.body).toBe(400);
      }
    });

    it('refuses a Role that does not exist — 422 VALIDATION_FAILED, nothing written', async () => {
      const before = ProjectTemplateListResponseSchema.parse((await callProjects(h, 'GET', '/templates')).json()).data;
      for (const payload of [
        body({ roleIds: [randomUUID()] }),
        body({ stages: [{ key: 'a', name: 'A', color: '#000000', responsibleRoleIds: [randomUUID()] }], moves: [] }),
        body({
          stages: [{ key: 'a', name: 'A', color: '#000000', tasks: [{ title: 'T', dueOffsetDays: 0, responsibleRoleId: randomUUID() }] }],
          moves: [],
        }),
      ]) {
        const response = await callProjects(h, 'POST', '/templates', { payload });
        expect(response.statusCode, response.body).toBe(422);
        expect(errorShape(response.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      const after = ProjectTemplateListResponseSchema.parse((await callProjects(h, 'GET', '/templates')).json()).data;
      expect(after).toHaveLength(before.length);
    });
  });

  describe('GET /projects/templates and /projects/templates/:id', () => {
    it('lists Templates as summaries; `active=true` leaves archived ones out', async () => {
      const kept = await make({ name: 'Annual framework contract' });
      const gone = await make({ name: 'Retired template' });
      expect((await callProjects(h, 'POST', `/templates/${gone.id}/archive`)).statusCode).toBe(200);

      const all = ProjectTemplateListResponseSchema.parse(
        (await callProjects(h, 'GET', '/templates', { cookies: reader.cookies })).json(),
      ).data;
      expect(all.find((row) => row.id === kept.id)).toMatchObject({ name: 'Annual framework contract', stageCount: 2, archivedAt: null });
      expect(all.find((row) => row.id === gone.id)?.archivedAt).not.toBeNull();

      const active = ProjectTemplateListResponseSchema.parse(
        (await callProjects(h, 'GET', '/templates?active=true', { cookies: reader.cookies })).json(),
      ).data;
      expect(active.map((row) => row.id)).toContain(kept.id);
      expect(active.map((row) => row.id)).not.toContain(gone.id);
    });

    it('reads one Template; an unknown id answers 404 PROJECT_TEMPLATE_NOT_FOUND', async () => {
      const template = await make();
      const response = await callProjects(h, 'GET', `/templates/${template.id}`, { cookies: reader.cookies });
      expect(response.statusCode, response.body).toBe(200);
      expect(ProjectTemplateResponseSchema.parse(response.json()).data).toEqual(template);

      const missing = await callProjects(h, 'GET', `/templates/${randomUUID()}`);
      expect(missing.statusCode).toBe(404);
      expect(errorShape(missing.body)).toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_FOUND' });
    });
  });

  describe('PUT /projects/templates/:id', () => {
    it('replaces the whole graph in one Command; a Stage named by its id keeps it', async () => {
      const template = await make();
      const [survey, build] = template.stages;
      const response = await callProjects(h, 'PUT', `/templates/${template.id}`, {
        payload: {
          name: 'Showroom fit-out, v2',
          roleIds: [],
          stages: [
            { key: build!.id, name: 'Build', color: '#f59e0b' },
            { key: 'new-handover', name: 'Handover', color: '#22c55e', tasks: [{ title: 'Hand the keys over', dueOffsetDays: 0 }] },
          ],
          moves: [
            { fromStageKey: build!.id, toStageKey: 'new-handover' },
            { fromStageKey: 'new-handover', toStageKey: build!.id },
          ],
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const saved = ProjectTemplateResponseSchema.parse(response.json()).data;
      expect(saved).toMatchObject({ id: template.id, name: 'Showroom fit-out, v2', description: '', roleIds: [] });
      expect(saved.stages.map((s) => s.name)).toEqual(['Build', 'Handover']);
      expect(saved.stages[0]!.id).toBe(build!.id);
      expect(saved.stages.map((s) => s.id)).not.toContain(survey!.id);
      const handover = saved.stages[1]!.id;
      expect(saved.moves).toEqual([
        { fromStageId: build!.id, toStageId: handover },
        { fromStageId: handover, toStageId: build!.id },
      ]);

      const audit = await h.auditLogService.query({ objectType: 'project_template', objectId: template.id });
      expect(audit.map((row) => row.action).sort()).toEqual(['projects.template.create', 'projects.template.save']);
    });

    it('answers 404 PROJECT_TEMPLATE_NOT_FOUND for an unknown id', async () => {
      const response = await callProjects(h, 'PUT', `/templates/${randomUUID()}`, { payload: body() });
      expect(response.statusCode, response.body).toBe(404);
      expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_FOUND' });
    });
  });

  describe('duplicate, archive, restore', () => {
    it('duplicate answers 201 with an independent copy named in the reader’s language', async () => {
      const template = await make({ name: 'Kiosk' });
      const response = await callProjects(h, 'POST', `/templates/${template.id}/duplicate`);
      expect(response.statusCode, response.body).toBe(201);
      const copy = ProjectTemplateResponseSchema.parse(response.json()).data;
      created.push(copy.id);
      expect(copy.id).not.toBe(template.id);
      expect(copy.name).toBe('Kiosk (copy)');
      expect(copy.stages.map((s) => s.name)).toEqual(['Survey', 'Build']);
      expect(copy.stages.map((s) => s.id).some((id) => template.stages.some((s) => s.id === id))).toBe(false);
      expect(copy.stages[0]!.tasks.map((task) => task.title)).toEqual(['Measure the floor']);
    });

    it('archive and restore answer the Template; both are 404 for an unknown id', async () => {
      const template = await make();
      const archived = await callProjects(h, 'POST', `/templates/${template.id}/archive`);
      expect(archived.statusCode, archived.body).toBe(200);
      expect(ProjectTemplateResponseSchema.parse(archived.json()).data.archivedAt).not.toBeNull();
      const restored = await callProjects(h, 'POST', `/templates/${template.id}/restore`);
      expect(restored.statusCode, restored.body).toBe(200);
      expect(ProjectTemplateResponseSchema.parse(restored.json()).data.archivedAt).toBeNull();
      for (const action of ['archive', 'restore', 'duplicate']) {
        const response = await callProjects(h, 'POST', `/templates/${randomUUID()}/${action}`);
        expect(response.statusCode, `${action}: ${response.body}`).toBe(404);
        expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_TEMPLATE_NOT_FOUND' });
      }
    });
  });
});
