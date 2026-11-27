import { ApiError, defineEnumLabels } from '@endora-commerce/admin-kit/lib';
import type {
  DesignationNotInForceReason,
  ProductVisibilityOverviewResponse,
  ProductVisibilityRoleEffect,
  VisibilityThreshold,
  WebsiteRulePreviewResponse,
} from '@endora-commerce/contracts';

/**
 * The module's enum labels (`specs/conventions/module-i18n.md`): each value names a key in this
 * module's own bundle, resolved with `useTranslation('product_visibility_rules')`.
 */
export const thresholdLabels = defineEnumLabels<VisibilityThreshold>({
  gt_zero: 'threshold.gt_zero',
  gte_zero: 'threshold.gte_zero',
});

/** FR-024, FR-026 — what the module does to a role's admin reads. */
export const roleEffectLabels = defineEnumLabels<ProductVisibilityRoleEffect>({
  unrestricted: 'roleEffect.unrestricted',
  mapped_unrestricted: 'roleEffect.mapped_unrestricted',
  mapped: 'roleEffect.mapped',
  unmappable_unrestricted: 'roleEffect.unmappable_unrestricted',
  mapping_without_effect: 'roleEffect.mapping_without_effect',
  sees_no_products: 'roleEffect.sees_no_products',
});

/** FR-086 — the only permission warning. */
export const roleWarningLabels = defineEnumLabels<ProductVisibilityOverviewResponse['roles'][number]['warnings'][number]>({
  audit_logs_read: 'roleWarning.audit_logs_read',
});

/** US2-11 — why a designated book does not price its currency now. */
export const designationReasonLabels = defineEnumLabels<DesignationNotInForceReason>({
  not_found: 'designationReason.not_found',
  currency_mismatch: 'designationReason.currency_mismatch',
  not_regular: 'designationReason.not_regular',
  audience_restricted: 'designationReason.audience_restricted',
  not_on_channel: 'designationReason.not_on_channel',
  not_active: 'designationReason.not_active',
  outside_schedule: 'designationReason.outside_schedule',
});

export const previewStatusLabels = defineEnumLabels<WebsiteRulePreviewResponse['status']>({
  pending: 'previewStatus.pending',
  ready: 'previewStatus.ready',
  failed: 'previewStatus.failed',
  applied: 'previewStatus.applied',
  expired: 'previewStatus.expired',
});

type Role = ProductVisibilityOverviewResponse['roles'][number];

/**
 * A control that is `aria-disabled` while busy, not `disabled`: it keeps focus (WCAG 2.4.3) and
 * looks unavailable, and its handler ignores the press. The kit's controls style only `disabled:`.
 */
export const INERT_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** A role row's id on the configuration screen: the role editor links to `#role-<id>`, which focuses it. */
export const roleRowId = (roleId: string): string => `role-${roleId}`;

/** FR-022, FR-026 — the roles no mapping can be set for. */
export function isMappable(role: Role): boolean {
  return role.effect !== 'unmappable_unrestricted';
}

/** The effects under which a role sees every product (FR-025, FR-026). */
const UNRESTRICTED_EFFECTS: ReadonlySet<ProductVisibilityRoleEffect> = new Set([
  'unrestricted',
  'mapped_unrestricted',
  'unmappable_unrestricted',
  'mapping_without_effect',
]);

/**
 * TM-4 c — whether the signed-in operator's own role sees every product, the condition the API
 * puts on every write. An operator with no role, or one the overview does not list, is not.
 */
export function callerIsUnrestricted(overview: ProductVisibilityOverviewResponse, roleId: string | null | undefined): boolean {
  if (!roleId) return false;
  const role = overview.roles.find((r) => r.roleId === roleId);
  return role !== undefined && UNRESTRICTED_EFFECTS.has(role.effect);
}

/**
 * The sentence an API refusal carries — translated by the server in the request's language —
 * or the screen's own fallback for a failure that carries none. Never the code.
 */
export function refusalMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const message = err.envelope?.error?.message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return fallback;
}

/** The code of an API refusal (`VERSION_CONFLICT`, …), or `null` for a failure that carries none. */
export function refusalCode(err: unknown): string | null {
  if (err instanceof ApiError) {
    const code = err.envelope?.error?.code;
    if (typeof code === 'string' && code !== '') return code;
  }
  return null;
}

/** The refusals after which the rule shown is no longer the one stored (T103). */
export const STALE_RULE_CODES: ReadonlySet<string> = new Set(['VERSION_CONFLICT', 'WEBSITE_RULE_PREVIEW_STALE']);

/**
 * A per-language text in the operator's language: an exact tag, else the same language under any
 * region (`pl` matches `pl-PL` and the other way round), else `undefined`. Stores key these by
 * `pl`, `pl-PL` or `en-US` depending on the owner, so both shapes are read.
 */
export function localized(texts: Record<string, string> | null | undefined, language: string): string | undefined {
  if (!texts) return undefined;
  const entries = Object.entries(texts).filter(([, value]) => typeof value === 'string' && value !== '');
  const wanted = language.toLowerCase();
  const base = wanted.split('-')[0];
  return (
    entries.find(([tag]) => tag.toLowerCase() === wanted)?.[1] ??
    entries.find(([tag]) => tag.toLowerCase().split('-')[0] === base)?.[1]
  );
}

/** A sales channel's name in the operator's language, else English, else its code. */
export function channelName(
  channel: { code: string; name: Record<string, string> } | undefined,
  language: string,
  unknownLabel: string,
): string {
  if (!channel) return unknownLabel;
  return localized(channel.name, language) ?? localized(channel.name, 'en') ?? Object.values(channel.name)[0] ?? channel.code;
}
