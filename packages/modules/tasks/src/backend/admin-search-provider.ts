import type {
  AdminSearchFieldDescriptor,
  AdminSearchProvider,
  AdminSearchProviderQuery,
  SupportedAdminLanguage,
} from '@endora-commerce/contracts';

/**
 * What the Task record type offers admin global search
 * (`specs/163-projects-and-tasks/contracts/admin-surfaces.md` §6): its number
 * and its title.
 */
export const TASK_ADMIN_SEARCH_FIELDS: readonly AdminSearchFieldDescriptor[] = [
  { code: 'number', labelKey: 'adminSearch.field.number', defaultSelected: true, identifier: true },
  { code: 'title', labelKey: 'adminSearch.field.title', defaultSelected: true, identifier: false },
];

export interface TaskAdminSearchQuery {
  readonly text: string;
  readonly likeEscaped: string;
  readonly isUuid: boolean;
  readonly fields: readonly string[];
  readonly limit: number;
}

export interface TaskAdminSearchRow {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  /** A code of the workflow. */
  readonly status: string;
}

export interface TaskAdminSearchProviderDeps {
  /** The Tasks the caller may see that match, ranked — `TaskService.searchForAdmin`. */
  search(query: TaskAdminSearchQuery): Promise<{ rows: TaskAdminSearchRow[]; hasMore: boolean }>;
  /** A status's name in the reader's language — the workflow's own words (`specs/165-task-management/` R-1). */
  statusLabel(code: string, language: SupportedAdminLanguage): Promise<string>;
}

/**
 * The Task provider. Visibility is the Tasks list's: the `tasks:read` gate its
 * route enforces, and the visibility pre-filter the search composes — a Task
 * whose context the reader may not see, or whose context's owner is off
 * (163 R-9), or another admin's draft or private Task (165 R-3), is never a hit.
 */
export function createTaskAdminSearchProvider(deps: TaskAdminSearchProviderDeps): AdminSearchProvider {
  return {
    entityType: 'tasks.task',
    moduleId: 'tasks',
    labelKey: 'adminSearch.group.label',
    icon: 'ListChecks',
    requiredPermission: 'tasks:read',
    weight: 810,
    fields: TASK_ADMIN_SEARCH_FIELDS,
    async search(query: AdminSearchProviderQuery) {
      const { rows, hasMore } = await deps.search({
        text: query.text,
        likeEscaped: query.likeEscaped,
        isUuid: query.isUuid,
        fields: query.fields,
        limit: query.limit,
      });
      const statuses = [...new Set(rows.map((row) => row.status))];
      const labels = new Map(
        await Promise.all(
          statuses.map(async (status) => [status, await deps.statusLabel(status, query.language)] as const),
        ),
      );
      return {
        hasMore,
        hits: rows.map((row) => ({
          id: row.id,
          title: `${row.number} · ${row.title}`,
          subtitle: null,
          status: { code: row.status, label: labels.get(row.status) ?? row.status },
          targetRoute: `/tasks/${row.id}`,
        })),
      };
    },
  };
}
