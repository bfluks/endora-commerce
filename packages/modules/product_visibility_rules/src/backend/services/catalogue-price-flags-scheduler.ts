/**
 * The scheduling seam of the catalogue-price flags (research R-5): a
 * designation set or cleared asks for a whole rebuild of its currency. Composed in `index.ts`
 * as a durable request (`CataloguePriceFlags.requestRebuild`) plus a coalesced pass; asking
 * twice builds once.
 */
export interface CataloguePriceFlagsScheduler {
  requestCurrencyRebuild(currencyCode: string): Promise<void>;
}
