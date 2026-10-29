import type { ReactNode } from 'react';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * A product's status pill and its Archived pill, shared by the product list and the
 * editor so the two read the same.
 *
 * Archived state is independent of the status, so an archived product shows both.
 * While it is archived the status pill drops to a neutral outline and Archived is
 * the only coloured pill: the status no longer decides anything a buyer sees, and
 * two coloured pills would compete (Von Restorff). The words carry the meaning;
 * colour only repeats it.
 */
export function ProductStatusPill(props: { status: 'active' | 'inactive'; archived?: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const tone = props.archived ? 'b2b-badge--outline' : props.status === 'active' ? 'b2b-badge--success' : '';
  return (
    <span className={cn('b2b-badge', 'b2b-badge--dot', tone)}>{t(`productsList.status.${props.status}`)}</span>
  );
}

export function ArchivedPill(): ReactNode {
  const t = useTranslation('catalog');
  return <span className="b2b-badge b2b-badge--warn">{t('productsList.status.archived')}</span>;
}
