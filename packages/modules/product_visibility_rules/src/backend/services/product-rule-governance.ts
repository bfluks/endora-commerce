import type { CatalogProductReadPort, ProductRuleGovernancePort } from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { isLive } from './product-rule-evaluator.js';
import type { WebsiteRuleService } from './website-rule.service.js';

/**
 * `productRuleGovernancePort` — spec 193 T060 (FR-055, FR-090, FR-091; contracts/ports.md §2,
 * research R-18). Published with `ctx.di.providePort`, so it answers 503 `MODULE_DISABLED` while
 * the module is off; a connector probing presence first reads absent as "nothing governed",
 * which is what the kernel does too.
 *
 * Built from this module's own tables (through the website-rule service), the membership port
 * and catalog's read port — no foreign SQL.
 *
 * `excludedOnlyByRule` needs the product's **stored channel status** (scope level `channel`,
 * owner N1). No catalog port reads that cell yet (it belongs to the gated sales-team phase,
 * 9b); until a reader is composed through {@link ProductRuleGovernanceDeps.channelStatuses} the
 * method fails closed — every ref `false`, so no sales-team path admits a rule-excluded product
 * on this answer.
 */
export type StoredChannelStatus = 'active' | 'inactive' | null;

export interface ProductRuleGovernanceDeps {
  readonly rules: Pick<WebsiteRuleService, 'governedChannels' | 'meetsRule'>;
  readonly membership: () => Pick<SalesChannelMembershipPort, 'filterEntityIdsInChannel'>;
  readonly products: () => Pick<CatalogProductReadPort, 'findByIds'>;
  /** Stored channel status per product on the channel (`null` = inherit / none). Absent ⇒ fail closed. */
  readonly channelStatuses?: (salesChannelId: string, productIds: readonly string[]) => Promise<ReadonlyMap<string, StoredChannelStatus>>;
}

export class ProductRuleGovernance implements ProductRuleGovernancePort {
  constructor(private readonly deps: ProductRuleGovernanceDeps) {}

  async governedChannels(): Promise<ReadonlyArray<{ salesChannelId: string; productRuleId: string; productRuleName: string }>> {
    return (await this.deps.rules.governedChannels()).map((g) => ({
      salesChannelId: g.salesChannelId,
      productRuleId: g.productRuleId,
      productRuleName: g.productRuleName,
    }));
  }

  meetsRule(salesChannelId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, boolean> | null> {
    return this.deps.rules.meetsRule(salesChannelId, productIds);
  }

  async excludedOnlyByRule(
    salesChannelId: string,
    refs: ReadonlyArray<{ productId: string; variantId?: string | null }>,
  ): Promise<ReadonlyArray<boolean>> {
    const none = refs.map(() => false);
    if (refs.length === 0 || this.deps.channelStatuses === undefined) return none;
    const governed = (await this.deps.rules.governedChannels()).some((g) => g.salesChannelId === salesChannelId);
    if (!governed) return none;
    const ids = [...new Set(refs.map((r) => r.productId))];
    const [products, members, statuses] = await Promise.all([
      this.deps.products().findByIds(ids),
      this.deps.membership().filterEntityIdsInChannel(salesChannelId, 'product', ids),
      this.deps.channelStatuses(salesChannelId, ids),
    ]);
    const live = new Set(
      products.filter((p) => isLive({ status: p.status, archived: p.archivedAt !== null, deleted: p.deletedAt !== null })).map((p) => p.id),
    );
    const memberSet = new Set(members);
    return refs.map((r) => live.has(r.productId) && !memberSet.has(r.productId) && statuses.get(r.productId) !== 'inactive');
  }
}
