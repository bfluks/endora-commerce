import type {
  OrderListPort,
  ProjectDocumentLookupQuery,
  RecordDocumentLookupGroup,
  RecordDocumentLookupResponse,
} from '@endora-commerce/contracts';
import type { LinkedRecordOwners } from './linked-records.js';
import type { OwnerReadChecks } from './owner-read-permissions.js';
import type { ProjectAccess } from './project-access.js';
import type { ProjectTasks } from './project-tasks.js';

/** How many documents each group of the `@@` list offers for one search (CRM's bound). */
export const DOCUMENT_LIST_GROUP_LIMIT = 10;

export interface ProjectDocumentLookupServiceDeps {
  access: Pick<ProjectAccess, 'loadVisible' | 'organizationIdsOf' | 'isOrgInScope'>;
  /** `orders`' list — lazy, resolved per call. `orders` cannot be switched off. */
  orders: OrderListPort;
  /** The one door to Quote Requests — asked `isPresent` first. */
  quoteRequests: Pick<LinkedRecordOwners, 'isPresent' | 'searchQuoteRequests'>;
  /** The one door to `tasks` — asked `present()` first. */
  tasks: Pick<ProjectTasks, 'present' | 'read'>;
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests' | 'tasks'>;
}

/**
 * The `@@` document list of a Project's texts
 * (`specs/163-projects-and-tasks/` FR-044, research R-14;
 * `contracts/admin-api.md` §2.4 `GET /projects/lookups/documents`) — one
 * grouped answer, Orders · Quote Requests · Tasks, the shape CRM serves at
 * `GET /crm/lookups/documents`.
 *
 * A group is in the answer only for a caller holding its owner's read code
 * (`orders:read`, `rfqs:handle`, `tasks:read`) and only while its owner is
 * present: a group nobody may open is not offered empty, it is not offered.
 * Orders and Quote Requests are those of the Project's Organizations — none for
 * an internal Project — or, on the create form, before there is a Project, of
 * the Organizations chosen on it (`organizationIds`), each only within the
 * caller's reach: one out of reach is dropped, never answered for and never
 * refused, so the list says nothing about it. Tasks are any the caller may see (`tasks`' context visibility, research R-9).
 * A Project the caller may not see answers 404 as one that does not exist.
 * Presence is decided before each switchable owner is asked; nothing is caught.
 */
export class ProjectDocumentLookupService {
  constructor(private readonly deps: ProjectDocumentLookupServiceDeps) {}

  async documents(query: ProjectDocumentLookupQuery): Promise<RecordDocumentLookupResponse> {
    const organizationIds =
      query.projectId !== undefined
        ? await this.deps.access.organizationIdsOf((await this.deps.access.loadVisible(query.projectId)).id)
        : [...new Set(query.organizationIds ?? [])].filter((organizationId) =>
            this.deps.access.isOrgInScope(organizationId),
          );
    const q = (query.q ?? '').trim();
    const withOrganizations = organizationIds.length > 0;
    const quoteRequestsPresent = withOrganizations && this.deps.quoteRequests.isPresent('quote_request');
    const tasksPresent = this.deps.tasks.present();
    const [mayReadOrders, mayReadQuoteRequests, mayReadTasks] = await Promise.all([
      withOrganizations ? this.deps.mayRead.orders() : Promise.resolve(false),
      quoteRequestsPresent ? this.deps.mayRead.quoteRequests() : Promise.resolve(false),
      tasksPresent ? this.deps.mayRead.tasks() : Promise.resolve(false),
    ]);

    const [orders, quoteRequests, tasks] = await Promise.all([
      mayReadOrders ? this.#orders(organizationIds, q) : Promise.resolve(null),
      mayReadQuoteRequests
        ? this.deps.quoteRequests
            .searchQuoteRequests(organizationIds, q, DOCUMENT_LIST_GROUP_LIMIT)
            .then((found) => found.map((record) => ({ id: record.id, label: record.number })))
        : Promise.resolve(null),
      mayReadTasks
        ? this.deps.tasks.read
            .search({ q, limit: DOCUMENT_LIST_GROUP_LIMIT })
            .then((found) => found.map((task) => ({ id: task.id, label: task.number, sublabel: task.title })))
        : Promise.resolve(null),
    ]);
    const groups: RecordDocumentLookupGroup[] = [];
    if (orders) groups.push({ kind: 'order', items: orders });
    if (quoteRequests) groups.push({ kind: 'quote_request', items: quoteRequests });
    if (tasks) groups.push({ kind: 'task', items: tasks });
    return { groups };
  }

  /** The Organizations' Orders by number, newest placed first — `orders`' own list, scoped to them. */
  async #orders(organizationIds: readonly string[], q: string): Promise<RecordDocumentLookupGroup['items']> {
    const page = await this.deps.orders.list(
      { ...(q !== '' ? { q } : {}), page: 1, pageSize: DOCUMENT_LIST_GROUP_LIMIT },
      { allowedOrganizationIds: [...organizationIds] },
    );
    return page.rows.map((row) => ({ id: row.id, label: row.businessId }));
  }
}
