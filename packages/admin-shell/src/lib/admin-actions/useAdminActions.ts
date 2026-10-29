import { useMemo } from 'react';
import type { AdminActionView } from '@endora-commerce/contracts';
import { useAdminActionsContext } from './AdminActionsProvider.js';
import { matchesSearchTerms, searchTerms } from '../palette-match.js';

/**
 * Read the operator-visible action list from the registry context, with
 * an optional client-side substring filter.
 *
 * The list is already permission-filtered, language-resolved, and
 * sorted by (weight, label) by the server. Client-side we only:
 *   - apply the user's typed query against label / description /
 *     keywords — every query word must occur somewhere in the row
 *     (diacritic-insensitive, case-insensitive; `lib/palette-match.ts`).
 *   - return the same list verbatim when the query is empty.
 */
export function useAdminActions(query?: string): {
  actions: AdminActionView[];
  isLoading: boolean;
  error: Error | null;
} {
  const ctx = useAdminActionsContext();
  const filtered = useMemo<AdminActionView[]>(() => {
    if (!query || query.trim().length === 0) return ctx.actions;
    const terms = searchTerms(query);
    return ctx.actions.filter((a) =>
      matchesSearchTerms(terms, [a.label, a.description, ...a.keywords]),
    );
  }, [ctx.actions, query]);
  return { actions: filtered, isLoading: ctx.isLoading, error: ctx.error };
}
