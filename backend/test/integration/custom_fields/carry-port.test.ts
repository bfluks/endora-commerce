import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldCarryPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `customFieldCarryPort` as the composed server publishes it
 * (`specs/162-custom-fields-value-carry/contracts/carry-api.md` §4.1, research
 * R-5): a real Quote Request → Order plan over stored definitions, and a
 * definition change visible to the very next plan — the definition Command's
 * invalidation of the shared per-entity cache, not the TTL.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const KEY = `cfc_${RUN}_order_source`;

const option = (value: string, sortOrder = 0) => ({
  value,
  label: {},
  labelDefault: value,
  isDefault: false,
  sortOrder,
});

describe('custom_fields — the carry port in the composed server', () => {
  let h: BackendServerHandle;
  let port: CustomFieldCarryPort;
  let targetId: string;
  const created: string[] = [];

  const define = async (entityType: string, extra: Record<string, unknown>): Promise<string> => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      ...ADMIN,
      payload: {
        entityType,
        key: KEY,
        label: {},
        labelDefault: KEY,
        valueType: 'select',
        required: false,
        sortOrder: 0,
        config: {},
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    created.push(id);
    return id;
  };

  const plan = (value: string) =>
    port.plan({
      sourceType: 'quote_request',
      targetType: 'order',
      sourceValues: { [KEY]: value },
      targetValues: {},
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    port = (h.container.cradle as unknown as { customFieldCarryPort: CustomFieldCarryPort })
      .customFieldCarryPort;
    targetId = await define('order', { options: [option('fair')] });
    await define('quote_request', { options: [option('fair'), option('web', 1)], carryTo: [] });
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('carries nothing while the source definition does not carry to the target', async () => {
    expect(await plan('fair')).toEqual({ values: {}, carried: [], skipped: [] });
  });

  it('answers a real plan once the carry is on, and sees a target option added at once', async () => {
    const sourceId = created[1]!;
    // The target lacks `web`, so the option sets are not compatible yet …
    const refused = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${sourceId}`,
      ...ADMIN,
      payload: { carryTo: ['order'] },
    });
    expect(refused.statusCode, refused.body).toBe(422);

    const added = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions/${targetId}/options`,
      ...ADMIN,
      payload: option('web', 1),
    });
    expect(added.statusCode, added.body).toBe(201);
    const accepted = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${sourceId}`,
      ...ADMIN,
      payload: { carryTo: ['order'] },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    expect(await plan('fair')).toEqual({ values: { [KEY]: 'fair' }, carried: [KEY], skipped: [] });
    expect(await plan('web')).toEqual({ values: { [KEY]: 'web' }, carried: [KEY], skipped: [] });
  });

  it('skips a value the target stops offering, on the very next plan', async () => {
    const options = (await h.app.inject({ method: 'GET', url: `${API}/definitions/${targetId}`, ...ADMIN })).json() as {
      data: { options: Array<{ id: string; value: string }> };
    };
    const web = options.data.options.find((o) => o.value === 'web')!;
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${targetId}/options/${web.id}`,
      ...ADMIN,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await plan('web')).toEqual({
      values: {},
      carried: [],
      skipped: [{ key: KEY, reason: 'value_invalid', label: { labelDefault: KEY, labels: {} } }],
    });
  });
});
