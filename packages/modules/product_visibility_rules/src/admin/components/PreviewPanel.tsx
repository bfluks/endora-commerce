import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import type { PreviewFlow } from '../lib/use-preview-flow.js';

/**
 * A preview's state in a polite live region mounted before it has text (SC 4.1.3), the server's
 * refusal, and, once ready, how many products would join and leave each channel (FR-053).
 */
export function PreviewPanel({ flow, channelName }: { readonly flow: PreviewFlow; readonly channelName: (id: string) => string }): ReactNode {
  const t = useTranslation('product_visibility_rules');
  return (
    <>
      <p data-testid="preview-status" role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
        {flow.busy ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
        <span>{flow.statusText}</span>
      </p>
      {flow.refusal ? (
        <Alert variant="destructive">
          <AlertDescription>{flow.refusal}</AlertDescription>
        </Alert>
      ) : null}
      {flow.counts ? (
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
