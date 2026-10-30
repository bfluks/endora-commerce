import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Pencil } from 'lucide-react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { Button, Input, PageHeader, type PageHeaderProps } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useOpportunityUpdate } from '../../lib/use-opportunity-update.js';

/** The title's limit — `opportunityCreateShape.title` in `@endora-commerce/contracts`. */
const TITLE_MAX_LENGTH = 200;
const TITLE_FIELD_ID = 'crm-opportunity-title';

export interface OpportunityTitleProps extends Omit<PageHeaderProps, 'title'> {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it the title is read and nothing more. */
  canWrite: boolean;
  onChange: (next: OpportunityDetail) => void;
  /** What stands beside the title — the status. */
  beside: ReactNode;
}

/**
 * The page's header with the Opportunity's title **edited where it is read**
 * (`specs/158-crm-opportunity-inline-editing/`, FR-001).
 *
 * Idle, it is the kit's `PageHeader`, with a pencil beside the title named
 * "Edit Title". Editing, the heading is the field: a large input holding the
 * title as it is, with *Save* and *Cancel*; Enter saves, Escape cancels and
 * gives the focus back to the pencil. The field is not put inside the `h1` —
 * a heading holds words, not a form — so the heading stays, for assistive
 * technology, while it is edited. A refusal is said under the field and what
 * was typed is kept; somebody else's save first is the conflict sentence of
 * `useOpportunityUpdate`.
 */
export function OpportunityTitle(props: OpportunityTitleProps): ReactNode {
  const { opportunity, canWrite, onChange, beside, ...header } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const update = useOpportunityUpdate(opportunity, onChange);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const pencil = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const editing = draft !== null;
  const fieldLabel = t('opportunity.field.title');

  useEffect(() => {
    if (editing) {
      document.getElementById(TITLE_FIELD_ID)?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      pencil.current?.focus();
    }
  }, [editing]);

  const close = (): void => {
    returnFocus.current = true;
    setDraft(null);
    setProblem(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (draft === null || busy) return;
    const title = draft.trim();
    if (title === '') {
      setProblem(t('opportunity.create.error.title'));
      return;
    }
    if (title === opportunity.title) {
      close();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await update({ title });
      close();
      setNotice(t('inlineEdit.saved', { field: fieldLabel }));
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : t('opportunity.edit.error'));
    } finally {
      setBusy(false);
    }
  };

  const status = (
    <p role="status" className="sr-only">
      {notice}
    </p>
  );

  if (!editing) {
    return (
      <>
        {/* The live region keeps its place in either state, so its announcement is reliable. */}
        {status}
        <PageHeader
          {...header}
          title={
            <>
              <span className="min-w-0 [overflow-wrap:anywhere]">{opportunity.title}</span>
              {beside}
            </>
          }
          titleActions={
            canWrite ? (
              <Button
                ref={pencil}
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 shrink-0 px-2 text-muted-foreground hover:text-foreground sm:min-h-8 sm:min-w-8"
                aria-label={t('inlineEdit.edit', { field: fieldLabel })}
                title={t('inlineEdit.edit', { field: fieldLabel })}
                onClick={(): void => {
                  setProblem(null);
                  setNotice('');
                  setDraft(opportunity.title);
                }}
              >
                <Pencil aria-hidden="true" className="size-4" />
              </Button>
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      {status}
      <header className="mb-6 space-y-1">
      {header.back ? (
        <Link
          to={header.back.to}
          className="-ml-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          {header.back.label}
        </Link>
      ) : null}
      <h1 className="sr-only">{opportunity.title}</h1>
      <form
        noValidate
        aria-busy={busy}
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event): void => void submit(event)}
        onKeyDown={(event): void => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            close();
          }
        }}
      >
        <label htmlFor={TITLE_FIELD_ID} className="sr-only">
          {fieldLabel}
        </label>
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <Input
            id={TITLE_FIELD_ID}
            value={draft}
            maxLength={TITLE_MAX_LENGTH}
            required
            disabled={busy}
            className="h-11 text-xl font-semibold"
            aria-invalid={problem !== null}
            aria-describedby={problem ? `${TITLE_FIELD_ID}-error` : undefined}
            onChange={(event): void => {
              setDraft(event.target.value);
              setProblem(null);
            }}
          />
          {problem ? (
            <p id={`${TITLE_FIELD_ID}-error`} role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>
            {tCore('common.action.cancel')}
          </Button>
          <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy}>
            {busy ? tCore('common.state.saving') : tCore('common.action.save')}
          </Button>
        </div>
      </form>
      {header.description ? <p className="text-sm text-muted-foreground">{header.description}</p> : null}
      </header>
    </>
  );
}
