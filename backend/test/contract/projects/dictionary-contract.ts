import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectRoleListResponseSchema, ProjectRoleResponseSchema, type ProjectDetail, type ProjectRole } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { callProjects, deleteProjects, errorShape, getProject } from '../../integration/projects/helpers.js';

/**
 * The shared contract of the two configuration dictionaries of `projects` —
 * Project Roles and loss reasons (`specs/163-projects-and-tasks/`, User Story
 * 4; `contracts/admin-api.md` §2.5). Both have one shape (`data-model.md`
 * §2.1) and one set of routes, so one body of cases runs against each, from
 * `roles.contract.test.ts` and `loss-reasons.contract.test.ts`; what differs —
 * how a Project uses a row, and how it shows one — is passed in.
 *
 * Reading is `projects:read`; adding, renaming, archiving, restoring and
 * deleting are `projects:configure`. Seeded rows are renamable and archivable,
 * never deletable (409); a row a Project or a Template uses is not deletable
 * either (409) — archiving is how it stops being offered, and an archived row
 * stays on the Projects that use it.
 */
export interface DictionaryContractSpec {
  /** `/roles` or `/loss-reasons`, under `/api/v1/admin/projects`. */
  path: '/roles' | '/loss-reasons';
  table: 'project_roles' | 'project_loss_reasons';
  /** The audit `objectType` of the dictionary's Commands. */
  objectType: 'project_role' | 'project_loss_reason';
  /** The audit action prefix: `<prefix>.create`, `.update`, `.archive`, `.restore`, `.delete`. */
  actionPrefix: 'projects.role' | 'projects.loss_reason';
  /** The seeded rows, in order, with their names in both admin languages. */
  seeded: ReadonlyArray<{ code: string; en: string; pl: string }>;
  /** Make a Project use row `id`; answers the Project's id. */
  use: (h: BackendServerHandle, id: string) => Promise<string>;
  /** How a Project shows row `id`, or `undefined` when it does not. */
  shown: (project: ProjectDetail, id: string) => { name: string } | undefined;
  /** Try to use row `id` on a new Project; answers that write's response. */
  useAnew: (h: BackendServerHandle, id: string) => Promise<{ response: LightMyRequestResponse; projectId: string }>;
  /** The refusal `useAnew` earns for an archived row. */
  archivedRefusal: string;
}

type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

export function describeDictionaryContract(spec: DictionaryContractSpec): void {
  const { path } = spec;

  describe(`projects (contract) — §2.5 ${path}`, () => {
    let h: BackendServerHandle;
    let reader: Person;
    let writer: Person;
    let configurer: Person;
    const createdRows: string[] = [];
    const createdProjects: string[] = [];

    async function list(query = ''): Promise<ProjectRole[]> {
      const response = await callProjects(h, 'GET', `${path}${query}`);
      expect(response.statusCode, response.body).toBe(200);
      return ProjectRoleListResponseSchema.parse(response.json()).data;
    }

    async function add(defaultName: string, name: Record<string, string> = { en: defaultName }): Promise<ProjectRole> {
      const response = await callProjects(h, 'POST', path, { payload: { defaultName, name } });
      expect(response.statusCode, response.body).toBe(201);
      const { data } = ProjectRoleResponseSchema.parse(response.json());
      createdRows.push(data.id);
      return data;
    }

    async function seededId(code: string): Promise<string> {
      const row = (await list()).find((r) => r.code === code);
      expect(row, `no seeded row ${code}`).toBeDefined();
      return row!.id;
    }

    /** The audit actions of row `id`, sorted — rows written in one millisecond have no order. */
    async function audit(id: string): Promise<string[]> {
      return (await h.auditLogService.query({ objectType: spec.objectType, objectId: id })).map((row) => row.action).sort();
    }

    beforeAll(async () => {
      h = await setupBackendServer();
      reader = await seedCrmAdmin(h.em(), `dict-reader${path.replace(/\W/g, '')}`, ['projects:read']);
      writer = await seedCrmAdmin(h.em(), `dict-writer${path.replace(/\W/g, '')}`, ['projects:read', 'projects:write']);
      configurer = await seedCrmAdmin(h.em(), `dict-config${path.replace(/\W/g, '')}`, [
        'projects:read',
        'projects:configure',
      ]);
    });

    afterAll(async () => {
      for (const person of [reader, writer, configurer]) person.undo();
      await deleteProjects(h, createdProjects);
      if (createdRows.length > 0) {
        await h
          .em()
          .getConnection()
          .execute(`delete from "${spec.table}" where "id" = any(?::uuid[])`, [`{${createdRows.join(',')}}`]);
      }
      await teardownBackendServer(h);
    });

    describe('gates', () => {
      const ID = '00000000-0000-4000-8000-0000000080a1';
      const writes: Array<[method: 'POST' | 'PATCH' | 'DELETE', path: string]> = [
        ['POST', path],
        ['PATCH', `${path}/${ID}`],
        ['POST', `${path}/${ID}/archive`],
        ['POST', `${path}/${ID}/restore`],
        ['DELETE', `${path}/${ID}`],
      ];
      const payload = { defaultName: 'Gate probe', name: { en: 'Gate probe' } };

      it('every write answers 401 without a session', async () => {
        for (const [method, route] of writes) {
          const response = await callProjects(h, method, route, { cookies: null, payload });
          expect(response.statusCode, `${method} ${route}`).toBe(401);
        }
      });

      it('writes need projects:configure, which projects:read and projects:write are not — 403', async () => {
        for (const who of [reader, writer]) {
          for (const [method, route] of writes) {
            const response = await callProjects(h, method, route, { cookies: who.cookies, payload });
            expect(response.statusCode, `${method} ${route}: ${response.body}`).toBe(403);
          }
        }
        // Reading stays `projects:read`.
        expect((await callProjects(h, 'GET', path, { cookies: reader.cookies })).statusCode).toBe(200);
      });

      it('a projects:configure holder writes', async () => {
        const response = await callProjects(h, 'POST', path, { cookies: configurer.cookies, payload });
        expect(response.statusCode, response.body).toBe(201);
        createdRows.push(ProjectRoleResponseSchema.parse(response.json()).data.id);
      });
    });

    describe('the seeded rows', () => {
      it('are listed first, in order, with a name in every admin language, as system rows', async () => {
        const rows = await list();
        const seeded = rows.slice(0, spec.seeded.length);
        expect(seeded.map((row) => [row.code, row.name.en, row.name.pl, row.isSystem, row.archivedAt])).toEqual(
          spec.seeded.map((row) => [row.code, row.en, row.pl, true, null]),
        );
      });
    });

    describe(`POST ${path}`, () => {
      it('answers 201 with an operator row: its code derived from the default name, last in order, audited', async () => {
        const before = await list();
        const row = await add('Site lead', { en: 'Site lead', pl: 'Kierownik budowy' });
        expect(row).toMatchObject({
          code: 'site_lead',
          defaultName: 'Site lead',
          name: { en: 'Site lead', pl: 'Kierownik budowy' },
          label: 'Site lead',
          isSystem: false,
          archivedAt: null,
        });
        expect(row.position).toBeGreaterThan(Math.max(...before.map((r) => r.position)));
        expect((await list()).map((r) => r.id)).toContain(row.id);
        expect(await audit(row.id)).toEqual([`${spec.actionPrefix}.create`].sort());
      });

      it('a code another row holds gets a suffix; the code is never asked for', async () => {
        const first = await add('Fit out');
        const second = await add('Fit-out');
        expect([first.code, second.code]).toEqual(['fit_out', 'fit_out_2']);
        const refused = await callProjects(h, 'POST', path, { payload: { defaultName: 'x', name: {}, code: 'mine' } });
        expect(refused.statusCode, refused.body).toBe(400);
      });

      it('refuses a default name another row has, whatever its case or whether it is archived — 409', async () => {
        const row = await add('Night shift');
        await callProjects(h, 'POST', `${path}/${row.id}/archive`);
        const response = await callProjects(h, 'POST', path, { payload: { defaultName: 'NIGHT SHIFT', name: {} } });
        expect(response.statusCode, response.body).toBe(409);
        expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_NAME_TAKEN' });
      });

      it('refuses an empty name — 400', async () => {
        for (const payload of [{ defaultName: '', name: {} }, { defaultName: 'Ok', name: { en: '' } }, {}]) {
          const response = await callProjects(h, 'POST', path, { payload });
          expect(response.statusCode, response.body).toBe(400);
        }
      });
    });

    describe(`PATCH ${path}/:id`, () => {
      it('renames an operator row; its code does not change', async () => {
        const row = await add('Draftsman');
        const response = await callProjects(h, 'PATCH', `${path}/${row.id}`, {
          payload: { defaultName: 'Draughtsman', name: { en: 'Draughtsman', pl: 'Kreślarz' } },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(ProjectRoleResponseSchema.parse(response.json()).data).toMatchObject({
          code: 'draftsman',
          defaultName: 'Draughtsman',
          name: { en: 'Draughtsman', pl: 'Kreślarz' },
          label: 'Draughtsman',
        });
        expect(await audit(row.id)).toEqual([`${spec.actionPrefix}.create`, `${spec.actionPrefix}.update`].sort());
      });

      it('renames a seeded row', async () => {
        const [first] = spec.seeded;
        const id = await seededId(first!.code);
        try {
          const response = await callProjects(h, 'PATCH', `${path}/${id}`, {
            payload: { name: { en: `${first!.en} (renamed)`, pl: `${first!.pl} (zmieniona)` } },
          });
          expect(response.statusCode, response.body).toBe(200);
          expect(ProjectRoleResponseSchema.parse(response.json()).data).toMatchObject({
            code: first!.code,
            isSystem: true,
            label: `${first!.en} (renamed)`,
          });
        } finally {
          const back = await callProjects(h, 'PATCH', `${path}/${id}`, { payload: { name: { en: first!.en, pl: first!.pl } } });
          expect(back.statusCode, back.body).toBe(200);
        }
      });

      it('refuses the default name of another row — 409; its own is fine', async () => {
        const one = await add('Surveyor');
        const two = await add('Estimator');
        const taken = await callProjects(h, 'PATCH', `${path}/${two.id}`, { payload: { defaultName: 'surveyor' } });
        expect(taken.statusCode, taken.body).toBe(409);
        expect(errorShape(taken.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_NAME_TAKEN' });
        const own = await callProjects(h, 'PATCH', `${path}/${one.id}`, { payload: { defaultName: 'Surveyor' } });
        expect(own.statusCode, own.body).toBe(200);
      });

      it('answers 404 PROJECT_DICTIONARY_ENTRY_NOT_FOUND for an unknown id, and 400 for an empty body', async () => {
        for (const id of [randomUUID(), 'not-a-uuid']) {
          const response = await callProjects(h, 'PATCH', `${path}/${id}`, { payload: { defaultName: 'Anything' } });
          expect(response.statusCode, response.body).toBe(404);
          expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_ENTRY_NOT_FOUND' });
        }
        const row = await add('Empty patch');
        expect((await callProjects(h, 'PATCH', `${path}/${row.id}`, { payload: {} })).statusCode).toBe(400);
      });
    });

    describe('archive and restore', () => {
      it('an archived row is left out by `active=true`, listed without it, and stays on the Project that uses it', async () => {
        const row = await add('Rigger', { en: 'Rigger', pl: 'Monter' });
        const projectId = await spec.use(h, row.id);
        createdProjects.push(projectId);

        const archived = await callProjects(h, 'POST', `${path}/${row.id}/archive`);
        expect(archived.statusCode, archived.body).toBe(200);
        expect(ProjectRoleResponseSchema.parse(archived.json()).data.archivedAt).not.toBeNull();

        expect((await list('?active=true')).map((r) => r.id)).not.toContain(row.id);
        expect((await list()).map((r) => r.id)).toContain(row.id);
        expect(spec.shown(await getProject(h, projectId), row.id)).toMatchObject({ name: 'Rigger' });

        // No longer offered: a new Project cannot take it.
        const anew = await spec.useAnew(h, row.id);
        if (anew.projectId) createdProjects.push(anew.projectId);
        expect(anew.response.statusCode, anew.response.body).toBe(422);
        expect(errorShape(anew.response.body)).toMatchObject({ code: spec.archivedRefusal });

        const restored = await callProjects(h, 'POST', `${path}/${row.id}/restore`);
        expect(restored.statusCode, restored.body).toBe(200);
        expect(ProjectRoleResponseSchema.parse(restored.json()).data.archivedAt).toBeNull();
        expect((await list('?active=true')).map((r) => r.id)).toContain(row.id);

        expect(await audit(row.id)).toEqual([
          `${spec.actionPrefix}.create`,
          `${spec.actionPrefix}.archive`,
          `${spec.actionPrefix}.restore`,
        ].sort());
      });

      it('a seeded row is archivable and restorable', async () => {
        const id = await seededId(spec.seeded[spec.seeded.length - 1]!.code);
        try {
          expect((await callProjects(h, 'POST', `${path}/${id}/archive`)).statusCode).toBe(200);
          expect((await list('?active=true')).map((r) => r.id)).not.toContain(id);
        } finally {
          expect((await callProjects(h, 'POST', `${path}/${id}/restore`)).statusCode).toBe(200);
        }
      });

      it('archiving an archived row changes nothing and audits nothing', async () => {
        const row = await add('Twice archived');
        await callProjects(h, 'POST', `${path}/${row.id}/archive`);
        expect((await callProjects(h, 'POST', `${path}/${row.id}/archive`)).statusCode).toBe(200);
        expect(await audit(row.id)).toEqual([`${spec.actionPrefix}.create`, `${spec.actionPrefix}.archive`].sort());
      });

      it('answers 404 for an unknown id', async () => {
        for (const action of ['archive', 'restore']) {
          const response = await callProjects(h, 'POST', `${path}/${randomUUID()}/${action}`);
          expect(response.statusCode, response.body).toBe(404);
          expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_ENTRY_NOT_FOUND' });
        }
      });
    });

    describe(`DELETE ${path}/:id`, () => {
      it('refuses a seeded row — 409 PROJECT_DICTIONARY_ENTRY_SYSTEM — and it stays', async () => {
        for (const seeded of spec.seeded) {
          const id = await seededId(seeded.code);
          const response = await callProjects(h, 'DELETE', `${path}/${id}`);
          expect(response.statusCode, response.body).toBe(409);
          expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_ENTRY_SYSTEM' });
        }
        expect((await list()).slice(0, spec.seeded.length).map((r) => r.code)).toEqual(spec.seeded.map((s) => s.code));
      });

      it('refuses a row a Project uses — 409 PROJECT_DICTIONARY_ENTRY_IN_USE, archived or not', async () => {
        const row = await add('Crane operator');
        createdProjects.push(await spec.use(h, row.id));
        for (const archive of [false, true]) {
          if (archive) await callProjects(h, 'POST', `${path}/${row.id}/archive`);
          const response = await callProjects(h, 'DELETE', `${path}/${row.id}`);
          expect(response.statusCode, response.body).toBe(409);
          expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_ENTRY_IN_USE' });
        }
      });

      it('deletes an operator row nothing uses — 204, gone, audited', async () => {
        const row = await add('Temporary');
        const response = await callProjects(h, 'DELETE', `${path}/${row.id}`);
        expect(response.statusCode, response.body).toBe(204);
        expect((await list()).map((r) => r.id)).not.toContain(row.id);
        expect(await audit(row.id)).toEqual([`${spec.actionPrefix}.create`, `${spec.actionPrefix}.delete`].sort());
        const again = await callProjects(h, 'DELETE', `${path}/${row.id}`);
        expect(again.statusCode, again.body).toBe(404);
        expect(errorShape(again.body)).toMatchObject({ code: 'PROJECT_DICTIONARY_ENTRY_NOT_FOUND' });
      });
    });
  });
}
