import { storefrontQuoteRequestNegotiationSchema } from '@endora-commerce/contracts';
import { apiGetAuthed, apiMutate } from './mutations';
import { backendBaseUrl } from '../env.mjs';
import { activeChannelHeaders } from './channel-headers';

/**
 * Storefront Quote Requests bindings — feature 008 workflow.
 *
 * The backend exposes seven customer endpoints under
 * `/api/v1/quote-requests/*`:
 *   - GET   /                            list summaries
 *   - GET   /:id                         full detail (with optional comparison block)
 *   - POST  /                             create + submit (one-shot)
 *   - PATCH /:id                          customer-side draft edit
 *   - POST  /:id/accept-revision         accept a sales-rep revision
 *   - POST  /:id/reject-revision         reject a revision
 *   - POST  /:id/resubmit                clone into a new Pending RFQ
 */

export type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

export interface RfqItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  desiredUnitPrice: number | null;
  agreedUnitPrice: number | null;
  lineNote: string | null;
  lineCurrency: string;
  discountPercent: number | null;
  /** VAT rate (fraction, e.g. 0.23) applied to this line's net price. */
  taxRate?: number;
  /** Feature 159 — the line's group (`itemGroups[].id`), `null` = ungrouped. */
  groupId?: string | null;
  /** Feature 159 — order within the line's section. */
  position?: number;
}

/** Feature 159 — a group of a quote's lines, as the customer reply carries it (non-empty ones only). */
export interface RfqItemGroup {
  id: string;
  name: string;
  position: number;
}

export interface RfqEvent {
  id: string;
  eventType: string;
  actorCustomerAccountId: string | null;
  actorRoleLabel: string | null;
  payload: Record<string, unknown>;
  revisionId: string | null;
  createdAt: string;
}

export type RfqDiffEntry =
  | { kind: 'header_note'; before: string | null; after: string | null }
  | {
      kind: 'line_added';
      productId: string;
      productName: string;
      /** Feature 159 — present only for a product on several lines; `null` = ungrouped. */
      groupName?: string | null;
      quantity: number;
      agreedUnitPrice: number | null;
    }
  | { kind: 'line_removed'; productId: string; productName: string; groupName?: string | null }
  | {
      kind: 'line_quantity';
      productId: string;
      productName: string;
      groupName?: string | null;
      before: number;
      after: number;
    }
  | {
      kind: 'line_agreed_unit_price';
      productId: string;
      productName: string;
      groupName?: string | null;
      before: number | null;
      after: number | null;
    }
  /** Feature 159 — the arrangement of the lines changed; names nothing. */
  | { kind: 'grouping' };

export interface RfqComparison {
  diff: RfqDiffEntry[];
  lastSeenRevisionNumber: number;
  currentRevisionNumber: number;
}

export interface RfqDetail {
  id: string;
  businessId: string;
  organizationId: string;
  customerAccountId: string;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  currentRevisionNumber: number;
  lastCustomerSeenRevisionNumber: number;
  headerNote: string | null;
  cancellationReason: string | null;
  /** Feature 159 — the groups holding a line, in order; absent on an older backend. */
  itemGroups?: RfqItemGroup[];
  /** In display order. */
  items: RfqItem[];
  events: RfqEvent[];
  comparisonAgainstLastSeen: RfqComparison | null;
  submittedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  expiredAt: string | null;
  expiresAt: string | null;
  convertedOrderId: string | null;
  /** Flat VAT rate (fraction) applied to this quote's net prices. */
  taxRate?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RfqSummary {
  id: string;
  businessId: string;
  organizationId: string;
  customerAccountId: string;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  lineCount: number;
  totalAtCustomerPrice: number | null;
  totalAtAgreedPrice: number | null;
  /** Flat VAT rate (fraction) applied to this quote's net totals. */
  taxRate?: number;
  currency: string;
  submittedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  originalRequester?: { customerAccountId: string; displayName: string | null };
}

export interface CreateRfqLine {
  productId: string;
  variantId?: string;
  quantity: number;
  desiredUnitPrice?: number;
  lineNote?: string;
}

export async function listRfqs(sessionCookie: string): Promise<RfqSummary[]> {
  return apiGetAuthed<RfqSummary[]>({
    path: '/api/v1/quote-requests',
    sessionCookie,
  });
}

export async function getRfqById(sessionCookie: string, id: string): Promise<RfqDetail> {
  return apiGetAuthed<RfqDetail>({
    path: `/api/v1/quote-requests/${id}`,
    sessionCookie,
  });
}

export async function createRfq(
  sessionCookie: string,
  body: { headerNote?: string; items: CreateRfqLine[] },
): Promise<RfqDetail> {
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: '/api/v1/quote-requests',
    body,
    sessionCookie,
  });
  return result.data!;
}

export async function patchRfqDraft(
  sessionCookie: string,
  id: string,
  body: { headerNote?: string | null; items?: CreateRfqLine[] },
  expectedVersion: number,
): Promise<RfqDetail> {
  const result = await apiMutate<RfqDetail>({
    method: 'PATCH',
    path: `/api/v1/quote-requests/${id}`,
    body,
    sessionCookie,
    headers: { 'if-match': `"${expectedVersion}"` },
  });
  return result.data!;
}

export async function acceptRevision(
  sessionCookie: string,
  id: string,
  expectedRevisionNumber: number,
): Promise<RfqDetail> {
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/accept-revision`,
    body: { expectedRevisionNumber },
    sessionCookie,
  });
  return result.data!;
}

export async function rejectRevision(
  sessionCookie: string,
  id: string,
  expectedRevisionNumber: number,
  reason?: string,
): Promise<RfqDetail> {
  const body: Record<string, unknown> = { expectedRevisionNumber };
  if (reason) body.reason = reason;
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/reject-revision`,
    body,
    sessionCookie,
  });
  return result.data!;
}

export async function resubmitRfq(
  sessionCookie: string,
  id: string,
  headerNote?: string,
): Promise<RfqDetail> {
  const body = headerNote ? { headerNote } : {};
  const result = await apiMutate<RfqDetail>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/resubmit`,
    body,
    sessionCookie,
  });
  return result.data!;
}

export async function convertRfqToOrder(
  sessionCookie: string,
  id: string,
): Promise<{ cartId: string; checkoutUrl: string }> {
  const result = await apiMutate<{ cartId: string; checkoutUrl: string }>({
    method: 'POST',
    path: `/api/v1/quote-requests/${id}/convert-to-order`,
    body: {},
    sessionCookie,
  });
  return result.data!;
}

/**
 * Whether the signed-in buyer may propose prices on a quote request
 * (feature 146, FR-025) — the buyer's own effective value, nobody else's.
 *
 * Fetched per request with the session cookie and `cache: 'no-store'`
 * (`apiGetAuthed`); never through `unstable_cache` or any cache keyed without
 * the session, which would hand one buyer's lock to another (threat model T15).
 *
 * **Fails open**: no session, a failed read or an answer that does not parse
 * all return `true`, and the draft shows the input as it always has. This is a
 * display decision only — the API refuses a locked buyer's proposal in the
 * same request that would write it (FR-022), so the UI is never the guarantee.
 */
export async function getQuoteRequestNegotiation(sessionCookie: string | null): Promise<boolean> {
  if (!sessionCookie) return true;
  try {
    const data = await apiGetAuthed<unknown>({
      path: '/api/v1/quote-requests/price-negotiation',
      sessionCookie,
    });
    const parsed = storefrontQuoteRequestNegotiationSchema.safeParse(data);
    if (parsed.success) return parsed.data.priceProposalsAllowed;
    console.warn('[storefront] quote-request negotiation read returned an unexpected shape');
    return true;
  } catch (err) {
    // Fails open — the page shows the proposal input and the API still
    // enforces the lock — but never silently. The cookie is not logged.
    console.warn(
      '[storefront] quote-request negotiation read failed',
      err instanceof Error ? err.message : String(err),
    );
    return true;
  }
}

export async function getStorefrontQuoteRequestSettings(): Promise<{
  showAddToQuoteOnCard: boolean;
  showAddToQuoteOnPdp: boolean;
}> {
  const baseUrl = backendBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/storefront/settings/quote-requests`, {
      headers: await activeChannelHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return { showAddToQuoteOnCard: true, showAddToQuoteOnPdp: true };
    const body = (await res.json()) as {
      data: { showAddToQuoteOnCard: boolean; showAddToQuoteOnPdp: boolean };
    };
    return body.data;
  } catch {
    return { showAddToQuoteOnCard: true, showAddToQuoteOnPdp: true };
  }
}
