import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** What the editor of an inline field is handed while it is open. */
export interface InlineEditorProps<T> {
  /** The id the control takes, so the field's name labels it. */
  id: string;
  draft: T;
  setDraft: (next: T) => void;
  busy: boolean;
  /** The id of the line that says what is wrong, while something is. */
  errorId: string | undefined;
  /** Save now — for a control whose own key saves (a formatted field's Ctrl/Cmd + Enter). */
  submit: () => void;
}

export interface InlineEditProps<T> {
  /** The field's name: the label of its control, and what its *Edit* button says it edits. */
  label: string;
  /** The value as it is read. */
  display: ReactNode;
  /** Whether the reader may change it — without, it is read and nothing more. */
  canEdit: boolean;
  /** The draft an edit starts from: the value as it now is. */
  initial: () => T;
  editor: (props: InlineEditorProps<T>) => ReactNode;
  /** A sentence when the draft cannot be saved as it is; checked before anything is sent. */
  validate?: (draft: T) => string | null;
  /**
   * Saves the draft. A rejection carries the sentence to show, and the draft is
   * kept for another try.
   */
  save: (draft: T) => Promise<void>;
  /** Whether the draft is the value unchanged — then *Save* is no request. */
  unchanged?: (draft: T) => boolean;
  /** Where the label goes: above the value (a fact of the sidebar), or nowhere visible (the page's title). */
  labelVisible?: boolean;
  className?: string;
}

/**
 * One field of an Opportunity, edited where it is shown
 * (`specs/158-crm-opportunity-inline-editing/`, FR-001 – FR-004): no form
 * elsewhere, no page of its own.
 *
 * Four states, each said on screen and to assistive technology:
 *
 * - **idle** — the value, and beside it a pencil that is always there (nothing
 *   is behind a hover) and is named "Edit <field>";
 * - **editing** — the control, holding the value as it now is, with the focus
 *   in it, and *Save* and *Cancel*. Enter saves a one-line field (a
 *   formatted text keeps Enter for its lines and saves on Ctrl/Cmd + Enter);
 *   Escape cancels and gives the focus back to the pencil;
 * - **saving** — the control and the buttons held, *Save* busy;
 * - **error** — the sentence of what went wrong under the control, tied to it,
 *   and the draft kept as typed.
 *
 * Once saved, the value is shown again and "Saved" is announced. The one *Save*
 * is the only filled button while a field is open (Von Restorff); *Cancel* is
 * beside it, as every form of the admin has them (Jakob).
 */
export function InlineEdit<T>(props: InlineEditProps<T>): ReactNode {
  const {
    label,
    display,
    canEdit,
    initial,
    editor,
    validate,
    save,
    unchanged,
    labelVisible = true,
    className,
  } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const errorId = `${baseId}-error`;
  // A draft may itself be `null` — a cleared contact, no Sales Channel — so
  // whether the field is open is its own state.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const pencil = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLDivElement>(null);
  /** Where the focus goes once the field closes: back to its pencil. */
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      // The control the editor drew: an input, a picker, a formatted field.
      region.current?.ownerDocument.getElementById(controlId)?.focus();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      pencil.current?.focus();
    }
  }, [editing, controlId]);

  const open = (): void => {
    setProblem(null);
    setNotice('');
    setDraft(initial());
    setEditing(true);
  };

  const close = (): void => {
    returnFocus.current = true;
    setEditing(false);
    setDraft(null);
    setProblem(null);
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!editing || busy) return;
    const current = draft as T;
    const invalid = validate?.(current) ?? null;
    if (invalid) {
      setProblem(invalid);
      return;
    }
    if (unchanged?.(current)) {
      close();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await save(current);
      close();
      setNotice(t('inlineEdit.saved', { field: label }));
    } catch (failure) {
      setProblem(failure instanceof Error && failure.message ? failure.message : t('opportunity.edit.error'));
    } finally {
      setBusy(false);
    }
  };

  const labelElement = labelVisible ? (
    editing ? (
      <label htmlFor={controlId} className="block text-xs text-muted-foreground">
        {label}
      </label>
    ) : (
      <p className="text-xs text-muted-foreground">{label}</p>
    )
  ) : editing ? (
    <label htmlFor={controlId} className="sr-only">
      {label}
    </label>
  ) : null;

  return (
    <div ref={region} className={className}>
      {labelElement}
      {editing ? (
        <form
          noValidate
          aria-busy={busy}
          className="mt-1 space-y-2"
          onSubmit={(event): void => void submit(event)}
          onKeyDown={(event): void => {
            // A control that takes Escape for itself — an open list — stops it first.
            if (event.key === 'Escape' && !busy && !event.defaultPrevented) {
              event.preventDefault();
              close();
            }
          }}
        >
          {editor({
            id: controlId,
            draft: draft as T,
            setDraft: (next) => {
              setDraft(next);
              setProblem(null);
            },
            busy,
            errorId: problem ? errorId : undefined,
            submit: () => void submit(),
          })}
          {problem ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={close}
            >
              {tCore('common.action.cancel')}
            </Button>
            <Button type="submit" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} aria-busy={busy}>
              {busy ? tCore('common.state.saving') : tCore('common.action.save')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{display}</div>
          {canEdit ? (
            <Button
              ref={pencil}
              type="button"
              variant="ghost"
              size="sm"
              className="-my-1 min-h-11 min-w-11 shrink-0 px-2 text-muted-foreground hover:text-foreground sm:min-h-8 sm:min-w-8"
              aria-label={t('inlineEdit.edit', { field: label })}
              title={t('inlineEdit.edit', { field: label })}
              onClick={open}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
      )}
      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}
