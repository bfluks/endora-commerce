import type { EntityManager } from '@mikro-orm/postgresql';
import { displayModeWithholdsAmounts } from '@endora-commerce/contracts';
import type {
  CatalogBulkPriceLine,
  CatalogProductAvailabilityPort,
  LinePriceResult,
  LinePricesPort,
  OrgLinePricePort,
  OrganizationDetailsPort,
  OrganizationRecord,
  ProductAudience,
  ProductAvailability,
  ProductDetail,
  ProductPriceTier,
  ProductSummary,
} from '@endora-commerce/contracts';
import { Product } from '../entities/product.entity.js';


/**
 * Feature 062 (research §R7) — pricing/availability decoration for the
 * external catalog namespace (`/api/v1/external/catalog/*`).
 *
 * Thin decoration ONLY: query logic stays in `CatalogQueryService`, price
 * resolution stays in `PricingService` (the exact resolver cart pricing
 * uses — SC-001 parity by construction). This service:
 *
 *  - for BOUND keys, replaces the summary/detail `price` with the bound
 *    Organization's effective unit price at quantity 1, sets the
 *    `priceUnavailable` marker, and (detail only) derives the org's
 *    quantity-bracket `priceTiers` ladder by probing the resolver at each
 *    bracket start quantity;
 *  - for ANY key, attaches the channel-public `availability` indication via
 *    the injected inventory port;
 *  - answers the bound-only bulk `(sku, quantity)` pricing request with
 *    per-line results (misses are data, not errors).
 *
 * Issue #491 — a line answer keeps its amount under display mode `none` (it is
 * the charging path), so this decorator, which **publishes** line amounts, asks
 * `displayModeWithholdsAmounts` first: a product whose display mode is `none`
 * for the bound Organization gets no price, no tier ladder and no bulk price —
 * `priceUnavailable` / `price_unavailable`, as a product nothing prices.
 */

/** A resolved line the caller may be shown, or `null` (nothing prices it, or its display mode withholds it). */
function shown(resolved: LinePriceResult | null | undefined): LinePriceResult | null {
  return resolved && !displayModeWithholdsAmounts(resolved.displayMode) ? resolved : null;
}

/** The request's resolved sales channel — only `id` + `defaultCurrency` are read. */
export interface ExternalPricingChannel {
  id: string;
  defaultCurrency: string;
}

export type ResolveAvailabilityPort = (
  productIds: string[],
  salesChannelId: string,
) => Promise<Map<string, ProductAvailability>>;

export interface CatalogOrgPriceDecoratorDeps {
  emFactory: () => EntityManager;
  /**
   * Feature 075 — the published line-pricing port, where
   * `price_lists`' `PricingServiceContract` used to be. This decorator calls
   * two of its methods. `OrgLinePricePort` — `LinePricePort` plus the bracket
   * ladder — was published in this cut, because `PricingServiceContract` is
   * deliberately not in `@endora-commerce/contracts` (it is the overlay decoration's
   * contract gate) and was `listBracketMinQuantities`' (now `listTierStarts`) only declaration.
   *
   * D-287 P0 — and `LinePricesPort`, named beside it rather than folded into
   * it: summaries, bulk lines and the tier ladder are each priced in one
   * `resolveLinePrices` call.
   */
  pricingService: OrgLinePricePort & LinePricesPort;
  /**
   * Feature 075 — the buying organisation, read through `organizations`' port
   * instead of `em.findOne(Organization, …)` against its table. The engine
   * reads two fields off it (the id, and the customer group a rule keys on),
   * and `OrganizationRecord` carries both.
   */
  organizations: OrganizationDetailsPort;
  /** Optional inventory port — when absent, `availability` is omitted. */
  resolveAvailability?: ResolveAvailabilityPort;
  /**
   * Feature 163 (owner decision W5 = A) — `catalogProductAvailabilityPort`:
   * the bulk-price probe prices only a product available to the bound
   * organisation at the key's channel (its default language) now. Membership
   * of the channel goes through the kernel's accessor inside it (issue #185,
   * Constitution XII), so it replaces the membership-only check.
   */
  availability: Pick<CatalogProductAvailabilityPort, 'filterAvailable'>;
}

export class CatalogOrgPriceDecorator {
  constructor(private readonly deps: CatalogOrgPriceDecoratorDeps) {}

  /**
   * Decorates list summaries in place-order: availability for every caller,
   * org-effective qty-1 price + `priceUnavailable` for bound callers.
   */
  async decorateSummaries(
    summaries: ProductSummary[],
    context: { organizationId: string | null; salesChannel: ExternalPricingChannel },
  ): Promise<ProductSummary[]> {
    if (summaries.length === 0) return summaries;
    const availabilityByProduct = await this.#resolveAvailability(
      summaries.map((s) => s.id),
      context.salesChannel.id,
    );

    if (context.organizationId === null) {
      return summaries.map((summary) => this.#withAvailability(summary, availabilityByProduct));
    }

    const em = this.deps.emFactory();
    const organization = await this.deps.organizations.findById(context.organizationId);
    const products = await em.find(Product, { id: { $in: summaries.map((s) => s.id) } });
    const productById = new Map(products.map((p) => [p.id, p]));

    // D-287 P0 — one batched resolution for the page; it was one sequential
    // `resolveLinePrice` per summary.
    const priced = await this.deps.pricingService.resolveLinePrices({
      lines: summaries.flatMap((summary, index) => {
        const product = productById.get(summary.id);
        return product ? [{ key: String(index), product, quantity: 1 }] : [];
      }),
      context: { organization, salesChannel: context.salesChannel },
    });

    const out: ProductSummary[] = [];
    for (const [index, summary] of summaries.entries()) {
      const decorated = this.#withAvailability(summary, availabilityByProduct);
      const product = productById.get(summary.id);
      if (!product) {
        out.push({ ...decorated, price: null, priceUnavailable: true });
        continue;
      }
      const resolved = shown(priced.get(String(index)));
      out.push(
        resolved
          ? {
              ...decorated,
              price: { amount: Number(resolved.amount), currency: resolved.currency },
            }
          : { ...decorated, price: null, priceUnavailable: true },
      );
    }
    return out;
  }

  /**
   * Detail decoration = summary decoration + (bound only) the org's resolved
   * bracket ladder.
   */
  async decorateDetail(
    detail: ProductDetail,
    context: { organizationId: string | null; salesChannel: ExternalPricingChannel },
  ): Promise<ProductDetail> {
    const [decorated] = await this.decorateSummaries([detail], context);
    const merged = { ...detail, ...decorated } as ProductDetail;
    if (context.organizationId === null) return merged;

    const em = this.deps.emFactory();
    const organization = await this.deps.organizations.findById(context.organizationId);
    const product = await em.findOne(Product, { id: detail.id });
    if (!product) return merged;
    const priceTiers = await this.#resolvePriceTiers(product, organization, context.salesChannel);
    return { ...merged, priceTiers };
  }

  /**
   * Bound-only bulk pricing: per-line, order-preserving. A SKU outside the
   * bound channel's published assortment (or unknown / inactive / deleted)
   * is indistinguishable from non-existence (`sku_not_in_assortment`); an
   * in-assortment SKU with no resolvable bracket is `price_unavailable`.
   */
  async resolveBulkPrices(
    lines: Array<{ sku: string; quantity: number }>,
    context: {
      organizationId: string;
      salesChannel: ExternalPricingChannel;
      /**
       * Feature 163 (W5) — who is asking, from the request's resolved actor
       * (`productAudienceOf`): the availability question is asked for it.
       */
      audience: ProductAudience;
    },
  ): Promise<CatalogBulkPriceLine[]> {
    const em = this.deps.emFactory();
    const organization = await this.deps.organizations.findById(context.organizationId);

    const skus = Array.from(new Set(lines.map((l) => l.sku)));
    // Feature 163 (W5 = A) — the status is the effective one at the channel,
    // so it is the availability rule's to decide, not a global filter here.
    const products = await em.find(Product, {
      sku: { $in: skus },
      deletedAt: null,
    });
    const productBySku = new Map(products.map((p) => [p.sku, p]));
    const assortment = await this.#availableTo(
      products.map((p) => p.id),
      context.salesChannel.id,
      context.audience,
    );

    // D-287 P0 — every in-assortment line in one batched resolution, each at
    // its own quantity; it was one sequential `resolveLinePrice` per line.
    const priced = await this.deps.pricingService.resolveLinePrices({
      lines: lines.flatMap((line, index) => {
        const product = productBySku.get(line.sku);
        return product && assortment.has(product.id)
          ? [{ key: String(index), product, quantity: line.quantity }]
          : [];
      }),
      context: { organization, salesChannel: context.salesChannel },
    });

    const out: CatalogBulkPriceLine[] = [];
    for (const [index, line] of lines.entries()) {
      const product = productBySku.get(line.sku);
      if (!product || !assortment.has(product.id)) {
        out.push({
          sku: line.sku,
          quantity: line.quantity,
          price: null,
          reason: 'sku_not_in_assortment',
        });
        continue;
      }
      const resolved = shown(priced.get(String(index)));
      if (!resolved) {
        out.push({
          sku: line.sku,
          quantity: line.quantity,
          price: null,
          reason: 'price_unavailable',
        });
        continue;
      }
      out.push({
        sku: line.sku,
        quantity: line.quantity,
        price: {
          amount: resolved.amount,
          currency: resolved.currency,
          isSale: resolved.isSale,
          bracketStartQuantity: resolved.bracketStartQuantity,
          priceListId: resolved.priceListId,
        },
      });
    }
    return out;
  }

  /**
   * The org's effective ladder: probe the resolver at every bracket start
   * quantity known for the (product, currency) across active lists, then
   * drop consecutive rungs that resolve identically (a non-matching list's
   * boundary changes nothing for this org — no cross-org leak).
   */
  async #resolvePriceTiers(
    product: Product,
    organization: OrganizationRecord | null,
    salesChannel: ExternalPricingChannel,
  ): Promise<ProductPriceTier[]> {
    const currencyCode = salesChannel.defaultCurrency.toUpperCase();
    const minQuantities = await this.deps.pricingService.listTierStarts(
      product.id,
      currencyCode,
    );
    const probeQuantities = Array.from(new Set([1, ...minQuantities])).sort((a, b) => a - b);

    // D-287 P0 — every rung in one batched resolution; it was one sequential
    // `resolveLinePrice` per probe quantity.
    const priced = await this.deps.pricingService.resolveLinePrices({
      lines: probeQuantities.map((quantity) => ({ key: String(quantity), product, quantity })),
      context: { organization, salesChannel },
    });

    const tiers: ProductPriceTier[] = [];
    for (const quantity of probeQuantities) {
      const resolved = shown(priced.get(String(quantity)));
      if (!resolved) continue;
      const tier: ProductPriceTier = {
        minQuantity: quantity,
        amount: Number(resolved.amount),
        currency: resolved.currency,
        isSale: resolved.isSale,
      };
      const previous = tiers[tiers.length - 1];
      if (previous && previous.amount === tier.amount && previous.isSale === tier.isSale) {
        continue;
      }
      tiers.push(tier);
    }
    return tiers;
  }

  async #resolveAvailability(
    productIds: string[],
    salesChannelId: string,
  ): Promise<Map<string, ProductAvailability>> {
    // D-61 — no `catch` here. `inventory` being absent is *decided* by the
    // contribution, in front of the gate, and arrives as the empty map this
    // method already returns when nothing is wired; the manifest declares that
    // degrade as `degrades-without`. What a `catch` would add is the ability to
    // turn a genuine inventory failure into a silently unpriced band.
    if (!this.deps.resolveAvailability) return new Map();
    return this.deps.resolveAvailability(productIds, salesChannelId);
  }

  #withAvailability(
    summary: ProductSummary,
    availabilityByProduct: Map<string, ProductAvailability>,
  ): ProductSummary {
    const availability = availabilityByProduct.get(summary.id);
    return availability ? { ...summary, availability } : summary;
  }

  /**
   * Feature 163 (W5 = A) — the products available to the caller at the
   * channel now: published there, effectively on in the channel's default
   * language (an API call carries no storefront language), inside the window,
   * admitted by the channel's audience rule. An id left out is answered as an
   * SKU outside the assortment — one answer for every reason. It replaces the
   * membership-only check (issue #185), which the port asks through the same
   * accessor.
   */
  async #availableTo(
    productIds: string[],
    salesChannelId: string,
    audience: ProductAudience,
  ): Promise<ReadonlySet<string>> {
    if (productIds.length === 0) return new Set();
    return this.deps.availability.filterAvailable(productIds, {
      channelId: salesChannelId,
      languageCode: null,
      audience,
    });
  }
}
