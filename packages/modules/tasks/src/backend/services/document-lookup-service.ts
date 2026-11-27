import type {
  OrderListPort,
  RecordDocumentKind,
  RecordDocumentLookupGroup,
  RecordDocumentLookupResponse,
  TaskDocumentLookupQuery,
} from '@endora-commerce/contracts';
import type { OwnerReadChecks } from './owner-read-permissions.js';
import type { SwitchableRecordKind, TaskRecordOwners } from './record-owners.js';

/** How many documents each group of the `@@` list offers for one search (CRM's bound). */
export const DOCUMENT_LIST_GROUP_LIMIT = 10;

export interface TaskDocumentLookupServiceDeps {
  /** `orders`' list — lazy, resolved per call. `orders` cannot be switched off. */
  orders: OrderListPort;
  /** The one door to Quote Requests, Opportunities and Projects — asked `isPresent` first. */
  owners: Pick<TaskRecordOwners, 'isPresent' | 'search'>;
  /** Tasks the caller may see by number or title — this module's own visibility seam. */
  tasks: (q: string, limit: number) => Promise<ReadonlyArray<{ id: string; number: string; title: string }>>;
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests' | 'opportunities' | 'projects'>;
}

const SWITCHABLE_GROUPS: ReadonlyArray<{
  kind: SwitchableRecordKind;
  check: 'quoteRequests' | 'opportunities' | 'projects';
}> = [
  { kind: 'quote_request', check: 'quoteRequests' },
  { kind: 'opportunity', check: 'opportunities' },
  { kind: 'project', check: 'projects' },
];

/**
 * The `@@` document list of a Task's texts (`specs/165-task-management/`
 * FR-005, research R-5; `contracts/admin-api.md` §3
 * `GET /tasks/lookups/documents`) — one grouped answer, Orders · Quote
 * Requests · Tasks · Opportunities · Projects, the shape CRM and Projects
 * serve.
 *
 * A group is in the answer only for a caller holding its owner's read code
 * (`orders:read`, `rfqs:handle`, `crm:read`, `projects:read`; Tasks are the
 * caller's own `tasks:read`) and only while its owner is present: a group
 * nobody may open is not offered empty, it is not offered. A Task belongs to
 * no Organization, so Orders are those within the caller's own reach, and a
 * Quote Request is offered only by its number typed in full. Presence is
 * decided before each switchable owner is asked; nothing is caught.
 */
export class TaskDocumentLookupService {
  constructor(private readonly deps: TaskDocumentLookupServiceDeps) {}

  async documents(query: TaskDocumentLookupQuery): Promise<RecordDocumentLookupResponse> {
    const q = (query.q ?? '').trim();
    const [orders, tasks, ...switchable] = await Promise.all([
      this.deps.mayRead.orders().then((may) => (may ? this.#orders(q) : null)),
      this.deps
        .tasks(q, DOCUMENT_LIST_GROUP_LIMIT)
        .then((found) => found.map((task) => ({ id: task.id, label: task.number, sublabel: task.title }))),
      ...SWITCHABLE_GROUPS.map(async ({ kind, check }) => {
        if (!this.deps.owners.isPresent(kind)) return null;
        if (!(await this.deps.mayRead[check]())) return null;
        const found = await this.deps.owners.search(kind, q, DOCUMENT_LIST_GROUP_LIMIT);
        return found.map((record) => ({
          id: record.id,
          label: record.label,
          ...(record.sublabel ? { sublabel: record.sublabel } : {}),
        }));
      }),
    ]);
    const [quoteRequests, opportunities, projects] = switchable;
    const groups: RecordDocumentLookupGroup[] = [];
    const push = (kind: RecordDocumentKind, items: RecordDocumentLookupGroup['items'] | null | undefined) => {
      if (items) groups.push({ kind, items });
    };
    push('order', orders);
    push('quote_request', quoteRequests);
    push('task', tasks);
    push('opportunity', opportunities);
    push('project', projects);
    return { groups };
  }

  /** Orders by number within the caller's reach, newest placed first — `orders`' own list. */
  async #orders(q: string): Promise<RecordDocumentLookupGroup['items']> {
    const page = await this.deps.orders.list({ ...(q !== '' ? { q } : {}), page: 1, pageSize: DOCUMENT_LIST_GROUP_LIMIT });
    return page.rows.map((row) => ({ id: row.id, label: row.businessId }));
  }
}
