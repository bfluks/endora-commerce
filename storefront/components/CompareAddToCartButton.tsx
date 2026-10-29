'use client';

import { useState, type ReactNode } from 'react';
import { addProductToCartAction } from '../lib/actions/cart';
import { cardAddToCartPayload, minimumStatement } from '../lib/orderMinimum';
import { compareAddButtonLabel, compareAddFailure } from '../lib/buyActionLabels';

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
 * Feature 155 (FR-016) — for a product with a pieces minimum the button adds the minimum in one
 * action, and the minimum is stated under it (linked by `aria-describedby`) so the buyer knows
 * how many pieces the click adds before making it.
 */

export function CompareAddToCartButton(props: {
  productId: string;
  disabled?: boolean;
  /** Feature 155 — the product's pieces minimum; `null`/absent = none (adds 1). */
  minOrderQuantity?: number | null | undefined;
  /**
   * The comparison table's resolved locale, for the button's copy and the minimum statement. Required: the button
   * and the table once fell back to different locales.
   */
  locale: string;
}): ReactNode {
  const statement = minimumStatement(
    { minOrderQuantity: props.minOrderQuantity },
    null,
    props.locale,
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
      if (!res.ok) {
        setError(compareAddFailure(res.message, props.locale));
        return;
      }
      setSuccess(true);
      // Notify the header cart counter so it refreshes if it's listening.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('b2b:cart:changed'));
      }
      setTimeout(() => setSuccess(false), 1500);
    } catch {
      setError(compareAddFailure(null, props.locale));
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
        {compareAddButtonLabel(success ? 'done' : busy ? 'busy' : 'idle', props.locale)}
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
