import { useCallback, useId, useState, type ReactNode } from 'react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { sameLabel, withLanguages } from './localized-label.js';
import { DefinitionBehaviourFields } from './DefinitionBehaviourFields.js';
import { DefinitionOptionsEditor } from './DefinitionOptionsEditor.js';

export interface DefinitionEditorDialogProps {
  definition: CustomFieldDefinitionDto;
  /** The `entity-types` entry of the definition's type. */
  entityTypeInfo: CustomFieldEntityTypeInfo;
  /** Closed without a save (Cancel, Escape, the scrim) — option actions may still have changed it. */
  onClose: () => void;
  /** Saved; the dialog is done. */
  onSaved: () => void;
}

const SELECT_TYPES = new Set(['select', 'multiselect']);

/**
 * Edits an existing custom-field definition (feature 157, US3;
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3).
 *
 * The key, the entity type and the value type are shown, never offered. *Save*
 * sends **one** `PATCH` holding only the members the operator changed among
 * `labelDefault`, `label`, `required` and `listFilter` — never `config`,
 * `options`, `valueType` or `key` (threat model F-6); nothing changed sends
 * nothing. Options are edited through their own sub-routes, one action at a
 * time, and the dialog re-reads the definition after each.
 */
export function DefinitionEditorDialog({ definition, entityTypeInfo, onClose, onSaved }: DefinitionEditorDialogProps): ReactNode {
  const t = useTranslation('custom_fields');
  const id = useId();
  const [current, setCurrent] = useState(definition);
  const [labelDefault, setLabelDefault] = useState(definition.labelDefault);
  const [en, setEn] = useState(definition.label['en'] ?? '');
  const [pl, setPl] = useState(definition.label['pl'] ?? '');
  const [required, setRequired] = useState(definition.required);
  const [listFilter, setListFilter] = useState(definition.listFilter);
  const [labelInvalid, setLabelInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reread = useCallback(async (): Promise<void> => {
    setCurrent(await customFieldsClient.get(definition.id));
  }, [definition.id]);

  const save = async (): Promise<void> => {
    const trimmedDefault = labelDefault.trim();
    if (trimmedDefault === '') {
      setLabelInvalid(true);
      return;
    }
    setLabelInvalid(false);
    const patch: UpdateCustomFieldDefinitionRequest = {};
    if (trimmedDefault !== definition.labelDefault) patch.labelDefault = trimmedDefault;
    const label = withLanguages(definition.label, en, pl);
    if (!sameLabel(label, definition.label)) patch.label = label;
    if (required !== definition.required) patch.required = required;
    if (listFilter !== definition.listFilter) patch.listFilter = listFilter;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await customFieldsClient.update(definition.id, patch);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('customFields.editor.saveFailed'));
      setBusy(false);
    }
  };

  const labelErrorId = `${id}-label-error`;
  return (
    <ModalDialog
      title={t('customFields.editor.title', { key: definition.key })}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('customFields.editor.cancel')}
          </Button>
          <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void save()}>
            {t('customFields.editor.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby={`${id}-identity`} className="space-y-2">
          <h3 id={`${id}-identity`} className="text-sm font-semibold">
            {t('customFields.editor.section.identity')}
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('customFields.editor.key')}</dt>
            <dd>
              <code className="font-mono text-xs">{definition.key}</code>
            </dd>
            <dt className="text-muted-foreground">{t('customFields.editor.entityType')}</dt>
            <dd>{t(entityTypeInfo.labelKey)}</dd>
            <dt className="text-muted-foreground">{t('customFields.editor.valueType')}</dt>
            <dd>{t(`customFields.valueType.${definition.valueType}`)}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">{t('customFields.editor.keyReadOnly')}</p>
        </section>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t('customFields.editor.section.labels')}</legend>
          <div className="space-y-1">
            <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
            <Input
              id={`${id}-default`}
              value={labelDefault}
              disabled={busy}
              aria-invalid={labelInvalid || undefined}
              aria-describedby={labelInvalid ? labelErrorId : undefined}
              onChange={(event): void => setLabelDefault(event.target.value)}
            />
            {labelInvalid ? (
              <p id={labelErrorId} role="alert" className="text-sm text-destructive">
                {t('customFields.editor.labelDefaultRequired')}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-en`}>{t('customFields.editor.labelEn')}</Label>
              <Input id={`${id}-en`} value={en} disabled={busy} onChange={(event): void => setEn(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-pl`}>{t('customFields.editor.labelPl')}</Label>
              <Input id={`${id}-pl`} value={pl} disabled={busy} onChange={(event): void => setPl(event.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t('customFields.editor.section.rules')}</legend>
          <label htmlFor={`${id}-required`} className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox
              id={`${id}-required`}
              checked={required}
              disabled={busy}
              onChange={(event): void => setRequired(event.target.checked)}
            />
            {t('customFields.form.required')}
          </label>
          {required && !definition.required ? (
            <p className="rounded-md border bg-muted p-3 text-sm">{t('customFields.editor.requiredNotice')}</p>
          ) : null}
        </fieldset>

        {SELECT_TYPES.has(definition.valueType) ? (
          <section aria-labelledby={`${id}-options`} className="space-y-2">
            <h3 id={`${id}-options`} className="text-sm font-semibold">
              {t('customFields.editor.section.options')}
            </h3>
            <DefinitionOptionsEditor definition={current} onChanged={reread} disabled={busy} />
          </section>
        ) : null}

        <DefinitionBehaviourFields
          definition={current}
          entityTypeInfo={entityTypeInfo}
          value={{ listFilter }}
          onChange={(next): void => setListFilter(next.listFilter)}
          disabled={busy}
        />
      </div>
    </ModalDialog>
  );
}
