import { useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Button, Checkbox, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ReorderAnnouncer, TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { CustomFieldDefinitionDto, CustomFieldOptionDto, LocalizedLabel } from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import { sameLabel, withLanguages } from './localized-label.js';

export interface DefinitionOptionsEditorProps {
  definition: CustomFieldDefinitionDto;
  /** Re-reads the definition after an option action. */
  onChanged: () => Promise<void>;
  disabled?: boolean;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The server's sentence for a refusal — never its code — else the generic one. */
function sentenceOf(error: unknown, t: Translate): string {
  return error instanceof ApiError ? error.envelope.error.message : t('customFields.editor.option.failed');
}

/**
 * The options of a select / multiselect definition, edited one action at a
 * time through the option sub-routes (feature 157, `admin-surfaces.md` §3.1).
 * An option's stored value is shown, never edited; an action sends only that
 * option's changed members. After every action the dialog re-reads the
 * definition.
 */
export function DefinitionOptionsEditor({ definition, onChanged, disabled = false }: DefinitionOptionsEditorProps): ReactNode {
  const t = useTranslation('custom_fields');
  const [announcement, setAnnouncement] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState(false);
  const options = [...definition.options].sort((a, b) => a.sortOrder - b.sortOrder);

  const setRowError = (optionId: string, message: string | null): void =>
    setRowErrors((current) => {
      const next = { ...current };
      if (message === null) delete next[optionId];
      else next[optionId] = message;
      return next;
    });

  const move = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction;
    const moved = options[index];
    if (moved?.id === undefined || target < 0 || target >= options.length) return;
    const order = [...options];
    order.splice(index, 1);
    order.splice(target, 0, moved);
    setMoving(true);
    setRowError(moved.id, null);
    try {
      // Only the options whose position changed are patched.
      for (const [position, option] of order.entries()) {
        if (option.id !== undefined && option.sortOrder !== position) {
          await customFieldsClient.updateOption(definition.id, option.id, { sortOrder: position });
        }
      }
      setAnnouncement(
        t(direction < 0 ? 'customFields.editor.option.moveUp' : 'customFields.editor.option.moveDown', {
          label: moved.labelDefault,
          position: target + 1,
          count: order.length,
        }),
      );
      await onChanged();
    } catch (error) {
      setRowError(moved.id, sentenceOf(error, t));
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="space-y-3">
      <ReorderAnnouncer message={announcement} />
      {options.map((option, index) => (
        <OptionRow
          key={`${option.id ?? option.value}:${option.labelDefault}:${JSON.stringify(option.label)}:${String(option.isDefault)}`}
          definitionId={definition.id}
          option={option}
          error={option.id === undefined ? undefined : rowErrors[option.id]}
          setError={(message): void => {
            if (option.id !== undefined) setRowError(option.id, message);
          }}
          onChanged={onChanged}
          disabled={disabled || moving}
          reorder={
            <TouchReorderButtons
              onMoveUp={(): void => void move(index, -1)}
              onMoveDown={(): void => void move(index, 1)}
              disableUp={index === 0}
              disableDown={index === options.length - 1}
              disabled={disabled || moving}
            />
          }
          t={t}
        />
      ))}
      <AddOptionRow
        definitionId={definition.id}
        nextSortOrder={options.reduce((max, option) => Math.max(max, option.sortOrder), -1) + 1}
        onChanged={onChanged}
        disabled={disabled}
        t={t}
      />
    </div>
  );
}

interface OptionRowProps {
  definitionId: string;
  option: CustomFieldOptionDto;
  error: string | undefined;
  setError: (message: string | null) => void;
  onChanged: () => Promise<void>;
  disabled: boolean;
  reorder: ReactNode;
  t: Translate;
}

function OptionRow({ definitionId, option, error, setError, onChanged, disabled, reorder, t }: OptionRowProps): ReactNode {
  const id = useId();
  const [labelDefault, setLabelDefault] = useState(option.labelDefault);
  const [en, setEn] = useState(option.label['en'] ?? '');
  const [pl, setPl] = useState(option.label['pl'] ?? '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const optionId = option.id;

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    if (optionId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(sentenceOf(err, t));
    } finally {
      setBusy(false);
    }
  };

  const commitLabels = (): void => {
    if (optionId === undefined) return;
    const trimmedDefault = labelDefault.trim();
    if (trimmedDefault === '') {
      setError(t('customFields.editor.labelDefaultRequired'));
      return;
    }
    const label = withLanguages(option.label, en, pl);
    const patch: { labelDefault?: string; label?: LocalizedLabel } = {};
    if (trimmedDefault !== option.labelDefault) patch.labelDefault = trimmedDefault;
    if (!sameLabel(label, option.label)) patch.label = label;
    if (Object.keys(patch).length === 0) return;
    void act(() => customFieldsClient.updateOption(definitionId, optionId, patch));
  };

  const locked = disabled || busy;
  const errorId = `${id}-error`;
  return (
    <div role="group" aria-label={option.labelDefault} aria-busy={busy} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">{t('customFields.editor.option.value')}: </span>
          <code className="font-mono text-xs">{option.value}</code>
        </p>
        {reorder}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
          <Input
            id={`${id}-default`}
            value={labelDefault}
            disabled={locked}
            aria-describedby={error ? errorId : undefined}
            onChange={(event): void => setLabelDefault(event.target.value)}
            onBlur={commitLabels}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-en`}>{t('customFields.editor.labelEn')}</Label>
          <Input id={`${id}-en`} value={en} disabled={locked} onChange={(event): void => setEn(event.target.value)} onBlur={commitLabels} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-pl`}>{t('customFields.editor.labelPl')}</Label>
          <Input id={`${id}-pl`} value={pl} disabled={locked} onChange={(event): void => setPl(event.target.value)} onBlur={commitLabels} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-is-default`} className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            id={`${id}-is-default`}
            checked={option.isDefault}
            disabled={locked}
            onChange={(event): void => {
              const isDefault = event.target.checked;
              if (optionId !== undefined) void act(() => customFieldsClient.updateOption(definitionId, optionId, { isDefault }));
            }}
          />
          {t('customFields.editor.option.default')}
        </label>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t('customFields.editor.option.removeConfirm', { label: option.labelDefault })}</span>
            <Button type="button" variant="outline" size="sm" disabled={locked} onClick={(): void => setConfirming(false)}>
              {t('customFields.editor.option.keep')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={locked}
              onClick={(): void => {
                setConfirming(false);
                if (optionId !== undefined) void act(() => customFieldsClient.removeOption(definitionId, optionId));
              }}
            >
              {t('customFields.editor.option.remove')}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={(): void => setConfirming(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('customFields.editor.option.remove')}
          </Button>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface AddOptionRowProps {
  definitionId: string;
  nextSortOrder: number;
  onChanged: () => Promise<void>;
  disabled: boolean;
  t: Translate;
}

function AddOptionRow({ definitionId, nextSortOrder, onChanged, disabled, t }: AddOptionRowProps): ReactNode {
  const id = useId();
  const [value, setValue] = useState('');
  const [labelDefault, setLabelDefault] = useState('');
  const [en, setEn] = useState('');
  const [pl, setPl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;

  const add = async (): Promise<void> => {
    const trimmedValue = value.trim();
    const trimmedDefault = labelDefault.trim();
    if (trimmedValue === '' || trimmedDefault === '') {
      setInvalid(true);
      setError(t('customFields.editor.option.addRequired'));
      return;
    }
    setInvalid(false);
    setError(null);
    setBusy(true);
    try {
      await customFieldsClient.createOption(definitionId, {
        value: trimmedValue,
        labelDefault: trimmedDefault,
        label: withLanguages({}, en, pl),
        isDefault: false,
        sortOrder: nextSortOrder,
      });
      setValue('');
      setLabelDefault('');
      setEn('');
      setPl('');
      await onChanged();
    } catch (err) {
      setError(sentenceOf(err, t));
    } finally {
      setBusy(false);
    }
  };

  const locked = disabled || busy;
  const describedBy = error ? errorId : undefined;
  return (
    <div role="group" aria-label={t('customFields.editor.option.add')} aria-busy={busy} className="space-y-2 rounded-md border border-dashed p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-value`}>{t('customFields.editor.option.value')}</Label>
          <Input
            id={`${id}-value`}
            value={value}
            disabled={locked}
            aria-invalid={invalid && value.trim() === '' ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event): void => setValue(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
          <Input
            id={`${id}-default`}
            value={labelDefault}
            disabled={locked}
            aria-invalid={invalid && labelDefault.trim() === '' ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event): void => setLabelDefault(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-en`}>{t('customFields.editor.labelEn')}</Label>
          <Input id={`${id}-en`} value={en} disabled={locked} onChange={(event): void => setEn(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-pl`}>{t('customFields.editor.labelPl')}</Label>
          <Input id={`${id}-pl`} value={pl} disabled={locked} onChange={(event): void => setPl(event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" disabled={locked} onClick={(): void => void add()}>
          {t('customFields.editor.option.add')}
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
