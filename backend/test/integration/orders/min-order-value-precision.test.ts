import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ensureSalesChannel } from '../../helpers/sales-channel-fixtures.js';

/**
 * Issue #428 point 4 — `orders.min_order_value` is a typed money amount, so it
 * takes at most two decimal places: more is refused with
 * `400 AMOUNT_PRECISION_EXCEEDED`, never rounded (owner ruling of 2026-10-24,
 * `specs/pricing/worked-examples.md` §10.18). The refusal is `orders`'
 * contribution to the settings write, so it holds for a platform-wide write and
 * for a per-channel one alike.
 */

const CODE = 'orders.min_order_value';
const ACTOR = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

async function refusal(work: Promise<unknown>): Promise<HttpError> {
  try {
    await work;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
  throw new Error('expected the write to be refused');
}

describe('orders — the minimum order value takes two decimal places', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await ensureSalesChannel(h.em(), 'min-precision');
  });
  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(CODE, 0, null, ACTOR).catch(() => undefined);
    await teardownBackendServer(h);
  });

  it('refuses a platform-wide value with a third decimal place', async () => {
    const err = await refusal(h.settings.adminService.setValueForAllChannels(CODE, 100.005, null, ACTOR));
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ERROR_CODES.AMOUNT_PRECISION_EXCEEDED);
  });

  it('refuses a per-channel value with a third decimal place', async () => {
    const err = await refusal(h.settings.adminService.setValueForSubset(CODE, ['min-precision'], 49.999, null, ACTOR));
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ERROR_CODES.AMOUNT_PRECISION_EXCEEDED);
  });

  it('accepts two places, and trailing zeros are not significant', async () => {
    await expect(h.settings.adminService.setValueForAllChannels(CODE, 100.5, null, ACTOR)).resolves.toBeTruthy();
    await expect(
      h.settings.adminService.setValueForSubset(CODE, ['min-precision'], 49.99, null, ACTOR),
    ).resolves.toBeTruthy();
  });
});
