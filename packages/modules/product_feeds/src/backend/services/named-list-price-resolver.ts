/**
 * Reading a **named** price list, through the port that owns it (issue #132).
 *
 * A feed pinned to a price list uses that list verbatim (FR-020) — no rule
 * evaluation, no fall-through. That read used to be a `select` against
 * `price_list_price_brackets` issued from this module, which put another
 * module's table in this module's SQL (Principle I) and, worse, bypassed the
 * gate on its registration: a feed could publish prices while the platform was
 * refusing to serve them, because nothing on the path could raise
 * `MODULE_DISABLED`.
 *
 * Nothing here catches. A switched-off `price_lists` must reach the feed run
 * and fail it; swallowing that is how fail-closed turns into fail-open.
 */

/** The slice of the `pricingService` port a named-list read needs. */
export interface NamedListPricePort {
  namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
    /** Feature 160 — the feed's channel, whose catalogue price a book's rows are taken off. */
    salesChannelId?: string;
  }): Promise<Map<string, string>>;
}

export interface NamedListPriceResolvers {
  /**
   * One product's amount on the list — the decimal string `price_lists`
   * answers with — or `null` when the list does not price it.
   */
  one(input: {
    priceListId: string;
    productId: string;
    currencyCode: string;
    salesChannelId?: string;
  }): Promise<string | null>;
  /** The same read for a batch; unpriced products are absent from the map. */
  many(input: {
    priceListId: string;
    productIds: readonly string[];
    currencyCode: string;
    salesChannelId?: string;
  }): Promise<Map<string, string>>;
}

export function createNamedListPriceResolver(
  pricing: NamedListPricePort,
): NamedListPriceResolvers {
  async function many(input: {
    priceListId: string;
    productIds: readonly string[];
    currencyCode: string;
    salesChannelId?: string;
  }): Promise<Map<string, string>> {
    if (input.productIds.length === 0) return new Map();
    // The decimal strings verbatim (review 2, finding 1 of release 0.108.0): a
    // feed rounds them with the decimal helpers, never as a JS number. A list
    // amount of `0` is a price, so nothing here tests one for truthiness.
    return pricing.namedListPrices({
      priceListId: input.priceListId,
      currencyCode: input.currencyCode,
      productIds: input.productIds,
      ...(input.salesChannelId ? { salesChannelId: input.salesChannelId } : {}),
    });
  }

  return {
    many,
    async one(input) {
      const amounts = await many({
        priceListId: input.priceListId,
        productIds: [input.productId],
        currencyCode: input.currencyCode,
        ...(input.salesChannelId ? { salesChannelId: input.salesChannelId } : {}),
      });
      const amount = amounts.get(input.productId);
      return amount === undefined ? null : amount;
    },
  };
}
