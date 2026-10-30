import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  ERROR_CODES,
  type CustomFieldCarryIncompatibility,
  type CustomFieldEntityTypeInfo,
  type SupportedEntityType,
} from '@endora-commerce/contracts';

/** The translator `useTranslation('custom_fields')` answers. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A key shown to an operator is cut here (`admin-surfaces.md`: "truncated to 64 characters"). */
export const SHOWN_KEY_LIMIT = 64;

export function shownKey(key: string): string {
  return key.length > SHOWN_KEY_LIMIT ? `${key.slice(0, SHOWN_KEY_LIMIT)}…` : key;
}

/**
 * The bundle key naming an entity type: the server's `labelKey` where the
 * entity-types list has the type, else `customFields.entity.<camelCase type>`
 * (`quote_request` → `quoteRequest`), the keys the bundle ships.
 */
export function entityTypeLabelKey(
  entityType: SupportedEntityType,
  entityTypes: readonly CustomFieldEntityTypeInfo[],
): string {
  const listed = entityTypes.find((info) => info.entityType === entityType);
  if (listed) return listed.labelKey;
  return `customFields.entity.${entityType.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())}`;
}

/** One incompatibility as the sentence the table shows under an *Incompatible* chip. */
export function incompatibilitySentence(
  t: Translate,
  reason: CustomFieldCarryIncompatibility,
  entityType: string,
  key: string,
): string {
  switch (reason.reason) {
    case 'target_missing':
      return t('customFields.carry.reason.target_missing', { entityType, key: shownKey(key) });
    case 'value_type_mismatch':
      return t('customFields.carry.reason.value_type_mismatch', {
        entityType,
        sourceValueType: t(`customFields.valueType.${reason.sourceValueType}`),
        targetValueType: t(`customFields.valueType.${reason.targetValueType}`),
      });
    case 'options_missing':
      return t('customFields.carry.reason.options_missing', {
        entityType,
        missingOptionValues: reason.missingOptionValues.join(', '),
      });
    case 'audience_mismatch':
      return t('customFields.carry.reason.audience_mismatch', { entityType });
  }
}

/** The refusal tokens `CUSTOM_FIELD_CARRY_INCOMPATIBLE` names in `details.code`. */
const REFUSAL_TOKENS = new Set([
  'target_missing',
  'value_type_mismatch',
  'options_missing',
  'audience_mismatch',
  'pair_unsupported',
  'target_unavailable',
]);

const VALUE_TYPES = new Set(['text', 'number', 'boolean', 'date', 'select', 'multiselect']);

/**
 * A refused save as one sentence — never its code. A carry refusal is built
 * from `details` in the operator's language, the type and value-type names
 * translated (an unknown `details.code` keeps the server's sentence); any other
 * API refusal is the server's own sentence, as this page showed before, and a
 * failure without an envelope is `fallback`.
 */
export function refusalSentence(
  t: Translate,
  error: unknown,
  typeLabel: (entityType: SupportedEntityType) => string,
  fallback: string,
): string {
  if (!(error instanceof ApiError)) return fallback;
  const { code, message, details } = error.envelope.error;
  if (code === ERROR_CODES.CUSTOM_FIELD_CARRY_INCOMPATIBLE && details && !Array.isArray(details)) {
    const token = typeof details['code'] === 'string' ? details['code'] : '';
    if (REFUSAL_TOKENS.has(token)) {
      const text = (name: string): string => (typeof details[name] === 'string' ? (details[name] as string) : '');
      const valueType = (name: string): string =>
        VALUE_TYPES.has(text(name)) ? t(`customFields.valueType.${text(name)}`) : text(name);
      const list = details['missingOptionValueList'];
      return t(`errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.${token}`, {
        key: shownKey(text('key')),
        targetEntityType: text('targetEntityType') === '' ? '' : typeLabel(text('targetEntityType') as SupportedEntityType),
        sourceValueType: valueType('sourceValueType'),
        targetValueType: valueType('targetValueType'),
        missingOptionValues: Array.isArray(list) ? list.map(String).join(', ') : text('missingOptionValues'),
      });
    }
  }
  return message;
}

/**
 * Whether a refused save is a carry refusal, which the forms show beside the
 * carry options rather than with the other errors (R16).
 */
export function isCarryRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.envelope.error.code === ERROR_CODES.CUSTOM_FIELD_CARRY_INCOMPATIBLE;
}
