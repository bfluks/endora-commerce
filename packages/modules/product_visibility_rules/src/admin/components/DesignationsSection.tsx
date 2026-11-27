import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ProductVisibilityDesignationOptionsResponse, ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { ListToolbarSearch, ModalDialog, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Badge, Button, EditorSection, FormField, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { channelName, designationReasonLabels, refusalMessage } from '../lib/labels.js';
import { useBaseCurrency, type SalesChannelRow } from '../lib/use-overview.js';


type Currency = ProductVisibilityOverviewResponse['currencies'][number];
type BookOption = ProductVisibilityDesignationOptionsResponse['items'][number];

export interface DesignationsSectionProps {
  readonly overview: ProductVisibilityOverviewResponse;
  readonly channels: readonly SalesChannelRow[];
  readonly writable: boolean;
  readonly onChanged: () => Promise<unknown>;
  readonly onStatus: (message: string, tone: 'success' | 'error') => void;
}

/**
 * FR-001, FR-007, US2-2, US2-7, US2-11 — which price book holds each currency's catalogue price.
 * A currency with no designation uses its base book. A designated book that is not in force is
 * flagged with its reason; a currency whose prices are being rebuilt says so (OQ-A, US2-15).
 */
export function DesignationsSection({ overview, channels, writable, onChanged, onStatus }: DesignationsSectionProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [editing, setEditing] = useState<Currency | null>(null);
  const bookNames = useBookNames(overview.currencies);
  const baseCurrency = useBaseCurrency();
  const [showRest, setShowRest] = useState(false);
  const [filter, setFilter] = useState('');
  const restId = useId();

  const clear = async (currency: Currency): Promise<void> => {
    const ok = await confirm({
      title: t('config.designations.clearTitle', { currency: currency.code }),
      message: t('config.designations.clearMessage'),
      confirmLabel: t('config.designations.clear'),
    });
    if (!ok) return;
    try {
      await productVisibilityClient.clearDesignation(currency.code);
      onStatus(t('config.designations.saved'), 'success');
      await onChanged();
    } catch (err) {
      onStatus(refusalMessage(err, t('config.error.write')), 'error');
    }
  };

  // Which group each currency is drawn in. A row never moves while its button may hold focus or
  // get it back from a dialog (WCAG 2.4.3): a currency listed first stays first until the screen
  // is opened again (clearing its book does not hide it), and one in the open disclosure stays
  // there while it is open. A currency designated from the disclosure moves up once it closes —
  // so a designated currency is never left hidden.
  const placed = useRef(new Map<string, boolean>());
  const first: Currency[] = [];
  const rest: Currency[] = [];
  for (const currency of [...overview.currencies].sort((a, b) => a.code.localeCompare(b.code))) {
    let pinned = placed.current.get(currency.code);
    if (pinned === undefined || (!pinned && !showRest)) {
      pinned = needsAttention(currency);
      placed.current.set(currency.code, pinned);
    }
    (pinned || currency.code === baseCurrency ? first : rest).push(currency);
  }
  const query = filter.trim().toUpperCase();
  const shown = query === '' ? rest : rest.filter((currency) => currency.code.includes(query));

  const row = (currency: Currency): ReactNode => (
    <CurrencyRow
      key={currency.code}
      currency={currency}
      bookName={currency.designation ? bookNames.get(currency.designation.priceListId) : undefined}
      channels={channels}
      writable={writable}
      onEdit={(): void => setEditing(currency)}
      onClear={(): void => void clear(currency)}
    />
  );

  return (
    <EditorSection as="h2" chrome="card" title={t('config.designations.title')} description={t('config.designations.description')}>
      {first.length > 0 ? <ul className="divide-y divide-border">{first.map(row)}</ul> : null}
      {rest.length > 0 ? (
        <div className={first.length > 0 ? 'mt-2 border-t border-border pt-2' : undefined}>
          {/* Hick: the currencies nobody has configured wait behind one disclosure, so the ones that
              need a decision are not buried under fifty that do not (walk-through follow-up). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showRest}
            aria-controls={showRest ? restId : undefined}
            onClick={(): void => setShowRest((open) => !open)}
          >
            {showRest ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            {first.length > 0
              ? t('config.designations.showOthers', { count: rest.length })
              : t('config.designations.showAll', { count: rest.length })}
          </Button>
          {showRest ? (
            <div id={restId} className="mt-2 space-y-2">
              <ListToolbarSearch
                label={t('config.designations.filterLabel')}
                value={filter}
                onValueChange={setFilter}
              />
              {shown.length > 0 ? (
                <ul className="divide-y divide-border">{shown.map(row)}</ul>
              ) : (
                <p className="py-3 text-sm text-muted-foreground">{t('config.designations.filterEmpty')}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <DesignationDialog
          currency={editing}
          channels={channels}
          onClose={(): void => setEditing(null)}
          onSaved={async (): Promise<void> => {
            setEditing(null);
            onStatus(t('config.designations.saved'), 'success');
            await onChanged();
          }}
        />
      ) : null}
      {confirmDialog}
    </EditorSection>
  );
}

/**
 * What earns a currency a place above the disclosure: a designated book, a book not in force, or
 * catalogue prices being rebuilt. The shop's base currency is listed there too.
 */
function needsAttention(currency: Currency): boolean {
  return currency.designation !== null || currency.building || (currency.designationStatus !== null && !currency.designationStatus.inForce);
}

interface CurrencyRowProps {
  readonly currency: Currency;
  readonly bookName: string | undefined;
  readonly channels: readonly SalesChannelRow[];
  readonly writable: boolean;
  readonly onEdit: () => void;
  readonly onClear: () => void;
}

/** One currency: its book and channel (or the base book), its status, and the two actions. */
function CurrencyRow({ currency, bookName, channels, writable, onEdit, onClear }: CurrencyRowProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { language } = useTranslationContext();
  const designation = currency.designation;
  const status = currency.designationStatus;
  return (
    <li data-currency-row className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-medium">{currency.code}</span>
          {currency.active ? null : <Badge variant="secondary">{t('config.designations.inactiveCurrency')}</Badge>}
        </p>
        {designation ? (
          <p className="text-sm">
            <span className="break-words">{bookName ?? t('config.designations.bookUnavailable')}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">
              {channelName(
                channels.find((c) => c.id === designation.salesChannelId),
                language,
                t('config.unknownChannel'),
              )}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('config.designations.baseBook')}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {status === null ? null : status.inForce ? (
            <Badge variant="success">{t('config.designations.inForce')}</Badge>
          ) : (
            <Badge variant="warning">
              <span>{t('config.designations.notInForce')}</span>
              <span className="ml-1">{designationReasonLabels.label(t, status.reason)}</span>
            </Badge>
          )}
          {currency.building ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
              {t('config.designations.building')}
            </span>
          ) : null}
        </div>
      </div>
      {writable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t('config.designations.changeFor', { currency: currency.code })}
            onClick={onEdit}
          >
            {t('config.designations.change')}
          </Button>
          {designation ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('config.designations.clearFor', { currency: currency.code })}
              onClick={onClear}
            >
              {t('config.designations.clear')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The names of the designated books. The overview names a book by id only; the designatable
 * books of its currency carry the name. A book that is no longer designatable is not among
 * them and reads "price book no longer available" beside its not-in-force reason.
 */
function useBookNames(currencies: readonly Currency[]): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const designated = useMemo(
    () => currencies.filter((c) => c.designation !== null).map((c) => c.code).join(','),
    [currencies],
  );
  useEffect(() => {
    let live = true;
    const codes = designated === '' ? [] : designated.split(',');
    void Promise.allSettled(codes.map((code) => productVisibilityClient.designationOptions(code))).then((answers) => {
      if (!live) return;
      const next = new Map<string, string>();
      for (const answer of answers) {
        if (answer.status !== 'fulfilled') continue;
        for (const book of answer.value.items) next.set(book.priceListId, book.name);
      }
      setNames(next);
    });
    return (): void => {
      live = false;
    };
  }, [designated]);
  return names;
}

interface DesignationDialogProps {
  readonly currency: Currency;
  readonly channels: readonly SalesChannelRow[];
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}

/** US2-8, US2-10 — only the designatable books are offered, and only the channels a book is on. */
function DesignationDialog({ currency, channels, onClose, onSaved }: DesignationDialogProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { language } = useTranslationContext();
  const formId = useId();
  const [books, setBooks] = useState<readonly BookOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [bookId, setBookId] = useState(currency.designation?.priceListId ?? '');
  const [channelId, setChannelId] = useState(currency.designation?.salesChannelId ?? '');
  const [errors, setErrors] = useState<{ book?: string; channel?: string }>({});
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    productVisibilityClient
      .designationOptions(currency.code)
      .then((answer) => {
        if (live) setBooks(answer.items);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return (): void => {
      live = false;
    };
  }, [currency.code]);

  const book = books?.find((b) => b.priceListId === bookId);
  const channelIds = book?.salesChannelIds ?? [];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found: { book?: string; channel?: string } = {};
    if (!book) found.book = t('config.designations.error.bookRequired');
    if (!channelIds.includes(channelId)) found.channel = t('config.designations.error.channelRequired');
    setErrors(found);
    if (found.book || found.channel) return;
    setSaving(true);
    setRefusal(null);
    try {
      await productVisibilityClient.setDesignation(currency.code, { priceListId: bookId, salesChannelId: channelId });
      await onSaved();
    } catch (err) {
      setRefusal(refusalMessage(err, t('config.error.write')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={t('config.designations.dialogTitle', { currency: currency.code })}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('config.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving || books === null} aria-busy={saving}>
            {t('config.designations.save')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e): void => void submit(e)} className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('config.designations.dialogHint')}</p>
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}
        {loadFailed ? (
          <Alert variant="destructive">
            <AlertDescription>{t('config.designations.optionsFailed')}</AlertDescription>
          </Alert>
        ) : null}
        {books !== null && books.length === 0 ? (
          <Alert variant="warning">
            <AlertDescription>{t('config.designations.noBooks')}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={t('config.designations.field.book')} error={errors.book} required>
          <Select
            value={bookId}
            disabled={books === null}
            aria-busy={books === null}
            onChange={(e): void => {
              setBookId(e.target.value);
              setChannelId('');
            }}
          >
            <option value="">{books === null ? t('config.loadingOptions') : t('config.choose')}</option>
            {(books ?? []).map((b) => (
              <option key={b.priceListId} value={b.priceListId}>
                {b.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('config.designations.field.channel')} error={errors.channel} required>
          <Select value={channelId} disabled={!book} onChange={(e): void => setChannelId(e.target.value)}>
            <option value="">{t('config.choose')}</option>
            {channelIds.map((id) => (
              <option key={id} value={id}>
                {channelName(channels.find((c) => c.id === id), language, t('config.unknownChannel'))}
              </option>
            ))}
          </Select>
        </FormField>
      </form>
    </ModalDialog>
  );
}
