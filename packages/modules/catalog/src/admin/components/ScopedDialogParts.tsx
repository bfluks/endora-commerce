import type { ReactNode } from 'react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';

/**
 * Feature 163 (review D9, D16) — what the attachment and packaging-unit dialogs share, so
 * the two say the same things the same way: the inherited value as visible text beside a
 * per-language field, one error wording, and a question before unsaved edits are dropped.
 */

type Translate = (key: string, params?: Record<string, string>) => string;

/** A refusal names itself (the server's message); anything else says nothing was saved. */
export function scopedSaveError(err: unknown, t: Translate): string {
  return err instanceof ApiError ? err.envelope.error.message : t('productEditor.scopeDialog.error');
}

/** "Inherited: …" beside a per-language field — the placeholder alone disappears on input (D9). */
export function InheritedHint({ id, value, t }: { id: string; value: string; t: Translate }): ReactNode {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {t('productEditor.scopeDialog.inherited', { value })}
    </p>
  );
}

/** Asked when a dialog holding unsaved edits is closed by Escape or Cancel (D16). */
export function DiscardChangesPrompt({
  onDiscard,
  onKeep,
  t,
}: {
  onDiscard: () => void;
  onKeep: () => void;
  t: Translate;
}): ReactNode {
  return (
    <Alert variant="warning">
      <AlertDescription>
        <p>{t('productEditor.scopeDialog.discard.body')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onKeep}>
            {t('productEditor.scopeDialog.discard.keep')}
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={onDiscard}>
            {t('productEditor.scopeDialog.discard.confirm')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
