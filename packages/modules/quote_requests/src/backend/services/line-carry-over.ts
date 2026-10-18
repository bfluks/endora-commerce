/**
 * Feature 146 — which stored line an incoming line of a rewrite *is*, and what
 * a paired line keeps (FR-034, FR-035, FR-036;
 * `specs/146-quote-request-pricing-history/research.md` R5, data-model §2).
 *
 * Admin `modify` and customer `patchDraft` both delete a request's lines and
 * recreate them from the body. Whatever a line carries that the body does not
 * restate — variant, line note, packaging unit, the customer's proposal, the
 * stored reference price — survives only by pairing the incoming line with the
 * row it replaces. Pure: no I/O, so both services share one rule and the rule
 * is unit-tested on its own.
 */

/** The part of a stored line the pairing reads. */
export interface CarryOverRow {
  id: string;
  productId: string;
  variantId?: string | null;
  /** Feature 155 — the catalogue unit the line was stored with; `null` for older lines. */
  packagingUnitId?: string | null;
  packagingUnitName?: string | null;
}

/**
 * The part of an incoming line the pairing reads.
 *
 * `variantId: undefined` is "key absent" — on the admin side that means "keep
 * the stored variant" (R5.2), so the line may pair with a row of any variant of
 * its product; on the customer side it means "no variant". `packagingUnitName:
 * undefined` means the body does not speak about packaging (the admin schema
 * has no such key) and only position decides.
 */
export interface IncomingLineKey {
  id?: string | undefined;
  productId: string;
  variantId?: string | null | undefined;
  /** Feature 155 — the catalogue unit the line resolved to; absent or `null` = none. */
  packagingUnitId?: string | null | undefined;
  packagingUnitName?: string | null | undefined;
}

/**
 * `'admin'` — `modify`: an `id` naming a row of this request with the same
 * product is that row (R5.1); an absent `variantId` is a wildcard over the
 * product's variants, a variant-less row preferred.
 * `'customer'` — `patchDraft`: lines carry no ids (R5.3); an absent variant is
 * `null` and must match `null`.
 */
export type PairingMode = 'admin' | 'customer';

export interface LinePairing<E> {
  /** Index-aligned with the incoming lines; `null` = a new line. */
  paired: Array<E | null>;
  /** Existing rows no incoming line paired with, in their stored order. */
  removed: E[];
}

/**
 * Pair incoming lines with stored rows: by `id` (admin only), then by product
 * and variant with the same packaging unit id, then with an equal packaging
 * name, then by product and variant in stored order (the R6 rule). Two variants
 * of one product never pair with each other. Each row pairs at most once.
 */
export function pairLines<E extends CarryOverRow>(
  existing: readonly E[],
  incoming: readonly IncomingLineKey[],
  mode: PairingMode,
): LinePairing<E> {
  const paired: Array<E | null> = incoming.map(() => null);
  const taken = new Set<number>();

  const claim = (lineIndex: number, accept: (row: E) => boolean): void => {
    if (paired[lineIndex] !== null) return;
    const rowIndex = existing.findIndex((row, index) => !taken.has(index) && accept(row));
    if (rowIndex < 0) return;
    taken.add(rowIndex);
    paired[lineIndex] = existing[rowIndex]!;
  };

  const variantOf = (line: IncomingLineKey): string | null => line.variantId ?? null;
  const wildcardVariant = (line: IncomingLineKey): boolean =>
    mode === 'admin' && line.variantId === undefined;
  const sameVariant = (row: E, line: IncomingLineKey): boolean =>
    (row.variantId ?? null) === variantOf(line);

  // 1. By id — admin only, and only for a row of the same product.
  if (mode === 'admin') {
    incoming.forEach((line, lineIndex) => {
      if (line.id === undefined) return;
      claim(lineIndex, (row) => row.id === line.id && row.productId === line.productId);
    });
  }

  // 2a. Same product and variant, the same packaging unit id (feature 155,
  //     FR-031 (b)) — a unit renamed in the catalogue since the line was
  //     stored is still the same unit. Both sides must carry an id.
  incoming.forEach((line, lineIndex) => {
    const unitId = line.packagingUnitId ?? null;
    if (unitId === null) return;
    claim(
      lineIndex,
      (row) => row.productId === line.productId && sameVariant(row, line) && (row.packagingUnitId ?? null) === unitId,
    );
  });

  // 2b. Same product and variant, equal packaging name — run over every line
  //     before any positional fallback, so an exact match is never stolen by an
  //     earlier line that would have settled for position.
  incoming.forEach((line, lineIndex) => {
    if (line.packagingUnitName === undefined) return;
    const packaging = line.packagingUnitName ?? null;
    claim(
      lineIndex,
      (row) =>
        row.productId === line.productId &&
        sameVariant(row, line) &&
        (row.packagingUnitName ?? null) === packaging,
    );
  });

  // 3. Same product and variant, by stored order.
  incoming.forEach((line, lineIndex) => {
    claim(lineIndex, (row) => row.productId === line.productId && sameVariant(row, line));
  });

  // 4. Admin, variant key absent: any variant of the product ("absent = keep").
  incoming.forEach((line, lineIndex) => {
    if (!wildcardVariant(line)) return;
    claim(lineIndex, (row) => row.productId === line.productId);
  });

  return { paired, removed: existing.filter((_, index) => !taken.has(index)) };
}

/**
 * The proposal a rewritten line stores (threat model T5): an omitted
 * `desiredUnitPrice` keeps the paired row's stored proposal — otherwise a
 * locked owner, who may not send one, could erase a proposal stored before the
 * lock by resending the line (FR-024). An explicit value replaces it.
 */
export function carriedProposal(
  sent: number | undefined,
  paired: { desiredUnitPrice?: string | null } | null,
): string | null {
  if (sent !== undefined) return sent.toFixed(2);
  return paired?.desiredUnitPrice ?? null;
}

/** What a reference price was resolved for. */
export interface ReferenceInputs {
  productId: string;
  variantId?: string | null | undefined;
  quantity: number;
  /** Feature 155 — when both sides carry one, the unit's identity (its name may since have changed). */
  packagingUnitId?: string | null | undefined;
  packagingUnitName?: string | null | undefined;
  packagingUnitBaseQuantity?: number | null | undefined;
}

/**
 * Whether a paired line keeps its stored reference: only when product,
 * variant, quantity and packaging unit are all unchanged — any of them can move
 * the price bracket (spec Assumption). A change of proposal or line note alone
 * keeps it.
 *
 * The packaging unit is the same unit when both sides carry the same unit id
 * (feature 155, FR-031 (b) — a unit renamed in the catalogue is not a change
 * the buyer made), otherwise when the names are equal; the base quantity must
 * be equal either way.
 */
export function referenceInputsUnchanged(stored: ReferenceInputs, next: ReferenceInputs): boolean {
  const storedUnitId = stored.packagingUnitId ?? null;
  const nextUnitId = next.packagingUnitId ?? null;
  const sameUnit =
    storedUnitId !== null && nextUnitId !== null
      ? storedUnitId === nextUnitId
      : (stored.packagingUnitName ?? null) === (next.packagingUnitName ?? null);
  return (
    stored.productId === next.productId &&
    (stored.variantId ?? null) === (next.variantId ?? null) &&
    stored.quantity === next.quantity &&
    sameUnit &&
    (stored.packagingUnitBaseQuantity ?? null) === (next.packagingUnitBaseQuantity ?? null)
  );
}
