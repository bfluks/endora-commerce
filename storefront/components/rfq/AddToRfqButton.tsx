'use client';

import { useState, type ReactNode } from 'react';
import { addRfqDraftItem } from '../../lib/rfqDraft';
import { clampQuantity, minimumStatement, quoteAddQuantity } from '../../lib/orderMinimum';
import { quoteAddButtonLabel } from '../../lib/buyActionLabels';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * "Add to quote request" button — pushes the product into the client-side RFQ
 * draft (`lib/rfqDraft`) instead of immediately creating a server-side request.
 * The buyer accumulates lines exactly like the cart, then reviews and submits
 * them on `/quote-request`.
 *
 * Renders an optional quantity input (PDP) and flashes a short "Added ✓"
 * confirmation. The header badge updates via the `b2b:rfq-draft:changed`
 * event the draft store dispatches.
 *
 * Feature 155 (FR-032, US4 #13): with the product's pieces minimum the input starts at it and
 * does not offer less, and the add never puts fewer pieces in the draft — the draft mirrors the
 * cart. What was typed is kept as typed and normalised on blur, as on the product page.
 */
export function AddToRfqButton(props: {
  productId: string;
  productSlug: string;
  productName: string;
  unitPrice?: { amount: number; currency: string } | null;
  /** Show a quantity input alongside the button (PDP). */
  withQuantity?: boolean;
  /** Locale for the button copy (defaults to Polish, matching the storefront). */
  locale?: string;
  className?: string;
  /** Feature 155 — the product's pieces minimum; `null`/absent = none. */
  minOrderQuantity?: number | null | undefined;
}): ReactNode {
  // The catalogue needs a full tag, so the Polish default is spelled out.
  const locale = props.locale ?? 'pl-PL';

  const floor = quoteAddQuantity(props.minOrderQuantity);
  const [qtyText, setQtyText] = useState<string>(() => String(floor));
  const qty = clampQuantity(qtyText, floor);
  const [added, setAdded] = useState(false);
  // The minimum is stated beside the input it constrains (Law of Proximity), in the request
  // locale.
  const statement = props.withQuantity
    ? minimumStatement({ minOrderQuantity: props.minOrderQuantity }, null, locale)
    : null;
  const statementId = `rfq-min-${props.productId}`;

  const onAdd = (): void => {
    addRfqDraftItem({
      productId: props.productId,
      slug: props.productSlug,
      name: props.productName,
      unitPrice: props.unitPrice ?? null,
      quantity: qty,
    }, props.minOrderQuantity ?? null);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${props.className ?? ''}`}>
      {props.withQuantity ? (
        <>
          <label htmlFor={`rfq-qty-${props.productId}`} className="text-[12px]">
            {tForLocale(locale)('common.quantity')}
          </label>
          <input
            id={`rfq-qty-${props.productId}`}
            type="number"
            min={floor}
            max={Math.max(9999, floor)}
            value={qtyText}
            onChange={(e): void => setQtyText(e.target.value)}
            onBlur={(): void => setQtyText(String(qty))}
            {...(statement ? { 'aria-describedby': statementId } : {})}
            className="w-[5rem] rounded-sm border border-line px-[8px] py-[6px]"
          />
        </>
      ) : null}
      <button type="button" onClick={onAdd} className="btn btn--outline btn--sm">
        {quoteAddButtonLabel(added, locale)}
      </button>
      {statement ? (
        <p id={statementId} className="m-0 basis-full text-[12px] text-muted">
          {statement}
        </p>
      ) : null}
    </div>
  );
}
