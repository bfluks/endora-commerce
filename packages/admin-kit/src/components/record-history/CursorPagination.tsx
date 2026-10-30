import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '../../lib/index.js';
import { Button } from '../../ui/button.js';
import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export interface CursorPaginationProps {
  /** One-based number of the page on screen. */
  page: number;
  pageSize: PageSizeOption;
  /** The most rows the endpoint returns in one page: larger sizes are not offered. All of them when absent. */
  maxPageSize?: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** While a page is being fetched, so a second press cannot skip one. */
  busy?: boolean;
  onPageSizeChange: (next: PageSizeOption) => void;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * The footer of a cursor-paginated list: rows per page, the page number, and
 * Previous / Next.
 *
 * The kit's `PaginationFooter` is built for a list that knows its total — it
 * renders "Showing X–Y of Z" and "Page N of M". A cursor-paginated endpoint
 * (`{ cursor, hasMore, limit }`) knows no total, so that component could only
 * be fed an invented one. This one says what the server can actually answer,
 * in the same place, with the kit's buttons and the shared
 * `common.pagination.*` copy (CRM's Opportunities list first; promoted by
 * `specs/163-projects-and-tasks/` research R-17).
 */
export function CursorPagination(props: CursorPaginationProps): ReactNode {
  const t = useTranslation('core');
  const sizes = PAGE_SIZE_OPTIONS.filter((size) => size <= (props.maxPageSize ?? Number.POSITIVE_INFINITY));

  return (
    <nav
      aria-label={t('cursorPagination.label')}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
    >
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('common.pagination.rowsPerPage')}
        <Select
          className="h-11 w-auto text-xs sm:h-8"
          value={props.pageSize}
          onChange={(event): void => {
            const next = Number.parseInt(event.target.value, 10) as PageSizeOption;
            if (sizes.includes(next)) props.onPageSizeChange(next);
          }}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t('cursorPagination.page', { page: props.page })}
        </span>
        <Button className="min-h-11 sm:min-h-8"
          variant="outline"
          size="sm"
          disabled={!props.hasPrevious || props.busy}
          onClick={props.onPrevious}
        >
          <ChevronLeft aria-hidden="true" />
          {t('common.pagination.previous')}
        </Button>
        <Button className="min-h-11 sm:min-h-8"
          variant="outline"
          size="sm"
          disabled={!props.hasNext || props.busy}
          onClick={props.onNext}
        >
          {t('common.pagination.next')}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
