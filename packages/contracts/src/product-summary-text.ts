/**
 * The product card's short description (`specs/163-page-builder-marketing-pages/`
 * research R-16, FR-027, owner ruling Q3): derived from the product's own
 * description rather than stored, so the catalogue's schema does not change.
 *
 * Pure and synchronous on purpose: the catalogue's listing calls it on the
 * description it already holds, so a summary costs no query per product.
 *
 * It lives here rather than in `catalog` (T196) because a second reader needs
 * the same answer: the page editor's preview of a product listing (`cms`'
 * admin), which reads the admin product payload — the description, not a
 * summary — and must show the line the storefront shows. A module may not
 * import another's internals; both may import this.
 */

/** The longest summary, ellipsis included. */
export const PRODUCT_SUMMARY_MAX_LENGTH = 160;

const ELLIPSIS = '…';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** A description (plain text or HTML) as one line of plain text. */
function toPlainText(description: string): string {
  const withoutCode = description.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const withoutTags = withoutCode.replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

/**
 * The summary of a description: plain text of at most
 * {@link PRODUCT_SUMMARY_MAX_LENGTH} characters, cut at the last word boundary
 * that fits and marked with an ellipsis; `null` when nothing is left.
 */
export function productSummaryText(description: string | null | undefined): string | null {
  if (typeof description !== 'string') return null;
  const text = toPlainText(description);
  if (text === '') return null;
  if (text.length <= PRODUCT_SUMMARY_MAX_LENGTH) return text;
  const room = PRODUCT_SUMMARY_MAX_LENGTH - ELLIPSIS.length;
  const head = text.slice(0, room + 1);
  const boundary = head.lastIndexOf(' ');
  const cut = boundary > 0 ? head.slice(0, boundary) : text.slice(0, room);
  return `${cut.replace(/[\s,;:–—-]+$/u, '')}${ELLIPSIS}`;
}
