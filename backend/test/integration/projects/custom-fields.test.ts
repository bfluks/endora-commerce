import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  RecordHistoryPageSchema,
  type ProjectDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import {
  PROJECTS_ADMIN,
  THREE_STAGES,
  callProjects,
  createProject,
  deleteProjects,
  getProject,
  setProjectsVisibility,
} from './helpers.js';

const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';

/**
 * User Story 9 — custom fields on a Project (`specs/163-projects-and-tasks/`
 * FR-036, research R-18), against the real `custom_fields` module.
 *
 * *Project* is a record type of the Custom Fields module while `projects` is
 * present, and only then. The values are a column on the Project's own row,
 * validated by the generic layer and written by the Project's own Command —
 * so whoever may not see the Project cannot see them, and every change is in
 * the Project's history, where the values are served only to a reader holding
 * `custom_fields:read`.
 */
describe('projects — custom fields (US9)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let member: Person;
  let memberWithoutFields: Person;
  let outsider: Person;
  const created: string[] = [];

  const definitions = async (): Promise<Array<{ id: string; key: string; updatedAt: string }>> => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${CUSTOM_FIELDS_API}/definitions?entityType=project`,
      cookies: PROJECTS_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: Array<{ id: string; key: string; updatedAt: string }> }).data;
  };

  const define = async (definition: {
    key: string;
    valueType: 'text' | 'number' | 'select';
    required?: boolean;
    listFilter?: boolean;
    options?: readonly string[];
  }): Promise<{ id: string }> => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${CUSTOM_FIELDS_API}/definitions`,
      cookies: PROJECTS_ADMIN,
      payload: definitionBody(definition),
    });
    expect(response.statusCode, response.body).toBe(201);
    return { id: (response.json() as { data: { id: string } }).data.id };
  };

  const removeDefinitions = async (): Promise<void> => {
    for (const definition of await definitions()) {
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `${CUSTOM_FIELDS_API}/definitions/${definition.id}`,
        cookies: PROJECTS_ADMIN,
      });
      expect(removed.statusCode, removed.body).toBe(204);
    }
  };

  const post = (body: Record<string, unknown>, cookies?: Record<string, string>) =>
    callProjects(h, 'POST', '', {
      payload: { title: 'Custom fields', organizationIds: [], stages: THREE_STAGES, ...body },
      ...(cookies ? { cookies } : {}),
    });

  const createWith = async (customFieldValues: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const project = await createProject(h, { customFieldValues, ...extra });
    created.push(project.id);
    return project;
  };

  const patch = (project: ProjectDetail, body: Record<string, unknown>, cookies?: Record<string, string>) =>
    callProjects(h, 'PATCH', `/${project.id}`, {
      payload: { version: project.version, ...body },
      ...(cookies ? { cookies } : {}),
    });

  const refusal = (response: { json(): unknown }) =>
    (response.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } }).error;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    await removeDefinitions();
    member = await seedCrmAdmin(h.em(), 'cf-member', ['projects:read', 'projects:write', 'custom_fields:read']);
    memberWithoutFields = await seedCrmAdmin(h.em(), 'cf-member-nocf', ['projects:read']);
    outsider = await seedCrmAdmin(h.em(), 'cf-outsider', ['projects:read', 'projects:write', 'custom_fields:read']);
    await define({ key: 'site_region', valueType: 'select', required: true, listFilter: true, options: ['north', 'south'] });
    await define({ key: 'floor_area', valueType: 'number' });
  });

  afterAll(async () => {
    for (const person of [member, memberWithoutFields, outsider]) person?.undo();
    await deleteProjects(h, created);
    await removeDefinitions();
    await teardownBackendServer(h);
  });

  describe('the record type follows the projects module', () => {
    it('offers Project on the custom-fields screen while projects is on', async () => {
      const response = await h.app.inject({ method: 'GET', url: `${CUSTOM_FIELDS_API}/entity-types`, cookies: PROJECTS_ADMIN });
      expect(response.statusCode, response.body).toBe(200);
      const project = (response.json() as { data: Array<{ entityType: string; labelKey: string; listFilter: boolean }> }).data.find(
        (row) => row.entityType === 'project',
      );
      expect(project).toMatchObject({ labelKey: 'customFields.entity.project', listFilter: true });
    });

    it('does not offer it, nor let its definitions change, while projects is off — and keeps them', async () => {
      const before = await definitions();
      expect(before.map((d) => d.key).sort()).toEqual(['floor_area', 'site_region']);
      await withModulesDeactivated(['projects'], async () => {
        const offered = await h.app.inject({ method: 'GET', url: `${CUSTOM_FIELDS_API}/entity-types`, cookies: PROJECTS_ADMIN });
        expect(offered.statusCode, offered.body).toBe(200);
        expect((offered.json() as { data: Array<{ entityType: string }> }).data.map((row) => row.entityType)).not.toContain(
          'project',
        );
        const add = await h.app.inject({
          method: 'POST',
          url: `${CUSTOM_FIELDS_API}/definitions`,
          cookies: PROJECTS_ADMIN,
          payload: definitionBody({ key: 'while_off', valueType: 'text' }),
        });
        expect(add.statusCode, add.body).toBe(409);
        const edit = await h.app.inject({
          method: 'PATCH',
          url: `${CUSTOM_FIELDS_API}/definitions/${before[0]!.id}`,
          cookies: PROJECTS_ADMIN,
          payload: { labelDefault: 'Changed while off' },
        });
        expect(edit.statusCode, edit.body).toBe(409);
      });
      expect(await definitions()).toEqual(before);
    });
  });

  describe('values are validated on save', () => {
    it('refuses a create without the required field, naming it, and writes nothing', async () => {
      const response = await post({ title: 'Never written' });
      expect(response.statusCode, response.body).toBe(422);
      const error = refusal(response);
      expect(error.code).toBe('CUSTOM_FIELD_VALUE_INVALID');
      expect(error.details.map((issue) => issue.path)).toEqual(['site_region']);
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as n from "projects" where "title" = 'Never written'`)) as Array<{ n: number }>;
      expect(rows[0]!.n).toBe(0);
    });

    it('refuses an unknown option and a wrong type, each at its own field', async () => {
      const response = await post({ customFieldValues: { site_region: 'east', floor_area: 'large' } });
      expect(response.statusCode, response.body).toBe(422);
      expect(refusal(response).details.map((issue) => issue.path).sort()).toEqual(['floor_area', 'site_region']);
    });

    it('persists valid values on create and on PATCH — a PATCH names the fields it changes', async () => {
      const project = await createWith({ site_region: 'north', floor_area: 120 });
      expect(project.customFieldValues).toEqual({ site_region: 'north', floor_area: 120 });
      const patched = await patch(project, { customFieldValues: { site_region: 'south' } });
      expect(patched.statusCode, patched.body).toBe(200);
      const after = ProjectDetailResponseSchema.parse(patched.json()).data;
      expect(after.customFieldValues).toEqual({ site_region: 'south', floor_area: 120 });
      expect(after.version).toBe(project.version + 1);
      expect((await getProject(h, project.id)).customFieldValues).toEqual({ site_region: 'south', floor_area: 120 });
    });

    it('leaves the values alone on a PATCH that does not name them', async () => {
      const project = await createWith({ site_region: 'north', floor_area: 3 });
      const patched = await patch(project, { title: 'Renamed only' });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(ProjectDetailResponseSchema.parse(patched.json()).data.customFieldValues).toEqual({
        site_region: 'north',
        floor_area: 3,
      });
    });

    it('refuses clearing the required field on PATCH, naming it, and keeps what was stored', async () => {
      const project = await createWith({ site_region: 'north' });
      const refused = await patch(project, { title: 'Renamed', customFieldValues: { site_region: null } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refusal(refused).code).toBe('CUSTOM_FIELD_VALUE_INVALID');
      expect(refusal(refused).details.map((issue) => issue.path)).toEqual(['site_region']);
      const read = await getProject(h, project.id);
      expect(read.title).toBe(project.title);
      expect(read.customFieldValues).toEqual({ site_region: 'north' });
      expect(read.version).toBe(project.version);
    });

    it('drops a value whose definition has been removed from what the detail shows', async () => {
      const extra = await define({ key: 'contractor', valueType: 'text' });
      const project = await createWith({ site_region: 'north', contractor: 'Acme' });
      expect(project.customFieldValues).toMatchObject({ contractor: 'Acme' });
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `${CUSTOM_FIELDS_API}/definitions/${extra.id}`,
        cookies: PROJECTS_ADMIN,
      });
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await getProject(h, project.id)).customFieldValues).toEqual({ site_region: 'north' });
    });
  });

  describe('values are shown under the Project’s visibility', () => {
    it('a Member reads them; somebody who may not see the Project gets the 404 of a missing one', async () => {
      const project = await createWith(
        { site_region: 'south', floor_area: 77 },
        { members: [{ adminUserId: member.adminUserId, roleIds: [] }] },
      );
      expect((await getProject(h, project.id, member.cookies)).customFieldValues).toEqual({
        site_region: 'south',
        floor_area: 77,
      });
      const hidden = await callProjects(h, 'GET', `/${project.id}`, { cookies: outsider.cookies });
      expect(hidden.statusCode, hidden.body).toBe(404);
      expect(hidden.body).not.toContain('floor_area');
      const write = await patch(project, { customFieldValues: { floor_area: 1 } }, outsider.cookies);
      expect(write.statusCode, write.body).toBe(404);
      expect((await getProject(h, project.id)).customFieldValues).toEqual({ site_region: 'south', floor_area: 77 });
    });
  });

  describe('changes are in the Project’s history', () => {
    let project: ProjectDetail;

    const history = async (who: Person) => {
      const response = await callProjects(h, 'GET', `/${project.id}/history?limit=50`, { cookies: who.cookies });
      expect(response.statusCode, response.body).toBe(200);
      return RecordHistoryPageSchema.parse(response.json()).data;
    };

    beforeAll(async () => {
      project = await createWith(
        { site_region: 'north' },
        {
          members: [
            { adminUserId: member.adminUserId, roleIds: [] },
            { adminUserId: memberWithoutFields.adminUserId, roleIds: [] },
          ],
        },
      );
      const patched = await patch(project, { customFieldValues: { floor_area: 40 } });
      expect(patched.statusCode, patched.body).toBe(200);
      // The same values again change nothing and write nothing.
      const again = await patch(ProjectDetailResponseSchema.parse(patched.json()).data, {
        customFieldValues: { floor_area: 40 },
      });
      expect(again.statusCode, again.body).toBe(200);
    });

    it('shows each create and change with the values it set, in one Command per write (T145, #470)', async () => {
      const entries = await history(member);
      expect(entries.map((entry) => entry.action)).toEqual([
        'projects.project.custom_fields_update',
        'projects.project.create',
      ]);
      const [update, create] = entries;
      expect(create!.after).toMatchObject({ customFieldValues: { site_region: 'north' } });
      expect(update!.before).toEqual({ customFieldValues: { floor_area: null } });
      expect(update!.after).toEqual({ customFieldValues: { floor_area: 40 } });
      expect(JSON.stringify(entries)).not.toContain('changedCustomFields');
      expect(JSON.stringify(entries)).not.toContain('valueChangeId');
    });

    it('the platform audit log names the changed fields and holds none of their values (T144 F4)', async () => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "action", "state_before", "state_after" from "audit_log_entries" where "object_id" = ?`, [
          project.id,
        ])) as Array<{ action: string; state_before: unknown; state_after: unknown }>;
      expect(JSON.stringify(rows)).not.toContain('north');
      expect(JSON.stringify(rows)).not.toContain('customFieldValues');
      const update = rows.find((row) => row.action === 'projects.project.custom_fields_update');
      expect(update?.state_after).toMatchObject({ changedCustomFields: ['floor_area'] });
    });

    it('hides the values from a reader without custom_fields:read', async () => {
      const entries = await history(memberWithoutFields);
      expect(entries.map((entry) => entry.action)).toEqual([
        'projects.project.custom_fields_update',
        'projects.project.create',
      ]);
      for (const entry of entries) {
        expect(JSON.stringify([entry.before, entry.after])).not.toContain('changedCustomFields');
        expect(JSON.stringify([entry.before, entry.after])).not.toContain('customFieldValues');
      }
      expect(JSON.stringify(entries)).not.toContain('floor_area');
      expect(JSON.stringify(entries)).not.toContain('north');
    });
  });

  describe('the list filters on a custom field offered as a list filter', () => {
    it('offers the list-filter fields and narrows the list by them', async () => {
      const offered = await callProjects(h, 'GET', '/custom-field-filters');
      expect(offered.statusCode, offered.body).toBe(200);
      expect((offered.json() as { data: Array<{ key: string }> }).data.map((field) => field.key)).toEqual(['site_region']);

      const north = await createWith({ site_region: 'north' }, { title: 'Filter north' });
      const south = await createWith({ site_region: 'south' }, { title: 'Filter south' });
      const filters = encodeURIComponent(JSON.stringify({ site_region: { in: ['south'] } }));
      const listed = await callProjects(h, 'GET', `?q=Filter&customFieldFilters=${filters}`);
      expect(listed.statusCode, listed.body).toBe(200);
      const page = ProjectListResponseSchema.parse(listed.json());
      expect(page.items.map((item) => item.id)).toEqual([south.id]);
      expect(page.total).toBe(1);
      expect(page.items.map((item) => item.id)).not.toContain(north.id);
    });

    it('refuses a field the list does not offer, naming it', async () => {
      const filters = encodeURIComponent(JSON.stringify({ floor_area: { min: '1' } }));
      const refused = await callProjects(h, 'GET', `?customFieldFilters=${filters}`);
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json()).toMatchObject({
        error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE', details: { key: 'floor_area' } },
      });
    });
  });
});

function definitionBody(definition: {
  key: string;
  valueType: 'text' | 'number' | 'select';
  required?: boolean;
  listFilter?: boolean;
  options?: readonly string[];
}): Record<string, unknown> {
  return {
    entityType: 'project',
    key: definition.key,
    label: {},
    labelDefault: definition.key,
    valueType: definition.valueType,
    required: definition.required ?? false,
    sortOrder: 0,
    config: {},
    ...(definition.listFilter ? { listFilter: true } : {}),
    options: (definition.options ?? []).map((value, index) => ({
      value,
      label: {},
      labelDefault: value,
      isDefault: false,
      sortOrder: index,
    })),
  };
}
