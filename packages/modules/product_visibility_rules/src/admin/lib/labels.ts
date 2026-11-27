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

/** A sales channel's name in the operator's language, its code when it has none. */
export function channelName(
  channel: { code: string; name: Record<string, string> } | undefined,
  language: string,
  unknownLabel: string,
): string {
  if (!channel) return unknownLabel;
  const exact = Object.entries(channel.name).find(([lang]) => lang === language || lang.startsWith(`${language}-`));
  return exact?.[1] ?? channel.name['en-US'] ?? Object.values(channel.name)[0] ?? channel.code;
}
