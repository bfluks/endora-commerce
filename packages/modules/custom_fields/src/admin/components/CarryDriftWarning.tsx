import { useRef, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { SupportedEntityType } from '@endora-commerce/contracts';
import type { CarryCounterpart } from '../lib/carry-drift.js';
import { shownKey } from '../lib/carry-labels.js';

export interface CarryDriftNoticeProps {
  counterparts: readonly CarryCounterpart[];
  /** The translated name of an entity type. */
  typeLabel: (entityType: SupportedEntityType) => string;
  /** A sentence naming the action itself, above the warning (a deletion says what it deletes). */
  lead?: string;
}

/**
 * What a change is about to break (FR-019, `admin-surfaces.md` §1.4): the
 * warning's sentence and one "<entity type> · <key>" line per counterpart.
 * Text only — the key is interpolated, never markup.
 */
export function CarryDriftNotice({ counterparts, typeLabel, lead }: CarryDriftNoticeProps): ReactNode {
  const t = useTranslation('custom_fields');
  return (
    <div className="space-y-2 text-sm">
      {lead ? <p className="break-words">{lead}</p> : null}
      <p className="flex items-start gap-2 break-words">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span>{t('customFields.carry.warning.body')}</span>
      </p>
      <ul className="list-disc space-y-0.5 pl-10">
        {counterparts.map((counterpart) => (
          <li key={`${counterpart.role}:${counterpart.entityType}:${counterpart.key}`} className="break-words">
            {t('customFields.carry.warning.counterpart', {
              entityType: typeLabel(counterpart.entityType),
              key: shownKey(counterpart.key),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CarryDriftDialogProps extends CarryDriftNoticeProps {
  onCancel: () => void;
  onProceed: () => void;
  /** `destructive` for a deletion, so the button reads as what it does. */
  proceedVariant?: 'default' | 'destructive';
}

/**
 * The warning as a dialog of its own, for a change made outside any dialog
 * (the table's audience select and *Delete*). Focus starts on *Cancel* — the
 * choice that changes nothing — and Escape or the scrim cancel too.
 */
export function CarryDriftDialog({
  counterparts,
  typeLabel,
  lead,
  onCancel,
  onProceed,
  proceedVariant = 'default',
}: CarryDriftDialogProps): ReactNode {
  const t = useTranslation('custom_fields');
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalDialog
      title={t('customFields.carry.warning.title')}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel}>
            {t('customFields.carry.warning.cancel')}
          </Button>
          <Button type="button" variant={proceedVariant} className="min-h-11 sm:min-h-9" onClick={onProceed}>
            {t('customFields.carry.warning.proceed')}
          </Button>
        </>
      }
    >
      <CarryDriftNotice counterparts={counterparts} typeLabel={typeLabel} {...(lead ? { lead } : {})} />
    </ModalDialog>
  );
}
