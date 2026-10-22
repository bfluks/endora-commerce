import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { SalesChannelAccessPolicy } from './sales-channel-access-policy.js';

/**
 * Feature 154 — the decision table of `contracts/channel-access-rule.md` §2.
 * One statement of the rule: the kernel's access step, the sign-in paths and the
 * storefront access read all ask it.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const open = { id: 'ch-open', code: 'retail', anonymousAccess: true };
const closed = { id: 'ch-closed', code: 'trade', anonymousAccess: false };

function policyWith(sets: Record<string, string[]>) {
  const permitted = vi.fn(async (organizationId: string) => new Set(sets[organizationId] ?? []));
  const channels = new Map([open, closed].map((c) => [c.id, c]));
  const policy = new SalesChannelAccessPolicy(
    { permittedChannelIds: permitted },
    async (id) => channels.get(id) ?? null,
  );
  return { policy, permitted };
}

describe('SalesChannelAccessPolicy.decide', () => {
  it('admits an anonymous request on an open channel without reading any assignment', async () => {
    const { policy, permitted } = policyWith({});
    expect(await policy.decide({ kind: 'anonymous' }, open)).toEqual({ ok: true });
    expect(permitted).not.toHaveBeenCalled();
  });

  it('refuses an anonymous request on a closed channel', async () => {
    const { policy } = policyWith({});
    expect(await policy.decide({ kind: 'anonymous' }, closed)).toEqual({
      ok: false,
      code: 'SALES_CHANNEL_SIGN_IN_REQUIRED',
    });
  });

  it('admits a customer on a channel assigned to its Organization, open or closed', async () => {
    const { policy } = policyWith({ [ORG]: ['ch-open', 'ch-closed'] });
    const actor = { kind: 'customer', organizationId: ORG } as const;
    expect(await policy.decide(actor, open)).toEqual({ ok: true });
    expect(await policy.decide(actor, closed)).toEqual({ ok: true });
  });

  it('refuses a customer on a channel not assigned, even an open one', async () => {
    const { policy } = policyWith({ [ORG]: ['ch-closed'] });
    expect(await policy.decide({ kind: 'customer', organizationId: ORG }, open)).toEqual({
      ok: false,
      code: 'SALES_CHANNEL_NOT_PERMITTED',
    });
  });

  it('refuses a customer with no Organization rather than treating it as anonymous', async () => {
    const { policy, permitted } = policyWith({});
    expect(await policy.decide({ kind: 'customer', organizationId: '' }, open)).toEqual({
      ok: false,
      code: 'SALES_CHANNEL_NOT_PERMITTED',
    });
    expect(permitted).not.toHaveBeenCalled();
  });

  it('decides an impersonated customer exactly as the customer', async () => {
    const { policy } = policyWith({ [ORG]: ['ch-closed'] });
    const impersonated = {
      kind: 'customer',
      organizationId: ORG,
      impersonatorAdminUserId: '00000000-0000-4000-8000-0000000000b1',
    } as const;
    expect(await policy.decide(impersonated, open)).toEqual({
      ok: false,
      code: 'SALES_CHANNEL_NOT_PERMITTED',
    });
    expect(await policy.decide(impersonated, closed)).toEqual({ ok: true });
  });
});

describe('SalesChannelAccessPolicy.assertCustomerMayUse', () => {
  it('passes for an assigned channel', async () => {
    const { policy } = policyWith({ [ORG]: ['ch-closed'] });
    await expect(policy.assertCustomerMayUse(ORG, 'ch-closed')).resolves.toBeUndefined();
  });

  it('throws 403 SALES_CHANNEL_NOT_PERMITTED naming the channel code', async () => {
    const { policy } = policyWith({ [ORG]: ['ch-closed'] });
    const error = await policy.assertCustomerMayUse(ORG, 'ch-open').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
      details: { channelCode: 'retail' },
    });
  });

  it('throws for a missing Organization', async () => {
    const { policy } = policyWith({});
    await expect(policy.assertCustomerMayUse(null, 'ch-open')).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
    });
  });
});
