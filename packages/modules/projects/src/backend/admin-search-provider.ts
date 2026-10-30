import type {
  AdminSearchFieldDescriptor,
  AdminSearchProvider,
  AdminSearchProviderQuery,
  ProjectSummary,
  SupportedAdminLanguage,
} from '@endora-commerce/contracts';

/**
 * What the Project record type offers admin global search
 * (`specs/163-projects-and-tasks/contracts/admin-surfaces.md` §6): its number,
 * its title and the names of its Organizations.
 */
export const PROJECT_ADMIN_SEARCH_FIELDS: readonly AdminSearchFieldDescriptor[] = [
  { code: 'number', labelKey: 'adminSearch.field.number', defaultSelected: true, identifier: true },
  { code: 'title', labelKey: 'adminSearch.field.title', defaultSelected: true, identifier: false },
  { code: 'organizationName', labelKey: 'adminSearch.field.organizationName', defaultSelected: true, identifier: false },
];

export interface ProjectAdminSearchQuery {
  readonly text: string;
  readonly likeEscaped: string;
  readonly isUuid: boolean;
  readonly fields: readonly string[];
  readonly limit: number;
}

export interface ProjectAdminSearchProviderDeps {
  /** The Projects the caller may see that match, ranked — `ProjectReadService.searchForAdmin`. */
  search(query: ProjectAdminSearchQuery): Promise<{ rows: ProjectSummary[]; hasMore: boolean }>;
  /** A sentence of this module's bundle in the reader's language. */
  translate(key: string, language: SupportedAdminLanguage): Promise<string>;
}

/**
 * The Project provider. Visibility is the Project list's: the `projects:read`
 * gate its route enforces, and `ProjectAccess`' predicate — Organization reach
 * and the visibility rule — which the search composes, so a Project the reader
 * may not see is never a hit, by title, number, Organization or id.
 */
export function createProjectAdminSearchProvider(deps: ProjectAdminSearchProviderDeps): AdminSearchProvider {
  return {
    entityType: 'projects.project',
    moduleId: 'projects',
    labelKey: 'adminSearch.group.label',
    icon: 'ClipboardList',
    requiredPermission: 'projects:read',
    weight: 800,
    fields: PROJECT_ADMIN_SEARCH_FIELDS,
    async search(query: AdminSearchProviderQuery) {
      const { rows, hasMore } = await deps.search({
        text: query.text,
        likeEscaped: query.likeEscaped,
        isUuid: query.isUuid,
        fields: query.fields,
        limit: query.limit,
      });
      const states = [...new Set(rows.map((row) => row.state))];
      const labels = new Map(
        await Promise.all(
          states.map(async (state) => [state, await deps.translate(`state.${state}`, query.language)] as const),
        ),
      );
      return {
        hasMore,
        hits: rows.map((row) => ({
          id: row.id,
          title: `${row.number} · ${row.title}`,
          subtitle: row.organizations.length > 0 ? row.organizations.map((o) => o.name).join(', ') : null,
          status: { code: row.state, label: labels.get(row.state) ?? row.state },
          targetRoute: `/projects/${row.id}`,
        })),
      };
    },
  };
}
