import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  QUOTE_REQUEST_DOCUMENT_TYPE,
  QUOTE_REQUEST_PDF_LIMITS,
  quoteRequestDocumentChoicesSchema,
  quoteRequestPdfSendResultSchema,
  type QuoteRequestDocumentChoices,
  type QuoteRequestPdfSendResult,
} from '@endora-commerce/contracts';
import { apiBaseUrl, apiClient, ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Input, Label, Select, Textarea } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * *Export PDF* and *Send PDF to customer* on a quote request
 * (`specs/153-quote-request-pdf-template/contracts/admin-ui.md` §1, §1a).
 *
 * One dialog, two modes. Both offer the quote templates that apply to the
 * quote's channel — the remembered one preselected, else the effective
 * default, else the built-in layout — and the language, preselected with the
 * channel's. The selection is sent as `templateId` **only when it differs from
 * what an export without a choice would use**, so accepting the preselected
 * default never pins the quote to today's default; choosing the built-in layout
 * while a template is remembered forgets it first. The send mode adds the
 * recipients — the requester preselected, at most five, each validated — and an
 * optional personal message.
 */

export type QuoteRequestPdfMode = 'download' | 'send';

export interface QuoteRequestPdfDialogProps {
  readonly quoteRequestId: string;
  readonly mode: QuoteRequestPdfMode;
  readonly onClose: () => void;
  /** Told what happened, for the screen's own status line. */
  readonly onDone: (outcome: { readonly kind: 'success' | 'warning'; readonly message: string }) => void;
}

const BUILT_IN = '__built_in__';
const BASE = '/api/v1/admin/quote-requests';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fileNameOf(disposition: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(disposition ?? '');
  return match?.[1] ?? fallback;
}

/** The PDF as a blob and the headers that say which template was used; an error envelope as `ApiError`. */
async function downloadPdf(id: string, query: URLSearchParams): Promise<{ blob: Blob; fileName: string; missing: boolean }> {
  const qs = query.toString();
  const res = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}${BASE}/${id}/pdf${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
    headers: { Accept: 'application/pdf' },
  });
  if (!res.ok) {
    const envelope = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    const fallback = { error: { code: 'INTERNAL', message: `HTTP ${res.status}` } };
    throw new ApiError(res.status, (envelope?.error ? { error: envelope.error } : fallback) as ConstructorParameters<typeof ApiError>[1]);
  }
  return {
    blob: await res.blob(),
    fileName: fileNameOf(res.headers.get('content-disposition'), `${id}.pdf`),
    missing: res.headers.get('x-document-template-missing') === 'true',
  };
}

/** The languages a selection offers: the template's own, else the built-in layout's. */
function languagesOf(choices: QuoteRequestDocumentChoices, selected: string): readonly string[] {
  if (selected === BUILT_IN) return choices.builtInLanguages;
  return choices.templates.find((template) => template.id === selected)?.languages ?? choices.builtInLanguages;
}

/** Keeps the current language while the selection offers it, else the channel's, else the first offered. */
function pickLanguage(languages: readonly string[], current: string, suggested: string): string {
  if (languages.includes(current)) return current;
  if (languages.includes(suggested)) return suggested;
  return languages[0] ?? '';
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function QuoteRequestPdfDialog({ quoteRequestId, mode, onClose, onDone }: QuoteRequestPdfDialogProps): ReactNode {
  const t = useTranslation('quote_requests');
  const { t: translateIn, language: adminLanguage } = useTranslationContext();
  const { hasPermission } = useAuth();
  const base = useId();
  const [choices, setChoices] = useState<QuoteRequestDocumentChoices | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string>(BUILT_IN);
  const [language, setLanguage] = useState<string>('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    apiClient
      .get<{ data: unknown }>(`${BASE}/${quoteRequestId}/document-templates`)
      .then((res) => {
        if (!live) return;
        const loaded = quoteRequestDocumentChoicesSchema.parse(res.data);
        setChoices(loaded);
        const remembered =
          loaded.rememberedTemplateId !== null && !loaded.rememberedTemplateMissing ? loaded.rememberedTemplateId : null;
        const preselected = remembered ?? loaded.effectiveDefaultId ?? BUILT_IN;
        setSelected(preselected);
        // In the same update as the choices, never in a later effect: the
        // controls and an enabled Download render together with the language
        // they show, so a click can never send an empty one.
        setLanguage((current) => pickLanguage(languagesOf(loaded, preselected), current, loaded.suggestedLanguage));
        setRecipients(loaded.requesterEmail ? [loaded.requesterEmail] : ['']);
        setTouched([]);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return (): void => {
      live = false;
    };
  }, [quoteRequestId, attempt]);

  // What an export without a choice uses: the remembered template, else the effective default.
  const implicit = useMemo((): string => {
    if (!choices) return BUILT_IN;
    if (choices.rememberedTemplateId !== null && !choices.rememberedTemplateMissing) return choices.rememberedTemplateId;
    return choices.effectiveDefaultId ?? BUILT_IN;
  }, [choices]);

  const languages = useMemo((): readonly string[] => (choices ? languagesOf(choices, selected) : []), [choices, selected]);

  /** A template change re-picks the language in the same update, for the same reason as the load. */
  const selectTemplate = (next: string): void => {
    setSelected(next);
    if (choices) setLanguage((current) => pickLanguage(languagesOf(choices, next), current, choices.suggestedLanguage));
  };

  const languageName = useCallback(
    (code: string): string => {
      try {
        return new Intl.DisplayNames([adminLanguage, 'en'], { type: 'language' }).of(code) ?? code;
      } catch {
        return code;
      }
    },
    [adminLanguage],
  );

  const errorText = useCallback(
    (err: unknown, fallbackKey: string): string => {
      if (err instanceof ApiError) {
        const { code, details } = err.envelope.error as { code: string; details?: { code?: unknown } };
        const token = typeof details?.code === 'string' ? details.code : null;
        for (const [owner, key] of [
          ['quote_requests', token ? `errors.${code}.${token}` : null],
          ['quote_requests', `errors.${code}`],
          ['document_templates', `errors.${code}`],
        ] as const) {
          if (!key) continue;
          const translated = translateIn(owner, key);
          if (translated !== `${owner}.${key}`) return translated;
        }
      }
      return t(fallbackKey);
    },
    [t, translateIn],
  );

  // Recipient validation, shown on blur and on submit.
  const recipientError = (index: number): string | null => {
    const value = (recipients[index] ?? '').trim();
    if (value === '') return recipients.length === 1 ? t('pdf.sendDialog.recipientRequired') : null;
    if (!EMAIL_RE.test(value) || value.length > 254) return t('pdf.sendDialog.recipientInvalid');
    const first = recipients.findIndex((other) => other.trim().toLowerCase() === value.toLowerCase());
    return first !== index ? t('pdf.sendDialog.recipientDuplicate') : null;
  };
  const filled = recipients.map((r) => r.trim()).filter((r) => r !== '');
  const recipientsValid = filled.length > 0 && recipients.every((_, i) => recipientError(i) === null);

  /** Forget the remembered template before using the built-in layout; answers the `templateId` to send, if any. */
  const prepareTemplate = async (): Promise<string | undefined> => {
    if (selected === implicit) return undefined;
    if (selected === BUILT_IN) {
      await apiClient.put(`${BASE}/${quoteRequestId}/document-template`, { documentTemplateId: null });
      return undefined;
    }
    return selected;
  };

  const download = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const templateId = await prepareTemplate();
      const query = new URLSearchParams();
      if (templateId) query.set('templateId', templateId);
      if (language) query.set('language', language);
      const result = await downloadPdf(quoteRequestId, query);
      saveBlob(result.blob, result.fileName);
      if (result.missing) onDone({ kind: 'warning', message: t('pdf.dialog.fallbackUsed') });
      onClose();
    } catch (err) {
      setError(errorText(err, 'pdf.dialog.error'));
    } finally {
      setBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    setTouched(recipients.map(() => true));
    if (!recipientsValid) return;
    setBusy(true);
    setError(null);
    try {
      const templateId = await prepareTemplate();
      const res = await apiClient.post<{ data: unknown }>(`${BASE}/${quoteRequestId}/pdf/send`, {
        recipients: filled,
        ...(templateId ? { templateId } : {}),
        ...(language ? { language } : {}),
        ...(message.trim() !== '' ? { message } : {}),
      });
      const result: QuoteRequestPdfSendResult = quoteRequestPdfSendResultSchema.parse(res.data);
      onDone(
        result.failed.length > 0
          ? { kind: 'warning', message: t('pdf.sendDialog.partial', { sent: result.sent.length, failed: result.failed.join(', ') }) }
          : { kind: 'success', message: t('pdf.sendDialog.sent', { count: result.sent.length }) },
      );
      onClose();
    } catch (err) {
      setError(errorText(err, 'pdf.sendDialog.error'));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'send' ? t('pdf.sendDialog.title') : t('pdf.dialog.title');
  const atLimit = recipients.length >= QUOTE_REQUEST_PDF_LIMITS.maxRecipients;

  return (
    <ModalDialog
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('pdf.dialog.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void (mode === 'send' ? send() : download())}
            disabled={busy || choices === null}
          >
            {mode === 'send'
              ? busy
                ? t('pdf.sendDialog.sending')
                : t('pdf.sendDialog.send')
              : busy
                ? t('pdf.dialog.downloading')
                : t('pdf.dialog.download')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" aria-busy={choices === null && !loadFailed}>
        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {choices === null && !loadFailed ? t('pdf.dialog.loading') : null}
        </p>
        {loadFailed ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{t('pdf.dialog.loadError')}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                {t('pdf.dialog.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {choices ? (
          <>
            {choices.rememberedTemplateMissing ? (
              <Alert variant="warning">
                <AlertDescription>{t('pdf.dialog.rememberedMissing')}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor={`${base}-template`}>{t('pdf.dialog.template')}</Label>
              <Select
                id={`${base}-template`}
                value={selected}
                aria-describedby={`${base}-template-hint`}
                disabled={busy}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                {choices.effectiveDefaultId === null || selected === BUILT_IN ? (
                  <option value={BUILT_IN}>{t('pdf.dialog.builtIn')}</option>
                ) : null}
                {choices.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {' — '}
                    {template.salesChannelId === null ? t('pdf.dialog.allChannels') : t('pdf.dialog.channel')}
                    {template.isDefault ? ` (${t('pdf.dialog.default')})` : ''}
                  </option>
                ))}
              </Select>
              <p id={`${base}-template-hint`} className="text-xs text-muted-foreground">
                {t('pdf.dialog.remembered')}
              </p>
              {selected !== BUILT_IN && choices.templates.find((tpl) => tpl.id === selected)?.isDefault ? (
                <Badge variant="secondary">{t('pdf.dialog.default')}</Badge>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${base}-language`}>{t('pdf.dialog.language')}</Label>
              <Select id={`${base}-language`} value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value)}>
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code)}
                  </option>
                ))}
              </Select>
            </div>
            {mode === 'send' ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">{t('pdf.sendDialog.recipients')}</legend>
                  <p id={`${base}-recipients-hint`} className="text-xs text-muted-foreground">
                    {t('pdf.sendDialog.recipientsHint', { max: QUOTE_REQUEST_PDF_LIMITS.maxRecipients })}
                  </p>
                  {recipients.map((recipient, index) => {
                    const problem = touched[index] ? recipientError(index) : null;
                    const inputId = `${base}-recipient-${index}`;
                    return (
                      <div key={index} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Label htmlFor={inputId} className="sr-only">
                            {t('pdf.sendDialog.recipientLabel', { n: index + 1 })}
                          </Label>
                          <Input
                            id={inputId}
                            type="email"
                            autoComplete="email"
                            value={recipient}
                            disabled={busy}
                            aria-invalid={problem !== null}
                            aria-describedby={problem !== null ? `${inputId}-error` : `${base}-recipients-hint`}
                            onChange={(event) =>
                              setRecipients((current) => current.map((value, i) => (i === index ? event.target.value : value)))
                            }
                            onBlur={() => setTouched((current) => recipients.map((_, i) => (i === index ? true : (current[i] ?? false))))}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || recipients.length <= 1}
                            aria-label={t('pdf.sendDialog.removeRecipient', { address: recipient || String(index + 1) })}
                            onClick={() => {
                              setRecipients((current) => current.filter((_, i) => i !== index));
                              setTouched((current) => current.filter((_, i) => i !== index));
                            }}
                          >
                            ×
                          </Button>
                        </div>
                        {problem !== null ? (
                          <p id={`${inputId}-error`} className="text-xs text-destructive">
                            {problem}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || atLimit}
                    onClick={() => setRecipients((current) => [...current, ''])}
                  >
                    {t('pdf.sendDialog.addRecipient')}
                  </Button>
                  {atLimit ? (
                    <p className="text-xs text-muted-foreground">
                      {t('pdf.sendDialog.recipientLimit', { max: QUOTE_REQUEST_PDF_LIMITS.maxRecipients })}
                    </p>
                  ) : null}
                </fieldset>
                <div className="space-y-1">
                  <Label htmlFor={`${base}-message`}>{t('pdf.sendDialog.message')}</Label>
                  <Textarea
                    id={`${base}-message`}
                    rows={4}
                    value={message}
                    disabled={busy}
                    maxLength={QUOTE_REQUEST_PDF_LIMITS.maxMessageLength}
                    aria-describedby={`${base}-message-counter`}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <p id={`${base}-message-counter`} className="text-right text-xs text-muted-foreground">
                    {t('pdf.sendDialog.messageCounter', { count: message.length, max: QUOTE_REQUEST_PDF_LIMITS.maxMessageLength })}
                  </p>
                </div>
              </>
            ) : null}
            {hasPermission('document_templates:read') ? (
              <p className="text-sm">
                <Link className="underline" to={`/document-templates?type=${encodeURIComponent(QUOTE_REQUEST_DOCUMENT_TYPE)}`}>
                  {t('pdf.dialog.manage')}
                </Link>
              </p>
            ) : null}
          </>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}

export default QuoteRequestPdfDialog;
