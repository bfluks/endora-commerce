import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleDollarSign, Plus, SearchX, X } from 'lucide-react';
import {
  opportunityBoardCustomFieldRef,
  type CustomFieldFilter,
  type CustomFieldFilters,
  type OpportunityFieldFilters,
  type OpportunityStatusKind,
  type OpportunitySummary,
  type OpportunityWorkflowStatus,
} from '@endora-commerce/contracts';
import {
  formatDateTime,
  statusBadgeStyle,
  useAuth,
  usePageSizePreference,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  ResponsiveTable,
  customFieldFilterRefusal,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  toCustomFieldFiltersParam,
  useCustomFieldListFilterFields,
  writeCustomFieldFilterParams,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OpportunityListParams, type OpportunitySort } from '../api.js';
import { AssigneeName } from '../components/AssigneeName.js';
import { TagChips } from '../components/TagPicker.js';
import { CursorPagination, MAX_PAGE_LIMIT } from '../components/CursorPagination.js';
import {
  NO_SHARED_FILTERS,
  OpportunityFilterFields,
  hasSharedFilters,
  sharedFilterParams,
  type SharedOpportunityFilters,
} from '../components/OpportunityFilterFields.js';
import {
  calendarDateLabel,
  errorMessage,
  moneyLabel,
  workflowStatusLabel,
} from '../lib/labels.js';

const STATES: readonly OpportunityStatusKind[] = ['open', 'won', 'lost'];

/** `<field>:<direction>` — one control for the two query parameters. */
const SORTS = [
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'value:desc',
  'expectedCloseDate:asc',
] as const;
type SortOption = (typeof SORTS)[number];

const SEARCH_DEBOUNCE_MS = 300;

/** The custom fields this list offers as filters (feature 157). */
const CUSTOM_FIELD_FILTERS_ENDPOINT = '/api/v1/admin/crm/opportunities/custom-field-filters';
/** A refused key shown in the UI is cut here: one that did not come from this client may be any length. */
const SHOWN_KEY_MAX = 64;

/**
 * The custom-field filters as the list's `fieldFilters`: one `custom:<key>`
 * reference each. Sent without `cardValues`, so the server applies the
 * list-filter option, not the board card's rule (FR-011a).
 */
function customFieldReferences(filters: CustomFieldFilters): OpportunityFieldFilters | undefined {
  const keys = Object.keys(filters);
  if (keys.length === 0) return undefined;
  const references: OpportunityFieldFilters = {};
  for (const key of keys) {
    const filter = filters[key];
    if (filter !== undefined) references[opportunityBoardCustomFieldRef(key)] = filter;
  }
  return references;
}

/**
 * `filters` with `key` set to `filter` (`null` removes it), as a new
 * prototype-free record — a key such as `constructor` stays an ordinary key.
 */
function withCustomFilter(
  filters: CustomFieldFilters,
  key: string,
  filter: CustomFieldFilter | null,
): CustomFieldFilters {
  const next = Object.create(null) as CustomFieldFilters;
  for (const existing of Object.keys(filters)) {
    const value = filters[existing];
    if (existing !== key && value !== undefined) next[existing] = value;
  }
  if (filter !== null) next[key] = filter;
  return next;
}

function shownKey(key: string): string {
  return key.length > SHOWN_KEY_MAX ? `${key.slice(0, SHOWN_KEY_MAX)}…` : key;
}

/** The filters shared with the board, plus the two only a list has. */
interface Filters extends SharedOpportunityFilters {
  state: OpportunityStatusKind | '';
  statusCode: string;
}

const NO_FILTERS: Filters = { ...NO_SHARED_FILTERS, state: '', statusCode: '' };

function hasFilters(filters: Filters): boolean {
  return hasSharedFilters(filters) || filters.state !== '' || filters.statusCode !== '';
}

/**
 * The Opportunities list (`specs/143-crm-sales-opportunities/`, User Story 1 —
 * FR-003 – FR-005): every Opportunity the operator may see, filtered by text,
 * state, status, Organization, Sales Channel and creation date.
 *
 * The fields the board has too are one component, `OpportunityFilterFields`;
 * the state and the status are the list's alone, because the board's columns
 * *are* the statuses.
 *
 * Custom-field filters (feature 157) are the definitions whose list-filter
 * option is on, whatever the board card shows. They live in the address as
 * `cf.<key>.<op>` and reach the server as `custom:<key>` references in
 * `fieldFilters`; a filter the server refuses is reported by name with a way
 * to remove it. The board and its card-field filters are untouched.
 */
export function OpportunitiesList(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const { pageSize, setPageSize } = usePageSizePreference('crm-opportunities');

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('createdAt:desc');
  /** The cursors that led to the page on screen; empty on the first page. */
  const [trail, setTrail] = useState<string[]>([]);
  const [rows, setRows] = useState<OpportunitySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<OpportunityWorkflowStatus[]>([]);
  const sequence = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [customFilters, setCustomFilters] = useState<CustomFieldFilters>(() =>
    readCustomFieldFilterParams(searchParams),
  );
  /** The key of a custom-field filter the server refused, until it is removed. */
  const [refusedKey, setRefusedKey] = useState<string | null>(null);
  const { fields: customFields, status: customFieldsStatus } =
    useCustomFieldListFilterFields(CUSTOM_FIELD_FILTERS_ENDPOINT);

  /** The custom-field filters changed: into the address, and back to the first page. */
  const changeCustom = useCallback(
    (next: CustomFieldFilters): void => {
      setCustomFilters(next);
      setRefusedKey(null);
      setTrail([]);
      setSearchParams((previous) => writeCustomFieldFilterParams(previous, next), { replace: true });
    },
    [setSearchParams],
  );

  // Options removed since the address was written are dropped once the fields
  // are known; an unknown key stays for the server to refuse.
  useEffect(() => {
    if (customFieldsStatus !== 'ready') return;
    setCustomFilters((previous) => {
      const pruned = pruneRemovedOptions(previous, customFields);
      return toCustomFieldFiltersParam(pruned) === toCustomFieldFiltersParam(previous) ? previous : pruned;
    });
  }, [customFields, customFieldsStatus]);

  // The status filter offers the configured workflow. Without it the list is
  // still usable — the filter simply has nothing to offer.
  useEffect(() => {
    let alive = true;
    crmApi
      .getWorkflow()
      .then((workflow) => {
        if (alive) setStatuses([...workflow.statuses].sort((a, b) => a.weight - b.weight));
      })
      .catch(() => {
        if (alive) setStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  // The search box is typed into; the request follows once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((previous) => (previous.q === search ? previous : { ...previous, q: search }));
      setTrail((previous) => (previous.length === 0 ? previous : []));
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search]);

  const params = useMemo<OpportunityListParams>(() => {
    const [field, order] = sort.split(':') as [OpportunitySort, 'asc' | 'desc'];
    const cursor = trail[trail.length - 1];
    const fieldFilters = customFieldReferences(customFilters);
    return {
      ...sharedFilterParams(filters),
      ...(fieldFilters ? { fieldFilters } : {}),
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.statusCode ? { statusCode: [filters.statusCode] } : {}),
      sort: field,
      order,
      ...(cursor ? { cursor } : {}),
      limit: Math.min(pageSize, MAX_PAGE_LIMIT),
    };
  }, [filters, customFilters, sort, trail, pageSize]);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const page = await crmApi.listOpportunities(params);
      // A slower, older answer must not overwrite a newer one.
      if (current !== sequence.current) return;
      setRows(page.data);
      setNextCursor(page.pagination.hasMore ? page.pagination.cursor : null);
      setLoaded(true);
    } catch (failure) {
      if (current !== sequence.current) return;
      const refused = customFieldFilterRefusal(failure);
      setRefusedKey(refused);
      setError(refused === null ? errorMessage(failure, t('opportunity.list.error')) : null);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any change of what is asked for starts again from the first page. */
  const change = (patch: Partial<Filters>): void => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setTrail([]);
  };

  const clear = (): void => {
    setSearch('');
    setFilters(NO_FILTERS);
    setTrail([]);
    if (Object.keys(customFilters).length > 0) changeCustom(Object.create(null) as CustomFieldFilters);
  };

  const removeRefused = (): void => {
    if (refusedKey !== null) changeCustom(withCustomFilter(customFilters, refusedKey, null));
  };

  const refusedField = refusedKey === null ? undefined : customFields.find((field) => field.key === refusedKey);
  const refusedName =
    refusedKey === null
      ? ''
      : refusedField
        ? (refusedField.label[language] ?? refusedField.labelDefault)
        : shownKey(refusedKey);

  const filtered =
    hasFilters(filters) || search.trim() !== '' || Object.keys(customFilters).length > 0;

  const columns: ResponsiveColumn<OpportunitySummary>[] = [
    {
      id: 'number',
      header: t('opportunity.list.col.number'),
      primary: true,
      render: (row) => (
        <Link
          to={`/crm/opportunities/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.number}
        </Link>
      ),
      meta: (row) => row.organization.name,
    },
    {
      id: 'title',
      header: t('opportunity.list.col.title'),
      primary: true,
      render: (row) => (
        <div className="space-y-1">
          <span>{row.title}</span>
          <TagChips tags={row.tags} />
        </div>
      ),
    },
    {
      id: 'organization',
      header: t('opportunity.list.col.organization'),
      hideOnMobile: true,
      render: (row) => row.organization.name,
    },
    {
      id: 'status',
      header: t('opportunity.list.col.status'),
      render: (row) => (
        <Badge className="font-medium" style={statusBadgeStyle(row.status.color)}>
          {row.status.name}
        </Badge>
      ),
    },
    {
      id: 'assignee',
      header: t('assignment.label'),
      hideOnMobile: true,
      render: (row) => <AssigneeName assignee={row.assignee} />,
    },
    {
      id: 'value',
      header: t('opportunity.list.col.value'),
      className: 'text-right tabular-nums',
      render: (row) => moneyLabel(row.value, row.currency),
    },
    {
      id: 'expectedClose',
      header: t('opportunity.list.col.expectedClose'),
      render: (row) => calendarDateLabel(row.expectedCloseDate),
    },
    {
      id: 'created',
      header: t('opportunity.list.col.created'),
      hideOnMobile: true,
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  const newOpportunity = (
    <Button className="min-h-11 sm:min-h-9" asChild>
      <Link to="/crm/opportunities/new">
        <Plus aria-hidden="true" />
        {t('opportunity.list.new')}
      </Link>
    </Button>
  );

  const emptyState = filtered ? (
    <div className="b2b-empty">
      <div className="b2b-empty__icon">
        <SearchX aria-hidden="true" />
      </div>
      <div className="b2b-empty__title">{t('opportunity.list.noResults.title')}</div>
      <div className="b2b-empty__sub">{t('opportunity.list.noResults.body')}</div>
      <Button className="min-h-11 sm:min-h-9" variant="outline" onClick={clear}>
        <X aria-hidden="true" />
        {t('opportunity.list.filter.clear')}
      </Button>
    </div>
  ) : (
    <div className="b2b-empty">
      <div className="b2b-empty__icon">
        <CircleDollarSign aria-hidden="true" />
      </div>
      <div className="b2b-empty__title">{t('opportunity.list.empty.title')}</div>
      <div className="b2b-empty__sub">
        {canWrite ? t('opportunity.list.empty.body') : t('opportunity.list.empty.bodyReadOnly')}
      </div>
      {canWrite ? newOpportunity : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('opportunity.list.title')}
        description={t('opportunity.list.description')}
        // With nothing listed the empty state carries the one action; two
        // filled buttons for the same thing would compete.
        actions={canWrite && (rows.length > 0 || filtered || !loaded) ? newOpportunity : undefined}
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <OpportunityFilterFields
              idPrefix="crm-opportunity"
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onChange={change}
            >
              <div className="space-y-1">
                <Label htmlFor="crm-opportunity-state">{t('opportunity.list.filter.state')}</Label>
                <Select
                  id="crm-opportunity-state"
                  value={filters.state}
                  onChange={(event): void =>
                    change({ state: event.target.value as OpportunityStatusKind | '' })
                  }
                >
                  <option value="">{t('opportunity.list.filter.stateAll')}</option>
                  {STATES.map((state) => (
                    <option key={state} value={state}>
                      {t(`opportunity.state.${state}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="crm-opportunity-status">{t('opportunity.list.filter.status')}</Label>
                <Select
                  id="crm-opportunity-status"
                  value={filters.statusCode}
                  onChange={(event): void => change({ statusCode: event.target.value })}
                >
                  <option value="">{t('opportunity.list.filter.statusAll')}</option>
                  {statuses.map((status) => (
                    <option key={status.code} value={status.code}>
                      {workflowStatusLabel(status, language)}
                    </option>
                  ))}
                </Select>
              </div>
            </OpportunityFilterFields>
            <CustomFieldListFilters
              idPrefix="crm-opportunity"
              fields={customFields}
              value={customFilters}
              onChange={(key, filter): void => changeCustom(withCustomFilter(customFilters, key, filter))}
              language={language}
            />
            {customFieldsStatus === 'error' ? (
              <p className="self-end text-sm text-muted-foreground">{tCore('customFieldFilters.loadFailed')}</p>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor="crm-opportunity-sort">{t('opportunity.list.sort')}</Label>
              <Select
                id="crm-opportunity-sort"
                className="w-auto"
                value={sort}
                onChange={(event): void => {
                  setSort(event.target.value as SortOption);
                  setTrail([]);
                }}
              >
                {SORTS.map((option) => (
                  <option key={option} value={option}>
                    {t(`opportunity.list.sortOption.${option.replace(':', '.')}`)}
                  </option>
                ))}
              </Select>
            </div>
            {filtered ? (
              <Button className="min-h-11 sm:min-h-8" variant="ghost" size="sm" onClick={clear}>
                <X aria-hidden="true" />
                {t('opportunity.list.filter.clear')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6" aria-busy={loading}>
          {refusedKey !== null ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{tCore('customFieldFilters.error.unavailable', { field: refusedName })}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={removeRefused}>
                  {tCore('customFieldFilters.error.remove')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('opportunity.list.loading')}
            </p>
          ) : (
            <>
              <ResponsiveTable
                data={rows}
                columns={columns}
                keyExtractor={(row): string => row.id}
                emptyState={emptyState}
              />
              {rows.length > 0 || trail.length > 0 ? (
                <CursorPagination
                  page={trail.length + 1}
                  pageSize={pageSize}
                  hasPrevious={trail.length > 0}
                  hasNext={nextCursor !== null}
                  busy={loading}
                  onPageSizeChange={(next): void => {
                    setPageSize(next);
                    setTrail([]);
                  }}
                  onPrevious={(): void => setTrail((previous) => previous.slice(0, -1))}
                  onNext={(): void => {
                    if (nextCursor) setTrail((previous) => [...previous, nextCursor]);
                  }}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunitiesList;
