import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { WebsiteRulePreviewResponse } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productVisibilityClient } from '../api.js';
import { previewStatusLabels, refusalCode, refusalMessage } from './labels.js';

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
  /** The refusal's code (`WEBSITE_RULE_PREVIEW_STALE`, …); `null` when there is none. */
  readonly refusalCode: string | null;
  /** Creating, counting or applying: the preview button waits. */
  readonly busy: boolean;
  /** The counts of a ready (or applying) preview — the only state in which a confirm is offered. */
  readonly counts: PreviewCounts | null;
  /** What the polite live region says now: the refusal when there is one, else the state. */
  readonly statusText: string;
  /** Still pending past the ceiling: the panel offers a new preview. */
  readonly slow: boolean;
  /** The Confirm button: focus moves to it when the preview is ready. */
  readonly confirmRef: RefObject<HTMLButtonElement | null>;
  /** Start the last preview again (after "this is taking longer than usual"). */
  again(): Promise<void>;
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
/**
 * A failure that carries no answer from the server — the network, or a server error — is worth
 * one more ask before the preview is given up; a refusal (4xx) is not.
 */
function isTransient(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500;
}

interface Refusal {
  readonly message: string;
  readonly code: string | null;
}

const refusalOf = (err: unknown, fallback: string): Refusal => ({ message: refusalMessage(err, fallback), code: refusalCode(err) });

/** About 75 s: a preview still pending after that says so and offers a new one (Doherty, Peak-End). */
export const PREVIEW_SLOW_AFTER_MS = 75_000;

export function usePreviewFlow(pollIntervalMs: number, slowAfterMs: number = PREVIEW_SLOW_AFTER_MS): PreviewFlow {
  const t = useTranslation('product_visibility_rules');
  const [preview, setPreview] = useState<PreviewState>({ phase: 'idle' });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [slow, setSlow] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastCreate = useRef<(() => Promise<{ previewId: string }>) | null>(null);
  const startedAt = useRef(0);
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
    setSlow(false);
  }, [stop]);

  const poll = useCallback(
    (previewId: string, mine: number, retried = false): void => {
      timer.current = setTimeout(() => {
        void productVisibilityClient
          .preview(previewId)
          .then((answer) => {
            if (mine !== ticket.current) return;
            if (answer.status === 'pending') {
              if (Date.now() - startedAt.current >= slowAfterMs) setSlow(true);
              poll(previewId, mine);
              return;
            }
            setSlow(false);
            if (answer.status === 'ready') {
              setPreview({ phase: 'ready', previewId, counts: answer.counts });
              return;
            }
            setPreview({ phase: 'ended', status: answer.status === 'expired' || answer.status === 'applied' ? 'expired' : 'failed' });
          })
          .catch((err: unknown) => {
            if (mine !== ticket.current) return;
            if (!retried && isTransient(err)) {
              poll(previewId, mine, true);
              return;
            }
            setSlow(false);
            setRefusal(refusalOf(err, t('rules.attach.previewFailed')));
            setPreview({ phase: 'ended', status: null });
          });
      }, pollIntervalMs);
    },
    [pollIntervalMs, slowAfterMs, t],
  );

  const start = useCallback(
    async (create: () => Promise<{ previewId: string }>): Promise<void> => {
      stop();
      const mine = ticket.current;
      lastCreate.current = create;
      startedAt.current = Date.now();
      setRefusal(null);
      setSlow(false);
      setPreview({ phase: 'creating' });
      try {
        const { previewId } = await create();
        if (mine !== ticket.current) return;
        setPreview({ phase: 'pending', previewId });
        poll(previewId, mine);
      } catch (err) {
        if (mine !== ticket.current) return;
        setRefusal(refusalOf(err, t('rules.attach.previewFailed')));
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
        setRefusal(refusalOf(err, t('config.error.write')));
        setPreview({ phase: 'ended', status: null });
      }
    },
    [preview, t],
  );

  const again = useCallback(async (): Promise<void> => {
    if (lastCreate.current) await start(lastCreate.current);
  }, [start]);

  // A ready preview's next step is Confirm: focus goes there, where the Preview button was.
  useEffect(() => {
    if (preview.phase === 'ready') confirmRef.current?.focus();
  }, [preview.phase]);

  const busy = preview.phase === 'creating' || preview.phase === 'pending' || preview.phase === 'applying';
  const counts = preview.phase === 'ready' || preview.phase === 'applying' ? preview.counts : null;
  const statusText = ((): string => {
    if (refusal !== null) return refusal.message;
    if (preview.phase === 'creating' || preview.phase === 'pending') {
      return slow && preview.phase === 'pending' ? t('preview.slow') : previewStatusLabels.label(t, 'pending');
    }
    if (preview.phase === 'ready') return previewStatusLabels.label(t, 'ready');
    if (preview.phase === 'ended' && preview.status !== null) return previewStatusLabels.label(t, preview.status);
    return '';
  })();

  return { preview, refusal: refusal?.message ?? null, refusalCode: refusal?.code ?? null, busy, counts, statusText, slow: slow && preview.phase === 'pending', confirmRef, again, start, confirm, reset, stop };
}
