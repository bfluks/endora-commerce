/**
 * The quantity a shopping-list row may be set to: a whole number from 1 to 9999, the range the
 * input offers. A list holds any positive quantity; a product's minimum binds when the list
 * moves to the cart (feature 155, FR-011), not here.
 *
 * `null` for anything else — the page then words the refusal beside the field (U4), rather than
 * the browser's own bubble in the browser's language.
 */
export const LIST_QUANTITY_MAX = 9999;

export function parseListQuantity(raw: FormDataEntryValue | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= LIST_QUANTITY_MAX ? value : null;
}
