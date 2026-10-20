import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldCarryReceiverPort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_ADMIN, CRM_CUSTOMER, seedCrmOrganization, submitCrmQuoteRequest } from '../../helpers/seed-crm.js';

/**
 * `quoteRequestCustomFieldCarryPort` — `quote_requests` receives a Sales
 * Opportunity's values into a Quote Request created from it
 * (`specs/158-custom-fields-value-carry/` US3; contract `carry-api.md` §4.2;
 * research R-10, R-11).
 *
 * One Command of the owner: empty fields filled, a held value kept, a value
 * that cannot be carried named in one admin-only `custom-field-carry-skipped`
 * event, and another Organization's request answered `not-found` exactly as a
 * missing one is.
 */
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

const option = (value: string, sortOrder = 0) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder });

interface AuditRow {
  actorAdminUserId?: string | null;
  stateAfter?: Record<string, unknown> | null;
}

describe('quote_requests — custom-field values received from a Sales Opportunity', () => {
  let h: BackendServerHandle;
  let port: CustomFieldCarryReceiverPort;
  let otherOrganizationId: string;
  const created: string[] = [];

  const define = async (entityType: string, key: string, extra: Record<string, unknown> = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: CRM_ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
        valueType: 'select',
        required: false,
        sortOrder: 0,
        config: {},
        options: [option('fair'), option('web', 1)],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    created.push(id);
    return id;
  };

  /** A Quote Request field and the same-key Opportunity field carrying to it. */
  const pair = async (name: string) => {
    const key = fixtureKey(name);
    const quoteRequestDefinitionId = await define('quote_request', key);
    await define('opportunity', key, { carryTo: ['quote_request'] });
    return { key, quoteRequestDefinitionId };
  };

  const receive = (recordId: string, values: Record<string, unknown>, organizationId = TEST_ORGANIZATION_ID) =>
    enterSystemScope('test: crm pushes an opportunity’s values', () =>
      port.receiveCarriedValues({
        recordId,
        organizationId,
        source: { entityType: 'opportunity', recordId: randomUUID(), reference: 'OPP-000042', values },
      }),
    );

  const storedValues = async (id: string): Promise<Record<string, unknown>> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "quote_requests" where id = ?`, [id])) as Array<{
      custom_field_values: Record<string, unknown> | null;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.custom_field_values ?? {};
  };

  const events = async (id: string): Promise<Array<{ event_type: string; payload: Record<string, unknown> }>> =>
    (await h
      .em()
      .getConnection()
      .execute(`select event_type, payload from "quote_request_events" where quote_request_id = ?`, [id])) as Array<{
      event_type: string;
      payload: Record<string, unknown>;
    }>;

  const audit = async (id: string): Promise<AuditRow[]> =>
    (await h.auditLogService.query({ action: 'quote_request.custom_fields.carry', objectId: id })) as unknown as AuditRow[];

  beforeAll(async () => {
    h = await setupBackendServer();
    port = (h.container.cradle as unknown as { quoteRequestCustomFieldCarryPort: CustomFieldCarryReceiverPort })
      .quoteRequestCustomFieldCarryPort;
    otherOrganizationId = await seedCrmOrganization(h.em(), `cfc-other-${RUN}`);
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('fills an empty field in one audited Command attributed to the system (US3-1)', async () => {
    const { key } = await pair('filled');
    const rfq = await submitCrmQuoteRequest(h);
    const receipt = await receive(rfq.id, { [key]: 'fair' });
    expect(receipt).toEqual({ outcome: 'applied', carried: [key], skipped: [] });
    expect((await storedValues(rfq.id))[key]).toBe('fair');
    const entries = await audit(rfq.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorAdminUserId ?? null).toBeNull();
    expect(entries[0]!.stateAfter).toMatchObject({ customFieldValues: { [key]: 'fair' } });
  });

  it('keeps a value the request already holds, and writes no entry (US3-3)', async () => {
    const { key } = await pair('kept');
    const rfq = await submitCrmQuoteRequest(h);
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify({ [key]: 'web' }),
        rfq.id,
      ]);
    const receipt = await receive(rfq.id, { [key]: 'fair' });
    expect(receipt).toEqual({ outcome: 'applied', carried: [], skipped: [] });
    expect((await storedValues(rfq.id))[key]).toBe('web');
    expect(await audit(rfq.id)).toEqual([]);
    expect((await events(rfq.id)).filter((e) => e.event_type === 'custom-field-carry-skipped')).toEqual([]);
  });

  it('names a value it cannot carry in one admin-only history entry (FR-010, Q5)', async () => {
    const { key, quoteRequestDefinitionId } = await pair('skipped');
    const drift = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${quoteRequestDefinitionId}`,
      cookies: CRM_ADMIN,
      payload: { audience: 'customer' },
    });
    expect(drift.statusCode, drift.body).toBe(200);
    const rfq = await submitCrmQuoteRequest(h);
    const receipt = await receive(rfq.id, { [key]: 'fair' });
    expect(receipt).toEqual({ outcome: 'applied', carried: [], skipped: [{ key, reason: 'audience_mismatch' }] });
    expect(Object.hasOwn(await storedValues(rfq.id), key)).toBe(false);

    const skipped = (await events(rfq.id)).filter((e) => e.event_type === 'custom-field-carry-skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.payload).toMatchObject({
      type: 'custom-field-carry-skipped',
      source: { entityType: 'opportunity', reference: 'OPP-000042' },
      skipped: [{ key, reason: 'audience_mismatch' }],
    });

    const adminHistory = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfq.id}/history`,
      cookies: CRM_ADMIN,
    });
    expect(adminHistory.statusCode, adminHistory.body).toBe(200);
    const entries = (adminHistory.json() as { data: { entries: Array<{ kind: string; customFieldCarry?: unknown }> } }).data
      .entries;
    const carryEntries = entries.filter((entry) => entry.kind === 'custom_field_carry_skipped');
    expect(carryEntries).toHaveLength(1);
    expect(carryEntries[0]!.customFieldCarry).toMatchObject({
      source: { entityType: 'opportunity', reference: 'OPP-000042' },
      skipped: [{ key, reason: 'audience_mismatch' }],
    });

    const buyerDetail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${rfq.id}`, cookies: CRM_CUSTOMER });
    expect(buyerDetail.statusCode, buyerDetail.body).toBe(200);
    expect(buyerDetail.body).not.toContain('custom-field-carry-skipped');
    expect(buyerDetail.body).not.toContain(key);
  });

  it('answers not-found for another Organization’s request exactly as for a missing one, and writes nothing (FR-012)', async () => {
    const { key } = await pair('foreign');
    const rfq = await submitCrmQuoteRequest(h);
    const foreign = await receive(rfq.id, { [key]: 'fair' }, otherOrganizationId);
    const missing = await receive(randomUUID(), { [key]: 'fair' });
    expect(foreign).toEqual({ outcome: 'not-found', carried: [], skipped: [] });
    expect(missing).toEqual(foreign);
    expect(Object.hasOwn(await storedValues(rfq.id), key)).toBe(false);
    expect(await audit(rfq.id)).toEqual([]);
  });
});
