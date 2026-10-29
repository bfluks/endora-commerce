import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrder } from '../../helpers/seed-crm.js';

/**
 * The carry options of a custom-field definition
 * (`specs/162-custom-fields-value-carry/` US4, FR-001 – FR-004, FR-011, FR-019).
 *
 * `carryTo` is a definition attribute, written by the definition Commands and
 * audited with them. Turning a target on is judged once, at that moment, by
 * the one compatibility rule — a refusal is 422
 * `CUSTOM_FIELD_CARRY_INCOMPATIBLE` naming why in `details.code`. A target
 * already on is never judged again: drift on either side is allowed and the
 * option stays as configured.
 */
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

interface DefinitionBody {
  id: string;
  key: string;
  carryTo: string[];
  options: Array<{ id: string; value: string }>;
}

interface Refusal {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface AuditRow {
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
}

describe('custom_fields — the carry options of a definition', () => {
  let h: BackendServerHandle;
  let writer: { cookies: { b2b_session: string }; undo: () => void };
  let reader: { cookies: { b2b_session: string }; undo: () => void };
  const created: string[] = [];

  const option = (value: string, sortOrder = 0) => ({
    value,
    label: {},
    labelDefault: value.toUpperCase(),
    isDefault: false,
    sortOrder,
  });

  const define = (entityType: string, key: string, extra: Record<string, unknown> = {}) =>
    h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: writer.cookies,
      payload: {
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
      },
    });

  const defineKept = async (
    entityType: string,
    key: string,
    extra: Record<string, unknown> = {},
  ): Promise<DefinitionBody> => {
    const response = await define(entityType, key, extra);
    expect(response.statusCode, response.body).toBe(201);
    const body = (response.json() as { data: DefinitionBody }).data;
    created.push(body.id);
    return body;
  };

  const patch = (id: string, payload: Record<string, unknown>, cookies = writer.cookies) =>
    h.app.inject({ method: 'PATCH', url: `${API}/definitions/${id}`, cookies, payload });

  const read = async (id: string): Promise<DefinitionBody> => {
    const response = await h.app.inject({ method: 'GET', url: `${API}/definitions/${id}`, cookies: writer.cookies });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: DefinitionBody }).data;
  };

  const refusal = (response: { statusCode: number; body: string; json(): unknown }): Refusal => {
    expect(response.statusCode, response.body).toBe(422);
    const error = (response.json() as { error: Refusal }).error;
    expect(error.code).toBe('CUSTOM_FIELD_CARRY_INCOMPATIBLE');
    return error;
  };

  const audit = async (action: string, objectId: string): Promise<AuditRow[]> =>
    (await h.auditLogService.query({ action, objectId })) as unknown as AuditRow[];

  beforeAll(async () => {
    h = await setupBackendServer();
    writer = await seedCrmAdmin(h.em(), `cfc_writer_${RUN}`, ['custom_fields:read', 'custom_fields:write']);
    reader = await seedCrmAdmin(h.em(), `cfc_reader_${RUN}`, ['custom_fields:read']);
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: writer.cookies });
    }
    writer.undo();
    reader.undo();
    await teardownBackendServer(h);
  });

  it('refuses a target with no same-key field — target_missing, in the request language', async () => {
    const key = fixtureKey('missing');
    const error = refusal(
      await define('quote_request', key, { valueType: 'select', options: [option('a')], carryTo: ['order'] }),
    );
    expect(error.details).toMatchObject({ code: 'target_missing', targetEntityType: 'order', key });
    expect(error.message).toBe(`No field with the key “${key}” exists on “order”. Create it first.`);
  });

  it.each([
    ['multiselect', [option('a')]],
    ['text', []],
  ] as const)('refuses a %s target for a select source — value_type_mismatch, no widening', async (targetType, targetOptions) => {
    const key = fixtureKey(`type_${targetType}`);
    await defineKept('order', key, { valueType: targetType, options: targetOptions });
    const error = refusal(
      await define('quote_request', key, { valueType: 'select', options: [option('a')], carryTo: ['order'] }),
    );
    expect(error.details).toMatchObject({
      code: 'value_type_mismatch',
      targetEntityType: 'order',
      key,
      sourceValueType: 'select',
      targetValueType: targetType,
    });
  });

  it('refuses a select target lacking a source option — options_missing, naming it', async () => {
    const key = fixtureKey('options');
    await defineKept('order', key, { valueType: 'select', options: [option('fair')] });
    const error = refusal(
      await define('quote_request', key, {
        valueType: 'select',
        options: [option('fair'), option('web', 1)],
        carryTo: ['order'],
      }),
    );
    expect(error.details).toMatchObject({
      code: 'options_missing',
      missingOptionValues: 'web',
      missingOptionValueList: ['web'],
    });
  });

  it('refuses an internal source into a customer-visible target — audience_mismatch', async () => {
    const key = fixtureKey('audience');
    await defineKept('order', key, { audience: 'customer' });
    const error = refusal(await define('quote_request', key, { audience: 'internal', carryTo: ['order'] }));
    expect(error.details).toMatchObject({ code: 'audience_mismatch', targetEntityType: 'order', key });
  });

  it('refuses a pair the registry does not offer — pair_unsupported', async () => {
    const orderKey = fixtureKey('order_to_qr');
    await defineKept('quote_request', orderKey);
    const fromOrder = refusal(await define('order', orderKey, { carryTo: ['quote_request'] }));
    expect(fromOrder.details).toMatchObject({ code: 'pair_unsupported', targetEntityType: 'quote_request' });

    const selfKey = fixtureKey('self');
    const toItself = refusal(await define('order', selfKey, { carryTo: ['order'] }));
    expect(toItself.details).toMatchObject({ code: 'pair_unsupported', targetEntityType: 'order' });

    const categoryKey = fixtureKey('category');
    await defineKept('order', categoryKey);
    const fromCategory = refusal(await define('category', categoryKey, { carryTo: ['order'] }));
    expect(fromCategory.details).toMatchObject({ code: 'pair_unsupported', targetEntityType: 'order' });

    const plainCategory = await defineKept('category', fixtureKey('category_plain'));
    const onEdit = refusal(await patch(plainCategory.id, { carryTo: ['opportunity'] }));
    expect(onEdit.details).toMatchObject({ code: 'pair_unsupported', targetEntityType: 'opportunity' });
    expect((await read(plainCategory.id)).carryTo).toEqual([]);
  });

  it('creates a compatible pair, audits the option, and a patch without carryTo leaves it', async () => {
    const key = fixtureKey('compatible');
    await defineKept('order', key, { valueType: 'select', options: [option('fair'), option('web', 1)] });
    const source = await defineKept('quote_request', key, {
      valueType: 'select',
      options: [option('fair')],
      carryTo: ['order'],
    });
    expect(source.carryTo).toEqual(['order']);
    expect((await read(source.id)).carryTo).toEqual(['order']);
    const createdEntries = (
      (await h.auditLogService.query({ action: 'custom_fields.definition.created' })) as unknown as AuditRow[]
    ).filter((entry) => entry.stateAfter?.['id'] === source.id);
    expect(createdEntries).toHaveLength(1);
    expect(createdEntries[0]!.stateAfter?.['carryTo']).toEqual(['order']);

    const relabel = await patch(source.id, { labelDefault: 'Relabelled' });
    expect(relabel.statusCode, relabel.body).toBe(200);
    expect((relabel.json() as { data: DefinitionBody }).data.carryTo).toEqual(['order']);

    const off = await patch(source.id, { carryTo: [] });
    expect(off.statusCode, off.body).toBe(200);
    expect((off.json() as { data: DefinitionBody }).data.carryTo).toEqual([]);
    const on = await patch(source.id, { carryTo: ['order'] });
    expect(on.statusCode, on.body).toBe(200);
    const updates = await audit('custom_fields.definition.updated', source.id);
    expect(updates[0]?.stateBefore?.['carryTo']).toEqual([]);
    expect(updates[0]?.stateAfter?.['carryTo']).toEqual(['order']);
    expect(updates[1]?.stateBefore?.['carryTo']).toEqual(['order']);
    expect(updates[1]?.stateAfter?.['carryTo']).toEqual([]);
  });

  it('turning the option on and off leaves every stored value as it was (FR-004)', async () => {
    const key = fixtureKey('values');
    await defineKept('opportunity', key);
    const source = await defineKept('order', key);
    const order = await seedCrmOrder(h.em());
    const conn = h.em().getConnection();
    await conn.execute(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [
      JSON.stringify({ [key]: 'kept as it is' }),
      order.id,
    ]);
    const stored = async (): Promise<string> =>
      ((await conn.execute(`select custom_field_values::text as v from "orders" where id = ?`, [order.id])) as Array<{
        v: string;
      }>)[0]!.v;
    const before = await stored();
    for (const carryTo of [['opportunity'], []]) {
      const response = await patch(source.id, { carryTo });
      expect(response.statusCode, response.body).toBe(200);
    }
    expect(await stored()).toBe(before);
  });

  it('allows drift on the target and keeps the option as configured (FR-019)', async () => {
    const key = fixtureKey('drift');
    const target = await defineKept('order', key, {
      valueType: 'select',
      options: [option('fair'), option('web', 1)],
    });
    const source = await defineKept('quote_request', key, {
      valueType: 'select',
      options: [option('fair'), option('web', 1)],
      carryTo: ['order'],
    });

    const web = target.options.find((o) => o.value === 'web')!;
    const removeOption = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${target.id}/options/${web.id}`,
      cookies: writer.cookies,
    });
    expect(removeOption.statusCode, removeOption.body).toBe(204);

    const audience = await patch(target.id, { audience: 'customer' });
    expect(audience.statusCode, audience.body).toBe(200);

    const remove = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${target.id}`,
      cookies: writer.cookies,
    });
    expect(remove.statusCode, remove.body).toBe(204);
    created.splice(created.indexOf(target.id), 1);

    const relabel = await patch(source.id, { labelDefault: 'Relabelled after drift' });
    expect(relabel.statusCode, relabel.body).toBe(200);
    expect((relabel.json() as { data: DefinitionBody }).data.carryTo).toEqual(['order']);

    const resend = await patch(source.id, { carryTo: ['order'] });
    expect(resend.statusCode, resend.body).toBe(200);
    expect((await read(source.id)).carryTo).toEqual(['order']);
  });

  it('refuses an edit from an administrator who may only read custom fields', async () => {
    const key = fixtureKey('read_only');
    await defineKept('opportunity', key);
    const source = await defineKept('order', key);
    const response = await patch(source.id, { carryTo: ['opportunity'] }, reader.cookies);
    expect(response.statusCode, response.body).toBe(403);
    expect((await read(source.id)).carryTo).toEqual([]);
  });
});
