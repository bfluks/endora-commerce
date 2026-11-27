import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProductVisibilityOverviewResponse, WebsiteRulePreviewResponse } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, FormField, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { channelName, previewStatusLabels, refusalMessage } from '../lib/labels.js';
import type { SalesChannelRow } from '../lib/use-overview.js';


type PreviewState =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'pending'; previewId: string }
  | { phase: 'ready'; previewId: string; counts: WebsiteRulePreviewResponse['counts'] }
  | { phase: 'ended'; status: 'failed' | 'expired' | null }
  | { phase: 'applying'; previewId: string; counts: WebsiteRulePreviewResponse['counts'] };

export interface AttachDialogProps {
  readonly rules: ProductVisibilityOverviewResponse['productRules'];
  readonly channels: readonly SalesChannelRow[];
  /** Channels that already have a rule — never offered (FR-051). */
  readonly governed: ReadonlySet<string>;
  readonly pollIntervalMs: number;
  readonly onClose: () => void;
  readonly onApplied: () => Promise<void>;
}

/**
 * FR-051, FR-053 — attach a product rule to a sales channel. Nothing is applied until the
 * administrator has seen how many products would join and leave the channel and confirmed that
 * preview. The preview is counted on the server; this dialog polls it while it is pending and
 * announces each change of state in a polite live region mounted before it has text (SC 4.1.3).
 * Changing the rule or the channel discards the preview, which belonged to the old choice. A
 * stale or expired preview offers a new one rather than a dead end (Peak-End).
 */
export function AttachDialog({ rules, channels, governed, pollIntervalMs, onClose, onApplied }: AttachDialogProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const { language } = useTranslationContext();
  const [ruleId, setRuleId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ phase: 'idle' });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ rule?: string; channel?: string }>({});
  /** Bumped whenever a preview stops mattering: inputs changed, dialog closed. A late answer for an older ticket is dropped. */
  const ticket = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback((): void => {
    ticket.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const offered = channels.filter((c) => !governed.has(c.id));
  const nameOf = (id: string): string => channelName(channels.find((c) => c.id === id), language, t('config.unknownChannel'));

  const reset = (): void => {
    stopPolling();
    setPreview({ phase: 'idle' });
    setRefusal(null);
  };

  const poll = useCallback(
    (previewId: string, mine: number): void => {
      timer.current = setTimeout(() => {
        void productVisibilityClient
          .preview(previewId)
          .then((answer) => {
            if (mine !== ticket.current) return;
            if (answer.status === 'pending') {
              poll(previewId, mine);
              return;
            }
            if (answer.status === 'ready') {
              setPreview({ phase: 'ready', previewId, counts: answer.counts });
              return;
            }
            setPreview({ phase: 'ended', status: answer.status === 'expired' || answer.status === 'applied' ? 'expired' : 'failed' });
          })
          .catch((err: unknown) => {
            if (mine !== ticket.current) return;
            setRefusal(refusalMessage(err, t('rules.attach.previewFailed')));
            setPreview({ phase: 'ended', status: null });
          });
      }, pollIntervalMs);
    },
    [pollIntervalMs, t],
  );

  const startPreview = async (): Promise<void> => {
    const found: { rule?: string; channel?: string } = {};
    if (ruleId === '') found.rule = t('rules.attach.error.ruleRequired');
    if (channelId === '') found.channel = t('rules.attach.error.channelRequired');
    setErrors(found);
    if (found.rule || found.channel) return;
    stopPolling();
    const mine = ticket.current;
    setRefusal(null);
    setPreview({ phase: 'creating' });
    try {
      const { previewId } = await productVisibilityClient.createPreview({ kind: 'attach', productRuleId: ruleId, salesChannelIds: [channelId] });
      if (mine !== ticket.current) return;
      setPreview({ phase: 'pending', previewId });
      poll(previewId, mine);
    } catch (err) {
      if (mine !== ticket.current) return;
      setRefusal(refusalMessage(err, t('rules.attach.previewFailed')));
      setPreview({ phase: 'ended', status: null });
    }
  };

  const confirm = async (): Promise<void> => {
    if (preview.phase !== 'ready') return;
    setRefusal(null);
    setPreview({ phase: 'applying', previewId: preview.previewId, counts: preview.counts });
    try {
      await productVisibilityClient.confirmPreview(preview.previewId);
      await onApplied();
    } catch (err) {
      // Stale (expired, rule moved, channel taken) or already governed: this preview is spent.
      setRefusal(refusalMessage(err, t('config.error.write')));
      setPreview({ phase: 'ended', status: null });
    }
  };

  const busy = preview.phase === 'creating' || preview.phase === 'pending' || preview.phase === 'applying';
  const counts = preview.phase === 'ready' || preview.phase === 'applying' ? preview.counts : null;
  const statusText =
    preview.phase === 'creating' || preview.phase === 'pending'
      ? previewStatusLabels.label(t, 'pending')
      : preview.phase === 'ready'
        ? previewStatusLabels.label(t, 'ready')
        : preview.phase === 'ended' && preview.status !== null
          ? previewStatusLabels.label(t, preview.status)
          : '';

  return (
    <ModalDialog
      title={t('rules.attach.title')}
      onClose={(): void => {
        stopPolling();
        onClose();
      }}
      busy={preview.phase === 'applying'}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={preview.phase === 'applying'}>
            {t('config.cancel')}
          </Button>
          {counts ? (
            <Button type="button" onClick={(): void => void confirm()} disabled={preview.phase === 'applying'} aria-busy={preview.phase === 'applying'}>
              {t('rules.attach.confirm')}
            </Button>
          ) : (
            <Button type="button" onClick={(): void => void startPreview()} disabled={busy} aria-busy={busy}>
              {t('rules.attach.preview')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('rules.attach.hint')}</p>
        <FormField label={t('rules.attach.field.rule')} error={errors.rule} required>
          <Select
            value={ruleId}
            disabled={preview.phase === 'applying'}
            onChange={(e): void => {
              setRuleId(e.target.value);
              reset();
            }}
          >
            <option value="">{t('config.choose')}</option>
            {rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('rules.attach.field.channel')} error={errors.channel} required>
          <Select
            value={channelId}
            disabled={preview.phase === 'applying'}
            onChange={(e): void => {
              setChannelId(e.target.value);
              reset();
            }}
          >
            <option value="">{t('config.choose')}</option>
            {offered.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {nameOf(channel.id)}
              </option>
            ))}
          </Select>
        </FormField>
        <p data-testid="preview-status" role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
          {busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
          <span>{statusText}</span>
        </p>
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}
        {counts ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {Object.entries(counts).map(([id, change]) => (
              <li key={id} data-preview-row className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{nameOf(id)}</span>
                <dl className="flex gap-4">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t('rules.attach.join')}</dt>
                    <dd className="font-medium tabular-nums">{change.join}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t('rules.attach.leave')}</dt>
                    <dd className="font-medium tabular-nums">{change.leave}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ModalDialog>
  );
}
