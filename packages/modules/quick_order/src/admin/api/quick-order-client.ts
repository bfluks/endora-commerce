import { apiClient } from '@endora-commerce/admin-kit/lib';
/**
 * Admin quick-order bindings (feature 039). Wraps the `/api/v1/admin/quick-order`
 * endpoints; the operator acts on behalf of a customer + organization.
 */

export type QuickOrderRejectionReason =
  | 'sku_missing'
  | 'quantity_invalid'
  | 'product_not_found'
  | 'product_archived'
  | 'malformed_row'
  | 'variant_not_resolved'
  | 'variant_ambiguous'
  | 'row_limit_exceeded'
  /** Feature 155 — the product's total across the file is below its pieces minimum (buyer's import). */
  | 'below_minimum';

/**
 * Feature 155 (FR-011 (a), P1 C) — the operator's import keeps a row whose
 * product's file total is below the pieces minimum, and flags it instead.
 */
export interface QuickOrderMinimumWarning {
  reason: 'below_minimum';
  minimum: number;
  productTotal: number;
}

export interface RecognizedQuickOrderItem {
  line: number;
  sku: string;
  productId: string;
  variantId: string | null;
  resolvedVariantSku?: string | null;
  quantity: number;
  mergedFromLines?: number[];
  warning?: QuickOrderMinimumWarning;
}

export interface RejectedQuickOrderItem {
  line: number;
  raw: string;
  reason: QuickOrderRejectionReason;
  /** Feature 155 — on `below_minimum`: the product's pieces minimum. */
  minimum?: number;
  /** Feature 155 — on `below_minimum`: the file total the verdict used. */
  productTotal?: number;
}

export interface QuickOrderImportResponse {
  recognized: RecognizedQuickOrderItem[];
  rejected: RejectedQuickOrderItem[];
  summary: {
    recognizedCount: number;
    rejectedCount: number;
    mergedCount: number;
    truncated: boolean;
    /** Feature 155 — operator's import: recognised rows carrying a `warning`. */
    warningCount?: number;
  };
}

export type QuickOrderTarget = 'cart' | 'quote_request';

export interface QuickOrderBuildResponse {
  target: QuickOrderTarget;
  cartId?: string;
  checkoutUrl?: string;
  quoteRequestId?: string;
  /**
   * Feature 155 (FR-011 (b)) — target `cart`: the lines not added because they
   * would leave their product below a minimum. Absent for a quote request.
   */
  rejected?: QuickOrderBuildRejectedLine[];
}

export interface QuickOrderBuildRejectedLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  productName: string;
  reason: 'below_minimum';
  kind: 'pieces' | 'packaging_unit';
  minimum: number;
  /** Feature 155 — on a `packaging_unit` refusal: the unit's name. */
  packagingUnitName?: string;
}

export interface OnBehalfOf {
  customerAccountId: string;
  organizationId: string;
}

interface Envelope<T> {
  data: T;
}

export async function adminQuickOrderImport(input: {
  csv?: string;
  file?: { filename: string; contentBase64: string };
}): Promise<QuickOrderImportResponse> {
  const res = await apiClient.post<Envelope<QuickOrderImportResponse>>(
    '/api/v1/admin/quick-order/import',
    input,
  );
  return res.data;
}

export async function adminQuickOrderBuild(input: {
  target: QuickOrderTarget;
  items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
  onBehalfOf: OnBehalfOf;
}): Promise<QuickOrderBuildResponse> {
  const res = await apiClient.post<Envelope<QuickOrderBuildResponse>>(
    '/api/v1/admin/quick-order/build',
    input,
  );
  return res.data;
}

export type PreferenceScope = 'organization' | 'customer';

export interface QuickOrderPreference {
  scope: PreferenceScope;
  scopeId: string;
  defaultPaymentMethodId: string | null;
  defaultDeliveryMethodId: string | null;
  defaultBillingAddressId: string | null;
  defaultShippingAddressId: string | null;
}

export interface QuickOrderPreferenceUpsert {
  scope: PreferenceScope;
  scopeId: string;
  defaultPaymentMethodId?: string | null;
  defaultDeliveryMethodId?: string | null;
  defaultBillingAddressId?: string | null;
  defaultShippingAddressId?: string | null;
}

export async function adminGetPreference(
  scope: PreferenceScope,
  scopeId: string,
): Promise<QuickOrderPreference | null> {
  const res = await apiClient.get<Envelope<QuickOrderPreference | null>>(
    `/api/v1/admin/quick-order/preferences?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`,
  );
  return res.data;
}

export async function adminUpsertPreference(
  body: QuickOrderPreferenceUpsert,
): Promise<QuickOrderPreference> {
  const res = await apiClient.put<Envelope<QuickOrderPreference>>(
    '/api/v1/admin/quick-order/preferences',
    body,
  );
  return res.data;
}
