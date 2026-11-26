import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogueDesignation, CatalogueReferenceLine, CatalogueReferencePricePort } from '@endora-commerce/contracts';

/**
 * The catalogue-price flags — spec 193 (`specs/193-product-visibility-rules/` data-model §2,
 * research R-5, R-17; threat model TM-7, TM-12).
 *
 * Per currency, `product_catalogue_prices` / `variant_catalogue_prices` hold a row for every
 * product / variant that has a catalogue price (0 included), with `has_positive`, keyed by a
 * **generation**. Every admin read uses the currency's `served_generation`; a whole rebuild
 * writes `served + 1` beside it and swaps only after it is complete. Flags come only from
 * `catalogueReferencePricePort.resolve` — the engine (FR-006) — never from an event payload.
 *
 * The work is driven by durable state, so it is idempotent and a lost queue job loses nothing:
 *
 * - `catalogue_price_generations.whole_stale` asks for a whole rebuild of the currency;
 * - `catalogue_price_stale_products` asks for a targeted refresh of one product.
 *
 * {@link CataloguePriceFlags.runPass} does both, and is what the worker runs.
 */

/** Products per `resolve` call of a whole build (R-5). */
export const BUILD_BATCH = 1_000;
/** Marks per targeted refresh transaction (R-5). */
export const REFRESH_BATCH = 500;

export interface CataloguePriceFlagsDeps {
  readonly emFactory: () => EntityManager;
  readonly prices: () => Pick<CatalogueReferencePricePort, 'resolve' | 'changeWatermark'>;
  /** Every product id of the catalogue, through `catalog`'s read port. */
  readonly listProductIds: () => Promise<readonly string[]>;
  /** Active currency codes, through `currencies`' read port — the bootstrap set (T031). */
  readonly activeCurrencies: () => Promise<readonly string[]>;
  readonly now?: () => Date;
}

interface GenerationRow {
  currency_code: string;
  served_generation: number;
  building_generation: number | null;
  built_for_price_list_id: string | null;
  built_for_sales_channel_id: string | null;
  whole_stale: boolean;
}

function lineFacts(lines: ReadonlyArray<CatalogueReferenceLine>): { priced: boolean; positive: boolean } {
  const amounts = lines.filter((l) => l.amount !== null).map((l) => Number(l.amount));
  return { priced: amounts.length > 0, positive: amounts.some((a) => a > 0) };
}

function uuidArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}

export class CataloguePriceFlags {
  constructor(private readonly deps: CataloguePriceFlagsDeps) {}

  #em(): EntityManager {
    return this.deps.emFactory();
  }

  /**
   * Ask for a whole rebuild of each currency (a designation change, a catalogue-wide price
   * change, the nightly reconcile). A currency never built gets its row, served generation 0:
   * until its first build swaps in, its conditions are not met (fail-closed, T031).
   */
  async requestRebuild(currencyCodes: readonly string[]): Promise<void> {
    const codes = [...new Set(currencyCodes.map((c) => c.toUpperCase()))];
    if (codes.length === 0) return;
    await this.#em().execute(
      `insert into "catalogue_price_generations" ("currency_code", "served_generation", "whole_stale")
       select c, 0, true from unnest(?::text[]) as c
       on conflict ("currency_code") do update set "whole_stale" = true`,
      [uuidArray(codes)],
    );
  }

  /** Every currency that has flags or asked for them. */
  async trackedCurrencies(): Promise<string[]> {
    const rows = await this.#em().execute<Array<{ currency_code: string }>>(
      `select "currency_code" from "catalogue_price_generations" order by "currency_code"`,
    );
    return rows.map((r) => r.currency_code.trim());
  }

  /**
   * Targeted refresh marks (TM-7 (1)): a mark already there takes the newer time, so a refresh
   * that read before this change cannot clear it. Written before the caller returns (TM-7 (5)).
   */
  async markProducts(currencyCodes: readonly string[], productIds: readonly string[]): Promise<void> {
    const codes = [...new Set(currencyCodes.map((c) => c.toUpperCase()))];
    const ids = [...new Set(productIds)];
    if (codes.length === 0 || ids.length === 0) return;
    await this.#em().execute(
      `insert into "catalogue_price_stale_products" ("currency_code", "product_id", "marked_at")
       select c, p, clock_timestamp() from unnest(?::text[]) as c cross join unnest(?::uuid[]) as p
       on conflict ("currency_code", "product_id") do update set "marked_at" = excluded."marked_at"`,
      [uuidArray(codes), uuidArray(ids)],
    );
  }

  /** T031 — every active currency has a generation row; a missing one is asked for. */
  async ensureActiveCurrencies(): Promise<string[]> {
    const tracked = new Set(await this.trackedCurrencies());
    const missing = (await this.deps.activeCurrencies()).map((c) => c.toUpperCase()).filter((c) => !tracked.has(c));
    await this.requestRebuild(missing);
    return missing;
  }

  /** Whether {@link runPass} would find work now (the worker's follow-up check). */
  async hasPendingWork(): Promise<boolean> {
    const [row] = await this.#em().execute<Array<{ pending: boolean }>>(
      `select exists (select 1 from "catalogue_price_generations" where "whole_stale")
           or exists (select 1 from "catalogue_price_stale_products") as "pending"`,
    );
    return row?.pending === true;
  }

  /**
   * One pass: rebuild every currency asking for it, then refresh every mark against the served
   * generation. Answers what it did.
   */
  async runPass(): Promise<{ rebuilt: string[]; refreshed: number }> {
    const rebuilt: string[] = [];
    const stale = await this.#em().execute<Array<{ currency_code: string }>>(
      `select "currency_code" from "catalogue_price_generations" where "whole_stale" order by "currency_code"`,
    );
    for (const row of stale) {
      const code = row.currency_code.trim();
      if (await this.rebuildCurrency(code)) rebuilt.push(code);
    }
    let refreshed = 0;
    for (;;) {
      const done = await this.refreshMarked();
      refreshed += done;
      if (done === 0) break;
    }
    return { rebuilt, refreshed };
  }

  /**
   * A whole build of generation `n + 1` for the designation that holds at its start
   * (TM-7 (6)): any leftover of a crashed build is deleted first, the swap happens only after
   * every batch is written, and only while the designation is still the one built for — a
   * designation changed mid-build leaves the request standing and the next pass builds again.
   * Marks are not touched: those taken meanwhile are applied to `n + 1` after the swap (TM-7 (3)).
   * Answers whether it swapped.
   */
  async rebuildCurrency(currencyCode: string): Promise<boolean> {
    const code = currencyCode.toUpperCase();
    const em = this.#em();
    const start = await em.transactional(async (tx) => {
      const [row] = await tx.execute<GenerationRow[]>(
        `select * from "catalogue_price_generations" where "currency_code" = ? for update`,
        [code],
      );
      if (!row) return null;
      const next = Math.max(row.served_generation, row.building_generation ?? 0) + 1;
      // A previous build that never swapped left rows above the served generation.
      await tx.execute(`delete from "product_catalogue_prices" where "currency_code" = ? and "generation" > ?`, [code, row.served_generation]);
      await tx.execute(`delete from "variant_catalogue_prices" where "currency_code" = ? and "generation" > ?`, [code, row.served_generation]);
      const [designation] = await tx.execute<Array<{ price_list_id: string; sales_channel_id: string }>>(
        `select "price_list_id", "sales_channel_id" from "catalogue_price_designations" where "currency_code" = ?`,
        [code],
      );
      // The request is taken now; one made during the build stands for the next pass.
      await tx.execute(
        `update "catalogue_price_generations" set "building_generation" = ?, "whole_stale" = false where "currency_code" = ?`,
        [next, code],
      );
      return {
        next,
        designation: designation ? { priceListId: designation.price_list_id, salesChannelId: designation.sales_channel_id } : null,
      };
    });
    if (!start) return false;

    const designation: CatalogueDesignation | null = start.designation;
    const ids = [...(await this.deps.listProductIds())];
    for (let i = 0; i < ids.length; i += BUILD_BATCH) {
      const batch = ids.slice(i, i + BUILD_BATCH);
      const answers = await this.deps.prices().resolve({ currencyCode: code, designation, productIds: batch });
      await this.#writeRows(em, code, start.next, answers);
    }

    const swapped = await em.transactional(async (tx) => {
      const [row] = await tx.execute<GenerationRow[]>(
        `select * from "catalogue_price_generations" where "currency_code" = ? for update`,
        [code],
      );
      const [now] = await tx.execute<Array<{ price_list_id: string; sales_channel_id: string }>>(
        `select "price_list_id", "sales_channel_id" from "catalogue_price_designations" where "currency_code" = ?`,
        [code],
      );
      const current = now ? { priceListId: now.price_list_id, salesChannelId: now.sales_channel_id } : null;
      const sameDesignation = JSON.stringify(current) === JSON.stringify(designation);
      if (!row || row.building_generation !== start.next || !sameDesignation) {
        if (row && row.building_generation === start.next) {
          // Built for a designation that no longer holds: never swapped; asked again.
          await tx.execute(
            `update "catalogue_price_generations" set "building_generation" = null, "whole_stale" = true where "currency_code" = ?`,
            [code],
          );
        }
        await tx.execute(`delete from "product_catalogue_prices" where "currency_code" = ? and "generation" = ?`, [code, start.next]);
        await tx.execute(`delete from "variant_catalogue_prices" where "currency_code" = ? and "generation" = ?`, [code, start.next]);
        return false;
      }
      await tx.execute(
        `update "catalogue_price_generations"
            set "served_generation" = ?, "building_generation" = null,
                "built_for_price_list_id" = ?, "built_for_sales_channel_id" = ?, "built_at" = now()
          where "currency_code" = ?`,
        [start.next, designation?.priceListId ?? null, designation?.salesChannelId ?? null, code],
      );
      // Spec 193 T059 (Q2 A) — the website rule re-evaluates only the products whose flag row the
      // swap changed (appeared, disappeared or moved across zero); the rest keep their membership.
      await tx.execute(
        `insert into "website_rule_stale_products" ("product_id", "marked_at")
         select coalesce(n."product_id", o."product_id"), clock_timestamp()
           from (select "product_id", "has_positive" from "product_catalogue_prices" where "currency_code" = ? and "generation" = ?) n
           full join (select "product_id", "has_positive" from "product_catalogue_prices" where "currency_code" = ? and "generation" = ?) o
             on o."product_id" = n."product_id"
          where n."product_id" is null or o."product_id" is null or n."has_positive" <> o."has_positive"
         on conflict ("product_id") do update set "marked_at" = excluded."marked_at"`,
        [code, start.next, code, row.served_generation],
      );
      await tx.execute(`delete from "product_catalogue_prices" where "currency_code" = ? and "generation" < ?`, [code, start.next]);
      await tx.execute(`delete from "variant_catalogue_prices" where "currency_code" = ? and "generation" < ?`, [code, start.next]);
      return true;
    });
    if (swapped) {
      // A whole generation was written and the old one deleted: the planner's statistics are
      // stale until autovacuum comes round, and the restricted list pays for it in the plan of
      // its semi-join (measured, T035). Best effort — the flags are right either way.
      await em.execute(`analyze "product_catalogue_prices"`).catch(() => undefined);
      await em.execute(`analyze "variant_catalogue_prices"`).catch(() => undefined);
    }
    return swapped;
  }

  /**
   * One targeted refresh batch (TM-7 (1), (2)): the marked products are re-resolved for the
   * designation the **served** generation was built for, and their rows replaced in one
   * transaction holding the generation row — if the served generation moved meanwhile, nothing
   * is written and the marks stay for the new one. Only marks older than the read's start are
   * cleared. A currency never built keeps its marks (its build covers them). Answers how many
   * products it refreshed.
   */
  async refreshMarked(limit = REFRESH_BATCH): Promise<number> {
    const em = this.#em();
    const [clock] = await em.execute<Array<{ at: Date }>>(`select clock_timestamp() as "at"`);
    const readStart = clock!.at;
    const marks = await em.execute<Array<{ currency_code: string; product_id: string }>>(
      `select m."currency_code", m."product_id" from "catalogue_price_stale_products" m
         join "catalogue_price_generations" g on g."currency_code" = m."currency_code"
        where g."served_generation" > 0 and m."marked_at" < ?
        order by m."currency_code", m."marked_at" limit ?`,
      [readStart, limit],
    );
    if (marks.length === 0) return 0;
    const byCurrency = new Map<string, string[]>();
    for (const m of marks) {
      const code = m.currency_code.trim();
      byCurrency.set(code, [...(byCurrency.get(code) ?? []), m.product_id]);
    }
    let refreshed = 0;
    for (const [code, productIds] of byCurrency) {
      const [row] = await em.execute<GenerationRow[]>(`select * from "catalogue_price_generations" where "currency_code" = ?`, [code]);
      if (!row) continue;
      const served = row.served_generation;
      const designation: CatalogueDesignation | null =
        row.built_for_price_list_id && row.built_for_sales_channel_id
          ? { priceListId: row.built_for_price_list_id, salesChannelId: row.built_for_sales_channel_id }
          : null;
      const answers = await this.deps.prices().resolve({ currencyCode: code, designation, productIds });
      const wrote = await em.transactional(async (tx) => {
        const [locked] = await tx.execute<GenerationRow[]>(
          `select * from "catalogue_price_generations" where "currency_code" = ? for update`,
          [code],
        );
        if (!locked || locked.served_generation !== served) return false;
        const before = await this.#productFlags(tx, code, served, productIds);
        await tx.execute(
          `delete from "product_catalogue_prices" where "currency_code" = ? and "generation" = ? and "product_id" = any(?::uuid[])`,
          [code, served, uuidArray(productIds)],
        );
        await tx.execute(
          `delete from "variant_catalogue_prices" where "currency_code" = ? and "generation" = ? and "product_id" = any(?::uuid[])`,
          [code, served, uuidArray(productIds)],
        );
        await this.#writeRows(tx, code, served, answers);
        const after = await this.#productFlags(tx, code, served, productIds);
        await markForWebsiteRule(
          tx,
          productIds.filter((id) => before.get(id) !== after.get(id)),
        );
        await tx.execute(
          `delete from "catalogue_price_stale_products"
            where "currency_code" = ? and "product_id" = any(?::uuid[]) and "marked_at" < ?`,
          [code, uuidArray(productIds), readStart],
        );
        return true;
      });
      if (wrote) refreshed += productIds.length;
    }
    return refreshed;
  }

  /** Each product's flag row at one generation: `true` / `false` (`has_positive`), absent = unpriced. */
  async #productFlags(
    em: Pick<EntityManager, 'execute'>,
    code: string,
    generation: number,
    productIds: readonly string[],
  ): Promise<Map<string, boolean>> {
    const rows = await em.execute<Array<{ product_id: string; has_positive: boolean }>>(
      `select "product_id", "has_positive" from "product_catalogue_prices" where "currency_code" = ? and "generation" = ? and "product_id" = any(?::uuid[])`,
      [code, generation, uuidArray(productIds)],
    );
    return new Map(rows.map((r) => [r.product_id, r.has_positive]));
  }

  async #writeRows(
    em: Pick<EntityManager, 'execute'>,
    code: string,
    generation: number,
    answers: ReadonlyMap<string, ReadonlyArray<CatalogueReferenceLine>>,
  ): Promise<void> {
    const products: Array<[string, boolean]> = [];
    const variants: Array<[string, string, boolean]> = [];
    for (const [productId, lines] of answers) {
      const facts = lineFacts(lines);
      if (facts.priced) products.push([productId, facts.positive]);
      for (const line of lines) {
        if (line.variantId && line.amount !== null) variants.push([line.variantId, productId, Number(line.amount) > 0]);
      }
    }
    if (products.length > 0) {
      await em.execute(
        `insert into "product_catalogue_prices" ("currency_code", "generation", "product_id", "has_positive", "refreshed_at")
         select ?, ?, p, h, now() from unnest(?::uuid[], ?::boolean[]) as t(p, h)
         on conflict ("currency_code", "generation", "product_id") do update set "has_positive" = excluded."has_positive", "refreshed_at" = excluded."refreshed_at"`,
        [code, generation, uuidArray(products.map((p) => p[0])), `{${products.map((p) => String(p[1])).join(',')}}`],
      );
    }
    if (variants.length > 0) {
      await em.execute(
        `insert into "variant_catalogue_prices" ("currency_code", "generation", "variant_id", "product_id", "has_positive", "refreshed_at")
         select ?, ?, v, p, h, now() from unnest(?::uuid[], ?::uuid[], ?::boolean[]) as t(v, p, h)
         on conflict ("currency_code", "generation", "variant_id") do update set "product_id" = excluded."product_id", "has_positive" = excluded."has_positive", "refreshed_at" = excluded."refreshed_at"`,
        [
          code,
          generation,
          uuidArray(variants.map((v) => v[0])),
          uuidArray(variants.map((v) => v[1])),
          `{${variants.map((v) => String(v[2])).join(',')}}`,
        ],
      );
    }
  }

  /**
   * Drift poll (TM-7 (5)): `price_lists`' change watermark moved past what this module last
   * accounted for ⇒ an announcement was lost ⇒ rebuild every tracked currency. The subscriber
   * accounts for each announcement it handles ({@link accountWatermark}). Answers whether it asked.
   */
  async driftPoll(): Promise<boolean> {
    const current = await this.deps.prices().changeWatermark();
    const rows = await this.#em().execute<Array<{ currency_code: string; consumed_watermark: string | null }>>(
      `select "currency_code", "consumed_watermark" from "catalogue_price_generations"`,
    );
    const drifted = rows.filter((r) => r.consumed_watermark !== current).map((r) => r.currency_code.trim());
    if (drifted.length === 0) return false;
    await this.requestRebuild(drifted);
    await this.#setConsumed(current);
    return true;
  }

  /** The subscriber has written the marks of every announcement up to now. */
  async accountWatermark(): Promise<void> {
    await this.#setConsumed(await this.deps.prices().changeWatermark());
  }

  async #setConsumed(watermark: string): Promise<void> {
    await this.#em().execute(`update "catalogue_price_generations" set "consumed_watermark" = ?`, [watermark]);
  }

  /** The designations in effect, current and served — which books a price change can concern. */
  async relevantBooks(): Promise<Map<string, Set<string>>> {
    const rows = await this.#em().execute<Array<{ currency_code: string; book: string | null }>>(
      `select "currency_code", "price_list_id" as "book" from "catalogue_price_designations"
       union all
       select "currency_code", "built_for_price_list_id" from "catalogue_price_generations"`,
    );
    const out = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.book) continue;
      const code = r.currency_code.trim();
      out.set(code, (out.get(code) ?? new Set()).add(r.book));
    }
    return out;
  }
}

/**
 * Spec 193 T059 — mark products whose flag row changed for the website rule's steady state, in
 * the refreshing transaction (the mark is durable with the change). The evaluation job takes them
 * within its period; with no governed channel it simply clears them.
 */
async function markForWebsiteRule(em: Pick<EntityManager, 'execute'>, productIds: readonly string[]): Promise<void> {
  if (productIds.length === 0) return;
  await em.execute(
    `insert into "website_rule_stale_products" ("product_id", "marked_at")
     select p, clock_timestamp() from unnest(?::uuid[]) as t(p)
     on conflict ("product_id") do update set "marked_at" = excluded."marked_at"`,
    [uuidArray(productIds)],
  );
}
