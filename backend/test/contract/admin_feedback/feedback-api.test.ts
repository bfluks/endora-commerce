import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_FEEDBACK_DEFAULT_RELAY_URL,
  ADMIN_FEEDBACK_ERROR_CODES,
  ADMIN_FEEDBACK_SETTING_CODES,
  AdminFeedbackRelayPayloadSchema,
  ERROR_CODES,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * `POST /api/v1/admin/feedback` (issue #379), through the composed
 * application: the guard, the validation envelope, the relay setting and what
 * the relay is sent. The relay is the global `fetch`, answered here for its
 * host only; every other request passes through.
 */
const URL = '/api/v1/admin/feedback';
const ADMIN = { b2b_session: 'stub-admin-session' };
const RELAY_HOST = new globalThis.URL(ADMIN_FEEDBACK_DEFAULT_RELAY_URL).host;
const BODY = {
  message: 'The order list forgets my filters.',
  email: 'anna@shop.example',
  phone: '',
  adminUrl: 'https://admin.shop.example',
  language: 'en',
};

describe('POST /api/v1/admin/feedback (issue #379)', () => {
  let h: BackendServerHandle;
  const realFetch = globalThis.fetch;
  let relayAnswer: () => Response = () => new Response('{"ok":true}', { status: 200 });
  const relayCalls: Array<{ url: string; init: RequestInit | undefined }> = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new globalThis.URL(url).host !== RELAY_HOST) return realFetch(input, init);
      relayCalls.push({ url, init });
      return relayAnswer();
    });
  });

  afterEach(async () => {
    relayCalls.length = 0;
    relayAnswer = () => new Response('{"ok":true}', { status: 200 });
    await setRelay(ADMIN_FEEDBACK_DEFAULT_RELAY_URL);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await teardownBackendServer(h);
  });

  async function setRelay(value: string): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL}/value`,
      headers: { 'content-type': 'application/json' },
      cookies: ADMIN,
      payload: JSON.stringify({ scope: 'all', value }),
    });
    expect(res.statusCode).toBe(200);
  }

  const send = (payload: unknown, cookies: Record<string, string> | null = ADMIN) =>
    h.app.inject({ method: 'POST', url: URL, ...(cookies ? { cookies } : {}), payload: payload as object });

  it('refuses a caller without a session with 401, before validating', async () => {
    const res = await send({}, null);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(relayCalls).toHaveLength(0);
  });

  it('answers 400 VALIDATION_FAILED for an invalid body, and sends nothing', async () => {
    const res = await send({ message: '', email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(relayCalls).toHaveLength(0);
  });

  it('relays the payload to the configured address and answers 204', async () => {
    const res = await send(BODY);
    expect(res.statusCode).toBe(204);
    expect(relayCalls).toHaveLength(1);
    const { url, init } = relayCalls[0]!;
    expect(url).toBe(ADMIN_FEEDBACK_DEFAULT_RELAY_URL);
    expect(init?.redirect).toBe('manual');
    const payload = AdminFeedbackRelayPayloadSchema.parse(JSON.parse(String(init?.body)));
    expect(payload).toMatchObject({
      kind: 'admin_feedback',
      message: BODY.message,
      email: BODY.email,
      phone: null,
      language: 'en',
      adminUrl: BODY.adminUrl,
      adminUserId: TEST_ADMIN_ID,
    });
    expect(payload.adminName).not.toBeNull();
  });

  it('answers 503 ADMIN_FEEDBACK_NOT_CONFIGURED while the relay address is empty', async () => {
    await setRelay('');
    const res = await send(BODY);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.NOT_CONFIGURED);
    expect(res.json().error.message).toBeTruthy();
    expect(relayCalls).toHaveLength(0);
  });

  it('answers 429 RATE_LIMITED when the relay does', async () => {
    relayAnswer = () => new Response('{"error":"rate_limited"}', { status: 429 });
    const res = await send(BODY);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('answers 502 ADMIN_FEEDBACK_DELIVERY_FAILED when the relay refuses', async () => {
    relayAnswer = () => new Response('{"error":"delivery"}', { status: 502 });
    const res = await send(BODY);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe(ADMIN_FEEDBACK_ERROR_CODES.DELIVERY_FAILED);
    expect(res.json().error.message).toBeTruthy();
  });
});
