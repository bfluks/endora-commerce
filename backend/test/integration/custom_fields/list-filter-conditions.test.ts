import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldFilters, CustomFieldListFilterPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmOrder } from '../../helpers/seed-crm.js';

/**
 * The list-filter port's one condition, run against real rows
 * (`specs/157-custom-fields-list-filters/` FR-008, FR-010; threat model F-9).
 *
 * The port is read off the composed container and its condition is run the
 * way a host runs it — as an id sub-select intersected with the host's own
 * statement — over Orders seeded here, whose value bags are written straight
 * to the row.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const key = (name: string) => `cf157_${RUN}_${name}`;

const TEXT = key('text');
const NUMBER = key('number');
const BOOLEAN = key('boolean');
const DATE = key('date');
const SELECT = key('select');
const MULTI = key('multi');

describe('custom_fields — the list-filter condition over stored values', () => {
  let h: BackendServerHandle;
  let port: CustomFieldListFilterPort;
  const definitionIds: string[] = [];
  const orders = new Map<string, string>();

  const define = async (definitionKey: string, valueType: string, options: string[] = []) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      ...ADMIN,
      payload: {
        entityType: 'order',
        key: definitionKey,
        label: {},
        labelDefault: definitionKey,
        valueType,
        required: false,
        sortOrder: 0,
        config: {},
        listFilter: true,
        options: options.map((value, sortOrder) => ({
          value,
          label: {},
          labelDefault: value,
          isDefault: false,
          sortOrder,
        })),
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitionIds.push((response.json() as { data: { id: string } }).data.id);
  };

  const seed = async (name: string, values: Record<string, unknown>) => {
    const order = await seedCrmOrder(h.em());
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify(values),
        order.id,
      ]);
    orders.set(name, order.id);
  };

  /** The names of the seeded Orders the filters select. */
  const matching = async (filters: CustomFieldFilters): Promise<string[]> => {
    const condition = await port.condition('order', filters);
    expect(condition).not.toBeNull();
    const ids = [...orders.values()];
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select id from "orders" where id = any(?::uuid[]) and id in (${condition!.sql})`, [
        `{${ids.join(',')}}`,
        ...condition!.params,
      ])) as Array<{ id: string }>;
    const byId = new Map([...orders].map(([name, id]) => [id, name]));
    return rows.map((row) => byId.get(row.id)!).sort();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<CustomFieldListFilterPort>('customFieldListFilterPort');
    await define(TEXT, 'text');
    await define(NUMBER, 'number');
    await define(BOOLEAN, 'boolean');
    await define(DATE, 'date');
    await define(SELECT, 'select', ['web', 'shop', 'app']);
    await define(MULTI, 'multiselect', ['a', 'b', 'c']);

    await seed('alpha', {
      [TEXT]: 'Hello World',
      [NUMBER]: 10,
      [BOOLEAN]: true,
      [DATE]: '2026-03-15',
      [SELECT]: 'web',
      [MULTI]: ['a', 'b'],
    });
    await seed('beta', {
      [TEXT]: "it's what? 100%",
      [NUMBER]: 20,
      [BOOLEAN]: false,
      [DATE]: '2026-06-01',
      [SELECT]: 'shop',
      [MULTI]: ['c'],
    });
    await seed('gamma', { [TEXT]: '1000 a_b', [NUMBER]: '30', [MULTI]: 'a' });
    await seed('empty', {});
    // Values that drifted under the date key: another type, and a string that is no date.
    await seed('drift-number', { [DATE]: 20260401 });
    await seed('drift-text', { [DATE]: 'soon' });
  });

  afterAll(async () => {
    for (const id of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('text: contains, in any case, with % and _ taken literally', async () => {
    expect(await matching({ [TEXT]: { contains: 'hello' } })).toEqual(['alpha']);
    expect(await matching({ [TEXT]: { contains: 'WORLD' } })).toEqual(['alpha']);
    expect(await matching({ [TEXT]: { contains: 'a_b' } })).toEqual(['gamma']);
    expect(await matching({ [TEXT]: { contains: 'a%b' } })).toEqual([]);
  });

  it('text: finds the hostile strings by themselves, bound and not spliced', async () => {
    expect(await matching({ [TEXT]: { contains: "it's" } })).toEqual(['beta']);
    expect(await matching({ [TEXT]: { contains: 'what?' } })).toEqual(['beta']);
    expect(await matching({ [TEXT]: { contains: '100%' } })).toEqual(['beta']);
  });

  it('number: inclusive bounds, either alone; a string-stored value neither matches nor fails', async () => {
    expect(await matching({ [NUMBER]: { min: '10', max: '20' } })).toEqual(['alpha', 'beta']);
    expect(await matching({ [NUMBER]: { min: '20' } })).toEqual(['beta']);
    expect(await matching({ [NUMBER]: { max: '10' } })).toEqual(['alpha']);
    expect(await matching({ [NUMBER]: { min: '0' } })).toEqual(['alpha', 'beta']);
  });

  it('boolean: yes matches stored true, no matches stored false, an absent value neither', async () => {
    expect(await matching({ [BOOLEAN]: { is: true } })).toEqual(['alpha']);
    expect(await matching({ [BOOLEAN]: { is: false } })).toEqual(['beta']);
  });

  it('date: inclusive bounds, either alone; a drifted value neither matches nor fails', async () => {
    expect(await matching({ [DATE]: { from: '2000-01-01' } })).toEqual(['alpha', 'beta']);
    expect(await matching({ [DATE]: { to: '9999-12-31' } })).toEqual(['alpha', 'beta']);
    expect(await matching({ [DATE]: { from: '2026-03-15', to: '2026-06-01' } })).toEqual(['alpha', 'beta']);
    expect(await matching({ [DATE]: { from: '2026-03-16' } })).toEqual(['beta']);
    expect(await matching({ [DATE]: { to: '2026-03-15' } })).toEqual(['alpha']);
  });

  it('select: any of the chosen options', async () => {
    expect(await matching({ [SELECT]: { in: ['web', 'app'] } })).toEqual(['alpha']);
    expect(await matching({ [SELECT]: { in: ['web', 'shop'] } })).toEqual(['alpha', 'beta']);
  });

  it('multiselect: any chosen element; a non-array stored value neither matches nor fails', async () => {
    expect(await matching({ [MULTI]: { in: ['b'] } })).toEqual(['alpha']);
    expect(await matching({ [MULTI]: { in: ['a', 'c'] } })).toEqual(['alpha', 'beta']);
  });

  it('a record without the key matches no filter, and two keys combine as AND', async () => {
    expect(await matching({ [SELECT]: { in: ['web'] }, [NUMBER]: { min: '15' } })).toEqual([]);
    expect(await matching({ [SELECT]: { in: ['shop'] }, [NUMBER]: { min: '15' } })).toEqual(['beta']);
    expect(await matching({ [TEXT]: { contains: 'e' } })).toEqual(['alpha']);
  });

  it('refuses an operator that does not apply to the field rather than ignoring it', async () => {
    const error = await port
      .condition('order', { [BOOLEAN]: { contains: 'x' } })
      .catch((caught: unknown) => caught);
    expect((error as { name?: string }).name).toBe('ZodError');
  });

  it('offers the six fields of the list', async () => {
    const offered = (await port.listFilterable('order')).map((field) => field.key);
    expect(offered).toEqual(expect.arrayContaining([TEXT, NUMBER, BOOLEAN, DATE, SELECT, MULTI]));
  });
});
