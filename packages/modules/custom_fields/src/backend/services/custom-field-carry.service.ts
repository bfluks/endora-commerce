import {
  assessCustomFieldCarry,
  CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX,
  type CustomFieldCarryPlan,
  type CustomFieldCarryPort,
  type CustomFieldCarrySkip,
  type CustomFieldCarrySkipLabel,
  type SupportedEntityType,
} from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import { carryTargetsOf, isSupportedEntityType, SUPPORTED_ENTITIES } from './custom-field-registry.js';
import { coerce, isEmpty, type DefinitionSource } from './custom-field-value.service.js';

/**
 * The source definition's label as it reads now, for the skip to keep (owner
 * ruling 2026-10-21, V3) — a copy, never the cached definition's own map. The
 * source is always known here, a `target_missing` skip included.
 */
function labelOf(definition: CachedDefinition['definition']): CustomFieldCarrySkipLabel {
  // A definition's per-locale labels are not capped; a stored skip's are, so
  // the snapshot is cut to what a skip holds rather than dropped when read.
  // Cut in UTF-16 code units — what the schema's `.max` counts — never inside
  // a surrogate pair.
  const cut = (text: string): string => {
    if (text.length <= CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX) return text;
    const head = text.slice(0, CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX);
    return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
  };
  return {
    labelDefault: cut(definition.labelDefault),
    labels: Object.fromEntries(Object.entries(definition.label ?? {}).map(([locale, text]) => [locale, cut(text)])),
  };
}

/**
 * The carry port (`specs/162-custom-fields-value-carry/`, research R-5):
 * `custom_fields` computes which source values carry into a target bag, and
 * the module that owns the target persists the answer in its own write.
 *
 * Per source definition whose `carryTo` names the target type and whose value
 * is non-empty: a target value already held is kept (FR-009); a missing
 * same-key target, another value type or an internal value into a
 * customer-visible field is skipped with that reason; otherwise the value is
 * coerced by the **target** definition — the option question is asked per
 * value — and carried, or skipped `value_invalid`. Unrelated target fields,
 * required ones included, are never consulted.
 *
 * Either type's owner module absent → an empty plan: nothing carried, nothing
 * recorded (FR-005, FR-014). It writes nothing, audits nothing, emits nothing.
 * Every skip carries the source field's label snapshot (owner ruling
 * 2026-10-21, V3), so whoever records it can name the field without a
 * definitions read.
 * Key lookups are prototype-free: `constructor` is a valid key.
 */
export class CustomFieldCarryService implements CustomFieldCarryPort {
  constructor(
    private readonly definitions: DefinitionSource,
    private readonly isPresent: (moduleId: string) => boolean = (moduleId) =>
      effectiveState.isPresent(moduleId),
  ) {}

  async plan(input: {
    sourceType: SupportedEntityType;
    targetType: SupportedEntityType;
    sourceValues: Record<string, unknown>;
    targetValues: Record<string, unknown>;
  }): Promise<CustomFieldCarryPlan> {
    const { sourceType, targetType, sourceValues, targetValues } = input;
    const unchanged: CustomFieldCarryPlan = { values: { ...targetValues }, carried: [], skipped: [] };
    if (
      !this.ownerPresent(sourceType) ||
      !this.ownerPresent(targetType) ||
      !carryTargetsOf(sourceType).includes(targetType)
    ) {
      return unchanged;
    }

    const carrying = (await this.definitions.listForEntity(sourceType)).filter(
      ({ definition }) =>
        definition.carryTo.includes(targetType) &&
        Object.hasOwn(sourceValues, definition.key) &&
        !isEmpty(sourceValues[definition.key]),
    );
    if (carrying.length === 0) return unchanged;

    const targets = new Map<string, CachedDefinition>(
      (await this.definitions.listForEntity(targetType)).map((entry) => [entry.definition.key, entry]),
    );
    const values: Record<string, unknown> = { ...targetValues };
    const carried: string[] = [];
    const skipped: CustomFieldCarrySkip[] = [];

    for (const { definition } of carrying) {
      const key = definition.key;
      if (Object.hasOwn(targetValues, key) && !isEmpty(targetValues[key])) continue;
      const target = targets.get(key);
      const incompatibility = assessCustomFieldCarry(
        // The option question is asked of the value below, not of the option
        // sets: with no option sets on either side, `options_missing` cannot
        // arise, and an option the target lacks is `coerce`'s `value_invalid`.
        { valueType: definition.valueType, audience: definition.audience, options: [] },
        target
          ? { valueType: target.definition.valueType, audience: target.definition.audience, options: [] }
          : null,
      )[0];
      if (incompatibility !== undefined && incompatibility.reason !== 'options_missing') {
        skipped.push({ key, reason: incompatibility.reason, label: labelOf(definition) });
        continue;
      }
      const result = coerce(target!.definition.valueType, sourceValues[key], target!.options);
      if ('code' in result) {
        skipped.push({ key, reason: 'value_invalid', label: labelOf(definition) });
        continue;
      }
      values[key] = result.value;
      carried.push(key);
    }
    return { values, carried, skipped };
  }

  /** Whether `entityType` is served: its registry owner, if it names one, is present. */
  private ownerPresent(entityType: SupportedEntityType): boolean {
    if (!isSupportedEntityType(entityType)) return false;
    const owner = SUPPORTED_ENTITIES[entityType].ownerModuleId;
    return owner === undefined || this.isPresent(owner);
  }
}
