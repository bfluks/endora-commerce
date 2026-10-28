import { CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS as TAGS } from '@endora-commerce/contracts';

/** At most this many tags in one call to the storefront's revalidate endpoint. */
const TAGS_PER_CALL = 200;

export interface ProductPageRevalidationDeps {
  /** The storefront revalidator (`StorefrontRevalidator`): a no-op while it is not configured. */
  revalidator: { readonly enabled: boolean; revalidate(tags: string[]): Promise<void> };
  /** Every key a product page may have been asked by besides the id: slug, URL keys, former keys. */
  keysOf: (productIds: readonly string[]) => Promise<string[]>;
  log?: { warn: (obj: unknown, msg: string) => void };
  /** When a batch is sent; the default is the next turn of the event loop. */
  schedule?: (run: () => void) => void;
}

/**
 * Feature 163 (T155 finding CACHE-1) — drops the storefront's cached product-page
 * reads of a product after a committed write that can change whether or where it is
 * available: status at any scope, publication window, audience, archive and restore,
 * URL keys, channel membership, and every bulk path that does one of those.
 *
 * The storefront tags each product-page read with the key it was asked by
 * (`CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS.productKey`): the URL key or slug of the
 * resolve, the product id of the detail. So a product's tags are its id, its slug, its
 * URL keys and its former keys (a changed key's old spelling stays as a redirect row).
 * A deleted product's keys are gone with it, so its removal drops the shared tag.
 *
 * Coalesced per turn of the event loop — a bulk operation announces every product it
 * touched and the storefront is asked once — and best-effort: a key read or a call that
 * fails is logged, and never reaches the write that announced it.
 */
export class ProductPageRevalidation {
  readonly #pending = new Set<string>();
  #removed = false;
  #scheduled = false;
  #inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ProductPageRevalidationDeps) {}

  /** A committed write changed what the product's page may answer. */
  productChanged(productId: string): void {
    if (!this.deps.revalidator.enabled) return;
    this.#pending.add(productId);
    this.#schedule();
  }

  /** A product was deleted. */
  productRemoved(): void {
    if (!this.deps.revalidator.enabled) return;
    this.#removed = true;
    this.#schedule();
  }

  /** Resolves once every batch scheduled so far has been sent. */
  idle(): Promise<void> {
    return this.#inFlight;
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    const schedule = this.deps.schedule ?? ((run: () => void): void => void setImmediate(run));
    schedule(() => {
      this.#scheduled = false;
      const ids = [...this.#pending];
      const removed = this.#removed;
      this.#pending.clear();
      this.#removed = false;
      this.#inFlight = this.#inFlight.then(() => this.#send(ids, removed));
    });
  }

  async #send(ids: string[], removed: boolean): Promise<void> {
    const keys = new Set<string>(ids);
    if (ids.length > 0) {
      try {
        for (const key of await this.deps.keysOf(ids)) keys.add(key);
      } catch (err) {
        this.deps.log?.warn({ err, productIds: ids }, '[catalog] product page revalidation: the keys could not be read');
      }
    }
    const tags = [...keys].map(TAGS.productKey).filter((tag) => tag.length <= TAGS.maxLength);
    if (removed) tags.push(TAGS.product);
    for (let i = 0; i < tags.length; i += TAGS_PER_CALL) {
      try {
        await this.deps.revalidator.revalidate(tags.slice(i, i + TAGS_PER_CALL));
      } catch (err) {
        this.deps.log?.warn({ err }, '[catalog] product page revalidation failed');
      }
    }
  }
}
