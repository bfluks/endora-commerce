import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type {
  SalesChannelAccessActor,
  SalesChannelAccessDecision,
  SalesChannelAccessPort,
} from '../ports/sales-channel.js';
import type { CachedChannel } from './sales-channels-cache.js';

/**
 * SalesChannelAccessPolicy — the one statement of the sales-channel access rule
 * (`specs/154-sales-channel-access/` research R-3, `contracts/channel-access-rule.md` §2).
 *
 * | actor                        | admitted when                                         | refusal                          |
 * | ---------------------------- | ----------------------------------------------------- | -------------------------------- |
 * | anonymous                    | the channel is open to anonymous visitors             | `SALES_CHANNEL_SIGN_IN_REQUIRED` |
 * | customer (and impersonation) | the channel is assigned to the customer's Organization | `SALES_CHANNEL_NOT_PERMITTED`    |
 *
 * Administrators and API keys never reach it (D5). A customer with no
 * Organization is a data inconsistency and is refused, never treated as
 * anonymous (Principle XI forbids a no-organization path). An anonymous decision
 * reads nothing: the flag rides on the cached channel (FR-035).
 */

type ChannelFacts = Pick<CachedChannel, 'id' | 'code' | 'anonymousAccess'>;

export interface PermittedChannelIdsSource {
  permittedChannelIds(organizationId: string): Promise<ReadonlySet<string>>;
}

export class SalesChannelAccessPolicy implements SalesChannelAccessPort {
  constructor(
    private readonly source: PermittedChannelIdsSource,
    /** Looks a channel up by id, for the code a sign-in refusal names. */
    private readonly channelById: (id: string) => Promise<ChannelFacts | null>,
  ) {}

  permittedChannelIds(organizationId: string): Promise<ReadonlySet<string>> {
    return this.source.permittedChannelIds(organizationId);
  }

  async decide(
    actor: SalesChannelAccessActor,
    channel: ChannelFacts,
  ): Promise<SalesChannelAccessDecision> {
    if (actor.kind === 'anonymous') {
      return channel.anonymousAccess
        ? { ok: true }
        : { ok: false, code: ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED };
    }
    if (actor.organizationId === '') {
      return { ok: false, code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED };
    }
    const permitted = await this.source.permittedChannelIds(actor.organizationId);
    return permitted.has(channel.id)
      ? { ok: true }
      : { ok: false, code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED };
  }

  async assertCustomerMayUse(organizationId: string | null, channelId: string): Promise<void> {
    const channel = await this.channelById(channelId);
    const facts: ChannelFacts = channel ?? {
      id: channelId,
      code: channelId,
      anonymousAccess: false,
    };
    const decision = await this.decide(
      { kind: 'customer', organizationId: organizationId ?? '' },
      facts,
    );
    if (!decision.ok) throw salesChannelAccessRefusal(decision.code, facts.code);
  }
}

/**
 * The refusal of `contracts/channel-access-rule.md` §3: 403, the code, and the
 * channel code in `details`. The message is the English fallback; the error
 * envelope translates it from the `sales_channels` bundle.
 */
export function salesChannelAccessRefusal(
  code: 'SALES_CHANNEL_SIGN_IN_REQUIRED' | 'SALES_CHANNEL_NOT_PERMITTED',
  channelCode: string,
): HttpError {
  const message =
    code === ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED
      ? 'This store is available to signed-in customers only. Please sign in.'
      : 'This account does not have access to this store.';
  return new HttpError(403, ERROR_CODES[code], message, { channelCode });
}
