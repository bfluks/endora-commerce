import { ADMIN_PERMISSION_WILDCARD, type PermissionReadPort } from '@endora-commerce/contracts';
import { actingAdminUserId, isSystemActor } from './project-access.js';

/**
 * What a linked or mentioned record shows is its owner's data, and
 * `projects:read` is not a permission to read it
 * (`specs/163-projects-and-tasks/research.md` R-10, R-17 — a copy of CRM's
 * `owner-read-permissions.ts` shape, not an import: the platform surface is
 * deliberately narrow and the shape is a few lines).
 *
 * The number, status and amount of an Order are rendered only for a caller who
 * also holds `orders:read`; those of a Quote Request for one holding
 * `rfqs:handle` (that module's one code, which gates its reads too); an
 * Opportunity's for `crm:read`; a Task's for `tasks:read`. Anybody else sees
 * that a record is linked, and no more. The system actor — a subscriber, a
 * worker — is nobody's session and is not narrowed; any other caller without an
 * administrator behind it (a customer, an api key) is answered no.
 *
 * **Asked by a service, after the owner's presence is decided** — never as a
 * `requireAdmin` on a route for a switchable owner: while that module is off
 * its code cannot be granted to anybody, and a route gate naming it would
 * answer 403 where the contract says 503 (D-173).
 */

/** The permission `orders` gates its own read surface with. */
export const ORDERS_READ_PERMISSION = 'orders:read';
/** `quote_requests` declares one code, the right to handle quotes; its reads are behind it too. */
export const QUOTE_REQUESTS_READ_PERMISSION = 'rfqs:handle';
/** The permission `crm` gates its Opportunity reads with. */
export const CRM_READ_PERMISSION = 'crm:read';
/** The permission `tasks` gates its Task reads with. */
export const TASKS_READ_PERMISSION = 'tasks:read';
/** The permission `catalog` gates its admin product reads with (Product references, User Story 7). */
export const CATALOG_READ_PERMISSION = 'catalog:read';
/** The permission `custom_fields` gates its definitions and values with (User Story 9). */
export const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';

/** Whether whoever is behind the request may read what one other module owns. */
export type OwnerReadCheck = () => Promise<boolean>;

/** The checks a service that renders another module's data is handed. */
export interface OwnerReadChecks {
  orders: OwnerReadCheck;
  quoteRequests: OwnerReadCheck;
  opportunities: OwnerReadCheck;
  tasks: OwnerReadCheck;
  products: OwnerReadCheck;
  customFields: OwnerReadCheck;
}

/**
 * One check. A function rather than a literal at the composition site:
 * `check:port-catches` follows the port through the value.
 */
export function createOwnerReadCheck(permissions: PermissionReadPort, permission: string): OwnerReadCheck {
  return async () => {
    const adminUserId = actingAdminUserId();
    // The system is nobody's session; any other caller without an
    // administrator behind it reads nothing (T144 F6).
    if (adminUserId === null) return isSystemActor();
    const held = await permissions.listPermissions(adminUserId);
    return held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(permission);
  };
}

export function createOwnerReadChecks(permissions: PermissionReadPort): OwnerReadChecks {
  return {
    orders: createOwnerReadCheck(permissions, ORDERS_READ_PERMISSION),
    quoteRequests: createOwnerReadCheck(permissions, QUOTE_REQUESTS_READ_PERMISSION),
    opportunities: createOwnerReadCheck(permissions, CRM_READ_PERMISSION),
    tasks: createOwnerReadCheck(permissions, TASKS_READ_PERMISSION),
    products: createOwnerReadCheck(permissions, CATALOG_READ_PERMISSION),
    customFields: createOwnerReadCheck(permissions, CUSTOM_FIELDS_READ_PERMISSION),
  };
}
