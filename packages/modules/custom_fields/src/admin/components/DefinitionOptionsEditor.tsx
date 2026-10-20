import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Button, Checkbox, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ReorderAnnouncer, TouchReorderButtons, resolveCustomFieldLabel } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { ERROR_CODES, type CustomFieldDefinitionDto, type CustomFieldOptionDto, type LocalizedLabel } from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import type { CarryCounterpart, DefinitionChange } from '../lib/carry-drift.js';
import { sameLabel, withLanguages } from './localized-label.js';

/**
 * Asks before an option change that breaks an enabled carry (feature 158,
 * `specs/158-custom-fields-value-carry/contracts/admin-surfaces.md` §1.4). The
 * dialog that renders this editor owns the question; the editor only says
 * which change it is about to make.
 */
export interface CarryDriftGuard {
  /** The enabled carries `change` would break; `[]` asks nothing. */
  brokenBy: (change: DefinitionChange) => CarryCounterpart[];
  /** Shows the warning; answers `true` once the operator proceeds, `false` on cancel. */
  confirm: (
    counterparts: readonly CarryCounterpart[],
    options?: { lead?: string; destructive?: boolean },
  ) => Promise<boolean>;
}

export interface DefinitionOptionsEditorProps {
  definition: CustomFieldDefinitionDto;
  /** Re-reads the definition after an option action. */
  onChanged: () => Promise<void>;
  disabled?: boolean;
  /** Feature 158 — present where a change can break a carry. */
  carryGuard?: CarryDriftGuard;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The server's refusal to remove an option some record still holds. */
function isOptionInUse(error: unknown): boolean {
  return error instanceof ApiError && error.envelope.error.code === ERROR_CODES.CUSTOM_FIELD_OPTION_IN_USE;
}

/** The server's sentence for a refusal — never its code — else the generic one. */
function sentenceOf(error: unknown, t: Translate): string {
  return error instanceof ApiError && error.status < 500
    ? error.envelope.error.message
    : t('customFields.editor.option.failed');
}

/**
 * The options of a select / multiselect definition, edited one action at a
 * time through the option sub-routes (feature 157, `admin-surfaces.md` §3.1).
 * An option's stored value is shown, never edited; an action sends only that
 * option's changed members. After every action the dialog re-reads the
 * definition.
 *
 * **A save never takes the operator's place.** Rows are keyed by the option
 * alone, so a re-read relabels a row rather than replacing it; inputs stay
 * enabled while a save is in flight (the row says `aria-busy`); and an input
 * adopts the re-read value only when it is not being typed in. A reorder hands
 * focus back to the moved row's button.
 */
export function DefinitionOptionsEditor({
  definition,
  onChanged,
  disabled = false,
  carryGuard,
}: DefinitionOptionsEditorProps): ReactNode {
  const t = useTranslation('custom_fields');
  const [announcement, setAnnouncement] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ optionId: string; direction: -1 | 1 } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = [...definition.options].sort((a, b) => a.sortOrder - b.sortOrder);

  const setRowError = useCallback(
    (optionId: string, message: string | null): void =>
      setRowErrors((current) => {
        const next = { ...current };
        if (message === null) delete next[optionId];
        else next[optionId] = message;
        return next;
      }),
    [],
  );

  // After a reorder settles: the moved row's matching button, or its other one
  // when the move left the matching one disabled (first or last place).
  useEffect(() => {
    if (pendingFocus === null || moving) return;
    const wrapper = rootRef.current?.querySelector(`[data-reorder-for="${pendingFocus.optionId}"]`);
    const buttons = wrapper ? Array.from(wrapper.querySelectorAll('button')) : [];
    const preferred = buttons[pendingFocus.direction < 0 ? 0 : 1];
    const other = buttons[pendingFocus.direction < 0 ? 1 : 0];
    const target = preferred && !preferred.disabled ? preferred : other;
    target?.focus();
    setPendingFocus(null);
  }, [pendingFocus, moving, definition]);

  const move = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction;
    const moved = options[index];
    if (moved?.id === undefined || target < 0 || target >= options.length) return;
    const movedId = moved.id;
    const order = [...options];
    order.splice(index, 1);
    order.splice(target, 0, moved);
    setMoving(true);
    setRowError(movedId, null);
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
    } catch (error) {
      setRowError(movedId, sentenceOf(error, t));
    } finally {
      // Re-read either way: a reorder refused half-way leaves an order on the
      // server that is neither the old one nor the one asked for.
      try {
        await onChanged();
      } catch {
        // The rows keep what they show; the next action re-reads again.
      }
      setPendingFocus({ optionId: movedId, direction });
      setMoving(false);
    }
  };

  return (
    <div ref={rootRef} className="space-y-3">
      <ReorderAnnouncer message={announcement} />
      {options.map((option, index) => (
        <OptionRow
          key={option.id ?? option.value}
          definitionId={definition.id}
          option={option}
          error={option.id === undefined ? undefined : rowErrors[option.id]}
          setError={(message): void => {
            if (option.id !== undefined) setRowError(option.id, message);
          }}
          onChanged={onChanged}
          disabled={disabled}
          carryGuard={carryGuard}
          reorder={
            <div data-reorder-for={option.id ?? option.value}>
              <TouchReorderButtons
                onMoveUp={(): void => void move(index, -1)}
                onMoveDown={(): void => void move(index, 1)}
                disableUp={index === 0}
                disableDown={index === options.length - 1}
                disabled={disabled || moving}
              />
            </div>
          }
          t={t}
        />
      ))}
      <AddOptionRow
        definitionId={definition.id}
        nextSortOrder={options.reduce((max, option) => Math.max(max, option.sortOrder), -1) + 1}
        onChanged={onChanged}
        disabled={disabled}
        carryGuard={carryGuard}
        t={t}
      />
    </div>
  );
}

interface LabelDraft {
  value: string;
  setValue: (next: string) => void;
  ref: RefObject<HTMLInputElement | null>;
  /** The value of a save still on its way, `null` when none is. */
  sent: MutableRefObject<string | null>;
}

/**
 * One label input's draft. It adopts the stored value when that changes, but
 * not while the input has focus, and not while a save of a different value is
 * still on its way back — so a re-read never overwrites what is being typed.
 */
function useLabelDraft(stored: string): LabelDraft {
  const [value, setValue] = useState(stored);
  const ref = useRef<HTMLInputElement | null>(null);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (ref.current !== null && ref.current === document.activeElement) return;
    if (sent.current !== null && sent.current !== stored) return;
    sent.current = null;
    setValue(stored);
  }, [stored]);
  return { value, setValue, ref, sent };
}

interface OptionRowProps {
  definitionId: string;
  option: CustomFieldOptionDto;
  error: string | undefined;
  setError: (message: string | null) => void;
  onChanged: () => Promise<void>;
  disabled: boolean;
  carryGuard: CarryDriftGuard | undefined;
  reorder: ReactNode;
  t: Translate;
}

function OptionRow({
  definitionId,
  option,
  error,
  setError,
  onChanged,
  disabled,
  carryGuard,
  reorder,
  t,
}: OptionRowProps): ReactNode {
  const id = useId();
  const { language } = useTranslationContext();
  const labelDefault = useLabelDraft(option.labelDefault);
  const en = useLabelDraft(option.label['en'] ?? '');
  const pl = useLabelDraft(option.label['pl'] ?? '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [saved, setSaved] = useState('');
  const keepRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the confirmation has opened or closed. */
  const focusNext = useRef<'keep' | 'remove' | null>(null);
  const optionId = option.id;

  useEffect(() => {
    if (focusNext.current === 'keep') keepRef.current?.focus();
    if (focusNext.current === 'remove') removeRef.current?.focus();
    focusNext.current = null;
  }, [confirming]);

  const act = async (fn: () => Promise<unknown>, onRefusal?: (err: unknown) => string): Promise<boolean> => {
    if (optionId === undefined) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setError(onRefusal ? onRefusal(err) : sentenceOf(err, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitLabels = (): void => {
    if (optionId === undefined) return;
    const trimmedDefault = labelDefault.value.trim();
    if (trimmedDefault === '') {
      setError(t('customFields.editor.labelDefaultRequired'));
      return;
    }
    // A value already on its way is not sent again (Enter, then the blur that follows).
    const patch: { labelDefault?: string; label?: LocalizedLabel } = {};
    if (trimmedDefault !== option.labelDefault && trimmedDefault !== labelDefault.sent.current) {
      patch.labelDefault = trimmedDefault;
    }
    const enText = en.value.trim();
    const plText = pl.value.trim();
    const label = withLanguages(option.label, enText, plText);
    const labelInFlight = en.sent.current === enText && pl.sent.current === plText;
    if (!sameLabel(label, option.label) && !labelInFlight) patch.label = label;
    if (Object.keys(patch).length === 0) return;
    if (patch.labelDefault !== undefined) labelDefault.sent.current = patch.labelDefault;
    if (patch.label !== undefined) {
      en.sent.current = enText;
      pl.sent.current = plText;
    }
    setSaved('');
    void act(() => customFieldsClient.updateOption(definitionId, optionId, patch)).then((ok) => {
      if (ok) {
        setSaved(t('customFields.editor.option.saved'));
        return;
      }
      labelDefault.sent.current = null;
      en.sent.current = null;
      pl.sent.current = null;
    });
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitLabels();
  };

  const edit = (draft: LabelDraft, next: string): void => {
    draft.setValue(next);
    setSaved('');
  };

  const labelInput = (draft: LabelDraft, suffix: string, labelKey: string): ReactNode => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={`${id}-${suffix}`}>{t(labelKey)}</Label>
      <Input
        ref={draft.ref}
        id={`${id}-${suffix}`}
        className="min-w-0"
        value={draft.value}
        disabled={disabled}
        aria-describedby={error ? errorId : undefined}
        onChange={(event): void => edit(draft, event.target.value)}
        onBlur={commitLabels}
        onKeyDown={onEnter}
      />
    </div>
  );

  const shownLabel = resolveCustomFieldLabel(option.label, option.labelDefault, language);
  const remove = (): void => {
    if (optionId === undefined) return;
    void act(
      () => customFieldsClient.removeOption(definitionId, optionId),
      (err) => (isOptionInUse(err) ? t('customFields.editor.option.inUse', { label: shownLabel }) : sentenceOf(err, t)),
    );
  };
  const errorId = `${id}-error`;
  return (
    <div role="group" aria-label={option.labelDefault} aria-busy={busy} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm">
          <span className="text-muted-foreground">{t('customFields.editor.option.value')}: </span>
          <code className="font-mono text-xs">{option.value}</code>
        </p>
        {reorder}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {labelInput(labelDefault, 'default', 'customFields.editor.labelDefault')}
        {labelInput(en, 'en', 'customFields.editor.labelEn')}
        {labelInput(pl, 'pl', 'customFields.editor.labelPl')}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-is-default`} className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            id={`${id}-is-default`}
            checked={option.isDefault}
            disabled={disabled || savingDefault}
            onChange={(event): void => {
              const isDefault = event.target.checked;
              if (optionId === undefined) return;
              setSavingDefault(true);
              void act(() => customFieldsClient.updateOption(definitionId, optionId, { isDefault })).finally(() =>
                setSavingDefault(false),
              );
            }}
          />
          {t('customFields.editor.option.default')}
        </label>
        {confirming ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              ref={keepRef}
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={(): void => {
                focusNext.current = 'remove';
                setConfirming(false);
              }}
            >
              {t('customFields.editor.option.keep')}
            </Button>
            <span className="min-w-0 break-words text-sm">
              {t('customFields.editor.option.removeConfirm', { label: option.labelDefault })}
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-11"
              disabled={disabled || busy}
              onClick={(): void => {
                setConfirming(false);
                remove();
              }}
            >
              {t('customFields.editor.option.remove')}
            </Button>
          </div>
        ) : (
          <Button
            ref={removeRef}
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            disabled={disabled || busy}
            onClick={(): void => {
              // A removal that breaks a carry asks once, with the carries named;
              // any other asks as it always has, in the row.
              const broken =
                carryGuard?.brokenBy({ kind: 'remove-option', definitionId, optionValue: option.value }) ?? [];
              if (carryGuard && broken.length > 0) {
                void carryGuard
                  .confirm(broken, {
                    lead: t('customFields.editor.option.removeConfirm', { label: option.labelDefault }),
                    destructive: true,
                  })
                  .then((proceed) => {
                    if (proceed) remove();
                  });
                return;
              }
              focusNext.current = 'keep';
              setConfirming(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t('customFields.editor.option.remove')}
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {saved}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="break-words text-sm text-destructive">
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
  carryGuard: CarryDriftGuard | undefined;
  t: Translate;
}

function AddOptionRow({ definitionId, nextSortOrder, onChanged, disabled, carryGuard, t }: AddOptionRowProps): ReactNode {
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
    const broken = carryGuard?.brokenBy({ kind: 'add-option', definitionId, optionValue: trimmedValue }) ?? [];
    if (carryGuard && broken.length > 0 && !(await carryGuard.confirm(broken))) return;
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

  const describedBy = error ? errorId : undefined;
  return (
    <div
      role="group"
      aria-label={t('customFields.editor.option.add')}
      aria-busy={busy}
      className="space-y-2 rounded-md border border-dashed p-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-value`}>{t('customFields.editor.option.value')}</Label>
          <Input
            id={`${id}-value`}
            className="min-w-0"
            value={value}
            disabled={disabled}
            aria-invalid={invalid && value.trim() === '' ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event): void => setValue(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
          <Input
            id={`${id}-default`}
            className="min-w-0"
            value={labelDefault}
            disabled={disabled}
            aria-invalid={invalid && labelDefault.trim() === '' ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event): void => setLabelDefault(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-en`}>{t('customFields.editor.labelEn')}</Label>
          <Input id={`${id}-en`} className="min-w-0" value={en} disabled={disabled} onChange={(event): void => setEn(event.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-pl`}>{t('customFields.editor.labelPl')}</Label>
          <Input id={`${id}-pl`} className="min-w-0" value={pl} disabled={disabled} onChange={(event): void => setPl(event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={disabled || busy}
          onClick={(): void => void add()}
        >
          {t('customFields.editor.option.add')}
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
