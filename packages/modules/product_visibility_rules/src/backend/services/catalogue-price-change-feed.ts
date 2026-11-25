import { CataloguePricesChangedEventSchema } from '@endora-commerce/contracts';
import type { CataloguePriceFlags } from './catalogue-price-flags.js';

/** TM-12 — more ids than this in one announcement is a catalogue-wide change. */
export const CHANGE_FEED_ID_CAP = 1_000;

/**
 * `price_lists.catalogue_prices_changed` → marks or whole rebuilds (spec 193 research R-6,
 * T029; threat model TM-12, TM-7 (5)).
 *
 * The announcement is a **hint**: the in-process bus does not check who emits, so nothing is
 * ever copied from it — flags come only from the engine. A payload that does not parse, or names
 * more than {@link CHANGE_FEED_ID_CAP} ids, asks for a whole rebuild of every tracked currency,
 * and coalescing is the durable request's (one flag per currency). Marks are written before this
 * returns, and the change watermark is accounted for after them.
 */
export async function handleCataloguePricesChanged(
  payload: unknown,
  flags: Pick<CataloguePriceFlags, 'trackedCurrencies' | 'requestRebuild' | 'markProducts' | 'relevantBooks' | 'accountWatermark'>,
): Promise<void> {
  const tracked = await flags.trackedCurrencies();
  if (tracked.length === 0) return;
  const parsed = CataloguePricesChangedEventSchema.safeParse(payload);
  const all = async () => {
    await flags.requestRebuild(tracked);
  };
  if (!parsed.success) {
    await all();
  } else {
    const change = parsed.data.change;
    const trackedSet = new Set(tracked);
    switch (change.kind) {
      case 'all':
      case 'channels':
      case 'categories':
      case 'attributes':
        await all();
        break;
      case 'products': {
        const currencies = (change.currencyCodes ?? tracked).map((c) => c.toUpperCase()).filter((c) => trackedSet.has(c));
        if (change.productIds.length > CHANGE_FEED_ID_CAP) await flags.requestRebuild(currencies);
        else await flags.markProducts(currencies, change.productIds);
        break;
      }
      case 'books': {
        const relevant = await flags.relevantBooks();
        for (const book of change.books) {
          for (const raw of book.currencyCodes) {
            const code = raw.toUpperCase();
            if (!trackedSet.has(code)) continue;
            // The base book prices every currency's reference; another book only while designated.
            if (!book.isSystem && !relevant.get(code)?.has(book.bookId)) continue;
            if (book.productIds === null || book.productIds.length > CHANGE_FEED_ID_CAP) await flags.requestRebuild([code]);
            else await flags.markProducts([code], book.productIds);
          }
        }
        break;
      }
    }
  }
  await flags.accountWatermark();
}
