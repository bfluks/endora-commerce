import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskDetailResponseSchema, TaskListResponseSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * `task` as a custom-field host (`specs/165-task-management/` FR-007,
 * research R-8; `foreign-module-changes.md` §E).
 *
 * A `task` definition is creatable; values are validated and persisted by the
 * Task's own Commands; a definition marked as a list filter is offered by
 * `GET /tasks/custom-field-filters` and narrows `GET /tasks`; and while
 * `tasks` is off the `task` entity type is hidden from the custom-fields
 * definitions API, because the registry names `tasks` as its owner.
 */
describe('tasks — the task custom-field host (US1)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const DEFINITIONS = '/api/v1/admin/custom-fields/definitions';
  const MARK = `cfhost-${randomUUID().slice(0, 6)}`;
  const region = `region_${randomUUID().slice(0, 6)}`;
  const created: string[] = [];
  const definitions: string[] = [];

  async function define(key: string, listFilter: boolean): Promise<string> {
    const response = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS,
      cookies: admin,
      payload: {
        entityType: 'task',
        key,
        label: { en: 'Region' },
        labelDefault: 'Region',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        listFilter,
        options: [],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    definitions.push(id);
    return id;
  }

  async function create(title: string, values: Record<string, unknown>): Promise<string> {
    const response = await h.app.inject({
      method: 'POST',
      url: API,
      cookies: admin,
      payload: { title: `${MARK} ${title}`, customFieldValues: values },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = TaskDetailResponseSchema.parse(response.json()).data.id;
    created.push(id);
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (created.length > 0) {
      await h.em().getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    for (const id of definitions) await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS}/${id}`, cookies: admin });
    await teardownBackendServer(h);
  });

  it('defines a task field, keeps its values, and filters the list by it', async () => {
    await define(region, true);
    const north = await create('north', { [region]: 'North' });
    const south = await create('south', { [region]: 'South' });

    const read = await h.app.inject({ method: 'GET', url: `${API}/${north}`, cookies: admin });
    expect(TaskDetailResponseSchema.parse(read.json()).data.customFieldValues).toEqual({ [region]: 'North' });

    const offered = await h.app.inject({ method: 'GET', url: `${API}/custom-field-filters`, cookies: admin });
    expect(offered.statusCode, offered.body).toBe(200);
    expect((offered.json() as { data: Array<{ key: string }> }).data.map((field) => field.key)).toContain(region);

    const filtered = await h.app.inject({
      method: 'GET',
      url: `${API}?q=${MARK}&customFieldFilters=${encodeURIComponent(JSON.stringify({ [region]: { contains: 'nor' } }))}`,
      cookies: admin,
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(TaskListResponseSchema.parse(filtered.json()).items.map((t) => t.id)).toEqual([north]);
    expect(south).toBeDefined();

    // A field the list does not offer is the caller's mistake: 400, naming it.
    const unknown = await h.app.inject({
      method: 'GET',
      url: `${API}?customFieldFilters=${encodeURIComponent(JSON.stringify({ not_a_field: { contains: 'x' } }))}`,
      cookies: admin,
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
    expect(unknown.json().error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
  });

  it('hides the task entity type from the definitions API while Tasks is off', async () => {
    const listTypes = async () => {
      const response = await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/entity-types', cookies: admin });
      expect(response.statusCode, response.body).toBe(200);
      return (response.json() as { data: Array<{ entityType: string }> }).data.map((row) => row.entityType);
    };
    expect(await listTypes()).toContain('task');
    await withModuleOff('tasks', 'deactivated', async () => {
      expect(await listTypes()).not.toContain('task');
      const listed = await h.app.inject({ method: 'GET', url: `${DEFINITIONS}?entityType=task`, cookies: admin });
      expect((listed.json() as { data: unknown[] }).data).toEqual([]);
    });
  });
});
