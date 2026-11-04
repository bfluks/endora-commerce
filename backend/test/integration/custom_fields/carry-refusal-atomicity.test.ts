import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * A refused carry option leaves nothing behind (`specs/162-custom-fields-value-carry/`
 * FR-003, FR-002; QA edge case "a refused write leaves no partial write").
 *
 * `carry-options.test.ts` proves each refusal reads right; this file proves the
 * refused request changed **nothing else**: a create leaves no definition and
 * no audit row, and an edit that mixes an acceptable change (a label) with an
 * unacceptable `carryTo` applies neither, audits nothing, and the same edit
 * without the refused option still succeeds afterwards.
 */
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

interface DefinitionBody {
  id: string;
  key: string;
  labelDefault: string;
  carryTo: string[];
}

describe('custom_fields — a refused carry option writes nothing', () => {
  let h: BackendServerHandle;
  let writer: { cookies: { b2b_session: string }; undo: () => void };
  const created: string[] = [];

  const body = (entityType: string, key: string, extra: Record<string, unknown> = {}) => ({
    entityType,
    key,
    label: {},
    labelDefault: key,
    valueType: 'text',
    required: false,
    sortOrder: 0,
    config: {},
    options: [],
    ...extra,
  });

  const definitions = async (entityType: string): Promise<DefinitionBody[]> => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${API}/definitions?entityType=${entityType}`,
      cookies: writer.cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: DefinitionBody[] }).data;
  };

  const audits = async (action: string): Promise<unknown[]> =>
    (await h.auditLogService.query({ action })) as unknown[];

  beforeAll(async () => {
    h = await setupBackendServer();
    writer = await seedCrmAdmin(h.em(), `cfc_atomic_${RUN}`, ['custom_fields:read', 'custom_fields:write']);
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: writer.cookies });
    }
    writer.undo();
    await teardownBackendServer(h);
  });

  it('a refused create leaves no definition and no audit row for it', async () => {
    const key = fixtureKey('create_refused');
    const before = (await audits('custom_fields.definition.created')).length;
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: writer.cookies,
      payload: body('quote_request', key, { carryTo: ['order'] }),
    });
    expect(response.statusCode, response.body).toBe(422);
    expect((await definitions('quote_request')).some((d) => d.key === key)).toBe(false);
    expect((await audits('custom_fields.definition.created')).length).toBe(before);
  });

  it('a refused edit applies none of its other changes, audits nothing, and the edit without the option then succeeds', async () => {
    const key = fixtureKey('edit_refused');
    const create = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: writer.cookies,
      payload: body('quote_request', key),
    });
    expect(create.statusCode, create.body).toBe(201);
    const id = (create.json() as { data: DefinitionBody }).data.id;
    created.push(id);
    const updatesBefore = (await audits('custom_fields.definition.updated')).length;

    const refused = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${id}`,
      cookies: writer.cookies,
      payload: { labelDefault: `Renamed ${RUN}`, sortOrder: 9, carryTo: ['order'] },
    });
    expect(refused.statusCode, refused.body).toBe(422);

    const after = (await definitions('quote_request')).find((d) => d.id === id)!;
    expect(after.labelDefault).toBe(key);
    expect(after.carryTo).toEqual([]);
    expect((await audits('custom_fields.definition.updated')).length).toBe(updatesBefore);

    const accepted = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${id}`,
      cookies: writer.cookies,
      payload: { labelDefault: `Renamed ${RUN}`, sortOrder: 9 },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((accepted.json() as { data: DefinitionBody }).data.carryTo).toEqual([]);
  });
});
