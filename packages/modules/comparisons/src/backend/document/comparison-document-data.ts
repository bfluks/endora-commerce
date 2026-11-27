import type { ComparisonDocumentData, ComparisonOwnerView } from '@endora-commerce/contracts';

/**
 * The data a comparison PDF is produced from — built only in the export
 * route, under the buyer's request, from what that route already read
 * (`contracts/comparison-document.md` §2). Nothing else reaches a render, so
 * a template can rearrange the buyer's comparison and never widen it (FR-033).
 */
export function buildComparisonDocumentData(input: {
  readonly view: ComparisonOwnerView;
  readonly channelName: string;
  readonly customerName: string | null;
  readonly organizationName: string | null;
  /** The channel's storefront base URL; empty or absent → no share link. */
  readonly storefrontUrl: string | null;
  /**
   * Puts the document language's storefront prefix on the share page path (feature
   * 167, FR-034). Absent: the logical path.
   */
  readonly pagePath?: (path: string) => string;
  readonly hideEmptyRows: boolean;
  readonly now: Date;
}): ComparisonDocumentData {
  const base = input.storefrontUrl?.trim().replace(/\/+$/, '') ?? '';
  let shareUrl: string | null = null;
  if (/^https?:\/\//i.test(base)) {
    try {
      const path = `/compare/share/${encodeURIComponent(input.view.shareToken)}`;
      shareUrl = new URL(`${base}${input.pagePath ? input.pagePath(path) : path}`).toString();
    } catch {
      shareUrl = null;
    }
  }
  return {
    view: input.view,
    channelName: input.channelName,
    customerName: input.customerName,
    organizationName: input.organizationName,
    shareUrl,
    hideEmptyRows: input.hideEmptyRows,
    generatedAt: input.now.toISOString(),
  };
}
