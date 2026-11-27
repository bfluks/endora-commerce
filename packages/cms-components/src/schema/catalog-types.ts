/** Minimal catalog shapes for CMS storefront fetch — avoids @endora-commerce/contracts in this package. */
export interface CmsProductSummary {
  id: string;
  slug: string;
  name: string;
  sku: string;
  primaryAssetUrl: string | null;
  price: { amount: number; currency: string } | null;
  stockLevel: number | null;
  /**
   * A plain-text excerpt of the product's description in the request
   * language, at most 160 characters, cut at a word boundary (feature 163,
   * R-16); `null` when the product has no description. Absent from an older
   * backend.
   */
  summary?: string | null | undefined;
}

export interface CmsCategoryNode {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  children: CmsCategoryNode[];
}
