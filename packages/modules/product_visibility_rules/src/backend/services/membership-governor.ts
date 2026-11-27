import type { EntityManager } from '@mikro-orm/postgresql';
import { PRODUCT_VISIBILITY_MODULE_ID, isUuidShape } from '@endora-commerce/contracts';
import type {
  ChannelMembershipGovernance,
  ChannelMembershipGovernor,
  ChannelMembershipGovernorRegistryPort,
  GovernorWriteToken,
} from '@endora-commerce/platform/kernel';

/**
 * The website rule's channel-membership governor (research R-10, contracts/ports.md
 * §5, threat model TM-10).
 *
 * A channel is governed while it has a `website_rule_attachments` row; the refusal names the
 * attached rule. `governs` runs on the mutation's own manager and inside its transaction, as one
 * statement on the connection — not through the unit of work, so asking never flushes or
 * registers anything in the caller's manager — and it caches nothing: an attach or detach is
 * effective on the next write in every process. A failed read propagates, so the kernel refuses
 * the write rather than reading it as "not governed".
 */
export function websiteRuleMembershipGovernor(): ChannelMembershipGovernor {
  return {
    moduleId: PRODUCT_VISIBILITY_MODULE_ID,
    entityTypes: ['product'],
    async governs(em: EntityManager, channelId: string): Promise<ChannelMembershipGovernance | null> {
      // No channel carries such an id, and a `uuid` cast of it would abort the caller's transaction.
      if (!isUuidShape(channelId)) return null;
      const rows = await em
        .getConnection()
        .execute<Array<{ name: string }>>(
          `select r."name" from "website_rule_attachments" a ` +
            `join "product_rules" r on r."id" = a."product_rule_id" ` +
            `where a."sales_channel_id" = ?`,
          [channelId],
          'all',
          em.getTransactionContext(),
        );
      return rows.length > 0 ? { ruleLabel: rows[0]!.name } : null;
    },
  };
}

/**
 * Holds the governor's write token (TM-10). One per composition, created inside the module's
 * `registerModule` closure and handed to the website-rule service by that closure — never placed
 * in the container, never at module scope (a process composing the platform twice gets two
 * registries and two tokens). The token sits in a private field, so nothing enumerates or
 * serialises it.
 */
export class WebsiteRuleGovernorHandle {
  #token: GovernorWriteToken | undefined;

  /** Boot-time: contribute the governor and keep the token the registry issued. */
  register(registry: ChannelMembershipGovernorRegistryPort): void {
    if (this.#token !== undefined) {
      throw new Error('[product_visibility_rules] the website rule governor is already registered.');
    }
    this.#token = registry.register(websiteRuleMembershipGovernor());
  }

  /** The write token; throws before boot registered the governor, so no write goes out unsigned. */
  token(): GovernorWriteToken {
    if (this.#token === undefined) {
      throw new Error('[product_visibility_rules] the website rule governor is not registered — no write token yet.');
    }
    return this.#token;
  }
}
