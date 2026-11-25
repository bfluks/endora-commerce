/**
 * Spec 193 T023 — the scheduling seam of the catalogue-price flags (research R-5): a
 * designation set or cleared asks for a whole rebuild of its currency. The flags worker that
 * consumes it is Phase 4's (T026 – T030); until then the request is recorded in the log only.
 * A rebuild request is idempotent per currency — asking twice builds once.
 */
export interface CataloguePriceFlagsScheduler {
  requestCurrencyRebuild(currencyCode: string): Promise<void>;
}

/** The Phase 3 scheduler: no worker consumes a rebuild yet, so it is logged and dropped. */
export function loggingFlagsScheduler(log: { info(obj: object, msg: string): void }): CataloguePriceFlagsScheduler {
  return {
    async requestCurrencyRebuild(currencyCode) {
      log.info({ currencyCode }, 'product_visibility_rules: catalogue-price flag rebuild requested (consumed from Phase 4 on)');
    },
  };
}
