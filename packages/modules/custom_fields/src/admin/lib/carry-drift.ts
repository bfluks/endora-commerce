import {
  assessCustomFieldCarry,
  type CustomFieldAudience,
  type CustomFieldDefinitionDto,
  type SupportedEntityType,
} from '@endora-commerce/contracts';

/**
 * A change an operator is about to make to one definition, as the drift
 * warning reads it (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §1.4).
 * The value type is not here: the admin never edits it.
 */
export type DefinitionChange =
  | { kind: 'remove-option'; definitionId: string; optionValue: string }
  | { kind: 'add-option'; definitionId: string; optionValue: string }
  | { kind: 'audience'; definitionId: string; audience: CustomFieldAudience }
  | { kind: 'delete'; definitionId: string };

/** The field on the other side of a carry, and which side it is on. */
export interface CarryCounterpart {
  entityType: SupportedEntityType;
  key: string;
  role: 'source' | 'target';
}

/** What the warning reads of a definition — a `CustomFieldDefinitionDto` is one. */
export interface CarryDriftDefinition {
  id: string;
  entityType: SupportedEntityType;
  key: string;
  valueType: CustomFieldDefinitionDto['valueType'];
  audience: CustomFieldAudience;
  options: ReadonlyArray<{ value: string }>;
  /** Absent on a definition read before feature 162 — it carries nothing. */
  carryTo?: readonly SupportedEntityType[];
}

type Definition = CarryDriftDefinition;

/** The same-key definition of `entityType`, looked up without touching an object's prototype. */
function sameKey(
  index: ReadonlyMap<string, Definition>,
  entityType: SupportedEntityType,
  key: string,
): Definition | null {
  return index.get(`${entityType}\u0000${key}`) ?? null;
}

function indexByTypeAndKey(definitions: readonly Definition[]): Map<string, Definition> {
  const index = new Map<string, Definition>();
  for (const definition of definitions) index.set(`${definition.entityType}\u0000${definition.key}`, definition);
  return index;
}

function compatible(source: Definition, target: Definition | null): boolean {
  return assessCustomFieldCarry(source, target).length === 0;
}

/** `definition` as it would be once `change` applied — `null` for a deletion. */
function applied(definition: Definition, change: DefinitionChange): Definition | null {
  switch (change.kind) {
    case 'delete':
      return null;
    case 'audience':
      return { ...definition, audience: change.audience };
    case 'remove-option':
      return { ...definition, options: definition.options.filter((option) => option.value !== change.optionValue) };
    case 'add-option':
      return definition.options.some((option) => option.value === change.optionValue)
        ? definition
        : { ...definition, options: [...definition.options, { value: change.optionValue }] };
  }
}

/**
 * The enabled carries this change turns from compatible to incompatible — or,
 * for `delete`, every enabled carry the definition is part of — named by their
 * counterpart field. A carry already incompatible before the change is not
 * reported again: the table's *Incompatible* mark already says so.
 *
 * Pure; the answer follows the order of `definitions`, each counterpart once.
 */
export function carryCounterpartsBrokenBy(
  change: DefinitionChange,
  definitions: readonly Definition[],
): CarryCounterpart[] {
  const changed = definitions.find((definition) => definition.id === change.definitionId);
  if (changed === undefined) return [];
  const index = indexByTypeAndKey(definitions);
  const after = applied(changed, change);
  const found: CarryCounterpart[] = [];
  const seen = new Set<string>();
  const report = (counterpart: CarryCounterpart): void => {
    const id = `${counterpart.role}\u0000${counterpart.entityType}\u0000${counterpart.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    found.push(counterpart);
  };

  // The changed definition as the source of a carry: its targets.
  for (const targetType of changed.carryTo ?? []) {
    const target = sameKey(index, targetType, changed.key);
    if (target === null) continue;
    const breaks = after === null ? true : compatible(changed, target) && !compatible(after, target);
    if (breaks) report({ entityType: targetType, key: changed.key, role: 'target' });
  }

  // The changed definition as the target of a carry: the sources carrying into it.
  for (const source of definitions) {
    if (source.id === changed.id || source.key !== changed.key) continue;
    if (!(source.carryTo ?? []).includes(changed.entityType)) continue;
    const breaks = after === null ? true : compatible(source, changed) && !compatible(source, after);
    if (breaks) report({ entityType: source.entityType, key: source.key, role: 'source' });
  }

  return found;
}

/** The proceed button of a drift warning, as the change it confirms reads (owner ruling V1, 2026-10-21). */
export interface CarryDriftProceed {
  /** A `custom_fields` bundle key naming the action. */
  labelKey: string;
  /** A removal or a deletion reads as destructive; an audience change or an added option does not. */
  destructive: boolean;
}

/**
 * What the drift warning's proceed button says and how it looks, for the kind
 * of change it confirms — the one mapping the page's dialog and the editor's
 * in-place warning both read, so the two can never name the same action apart.
 */
export function carryDriftProceed(kind: DefinitionChange['kind']): CarryDriftProceed {
  switch (kind) {
    case 'delete':
      return { labelKey: 'customFields.carry.warning.proceedDeleteField', destructive: true };
    case 'remove-option':
      return { labelKey: 'customFields.carry.warning.proceedRemoveOption', destructive: true };
    case 'add-option':
      return { labelKey: 'customFields.carry.warning.proceedAddOption', destructive: false };
    case 'audience':
      return { labelKey: 'customFields.carry.warning.proceedChangeAudience', destructive: false };
  }
}
