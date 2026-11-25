import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogueDesignation,
  CatalogueReferenceLine,
  CatalogueReferencePricePort,
  DesignationStatus,
} from '@endora-commerce/contracts';
import type { BookPricing } from './book-pricing.js';
import type { PricedProductRef } from './pricing-service.interface.js';

/**
 * The sequence a pricing-generation bump moves after commit (spec 193, TM-7 (5)): a
 * durable, monotonic watermark of "a price may have moved", read by a consumer that polls
 * for an announcement it may have missed. `price_lists`' own schema object.
 */
export const CATALOGUE_CHANGE_SEQUENCE = 'price_lists_catalogue_change_seq';

/** The resolve batch: one listing read of the variants and one resolution per chunk. */
const RESOLVE_CHUNK = 500;

export interface CatalogueReferencePriceDeps {
  emFactory: () => EntityManager;
  books: () => BookPricing;
  /** `catalog`'s pricing references (id + attribute values), through its read port. */
  productsByIds: (ids: readonly string[]) => Promise<PricedProductRef[]>;
  /** A book's channel set, through the membership accessor (Principle XII). */
  bookChannels: (bookId: string) => Promise<readonly string[]>;
}

/**
 * `catalogueReferencePricePort` — spec 193 (`specs/193-product-visibility-rules/`
 * contracts/ports.md §3, research R-4). The catalogue price of a product in one currency,
 * from {@link BookPricing.catalogueReference} (the engine's own resolver: no second one,
 * FR-006); the designation's in-force state from {@link BookPricing.designationStatuses};
 * the books a currency may designate; and the change watermark.
 */
export class CatalogueReferencePriceService implements CatalogueReferencePricePort {
  constructor(private readonly deps: CatalogueReferencePriceDeps) {}

  async resolve(input: {
    currencyCode: string;
    designation: CatalogueDesignation | null;
    productIds: readonly string[];
  }): Promise<ReadonlyMap<string, ReadonlyArray<CatalogueReferenceLine>>> {
    const out = new Map<string, ReadonlyArray<CatalogueReferenceLine>>();
    const ids = [...new Set(input.productIds)];
    for (let i = 0; i < ids.length; i += RESOLVE_CHUNK) {
      const products = await this.deps.productsByIds(ids.slice(i, i + RESOLVE_CHUNK));
      const answers = await this.deps.books().catalogueReference({
        currencyCode: input.currencyCode,
        designation: input.designation,
        products,
      });
      for (const [productId, lines] of answers) out.set(productId, lines);
    }
    return out;
  }

  async designationStatus(input: { currencyCode: string } & CatalogueDesignation): Promise<DesignationStatus> {
    const [status] = await this.designationStatuses([input]);
    return status!;
  }

  designationStatuses(
    input: ReadonlyArray<{ currencyCode: string } & CatalogueDesignation>,
  ): Promise<ReadonlyArray<DesignationStatus>> {
    return this.deps.books().designationStatuses(input);
  }

  async changeWatermark(): Promise<string> {
    const [row] = await this.deps
      .emFactory()
      .execute<Array<{ last_value: string | number; is_called: boolean }>>(
        `select "last_value", "is_called" from "${CATALOGUE_CHANGE_SEQUENCE}"`,
      );
    // `is_called` false: nothing has moved it since it was created.
    return row && row.is_called ? String(row.last_value) : '0';
  }

  async designatableBooks(
    currencyCode: string,
  ): Promise<ReadonlyArray<{ priceListId: string; name: string; salesChannelIds: string[] }>> {
    const rows = await this.deps.emFactory().execute<Array<{ id: string; name: string }>>(
      `select "id", "name" from "price_lists"
        where "currency_code" = ? and "is_system" = false and "type" = 'regular' and "audience_kind" = 'everyone'
        order by "name", "id"`,
      [currencyCode.toUpperCase()],
    );
    const out: Array<{ priceListId: string; name: string; salesChannelIds: string[] }> = [];
    for (const row of rows) {
      out.push({ priceListId: row.id, name: row.name, salesChannelIds: [...(await this.deps.bookChannels(row.id))] });
    }
    return out;
  }
}

/**
 * Move the change watermark — once per bump, by the writer, after commit. Best effort, like
 * the bump: the write has already committed; a lost move is bounded by the consumer's
 * nightly reconcile.
 */
export async function advanceCatalogueChangeWatermark(em: EntityManager): Promise<void> {
  await em.execute(`select nextval('${CATALOGUE_CHANGE_SEQUENCE}')`);
}
