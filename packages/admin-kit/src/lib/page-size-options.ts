/**
 * The page sizes every paginated admin list offers.
 *
 * It is a module of its own because the **constant** is design-system and the
 * **preference** is application state: `PaginationFooter` only needs the list of
 * numbers to render its dropdown. Since feature 164 the array itself is declared in
 * `@endora-commerce/contracts` (`ADMIN_LIST_PAGE_SIZE_OPTIONS`), because the server
 * validates a stored page size against it and cannot import the kit. This file
 * re-exports that one array under the kit's names, so the dropdown, the preference
 * hook and the server cannot disagree (`admin/test/kit/admin-kit-identity.test.ts`).
 */
export {
  ADMIN_LIST_PAGE_SIZE_OPTIONS as PAGE_SIZE_OPTIONS,
  type AdminListPageSize as PageSizeOption,
} from '@endora-commerce/contracts';
