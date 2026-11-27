import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProductVisibilityDesignationOptionsResponse, ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { ModalDialog, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Badge, Button, EditorSection, FormField, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { channelName, designationReasonLabels, refusalMessage } from '../lib/labels.js';
import type { SalesChannelRow } from '../lib/use-overview.js';

const MODULE = 'product_visibility_rules';

type Currency = ProductVisibilityOverviewResponse['currencies'][number];
type BookOption = ProductVisibilityDesignationOptionsResponse['items'][number];

export interface DesignationsSectionProps {
  readonly overview: ProductVisibilityOverviewResponse;
  readonly channels: readonly SalesChannelRow[];
  readonly writable: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onStatus: (message: string, tone: 'success' | 'error') => void;
}

/**
 * FR-001, FR-007, US2-2, US2-7, US2-11 — which price book holds each currency's catalogue price.
 * A currency with no designation uses its base book. A designated book that is not in force is
 * flagged with its reason; a currency whose prices are being rebuilt says so (OQ-A, US2-15).
 */
export function DesignationsSection({ overview, channels, writable, onChanged, onStatus }: DesignationsSectionProps): ReactNode {
  const t = useTranslation(MODULE);
  const { language } = useTranslationContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [editing, setEditing] = useState<Currency | null>(null);
  const bookNames = useBookNames(overview.currencies);

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

  return (
    <EditorSection as="h2" chrome="card" title={t('config.designations.title')} description={t('config.designations.description')}>
      <ul className="divide-y divide-border">
        {overview.currencies.map((currency) => {
          const designation = currency.designation;
          const status = currency.designationStatus;
          return (
            <li key={currency.code} data-currency-row className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{currency.code}</span>
                  {currency.active ? null : <Badge variant="secondary">{t('config.designations.inactiveCurrency')}</Badge>}
                </p>
                {designation ? (
                  <p className="text-sm">
                    <span className="break-words">{bookNames.get(designation.priceListId) ?? t('config.designations.bookUnavailable')}</span>
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
                  <Button type="button" size="sm" variant="outline" onClick={(): void => setEditing(currency)}>
                    {t('config.designations.change')}
                  </Button>
                  {designation ? (
                    <Button type="button" size="sm" variant="ghost" onClick={(): void => void clear(currency)}>
                      {t('config.designations.clear')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
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
  const t = useTranslation(MODULE);
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
