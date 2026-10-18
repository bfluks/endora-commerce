'use client';

import { useState, type ReactNode } from 'react';
import { addProductToCartAction } from '../lib/actions/cart';
import { cardAddToCartPayload, minimumStatement } from '../lib/orderMinimum';

/**
 * `<CompareAddToCartButton>` — feature 007 / US3 / T046.
 *
 * Thin client-side wrapper around the carts module's add-item endpoint.
 * The comparisons module deliberately has no cart proxy (research.md R-9):
 * the cart enforces its own business rules (channel availability, stock,
 * etc.), and the comparison stays untouched on either success or refusal.
 *
 * The call goes through the `addProductToCartAction` server action, not a
 * browser fetch to the backend origin: the buyer's cart cookies are httpOnly
 * and scoped to the storefront origin, so a direct call filled a cart the
 * `/cart` page never reads (`lib/actions/cart.ts`).
 *
 * Mounted inside `<ComparisonTable>` only when `viewerIsOwner === true`
 * (US1 / spec FR-013, FR-015). The shared-link recipient never sees
 * this button.
 *
 * Feature 154 (FR-016) — for a product with a pieces minimum the button adds the minimum in one
 * action, and the minimum is stated under it (linked by `aria-describedby`) so the buyer knows
 * how many pieces the click adds before making it.
 */

export function CompareAddToCartButton(props: {
  productId: string;
  disabled?: boolean;
  /** Feature 154 — the product's pieces minimum; `null`/absent = none (adds 1). */
  minOrderQuantity?: number | null | undefined;
  /** Request locale for the minimum statement. */
  locale?: string | undefined;
}): ReactNode {
  const statement = minimumStatement(
    { minOrderQuantity: props.minOrderQuantity },
    null,
    props.locale ?? 'pl-PL',
  );
  const statementId = `compare-min-${props.productId}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onClick = async (): Promise<void> => {
    if (busy || props.disabled) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await addProductToCartAction(
        cardAddToCartPayload(props.productId, props.minOrderQuantity),
      );
      if (!res.ok) throw new Error(res.message ?? 'Could not add to cart.');
      setSuccess(true);
      // Notify the header cart counter so it refreshes if it's listening.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('b2b:cart:changed'));
      }
      setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to cart.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--dark btn--sm"
        disabled={busy || props.disabled}
        {...(statement ? { 'aria-describedby': statementId } : {})}
        onClick={(): void => void onClick()}
      >
        {success ? '✓ Dodano' : busy ? 'Dodawanie…' : 'Dodaj do koszyka'}
      </button>
      {statement ? (
        <div id={statementId} className="mt-1 text-[12px] text-muted">
          {statement}
        </div>
      ) : null}
      {error ? <div className="mt-1 text-[12px] text-bad">{error}</div> : null}
    </>
  );
}
