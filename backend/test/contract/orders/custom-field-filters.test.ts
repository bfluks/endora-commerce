import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * Custom fields as filters of the admin Orders list and its CSV export
 * (`specs/157-custom-fields-list-filters/` US1; FR-007, FR-009 – FR-012,
 * FR-015, FR-017; contract §4; threat model F-1 – F-4).
 */
const ADMIN = { b2b_session: 'stub-admin-session' };
const API = '/api/v1/admin/custom-fields';
const ORDERS = '/api/v1/admin/orders';
const RUN = randomUUID().slice(0, 8);
const key = (name: string) => `cf157_${RUN}_${name}`;

const S = key('s');
const T = key('t');
const NUMBER = key('number');
const BOOLEAN = key('boolean');
const DATE = key('date');
const MULTI = key('multi');
const OFF = key('off');

type Cookies = Record<string, string>;

interface ListBody {
  data: Array<{ id: string; businessId: string }>;
  pagination: { page: number; pageSize: number; total: number };
  counts: Record<string, number>;
  paymentStatusCounts: Record<string, number>;
}

interface ErrorBody {
  error: { code: string; message: string; details?: { key?: string; keys?: string[] } };
}

const param = (filters: unknown) => `customFieldFilters=${encodeURIComponent(JSON.stringify(filters))}`;
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);

describe('admin Orders list — custom-field filters', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let reader: { cookies: Cookies; undo: () => void };
  let withoutOrders: { cookies: Cookies; undo: () => void };
  let polish: { cookies: Cookies; undo: () => void };
  let rep: { cookies: Cookies; undo: () => void };
  const definitionIds: string[] = [];
  const inA: { a: string[]; b: string[]; none: string[] } = { a: [], b: [], none: [] };
  const inB: string[] = [];
  const perType = new Map<string, { match: string; miss: string }>();

  const get = (url: string, cookies: Cookies = ADMIN) => h.app.inject({ method: 'GET', url, cookies });

  const list = async (query: string, cookies: Cookies = ADMIN): Promise<ListBody> => {
    const response = await get(`${ORDERS}?${query}`, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as ListBody;
  };

  /** Every id over every page of `query`. */
  const allIds = async (query: string, cookies: Cookies = ADMIN): Promise<string[]> => {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const body = await list(`${query}&pageSize=10&page=${page}`, cookies);
      ids.push(...body.data.map((row) => row.id));
      if (body.data.length < 10) return ids;
    }
  };

  const define = async (
    entityType: string,
    definitionKey: string,
    valueType: string,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType,
        key: definitionKey,
        label: { en: definitionKey },
        labelDefault: definitionKey,
        valueType,
        required: false,
        sortOrder: 0,
        config: {},
        listFilter: true,
        options: [],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitionIds.push((response.json() as { data: { id: string } }).data.id);
  };

  const options = (...values: string[]) =>
    values.map((value, sortOrder) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder }));

  const order = async (organizationId: string, values: Record<string, unknown>): Promise<string> => {
    const seeded = await seedCrmOrder(h.em(), { organizationId });
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify(values),
        seeded.id,
      ]);
    return seeded.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    organizationA = await seedCrmOrganization(em, `cf157 A ${RUN}`);
    organizationB = await seedCrmOrganization(em, `cf157 B ${RUN}`);
    reader = await seedCrmAdmin(em, `cf157_orders_${RUN}`, ['orders:read']);
    withoutOrders = await seedCrmAdmin(em, `cf157_no_orders_${RUN}`, ['custom_fields:read']);
    polish = await seedCrmAdmin(em, `cf157_pl_${RUN}`, ['orders:read']);
    rep = await seedCrmSalesRep(em, [organizationA], ['orders:read']);

    await define('order', S, 'select', { options: options('a', 'b', 'c') });
    await define('order', T, 'text', { audience: 'internal' });
    await define('order', NUMBER, 'number');
    await define('order', BOOLEAN, 'boolean');
    await define('order', DATE, 'date');
    await define('order', MULTI, 'multiselect', { options: options('x', 'y') });
    await define('order', OFF, 'select', { options: options('a'), listFilter: false });
    await define('quote_request', key('qr'), 'select', { options: options('a') });

    for (let i = 0; i < 23; i += 1) {
      inA.a.push(await order(organizationA, { [S]: 'a', [T]: i < 3 ? 'needle here' : 'hay' }));
    }
    for (let i = 0; i < 5; i += 1) inA.b.push(await order(organizationA, { [S]: 'b', [T]: 'needle' }));
    for (let i = 0; i < 2; i += 1) inA.none.push(await order(organizationA, {}));
    for (let i = 0; i < 2; i += 1) inB.push(await order(organizationB, { [S]: 'a' }));

    const pair = async (name: string, match: Record<string, unknown>, miss: Record<string, unknown>) =>
      perType.set(name, { match: await order(organizationB, match), miss: await order(organizationB, miss) });
    await pair('select', { [S]: 'c' }, { [S]: 'b' });
    await pair('text', { [T]: 'unique-text-match' }, { [T]: 'other' });
    await pair('number', { [NUMBER]: 1234 }, { [NUMBER]: 5 });
    await pair('boolean', { [BOOLEAN]: true }, { [BOOLEAN]: false });
    await pair('date', { [DATE]: '2031-01-02' }, { [DATE]: '2020-01-01' });
    await pair('multiselect', { [MULTI]: ['y'] }, { [MULTI]: ['x'] });

    const language = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: polish.cookies,
      payload: { preferredLanguage: 'pl' },
    });
    expect(language.statusCode, language.body).toBe(200);
  });

  afterAll(async () => {
    reader.undo();
    withoutOrders.undo();
    polish.undo();
    rep.undo();
    for (const id of definitionIds) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  describe('the offered fields', () => {
    it('lists the option-on Order definitions, internal ones included, and not the others', async () => {
      const response = await get(`${ORDERS}/custom-field-filters`, reader.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const keys = (response.json() as { data: Array<{ key: string }> }).data.map((field) => field.key);
      expect(keys).toEqual(expect.arrayContaining([S, T, NUMBER, BOOLEAN, DATE, MULTI]));
      expect(keys).not.toContain(OFF);
      expect(keys).not.toContain(key('qr'));
    });

    it('answers 403 without orders:read', async () => {
      const response = await get(`${ORDERS}/custom-field-filters`, withoutOrders.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('is its own route, not an order lookup', async () => {
      const response = await get(`${ORDERS}/custom-field-filters`);
      expect(response.statusCode).toBe(200);
      expect(Array.isArray((response.json() as { data: unknown }).data)).toBe(true);
    });
  });

  describe('filtering', () => {
    it('pages through exactly the matching Orders', async () => {
      const query = param({ [S]: { in: ['a'] } });
      const first = await list(`${query}&pageSize=10`);
      expect(first.pagination.total).toBe(25);
      const ids = await allIds(query);
      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25);
      expect([...ids].sort()).toEqual([...inA.a, ...inB].sort());
    });

    it('ORs the values of one key', async () => {
      const body = await list(`${param({ [S]: { in: ['a', 'b'] } })}&organizationId=${organizationA}`);
      expect(body.pagination.total).toBe(28);
    });

    it('ANDs with the list’s own filters and with another key', async () => {
      const scoped = await list(`${param({ [S]: { in: ['a'] } })}&organizationId=${organizationB}`);
      expect(scoped.pagination.total).toBe(2);
      const withStatus = await list(`${param({ [S]: { in: ['a'] } })}&status=new`);
      expect(withStatus.pagination.total).toBe(25);
      const withStatusOff = await list(`${param({ [S]: { in: ['a'] } })}&status=cancelled`);
      expect(withStatusOff.pagination.total).toBe(0);
      const both = await list(param({ [S]: { in: ['a', 'b'] }, [T]: { contains: 'needle' } }));
      expect(both.pagination.total).toBe(8);
    });

    it.each([
      ['S alone', { [S]: { in: ['a'] } }],
      ['S and T', { [S]: { in: ['a', 'b'] }, [T]: { contains: 'needle' } }],
    ])('the four statements agree under the filter (%s)', async (_name, filters) => {
      const body = await list(param(filters));
      expect(sum(body.counts)).toBe(body.pagination.total);
      expect(sum(body.paymentStatusCounts)).toBe(body.pagination.total);
      const ids = await allIds(param(filters));
      expect(new Set(ids).size).toBe(body.pagination.total);
      const csv = await get(`${ORDERS}/export?${param(filters)}`);
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers['x-export-row-count']).toBe(String(body.pagination.total));
      const lines = csv.body.split('\r\n').filter((line) => line.length > 0);
      expect(lines.length - 1).toBe(body.pagination.total);
    });

    it('exports the same Orders the list shows', async () => {
      const query = param({ [S]: { in: ['b'] } });
      const listed = (await list(`${query}&pageSize=50`)).data.map((row) => row.businessId).sort();
      const csv = await get(`${ORDERS}/export?${query}`);
      const [header, ...rows] = csv.body.split('\r\n').filter((line) => line.length > 0);
      const column = header!.split(',').indexOf('businessId');
      expect(rows.map((row) => row.split(',')[column]).sort()).toEqual(listed);
    });

    it('matches only a stored "no" for No — a request without the value matches neither', async () => {
      const ids = (await list(`${param({ [BOOLEAN]: { is: false } })}&organizationId=${organizationB}&pageSize=50`)).data.map(
        (row) => row.id,
      );
      expect(ids).toEqual([perType.get('boolean')!.miss]);
    });

    it('is not applied by the buyer’s own Orders list', async () => {
      const customer = { b2b_session: 'stub-customer-session' };
      const plain = await get('/api/v1/orders', customer);
      expect(plain.statusCode, plain.body).toBe(200);
      const filtered = await get(`/api/v1/orders?${param({ [S]: { in: ['zzz'] } })}`, customer);
      expect(filtered.statusCode, filtered.body).toBe(plain.statusCode);
      const idsOf = (body: string) =>
        ((JSON.parse(body) as { data?: Array<{ id: string }> }).data ?? []).map((row) => row.id).sort();
      expect(idsOf(filtered.body)).toEqual(idsOf(plain.body));
    });

    it('filters on an internal field', async () => {
      expect((await list(param({ [T]: { contains: 'needle' } }))).pagination.total).toBe(8);
    });

    it.each([
      ['select', { [S]: { in: ['c'] } }],
      ['text', { [T]: { contains: 'unique-text-match' } }],
      ['number', { [NUMBER]: { min: '1000' } }],
      ['boolean', { [BOOLEAN]: { is: true } }],
      ['date', { [DATE]: { from: '2030-01-01' } }],
      ['multiselect', { [MULTI]: { in: ['y'] } }],
    ])('filters a %s field', async (name, filters) => {
      const ids = (await list(`${param(filters)}&organizationId=${organizationB}&pageSize=50`)).data.map(
        (row) => row.id,
      );
      const { match, miss } = perType.get(name)!;
      expect(ids).toContain(match);
      expect(ids).not.toContain(miss);
    });

    it('confines a sales representative to their Organizations', async () => {
      const ids = await allIds(param({ [S]: { in: ['a'] } }), rep.cookies);
      expect([...ids].sort()).toEqual([...inA.a].sort());
    });
  });

  describe('refusals', () => {
    it.each([
      ['an unknown key', key('unknown')],
      ['a Quote Request key', key('qr')],
      ['a field with the option off', OFF],
      ['constructor', 'constructor'],
    ])('refuses %s on the list and the export, naming it', async (_name, refused) => {
      for (const path of [ORDERS, `${ORDERS}/export`]) {
        const response = await get(`${path}?${param({ [S]: { in: ['a'] }, [refused]: { in: ['a'] } })}`);
        expect(response.statusCode, response.body).toBe(400);
        const { error } = response.json() as ErrorBody;
        expect(error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
        expect(error.details?.key).toBe(refused);
      }
    });

    it('answers the same refusal to a sales representative', async () => {
      const filters = param({ [OFF]: { in: ['a'] } });
      const admin = (await get(`${ORDERS}?${filters}`)).json() as ErrorBody;
      const scoped = await get(`${ORDERS}?${filters}`, rep.cookies);
      expect(scoped.statusCode).toBe(400);
      expect((scoped.json() as ErrorBody).error).toMatchObject({
        code: admin.error.code,
        message: admin.error.message,
        details: { key: OFF },
      });
    });

    it('answers the sentence of the custom_fields bundle, in the admin’s language', async () => {
      const filters = param({ [OFF]: { in: ['a'] } });
      const english = (await get(`${ORDERS}?${filters}`, reader.cookies)).json() as ErrorBody;
      expect(english.error.message).toBe(
        `The filter on the custom field "${OFF}" is not available on this list. Remove it and try again.`,
      );
      const polishBody = (await get(`${ORDERS}?${filters}`, polish.cookies)).json() as ErrorBody;
      expect(polishBody.error.message).toBe(
        `Filtr po polu niestandardowym „${OFF}” nie jest dostępny na tej liście. Usuń go i spróbuj ponownie.`,
      );
    });

    it('refuses more than ten keys as a validation failure', async () => {
      const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [key(`k${i}`), { is: true }]));
      const response = await get(`${ORDERS}?${param(eleven)}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses the parameter given twice, on the list and the export', async () => {
      const once = param({ [S]: { in: ['a'] } });
      for (const path of [ORDERS, `${ORDERS}/export`]) {
        const response = await get(`${path}?${once}&${once}`);
        expect(response.statusCode, response.body).toBe(400);
        expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('refuses an operator that does not apply to the field as a validation failure', async () => {
      for (const filters of [{ [BOOLEAN]: { contains: 'x' } }, { [S]: { min: '1' } }]) {
        const response = await get(`${ORDERS}?${param(filters)}`);
        expect(response.statusCode, response.body).toBe(400);
        expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
      }
    });

    it.each([
      ['__proto__', '{"__proto__":{"is":true}}'],
      ['an SQL-shaped key', JSON.stringify({ "a'; drop table orders;--": { is: true } })],
      ['101 `in` values over three keys', JSON.stringify({
        [S]: { in: Array.from({ length: 50 }, (_, i) => `a${i}`) },
        [MULTI]: { in: Array.from({ length: 50 }, (_, i) => `b${i}`) },
        [key('third')]: { in: ['c'] },
      })],
      ['51 `in` values on one key', JSON.stringify({ [S]: { in: Array.from({ length: 51 }, (_, i) => `a${i}`) } })],
    ])('refuses %s as a validation failure, reading nothing', async (_name, raw) => {
      const response = await get(`${ORDERS}?customFieldFilters=${encodeURIComponent(raw)}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a filter as soon as its option is switched off, and answers again when it is back on', async () => {
      const toggled = key('toggled');
      await define('order', toggled, 'boolean');
      const id = definitionIds.at(-1)!;
      const filters = param({ [toggled]: { is: true } });
      const patch = (listFilter: boolean) =>
        h.app.inject({ method: 'PATCH', url: `${API}/definitions/${id}`, cookies: ADMIN, payload: { listFilter } });

      expect((await get(`${ORDERS}?${filters}`)).statusCode).toBe(200);
      expect((await patch(false)).statusCode).toBe(200);
      for (const path of [ORDERS, `${ORDERS}/export`]) {
        const refused = await get(`${path}?${filters}`);
        expect(refused.statusCode, refused.body).toBe(400);
        expect((refused.json() as ErrorBody).error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
      }
      expect((await patch(true)).statusCode).toBe(200);
      expect((await get(`${ORDERS}?${filters}`)).statusCode).toBe(200);
      expect((await get(`${ORDERS}/export?${filters}`)).statusCode).toBe(200);
    });

    it('refuses an inverted number or date range as a validation failure, in a sentence', async () => {
      for (const filters of [{ [NUMBER]: { min: '10', max: '1' } }, { [DATE]: { from: '2026-03-01', to: '2026-02-01' } }]) {
        const response = await get(`${ORDERS}?${param(filters)}`);
        expect(response.statusCode, response.body).toBe(400);
        const { error } = response.json() as ErrorBody;
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.message).toBe('Request failed validation.');
      }
    });

    it('refuses a malformed bound as a validation failure', async () => {
      const response = await get(`${ORDERS}?${param({ [NUMBER]: { min: 'ten' } })}`);
      expect(response.statusCode, response.body).toBe(400);
      expect((response.json() as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });
  });
});
