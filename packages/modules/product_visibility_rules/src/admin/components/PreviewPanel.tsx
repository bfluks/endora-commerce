import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button } from '@endora-commerce/admin-kit/ui';
import type { PreviewFlow } from '../lib/use-preview-flow.js';

/**
 * A preview's state — or the server's refusal — in one polite live region mounted before it has
 * text (SC 4.1.3): a refusal is said there rather than in an alert mounted with its text, which is
 * not reliably announced. Past the ceiling it says so and offers a new preview (Peak-End). Once
 * ready, how many products would join and leave each channel (FR-053), or that nothing changes.
 */
export function PreviewPanel({ flow, channelName }: { readonly flow: PreviewFlow; readonly channelName: (id: string) => string }): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const refused = flow.refusal !== null;
  const unchanged = flow.counts !== null && Object.values(flow.counts).every((change) => change.join === 0 && change.leave === 0);
  return (
    <>
      <p
        data-testid="preview-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`flex items-center gap-2 text-sm ${refused ? 'font-medium text-destructive' : ''}`}
      >
        {flow.busy && !refused ? <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : null}
        {refused ? <AlertCircle className="size-4 shrink-0" aria-hidden="true" /> : null}
        <span>{flow.statusText}</span>
      </p>
      {flow.slow ? (
        <Button type="button" size="sm" variant="outline" onClick={(): void => void flow.again()}>
          {t('preview.again')}
        </Button>
      ) : null}
      {flow.counts && unchanged ? <p className="text-sm">{t('rules.attach.nothingChanges')}</p> : null}
      {flow.counts && !unchanged ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {Object.entries(flow.counts).map(([id, change]) => (
            <li key={id} data-preview-row className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-medium">{channelName(id)}</span>
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
    </>
  );
}
