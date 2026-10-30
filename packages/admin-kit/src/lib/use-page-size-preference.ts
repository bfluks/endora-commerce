import { useCallback, useState } from 'react';
import { ADMIN_LIST_PAGE_SIZE_DEFAULT } from '@endora-commerce/contracts';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from './page-size-options.js';
import { useAdminPreferencesStore } from './admin-preferences/AdminPreferencesProvider.js';

/**
 * Supported page-size options across paginated admin lists — one array, declared
 * in `@endora-commerce/contracts` so the server validates against it too.
 * Re-exported here because every existing caller names it at this path.
 */
export { PAGE_SIZE_OPTIONS, type PageSizeOption };

function asOption(value: unknown): PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly unknown[]).includes(value)
    ? (value as PageSizeOption)
    : ADMIN_LIST_PAGE_SIZE_DEFAULT;
}

/**
 * The signed-in admin's page size for one list, kept on the server
 * (feature 164, FR-014; `specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §3).
 *
 * `scope` names the list (`'catalog-products'`, `'orders'`); two screens naming
 * the same scope share one value — the Product list and the product browser
 * dialog do. A new list gets a remembered size by choosing a scope id and
 * nothing else.
 *
 * The value is read **once, at mount**, into local state: a foreground refetch
 * that brings another device's choice changes what the next mount reads and
 * never resizes the list on screen. A stored size that is not one of the
 * options reads as the default (20) and is left as it is (FR-015).
 * `setPageSize` applies at once and saves that one list in the background.
 */
export function usePageSizePreference(scope: string): {
  pageSize: PageSizeOption;
  setPageSize: (next: PageSizeOption) => void;
} {
  const store = useAdminPreferencesStore();
  const [pageSize, setPageSizeState] = useState<PageSizeOption>(() =>
    asOption(store?.get('listPageSizes')[scope]),
  );

  const setPageSize = useCallback(
    (next: PageSizeOption): void => {
      setPageSizeState(next);
      store?.setListPageSize(scope, next);
    },
    [store, scope],
  );

  return { pageSize, setPageSize };
}
