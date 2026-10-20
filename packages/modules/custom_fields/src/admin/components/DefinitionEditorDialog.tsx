import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AlertDescription, Button, Checkbox, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  CustomFieldDefinitionDto,
  CustomFieldEntityTypeInfo,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { carryCounterpartsBrokenBy, type CarryCounterpart } from '../lib/carry-drift.js';
import { entityTypeLabelKey, refusalSentence } from '../lib/carry-labels.js';
import { sameLabel, withLanguages } from './localized-label.js';
import { CarryDriftNotice } from './CarryDriftWarning.js';
import { DefinitionBehaviourFields } from './DefinitionBehaviourFields.js';
import { DefinitionOptionsEditor, type CarryDriftGuard } from './DefinitionOptionsEditor.js';

export interface DefinitionEditorDialogProps {
  definition: CustomFieldDefinitionDto;
  /** The `entity-types` entry of the definition's type. */
  entityTypeInfo: CustomFieldEntityTypeInfo;
  /** Closed without a save (Cancel, Escape, the scrim) — option actions may still have changed it. */
  onClose: () => void;
  /** Saved; the dialog is done. */
  onSaved: () => void;
  /** Feature 158 — the entity-types list, to name a carry target. */
  entityTypes?: readonly CustomFieldEntityTypeInfo[];
  /**
   * Feature 158 — every definition the page knows, of every type, so an option
   * change can say which carries it breaks. The edited definition's own entry
   * is replaced by the dialog's latest read.
   */
  definitions?: readonly CustomFieldDefinitionDto[];
}

/** A pending drift warning: what it names, how it reads, and who is waiting for the answer. */
interface PendingDrift {
  counterparts: readonly CarryCounterpart[];
  lead?: string;
  destructive: boolean;
  resolve: (proceed: boolean) => void;
}

const sameTargets = (a: readonly SupportedEntityType[], b: readonly SupportedEntityType[]): boolean =>
  a.length === b.length && a.every((target) => b.includes(target));

const SELECT_TYPES = new Set(['select', 'multiselect']);

/**
 * Edits an existing custom-field definition (feature 157, US3;
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §3).
 *
 * The key, the entity type and the value type are shown, never offered. *Save*
 * sends **one** `PATCH` holding only the members the operator changed among
 * `labelDefault`, `label`, `required`, `listFilter` and `carryTo` (feature 158,
 * as the whole new list) — never `config`,
 * `options`, `valueType` or `key` (threat model F-6); nothing changed sends
 * nothing. Options are edited through their own sub-routes, one action at a
 * time, and the dialog re-reads the definition after each.
 */
export function DefinitionEditorDialog({
  definition,
  entityTypeInfo,
  onClose,
  onSaved,
  entityTypes = [],
  definitions = [],
}: DefinitionEditorDialogProps): ReactNode {
  const t = useTranslation('custom_fields');
  const id = useId();
  const [current, setCurrent] = useState(definition);
  const [labelDefault, setLabelDefault] = useState(definition.labelDefault);
  const [en, setEn] = useState(definition.label['en'] ?? '');
  const [pl, setPl] = useState(definition.label['pl'] ?? '');
  const [required, setRequired] = useState(definition.required);
  const [listFilter, setListFilter] = useState(definition.listFilter);
  const [carryTo, setCarryTo] = useState<SupportedEntityType[]>(definition.carryTo ?? []);
  const offersCarry = (entityTypeInfo.carryTargets ?? []).length > 0;
  const [labelInvalid, setLabelInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** An option action applies at once, so after one *Cancel* would undo nothing: it reads *Close*. */
  const [optionsTouched, setOptionsTouched] = useState(false);
  /**
   * Feature 158 — an option change that breaks a carry asks first. The question
   * takes the dialog's place rather than opening a second dialog over it: two
   * modals would both answer Escape and both trap focus. The editor stays
   * mounted under it (hidden), so a half-typed option survives a *Cancel*.
   */
  const [drift, setDrift] = useState<PendingDrift | null>(null);
  const driftCancelRef = useRef<HTMLButtonElement>(null);
  const driftOpener = useRef<HTMLElement | null>(null);

  const typeLabel = useCallback(
    (entityType: SupportedEntityType): string => t(entityTypeLabelKey(entityType, entityTypes)),
    [t, entityTypes],
  );

  const known = useMemo(
    () => [...definitions.filter((candidate) => candidate.id !== current.id), current],
    [definitions, current],
  );
  const carryGuard = useMemo<CarryDriftGuard>(
    () => ({
      brokenBy: (change) => carryCounterpartsBrokenBy(change, known),
      confirm: (counterparts, options = {}) =>
        new Promise<boolean>((resolve) => {
          driftOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setDrift({
            counterparts,
            ...(options.lead ? { lead: options.lead } : {}),
            destructive: options.destructive === true,
            resolve,
          });
        }),
    }),
    [known],
  );

  const settleDrift = useCallback(
    (proceed: boolean): void => {
      drift?.resolve(proceed);
      setDrift(null);
    },
    [drift],
  );

  // The question opens on *Cancel*; once answered, focus goes back to the control that asked.
  useEffect(() => {
    if (drift !== null) {
      driftCancelRef.current?.focus();
      return;
    }
    const opener = driftOpener.current;
    driftOpener.current = null;
    if (opener?.isConnected) opener.focus();
  }, [drift]);

  const reread = useCallback(async (): Promise<void> => {
    setOptionsTouched(true);
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
    if (offersCarry && !sameTargets(carryTo, definition.carryTo ?? [])) patch.carryTo = carryTo;
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
      // A carry refusal keeps the dialog open with a sentence built from `details`.
      setError(refusalSentence(t, err, typeLabel, t('customFields.editor.saveFailed')));
      setBusy(false);
    }
  };

  const labelErrorId = `${id}-label-error`;
  const requiredNoticeId = `${id}-required-notice`;
  const showRequiredNotice = required && !definition.required;
  return (
    <ModalDialog
      title={drift ? t('customFields.carry.warning.title') : t('customFields.editor.title', { key: definition.key })}
      onClose={drift ? (): void => settleDrift(false) : onClose}
      busy={busy}
      footer={
        drift ? (
          <>
            <Button ref={driftCancelRef} type="button" variant="outline" onClick={(): void => settleDrift(false)}>
              {t('customFields.carry.warning.cancel')}
            </Button>
            <Button
              type="button"
              variant={drift.destructive ? 'destructive' : 'default'}
              onClick={(): void => settleDrift(true)}
            >
              {t('customFields.carry.warning.proceed')}
            </Button>
          </>
        ) : (
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {optionsTouched ? t('customFields.editor.close') : t('customFields.editor.cancel')}
          </Button>
          <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void save()}>
            {t('customFields.editor.save')}
          </Button>
        </>
        )
      }
    >
      {drift ? (
        <CarryDriftNotice
          counterparts={drift.counterparts}
          typeLabel={typeLabel}
          {...(drift.lead ? { lead: drift.lead } : {})}
        />
      ) : null}
      <div className="space-y-5" hidden={drift !== null}>
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
          <p className="break-words text-sm text-muted-foreground">{t('customFields.editor.keyReadOnly')}</p>
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
              aria-describedby={showRequiredNotice ? requiredNoticeId : undefined}
              onChange={(event): void => setRequired(event.target.checked)}
            />
            {t('customFields.form.required')}
          </label>
          {/* A live region mounted before it has anything to say, so the notice is announced. */}
          <p
            id={requiredNoticeId}
            data-testid="required-notice"
            role="status"
            className={
              showRequiredNotice ? 'break-words rounded-md border bg-muted p-3 text-sm' : 'break-words text-sm'
            }
          >
            {showRequiredNotice ? t('customFields.editor.requiredNotice') : ''}
          </p>
        </fieldset>

        {SELECT_TYPES.has(definition.valueType) ? (
          <section aria-labelledby={`${id}-options`} className="space-y-2">
            <h3 id={`${id}-options`} className="text-sm font-semibold">
              {t('customFields.editor.section.options')}
            </h3>
            <p className="break-words text-sm text-muted-foreground">{t('customFields.editor.optionsNote')}</p>
            <DefinitionOptionsEditor definition={current} onChanged={reread} disabled={busy} carryGuard={carryGuard} />
          </section>
        ) : null}

        <DefinitionBehaviourFields
          definition={current}
          entityTypeInfo={entityTypeInfo}
          value={offersCarry ? { listFilter, carryTo } : { listFilter }}
          onChange={(next): void => {
            setListFilter(next.listFilter);
            if (next.carryTo !== undefined) setCarryTo(next.carryTo);
          }}
          entityTypes={entityTypes}
          disabled={busy}
        />
      </div>
    </ModalDialog>
  );
}
