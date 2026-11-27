import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebsiteRulePreviewResponse } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productVisibilityClient } from '../api.js';
import { previewStatusLabels, refusalMessage } from './labels.js';

export type PreviewCounts = WebsiteRulePreviewResponse['counts'];

export type PreviewState =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'pending'; previewId: string }
  | { phase: 'ready'; previewId: string; counts: PreviewCounts }
  | { phase: 'ended'; status: 'failed' | 'expired' | null }
  | { phase: 'applying'; previewId: string; counts: PreviewCounts };

export interface PreviewFlow {
  readonly preview: PreviewState;
  /** The server's sentence for a refused create, poll or confirm; `null` when there is none. */
  readonly refusal: string | null;
  /** Creating, counting or applying: the preview button waits. */
  readonly busy: boolean;
  /** The counts of a ready (or applying) preview — the only state in which a confirm is offered. */
  readonly counts: PreviewCounts | null;
  /** What the polite live region says now. */
  readonly statusText: string;
  /** Start a preview with `create`; a running one is dropped first. */
  start(create: () => Promise<{ previewId: string }>): Promise<void>;
  /** Confirm the ready preview, then `onApplied`; a refusal spends the preview (stale, expired, taken). */
  confirm(onApplied: () => Promise<void>): Promise<void>;
  /** Drop the preview: the inputs it counted changed. */
  reset(): void;
  /** Stop polling (the dialog closes). */
  stop(): void;
}

/**
 * FR-053 — the preview → confirm flow shared by attaching a rule and changing an attached rule's
 * conditions. The preview is counted on the server; this polls it while it is pending, and a late
 * answer for a preview that stopped mattering (inputs changed, dialog closed) is dropped. A stale or
 * expired preview ends in a state that offers a new one rather than a dead end (Peak-End).
 */
export function usePreviewFlow(pollIntervalMs: number): PreviewFlow {
  const t = useTranslation('product_visibility_rules');
  const [preview, setPreview] = useState<PreviewState>({ phase: 'idle' });
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Bumped whenever a preview stops mattering. A late answer for an older ticket is dropped. */
  const ticket = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback((): void => {
    ticket.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const reset = useCallback((): void => {
    stop();
    setPreview({ phase: 'idle' });
    setRefusal(null);
  }, [stop]);

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

  const start = useCallback(
    async (create: () => Promise<{ previewId: string }>): Promise<void> => {
      stop();
      const mine = ticket.current;
      setRefusal(null);
      setPreview({ phase: 'creating' });
      try {
        const { previewId } = await create();
        if (mine !== ticket.current) return;
        setPreview({ phase: 'pending', previewId });
        poll(previewId, mine);
      } catch (err) {
        if (mine !== ticket.current) return;
        setRefusal(refusalMessage(err, t('rules.attach.previewFailed')));
        setPreview({ phase: 'ended', status: null });
      }
    },
    [poll, stop, t],
  );

  const confirm = useCallback(
    async (onApplied: () => Promise<void>): Promise<void> => {
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
    },
    [preview, t],
  );

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

  return { preview, refusal, busy, counts, statusText, start, confirm, reset, stop };
}
