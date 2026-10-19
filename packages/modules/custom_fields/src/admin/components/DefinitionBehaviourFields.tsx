import { useId, type ReactNode } from 'react';
import { Checkbox } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldAudience,
  CustomFieldEntityTypeInfo,
  CustomFieldValueType,
  LocalizedLabel,
} from '@endora-commerce/contracts';

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
  value: { listFilter: boolean };
  onChange: (next: { listFilter: boolean }) => void;
  disabled?: boolean;
  /**
   * `stacked` (default): the controls over their help, in a block of their
   * own. `row`: for a flex-wrap form row — the controls sit in the row and the
   * help drops to a full-width line at the row's end.
   */
  layout?: 'stacked' | 'row';
}

/**
 * How a definition behaves beyond its value (feature 157,
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3): the
 * one block the create form and the editor dialog both render.
 *
 * Today it is the *Use as list filter* option, offered only where the entity
 * type's entry says the type has it. `definition` is passed although nothing
 * reads it yet, so the signature does not change when a behaviour depends on
 * the field itself — **this is the seam `custom-fields-value-carry` extends**,
 * by additive optional props, never by a restructure.
 */
export function DefinitionBehaviourFields({
  entityTypeInfo,
  value,
  onChange,
  disabled = false,
  layout = 'stacked',
}: DefinitionBehaviourFieldsProps): ReactNode {
  const t = useTranslation('custom_fields');
  const id = useId();
  if (!entityTypeInfo.listFilter) return null;
  const helpId = `${id}-help`;
  const control = (
      <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <Checkbox
          id={id}
          checked={value.listFilter}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event): void => onChange({ listFilter: event.target.checked })}
        />
        {t('customFields.listFilter.label')}
      </label>
  );
  if (layout === 'row') {
    return (
      <>
        {control}
        <p id={helpId} className="order-last basis-full break-words text-sm text-muted-foreground">
          {t('customFields.listFilter.help')}
        </p>
      </>
    );
  }
  return (
    <div className="space-y-1">
      {control}
      <p id={helpId} className="break-words text-sm text-muted-foreground">
        {t('customFields.listFilter.help')}
      </p>
    </div>
  );
}
