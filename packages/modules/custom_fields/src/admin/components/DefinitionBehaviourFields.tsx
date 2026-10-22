import { useId, type ReactNode, type Ref } from 'react';
import { Checkbox } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldAudience,
  CustomFieldEntityTypeInfo,
  CustomFieldValueType,
  LocalizedLabel,
  SupportedEntityType,
} from '@endora-commerce/contracts';
import { entityTypeLabelKey } from '../lib/carry-labels.js';

/**
 * The block's value. `carryTo` is present where the entity type offers carry
 * targets (feature 162) — a caller for a type that offers none leaves it out,
 * and `onChange` answers it back only when it was given or changed.
 */
export interface DefinitionBehaviourValue {
  listFilter: boolean;
  carryTo?: SupportedEntityType[];
}

export interface DefinitionBehaviourFieldsProps {
  /** The definition being created (the form's draft, no `id`) or edited. */
  definition: {
    id?: string;
    key: string;
    valueType: CustomFieldValueType;
    options: ReadonlyArray<{ value: string; label: LocalizedLabel; labelDefault: string }>;
    audience: CustomFieldAudience;
  };
  /** The `entity-types` entry of the definition's type. */
  entityTypeInfo: CustomFieldEntityTypeInfo;
  value: DefinitionBehaviourValue;
  onChange: (next: DefinitionBehaviourValue) => void;
  /** The entity-types list, to name a carry target; the bundle's own key without it. */
  entityTypes?: readonly CustomFieldEntityTypeInfo[];
  disabled?: boolean;
  /**
   * `stacked` (default): the controls over their help, in a block of their
   * own. `row`: for a flex-wrap form row — the controls sit in the row and the
   * help drops to a full-width line at the row's end.
   */
  layout?: 'stacked' | 'row';
  /**
   * A refused save's carry sentence (R16): shown beside the carry options,
   * describing their group and the ticked boxes, which it marks invalid.
   */
  carryError?: string | null;
  /** The carry error's element, focusable so the form can move focus to it. */
  carryErrorRef?: Ref<HTMLParagraphElement>;
}

/**
 * How a definition behaves beyond its value (feature 157,
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3): the
 * one block the create form and the editor dialog both render.
 *
 * - *Use as list filter*, offered only where the entity type's entry says the
 *   type has it (feature 157).
 * - *Carry value to …*, one checkbox per `entityTypeInfo.carryTargets` entry
 *   in the registry's order, none when the type has no target (feature 162,
 *   `specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §1.1).
 *   In the `stacked` layout (the editor dialog) each checkbox is described by
 *   its own help line, so a screen reader hears what turning it on does
 *   without reading the block's prose. In the narrow `row` layout (the create
 *   form) one shared line explains the whole group and describes the group,
 *   not each checkbox — a help line per target would wrap the row into a wall
 *   of near-identical sentences (owner ruling V2, 2026-10-21).
 */
export function DefinitionBehaviourFields({
  entityTypeInfo,
  value,
  onChange,
  entityTypes = [],
  disabled = false,
  layout = 'stacked',
  carryError = null,
  carryErrorRef,
}: DefinitionBehaviourFieldsProps): ReactNode {
  const t = useTranslation('custom_fields');
  const id = useId();
  // `?? []`: an entry read from a server older than feature 162 has no marker.
  const carryTargets = entityTypeInfo.carryTargets ?? [];
  const carryTo = value.carryTo ?? [];
  if (!entityTypeInfo.listFilter && carryTargets.length === 0) return null;
  const helpId = `${id}-help`;
  const carryGroupHelpId = `${id}-carry-help`;
  const carryErrorId = `${id}-carry-error`;
  const describedBy = (...ids: ReadonlyArray<string | false | undefined>): string | undefined =>
    ids.filter(Boolean).join(' ') || undefined;

  const emit = (next: Partial<DefinitionBehaviourValue>): void =>
    onChange({
      listFilter: next.listFilter ?? value.listFilter,
      ...(value.carryTo !== undefined || next.carryTo !== undefined ? { carryTo: next.carryTo ?? carryTo } : {}),
    });

  const listFilterControl = entityTypeInfo.listFilter ? (
    <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm font-medium">
      <Checkbox
        id={id}
        checked={value.listFilter}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(event): void => emit({ listFilter: event.target.checked })}
      />
      {t('customFields.listFilter.label')}
    </label>
  ) : null;
  const listFilterHelp = (className: string): ReactNode =>
    entityTypeInfo.listFilter ? (
      <p id={helpId} className={className}>
        {t('customFields.listFilter.help')}
      </p>
    ) : null;

  const carryControls = carryTargets.map((target) => {
    const controlId = `${id}-carry-${target}`;
    const entityType = t(entityTypeLabelKey(target, entityTypes));
    // A refusal is about a ticked target: an unticked box is not wrong.
    const invalid = carryError !== null && carryTo.includes(target);
    return {
      target,
      control: (
        <label key={controlId} htmlFor={controlId} className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <Checkbox
            id={controlId}
            checked={carryTo.includes(target)}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy(layout !== 'row' && `${controlId}-help`, invalid && carryErrorId)}
            onChange={(event): void =>
              emit({
                // Kept in the registry's order, whatever order they were ticked in.
                carryTo: event.target.checked
                  ? carryTargets.filter((candidate) => candidate === target || carryTo.includes(candidate))
                  : carryTo.filter((candidate) => candidate !== target),
              })
            }
          />
          {t('customFields.carry.toggle', { entityType })}
        </label>
      ),
      help: (className: string): ReactNode => (
        <p key={`${controlId}-help`} id={`${controlId}-help`} className={className}>
          {t('customFields.carry.help', { entityType })}
        </p>
      ),
    };
  });

  const carryErrorLine = (className: string): ReactNode =>
    carryError !== null ? (
      <p
        id={carryErrorId}
        ref={carryErrorRef}
        tabIndex={-1}
        data-testid="carry-error"
        className={`${className} rounded-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        {carryError}
      </p>
    ) : null;

  if (layout === 'row') {
    const help = 'order-last basis-full break-words text-sm text-muted-foreground';
    return (
      <>
        {listFilterControl}
        {carryControls.length > 0 ? (
          <div
            role="group"
            aria-label={t('customFields.carry.legend')}
            aria-describedby={describedBy(carryGroupHelpId, carryError !== null && carryErrorId)}
            className="flex flex-wrap items-center gap-x-4"
          >
            {carryControls.map((item) => item.control)}
          </div>
        ) : null}
        {listFilterHelp(help)}
        {carryControls.length > 0 ? (
          <p id={carryGroupHelpId} className={help}>
            {t('customFields.carry.helpGroup')}
          </p>
        ) : null}
        {carryControls.length > 0 ? carryErrorLine('order-last basis-full break-words text-sm') : null}
      </>
    );
  }
  const help = 'break-words text-sm text-muted-foreground';
  return (
    <div className="space-y-3">
      {listFilterControl ? (
        <div className="space-y-1">
          {listFilterControl}
          {listFilterHelp(help)}
        </div>
      ) : null}
      {carryControls.length > 0 ? (
        <fieldset
          className="space-y-2"
          aria-describedby={carryError !== null ? carryErrorId : undefined}
        >
          <legend className="text-sm font-semibold">{t('customFields.carry.legend')}</legend>
          {carryControls.map((item) => (
            <div key={item.target} className="space-y-1">
              {item.control}
              {item.help(help)}
            </div>
          ))}
          {carryErrorLine('break-words text-sm')}
        </fieldset>
      ) : null}
    </div>
  );
}
