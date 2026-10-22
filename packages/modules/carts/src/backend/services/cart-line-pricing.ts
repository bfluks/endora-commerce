import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductRecord,
  LinePricesPort,
  LinePriceResult,
  OrganizationDetailsPort,
  ProductDisplayModePort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * What a cart line may cost at its **current** quantity — the one answer
 * `CartService` stores when a line is added, merged or has its quantity changed,
 * and that order placement compares the stored price with before it copies that
 * price onto the order line.
 *
 * One definition, because two would drift: the stored `unit_price` is what an
 * order is placed at, so a cart that priced a line one way and a placement that
 * checked it another would refuse a basket the buyer cannot repair.
 *
 * The chain:
 *
 *  1. **An agreed price, at the agreed quantity.** A line seeded from an
 *     accepted Quote Request carries the seller's price and the quantity it was
 *     agreed for. It holds only while the line holds that quantity; at any other
 *     quantity the line is priced like any other, and it gets the agreed price
 *     back if it returns to the agreed quantity.
 *  2. **The price list**, at the line's quantity — so a quantity-tier bracket
 *     applies to the quantity actually ordered.
 *  3. **The Product's own price** (the `defaultPrice` / `price` attribute) when
 *     no list applies — the second step of the catalogue's pricing chain
 *     (issue #132), which is what the storefront lists the product at. It is in
 *     the basket channel's default currency, as the listing chain labels it
 *     (`price_lists`' `listingPriceFrom`); it used to be labelled `PLN` whatever
 *     the channel (D-287 P0, issue #303's cart half), so on a EUR channel the
 *     card said 100 EUR and the cart line 100 PLN. A basket whose channel is
 *     gone has no currency to claim for the attribute and is unpriced.
 *  4. **Nothing.** A product nobody priced is not orderable; it used to become a
 *     line at `0.00`.
 *
 * A product sold on request only (display mode `none`) is not orderable outside
 * an agreement either.
 *
 * Prices resolve against the basket's own sales channel — the channel it is used
 * on (`specs/154-sales-channel-access/`, contracts/basket-attribution.md §2). They
 * used to resolve against the system-default channel whatever the basket, so a
 * list targeting another store never applied to its baskets.
 */

export interface CartLineAgreement {
  quantity: number | null;
  unitPrice: string | null;
  currency: string | null;
}

export interface CartPricingContext {
  channel: { id: string; defaultCurrency: string } | null;
  organization: Awaited<ReturnType<OrganizationDetailsPort['findById']>>;
  organizationId: string | null;
  signedIn: boolean;
  /**
   * D-287 P0 — the basket's customer account, whose own customer group
   * overrides the organisation's. `price_lists` applies the rule; optional so a
   * hand-built context for a guest needs nothing.
   */
  customerAccountId?: string | null;
}

export interface CartLinePriceInput {
  product: CatalogProductRecord;
  variantId: string | null;
  quantity: number;
  agreed?: CartLineAgreement | null;
}

export type CartLinePriceAnswer =
  | { ok: true; unitPrice: string; currency: string; source: 'agreed' | 'price_list' | 'product' }
  | { ok: false; reason: 'unpriced' | 'quote_only' };

export class CartLinePricing {
  constructor(
    /**
     * D-287 P0 — the batched line slice: a basket's lines are priced in one
     * call (the placement drift check and the login/reorder reprice looped one
     * `resolveLinePrice` per line). A single line is a batch of one, so there
     * is one chain and one call shape.
     */
    private readonly pricingService: LinePricesPort,
    private readonly displayModes: ProductDisplayModePort,
    private readonly organizations: OrganizationDetailsPort,
  ) {}

  /**
   * The channel and buyer every line of one cart is priced for, resolved once.
   * `salesChannelId` is the basket's channel; there is no fallback to the system
   * default, so a basket is never priced for a store it is not used on. A
   * channel that no longer exists prices nothing from a list, which leaves the
   * Product's own price or "unpriced" — never another channel's list.
   */
  async contextFor(
    em: EntityManager,
    input: {
      organizationId: string | null;
      signedIn: boolean;
      salesChannelId: string;
      /** D-287 P0 — the customer whose own group to price on. */
      customerAccountId?: string | null;
    },
  ): Promise<CartPricingContext> {
    const channel = await em.findOne(
      SalesChannel,
      { id: input.salesChannelId },
      { fields: ['id', 'defaultCurrency'] },
    );
    const organization = input.organizationId
      ? await this.organizations.findById(input.organizationId)
      : null;
    return {
      channel: channel ? { id: channel.id, defaultCurrency: channel.defaultCurrency } : null,
      organization,
      organizationId: input.organizationId,
      signedIn: input.signedIn,
      customerAccountId: input.customerAccountId ?? null,
    };
  }

  async orderablePrice(ctx: CartPricingContext, line: CartLinePriceInput): Promise<CartLinePriceAnswer> {
    const answers = await this.orderablePrices(ctx, [{ ...line, key: 'line' }]);
    return answers.get('line')!;
  }

  /**
   * {@link orderablePrice} for many lines of one basket, keyed by the caller's
   * `key`. The list prices of every line without an agreement come from one
   * batched `resolveLinePrices` call (D-287 P0); the chain per line is
   * unchanged.
   */
  async orderablePrices(
    ctx: CartPricingContext,
    lines: ReadonlyArray<CartLinePriceInput & { key: string }>,
  ): Promise<Map<string, CartLinePriceAnswer>> {
    const out = new Map<string, CartLinePriceAnswer>();
    const toResolve: Array<CartLinePriceInput & { key: string }> = [];
    for (const line of lines) {
      const agreed = agreedUnitPriceFor(line.quantity, line.agreed ?? null);
      if (agreed) out.set(line.key, { ok: true, ...agreed, source: 'agreed' });
      else toResolve.push(line);
    }
    if (toResolve.length === 0) return out;

    // No `catch` (issue #84): `null` is the engine's own "no list applies", and
    // an absent `price_lists` throws `MODULE_DISABLED` through this call.
    const resolved: Map<string, LinePriceResult | null> = ctx.channel
      ? await this.pricingService.resolveLinePrices({
          lines: toResolve.map((line) => ({
            key: line.key,
            product: line.product,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
          context: {
            ...(ctx.organization ? { organization: ctx.organization } : {}),
            ...(ctx.organization && ctx.customerAccountId
              ? { customerAccountId: ctx.customerAccountId }
              : {}),
            salesChannel: ctx.channel,
          },
        })
      : new Map();

    for (const line of toResolve) {
      const price = resolved.get(line.key) ?? null;
      // Issue #236 — the mode is read off the list price when there is one, and
      // asked for on its own when there is not.
      const displayMode =
        price?.displayMode ??
        (ctx.channel
          ? await this.displayModes.resolveDisplayMode({
              productId: line.product.id,
              organizationId: ctx.organizationId,
              salesChannelId: ctx.channel.id,
              customerKind: ctx.signedIn ? 'signed_in' : 'guest',
            })
          : null);
      if (displayMode === 'none') {
        out.set(line.key, { ok: false, reason: 'quote_only' });
        continue;
      }
      if (price) {
        out.set(line.key, {
          ok: true,
          unitPrice: Number(price.amount).toFixed(2),
          currency: price.currency,
          source: 'price_list',
        });
        continue;
      }
      const own = productOwnUnitPrice(line.product.attributeValues);
      // The attribute carries no currency; the basket channel's default is the
      // only one it was ever entered in (D-287 P0 — it used to read `PLN`).
      if (own === null || !ctx.channel) {
        out.set(line.key, { ok: false, reason: 'unpriced' });
        continue;
      }
      out.set(line.key, {
        ok: true,
        unitPrice: own,
        currency: ctx.channel.defaultCurrency.toUpperCase(),
        source: 'product',
      });
    }
    return out;
  }
}

/** The agreed price, when the line holds the quantity it was agreed for. */
export function agreedUnitPriceFor(
  quantity: number,
  agreed: CartLineAgreement | null,
): { unitPrice: string; currency: string } | null {
  if (!agreed || agreed.quantity == null || agreed.unitPrice == null || agreed.currency == null) {
    return null;
  }
  if (agreed.quantity !== quantity) return null;
  return { unitPrice: Number(agreed.unitPrice).toFixed(2), currency: agreed.currency };
}

/**
 * The Product's own price — the legacy `defaultPrice` (and older `price`)
 * attribute — or `null` when it carries no non-negative number. Zero is a price
 * an operator entered and stays one.
 */
export function productOwnUnitPrice(attributeValues: Record<string, unknown>): string | null {
  const raw = attributeValues['defaultPrice'] ?? attributeValues['price'];
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value.toFixed(2);
}

/** Whether a stored line price is not the price the line may be ordered at now. */
export function storedPriceDiffers(
  stored: { unitPrice: string; currency: string },
  current: { unitPrice: string; currency: string } | null,
): boolean {
  if (!current) return true;
  if (stored.currency.toUpperCase() !== current.currency.toUpperCase()) return true;
  return Number(stored.unitPrice).toFixed(2) !== Number(current.unitPrice).toFixed(2);
}

/** The agreement a line carries, in the shape `CartLinePricing` reads. */
export function agreementOf(item: {
  agreedQuantity?: number | null;
  agreedUnitPrice?: string | null;
  agreedCurrency?: string | null;
}): CartLineAgreement {
  return {
    quantity: item.agreedQuantity ?? null,
    unitPrice: item.agreedUnitPrice ?? null,
    currency: item.agreedCurrency ?? null,
  };
}
