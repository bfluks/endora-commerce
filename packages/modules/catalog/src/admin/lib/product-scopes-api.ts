import type {
  OrganizationStatus,
  PatchProductScopesRequest,
  PatchProductScopesResponse,
  ProductScopes,
  ScopeMissingValue,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import type { ScopeContext } from '../components/ProductScopeEditor.js';

/**
 * Feature 162 (T088) — the product editor's calls to `…/scopes`, made the way
 * `ProductScopeEditor` already calls `…/scope-context` and `…/value-overrides`: through
 * the admin kit's client (`contracts/admin-scopes-api.md` §1–§2).
 */

const productPath = (productId: string): string =>
  `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}`;

/** §1 — the global values and every channel the product is in or has rows for. */
export async function getProductScopes(productId: string): Promise<ProductScopes> {
  const res = await apiClient.get<{ data: ProductScopes }>(`${productPath(productId)}/scopes`);
  return res.data;
}

/** §2 — one Command, one audit entry; an absent key is untouched, `null` inherits. */
export function patchProductScopes(
  productId: string,
  body: PatchProductScopesRequest,
): Promise<PatchProductScopesResponse> {
  return apiClient.patch<PatchProductScopesResponse>(`${productPath(productId)}/scopes`, body);
}

/** The member channels with their names and languages (feature 022). */
export async function getProductScopeContext(productId: string): Promise<ScopeContext> {
  const res = await apiClient.get<{ data: ScopeContext }>(`${productPath(productId)}/scope-context`);
  return res.data;
}

export type OrganizationLabels = Record<string, { name: string; status: OrganizationStatus }>;

/** Bounded so a long audience list cannot fan out into hundreds of reads. */
const ORGANIZATION_LABEL_LIMIT = 50;

/**
 * Names for organization ids the scopes answer carries (an audience list, its
 * non-members), so the warning of FR-030 can name them. Best effort: an id that cannot be
 * read (no permission, deleted) is simply absent and the caller shows a short id instead.
 */
export async function fetchOrganizationLabels(ids: readonly string[]): Promise<OrganizationLabels> {
  const unique = [...new Set(ids)].slice(0, ORGANIZATION_LABEL_LIMIT);
  const rows = await Promise.all(
    unique.map((id) =>
      apiClient
        .get<{ data: { id: string; name: string; status: OrganizationStatus } }>(
          `/api/v1/admin/organizations/${encodeURIComponent(id)}`,
        )
        .then((res) => res.data)
        .catch(() => null),
    ),
  );
  const labels: OrganizationLabels = {};
  for (const row of rows) {
    if (row && typeof row.name === 'string') labels[row.id] = { name: row.name, status: row.status };
  }
  return labels;
}

/** A short, stable stand-in for an organization whose name could not be read. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** One missing value (FR-041 vocabulary) in the operator's words. */
export function describeMissingValue(value: ScopeMissingValue, t: Translate): string {
  if (value === 'name') return t('productEditor.scopeControls.missing.name');
  if (value === 'urlKey') return t('productEditor.scopeControls.missing.urlKey');
  return t('productEditor.scopeControls.missing.attribute', { key: value.slice('attribute:'.length) });
}

/** `B2B · DE: name, URL key` — one gate pair. */
export function describeIncompletePair(
  pair: { channelId: string; languageCode: string; missing: readonly ScopeMissingValue[] },
  channelName: (channelId: string) => string,
  t: Translate,
): string {
  return t('productEditor.scopeControls.incompletePair', {
    channel: channelName(pair.channelId),
    language: pair.languageCode.toUpperCase(),
    missing: pair.missing.map((m) => describeMissingValue(m, t)).join(', '),
  });
}

/**
 * A refused scope write as one translated sentence. The error code never reaches the
 * operator; an unknown refusal gets the generic sentence, which says the edit is kept.
 */
export function scopeSaveErrorMessage(
  err: unknown,
  channelName: (channelId: string) => string,
  t: Translate,
  genericKey = 'productEditor.scopeControls.error.generic',
): string {
  if (!(err instanceof ApiError)) return t(genericKey);
  if (err.status === 403) return t('productEditor.scopeControls.error.forbidden');
  const { code, details } = err.envelope.error as { code: string; details?: Record<string, unknown> };
  if (code === 'SCOPE_INVALID' && details) {
    const channel = channelName(String(details['channelId'] ?? ''));
    if (details['reason'] === 'language_not_offered') {
      return t('productEditor.scopeControls.error.languageNotOffered', {
        channel,
        language: String(details['languageCode'] ?? '').toUpperCase(),
      });
    }
    return t('productEditor.scopeControls.error.notAMember', { channel });
  }
  if (code === 'VALIDATION_FAILED' && details?.['field'] === 'window') {
    return t('productEditor.scopeControls.error.window');
  }
  if (code === 'SCOPE_INCOMPLETE' && details && Array.isArray(details['pairs'])) {
    const pairs = details['pairs'] as Array<{
      channelId: string;
      languageCode: string;
      missing: ScopeMissingValue[];
    }>;
    return t('productEditor.scopeControls.error.incomplete', {
      details: pairs.map((pair) => describeIncompletePair(pair, channelName, t)).join('; '),
    });
  }
  return t(genericKey);
}
