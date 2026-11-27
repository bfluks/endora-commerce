import { useState, type ReactNode } from 'react';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Button, FormField, Select } from '@endora-commerce/admin-kit/ui';
import { productVisibilityClient } from '../api.js';
import { channelName } from '../lib/labels.js';
import type { SalesChannelRow } from '../lib/use-overview.js';
import { usePreviewFlow } from '../lib/use-preview-flow.js';
import { PreviewPanel } from './PreviewPanel.js';

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
  const flow = usePreviewFlow(pollIntervalMs);
  const [errors, setErrors] = useState<{ rule?: string; channel?: string }>({});

  const offered = channels.filter((c) => !governed.has(c.id));
  const nameOf = (id: string): string => channelName(channels.find((c) => c.id === id), language, t('config.unknownChannel'));

  const startPreview = async (): Promise<void> => {
    const found: { rule?: string; channel?: string } = {};
    if (ruleId === '') found.rule = t('rules.attach.error.ruleRequired');
    if (channelId === '') found.channel = t('rules.attach.error.channelRequired');
    setErrors(found);
    if (found.rule || found.channel) return;
    await flow.start(() => productVisibilityClient.createPreview({ kind: 'attach', productRuleId: ruleId, salesChannelIds: [channelId] }));
  };

  const applying = flow.preview.phase === 'applying';

  return (
    <ModalDialog
      title={t('rules.attach.title')}
      onClose={(): void => {
        flow.stop();
        onClose();
      }}
      busy={applying}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={applying}>
            {t('config.cancel')}
          </Button>
          {flow.counts ? (
            <Button type="button" onClick={(): void => void flow.confirm(onApplied)} disabled={applying} aria-busy={applying}>
              {t('rules.attach.confirm')}
            </Button>
          ) : (
            <Button type="button" onClick={(): void => void startPreview()} disabled={flow.busy} aria-busy={flow.busy}>
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
            disabled={applying}
            onChange={(e): void => {
              setRuleId(e.target.value);
              flow.reset();
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
            disabled={applying}
            onChange={(e): void => {
              setChannelId(e.target.value);
              flow.reset();
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
        <PreviewPanel flow={flow} channelName={nameOf} />
      </div>
    </ModalDialog>
  );
}
