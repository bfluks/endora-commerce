import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { withReturnTo } from '@endora-commerce/admin-kit/lib';

/**
 * A link to an Order or a Quote Request that leads back here
 * (`specs/158-crm-opportunity-inline-editing/`, FR-020): the target with
 * `?returnTo=` naming the screen as it is now — the Opportunity and its open
 * tab — so the document's *Back* returns to the deal being worked on and not
 * to that module's list.
 *
 * Only the screens that read `returnTo` get one; a Product's screen does not,
 * and its links stay as they were.
 */
export function useReturnHere(): (target: string) => string {
  const { pathname, search } = useLocation();
  const here = `${pathname}${search}`;
  return useCallback((target: string) => withReturnTo(target, here), [here]);
}
