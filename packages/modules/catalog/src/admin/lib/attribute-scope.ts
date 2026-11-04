import type { AttributeScopeChangePreviewResponse } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 163 (FR-090) — an attribute's two scope flags and the preview of narrowing them
 * (`contracts/admin-scopes-api.md` §6).
 */

export interface AttributeScopeFlags {
  channelScoped: boolean;
  languageScoped: boolean;
}

export type AttributeScopePreview = AttributeScopeChangePreviewResponse['data'];

/** Turning either flag off narrows: values set at that level stop applying. */
export function isScopeNarrowing(current: AttributeScopeFlags, next: AttributeScopeFlags): boolean {
  return (current.channelScoped && !next.channelScoped) || (current.languageScoped && !next.languageScoped);
}

/** Both flags or `null` — an answer that carries only one of them is not read as a scope. */
export function scopeFlagsOf(attribute: { channelScoped?: unknown; languageScoped?: unknown }): AttributeScopeFlags | null {
  if (typeof attribute.channelScoped !== 'boolean' || typeof attribute.languageScoped !== 'boolean') return null;
  return { channelScoped: attribute.channelScoped, languageScoped: attribute.languageScoped };
}

/** `GET …/attributes/:key/scope-change-preview` with both requested flags spelled out. */
export async function previewAttributeScopeChange(
  attributeKey: string,
  next: AttributeScopeFlags,
): Promise<AttributeScopePreview> {
  const qs = `channelScoped=${String(next.channelScoped)}&languageScoped=${String(next.languageScoped)}`;
  const res = await apiClient.get<AttributeScopeChangePreviewResponse>(
    `/api/v1/admin/catalog/attributes/${encodeURIComponent(attributeKey)}/scope-change-preview?${qs}`,
  );
  return res.data;
}
