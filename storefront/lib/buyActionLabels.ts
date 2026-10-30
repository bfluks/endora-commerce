import { tForLocale } from './i18n/messages';

/**
 * The transient copy of the buy controls — "added", "adding", "could not add" — in the page's
 * language (feature 155, U4). Pure, so the storefront's server-render suite can assert the
 * states a click reaches without rendering the click (issue #355).
 */

/** The "add to quote" button: the action, then its confirmation for a moment after the click. */
export function quoteAddButtonLabel(added: boolean, locale: string): string {
  return tForLocale(locale)(added ? 'product.quote.added' : 'product.quote.add');
}

export type CompareAddState = 'idle' | 'busy' | 'done';

/** The comparison's "add to cart" button in each of its states. */
export function compareAddButtonLabel(state: CompareAddState, locale: string): string {
  const t = tForLocale(locale);
  if (state === 'done') return t('compare.cart.added');
  if (state === 'busy') return t('compare.cart.adding');
  return t('product.addToCart');
}

/**
 * The comparison's refusal: the backend's sentence when it gave one (already in the request's
 * language and without its log-only code), else the catalogue's.
 */
export function compareAddFailure(backendDetail: string | null | undefined, locale: string): string {
  return backendDetail?.trim() ? backendDetail : tForLocale(locale)('product.addToCartFailed');
}

export type CardActionState = 'idle' | 'busy' | 'done' | 'error';

export interface ProductCardActionLabels {
  /** The shopping-list heart: tooltip and accessible name (one string — the state is the name). */
  list: string;
  /** The quote button's tooltip. */
  quote: string;
  /** The quote button's accessible name. */
  quoteName: string;
  /** The cart button's tooltip. */
  cart: string;
  /** The cart button's accessible name. */
  cartName: string;
}

/** Every tooltip and accessible name of the product card's icon buttons. */
export function productCardActionLabels(input: {
  locale: string;
  cartState: CardActionState;
  listState: CardActionState;
  quoteState: CardActionState;
  inList: boolean;
  /** The server card's "Add 10 pcs to cart" (or the plain label); `null` = the plain label. */
  addToCartLabel: string | null | undefined;
}): ProductCardActionLabels {
  const t = tForLocale(input.locale);
  const cartName = input.addToCartLabel ?? t('product.addToCart');
  return {
    list:
      input.listState === 'error'
        ? t('card.list.failed')
        : input.inList
          ? t('card.list.remove')
          : t('card.list.add'),
    quote: input.quoteState === 'done' ? t('card.quote.added') : t('product.quote.add'),
    quoteName: t('product.quote.add'),
    cart:
      input.cartState === 'done'
        ? t('card.cart.added')
        : input.cartState === 'error'
          ? t('card.cart.failed')
          : cartName,
    cartName,
  };
}
