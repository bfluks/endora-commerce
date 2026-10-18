import { randomUUID } from 'crypto';
import type { EntityManager, Knex } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  QUOTE_REQUEST_HISTORY_EVENT_WINDOW,
  RFQ_CREATED_BY_ADMIN_EVENT,
  type AdminCreateQuoteRequest,
  type AdminPatchQuoteRequest,
  type QuoteRequest as RfqDto,
  type QuoteRequestHistory,
  type QuoteRequestSummary,
  isCustomFieldValidationFailure,
  type AdminUserReadPort,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomFieldValuePort,
  type OrganizationDetailsPort,
  type RfqCreatedByAdminEventPayload,
  type SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { orgConstraintFor } from '@endora-commerce/platform/tenancy';
import type {
  QuoteRequestAdminSearchQuery,
  QuoteRequestAdminSearchRow,
} from '../admin-search-provider.js';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { underRowLock } from './transition-lock.js';
import type { RfqService} from './rfq-service.js';
import { type RfqEventBus, type RfqEvents } from './rfq-service.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqRevisionService } from './rfq-revision-service.js';
import type { RfqNotificationService } from './rfq-notification-service.js';
import { raisedOnChannelId } from './raised-on-channel.js';
import { hasUnpricedLine, quoteIncompleteError } from './agreed-price.js';
import { pairLines } from './line-carry-over.js';
import { storedReferenceColumns } from './reference-price.js';
import { AUTOMATIC_ADMIN_CREATION_NOTE } from './history/constants.js';
import {
  adminActorDirectory,
  customerActorDirectory,
  predecessorsToRead,
  projectHistory,
  variantLabelDirectory,
  type HistoryEventInput,
  type HistoryRevisionInput,
} from './history/history-projection.js';

/**
 * Admin-facing Quote Requests service — feature 008 workflow.
 *
 * Endpoints implemented:
 *   - listAll(scope)       (US2)
 *   - getById              (US2)
 *   - approve              (US2)
 *   - cancel               (US2)
 *   - assign               (US2)
 *   - modify               (US3)
 *   - createOnBehalf       (US4)
 *
 * Visibility scoping is centralised in `SalesRepAssignmentService.canSeeOrganization`
 * (research §R2). Platform admins skip the predicate.
 */

/**
 * How many of the most recent events the admin History reads (threat model T9)
 * — the contracts' number, which the admin's truncation notice states too.
 */
export const HISTORY_EVENT_WINDOW = QUOTE_REQUEST_HISTORY_EVENT_WINDOW;

export interface AdminContext {
  adminUserId: string;
  isPlatformAdmin: boolean;
  /** Display label embedded in event records ('Sales representative', 'Platform administrator', …) */
  roleLabel: string;
}

export type AdminAssignmentScope = 'mine' | 'unassigned' | 'all';

export interface AdminListFilter {
  scope?: AdminAssignmentScope;
  status?: QuoteRequestStatus | QuoteRequestStatus[];
  organizationId?: string;
}

/**
 * The events of the admin paths: the customer path's, and the one only an
 * administrator's create emits. Declared here, beside its one emitter, rather
 * than in the map `rfq-service.ts` shares with the customer path.
 */
export interface RfqAdminEvents extends RfqEvents {
  'rfq.created_by_admin.v1': EventBase & RfqCreatedByAdminEventPayload;
}

export interface RfqAdminServiceDeps {
  emFactory: () => EntityManager;
  events: RfqEventBus;
  rfqService: RfqService;
  eventService: RfqEventService;
  revisionService: RfqRevisionService;
  notificationService: RfqNotificationService;
  salesRepAssignment: SalesRepAssignmentPort;
  /** Feature 054 — audits RFQ admin writes co-transactionally when provided. */
  auditLog?: AuditPort;
  /** Feature 055 — validates + merges custom-field values on RFQ edit. */
  customFieldValues?: CustomFieldValuePort;
  /**
   * Feature 075, Phase C — the three rows the admin list and detail read and
   * none of which this module owns. They were `em.find` calls against
   * `catalog`'s, `customer_accounts`' and `organizations`' tables; over their
   * published ports the same reads fail closed with their owners.
   */
  catalogProducts: CatalogProductReadPort;
  customerAccounts: CustomerAccountReadPort;
  organizations: OrganizationDetailsPort;
  adminUsers: AdminUserReadPort;
}

export class RfqAdminService {
  constructor(private readonly deps: RfqAdminServiceDeps) {}

  /** Feature 054 — co-transactional RFQ audit on `em` (actor from context). */
  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action,
        objectType: 'quote_request',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async listAll(ctx: AdminContext, filter: AdminListFilter = {}): Promise<QuoteRequestSummary[]> {
    const em = this.deps.emFactory();
    const where: Record<string, unknown> = {};
    if (filter.organizationId) where['organizationId'] = filter.organizationId;
    if (filter.status) where['status'] = filter.status;

    let rfqs: QuoteRequest[] = await em.find(QuoteRequest, where, {
      orderBy: { createdAt: 'desc' },
    });

    // Visibility scoping (skipped for platform admin)
    if (!ctx.isPlatformAdmin) {
      const visible = await Promise.all(
        rfqs.map((r) =>
          this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, r.organizationId),
        ),
      );
      rfqs = rfqs.filter((_, i) => visible[i]);
    }

    if (filter.scope === 'mine') {
      const assigned = new Set(
        await this.deps.salesRepAssignment.listAssignedOrganizationIds(ctx.adminUserId),
      );
      rfqs = rfqs.filter((r) => assigned.has(r.organizationId));
    } else if (filter.scope === 'unassigned') {
      const flagged = await Promise.all(rfqs.map((r) => this.isUnassigned(em, r.organizationId)));
      rfqs = rfqs.filter((_, i) => flagged[i]);
    }

    if (rfqs.length === 0) return [];

    const items = await em.find(QuoteRequestItem, {
      quoteRequestId: { $in: rfqs.map((r) => r.id) },
    });
    const itemsByRfq = groupBy(items, (i) => i.quoteRequestId);

    const orgs = await this.deps.organizations.findByIds(rfqs.map((r) => r.organizationId));
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const customers = await this.deps.customerAccounts.findByIds(
      rfqs.map((r) => r.customerAccountId),
    );
    const customerById = new Map(customers.map((c) => [c.id, c]));

    // Resolve the VAT rate once per distinct Organization (mirrors Orders).
    const taxRateByOrg = new Map<string, number>();
    for (const orgId of new Set(rfqs.map((r) => r.organizationId))) {
      taxRateByOrg.set(orgId, await this.deps.rfqService.taxRateForOrganization(orgId));
    }

    return rfqs.map((rfq) => {
      const rfqItems = itemsByRfq.get(rfq.id) ?? [];
      const customer = customerById.get(rfq.customerAccountId);
      const org = orgById.get(rfq.organizationId);
      const totalAtAgreedPrice = rfqItems.every((it) => it.agreedUnitPrice != null)
        ? rfqItems.reduce(
            (sum, it) => sum + Number(it.agreedUnitPrice ?? 0) * it.quantity,
            0,
          )
        : null;
      const totalAtCustomerPrice = rfqItems.every((it) => it.desiredUnitPrice != null)
        ? rfqItems.reduce(
            (sum, it) => sum + Number(it.desiredUnitPrice ?? 0) * it.quantity,
            0,
          )
        : null;
      return {
        id: rfq.id,
        businessId: rfq.businessId,
        organizationId: rfq.organizationId,
        customerAccountId: rfq.customerAccountId,
        status: rfq.status,
        awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
        lineCount: rfqItems.length,
        totalAtCustomerPrice,
        totalAtAgreedPrice,
        taxRate: taxRateByOrg.get(rfq.organizationId) ?? 0,
        currency: rfqItems[0]?.lineCurrency ?? 'PLN',
        submittedAt: rfq.submittedAt?.toISOString() ?? null,
        expiresAt: rfq.expiresAt?.toISOString() ?? null,
        createdAt: rfq.createdAt.toISOString(),
        updatedAt: rfq.updatedAt.toISOString(),
        version: rfq.version,
        organizationName: org?.name ?? '',
        customerDisplayName: customer ? customerDisplayName(customer) : null,
      };
    });
  }

  /**
   * Global search over quote requests (`specs/150-admin-global-search/`, T032).
   *
   * The list's visibility, **in the statement** — not `listAll`'s shape, which
   * loads every row and filters the organization scope in memory. Two layers,
   * the same two the list applies:
   *
   *  1. the request's tenant scope (`orgConstraintFor()`), the reach
   *     `adminTenantScopePort` derives for this admin;
   *  2. for any role other than the platform administrator, the sales
   *     representative rule (`canSeeOrganization`: assigned, or an organization
   *     nobody is assigned to). It is asked of the **distinct organizations
   *     that have a matching quote request** — a bounded set — and the page is
   *     then read with `organization_id in (visible)`.
   *
   * Matching, ranking and the `limit + 1` page follow the other providers:
   * literal `likeEscaped` patterns, exact → prefix → rest on the number, then
   * most recent change, then id.
   */
  async searchForAdmin(
    ctx: AdminContext,
    query: QuoteRequestAdminSearchQuery,
  ): Promise<{ rows: QuoteRequestAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const contains = `%${query.likeEscaped}%`;
    const prefix = `${query.likeEscaped}%`;
    const [orgIds, customerIds] = await Promise.all([
      fields.has('organizationName') ? this.deps.organizations.searchIdsByName(query.text) : [],
      fields.has('customer') ? this.deps.customerAccounts.searchIdsByName(query.text) : [],
    ]);
    const matches: Array<(qb: Knex.QueryBuilder) => void> = [];
    if (fields.has('number')) matches.push((qb) => qb.orWhereRaw('"business_id" ilike ?', [contains]));
    if (orgIds.length > 0) matches.push((qb) => qb.orWhereIn('organization_id', orgIds));
    if (customerIds.length > 0) matches.push((qb) => qb.orWhereIn('customer_account_id', customerIds));
    if (fields.has('customerNote')) matches.push((qb) => qb.orWhereRaw('"header_note" ilike ?', [contains]));
    if (query.isUuid) matches.push((qb) => qb.orWhereRaw('"id" = ?::uuid', [query.text]));
    if (matches.length === 0) return { rows: [], hasMore: false };

    const constraint = orgConstraintFor();
    const tenantOrgIds =
      constraint.kind === 'all'
        ? null
        : constraint.kind === 'set'
          ? [...constraint.organizationIds]
          : constraint.organizationId === null
            ? []
            : [constraint.organizationId];
    if (tenantOrgIds !== null && tenantOrgIds.length === 0) return { rows: [], hasMore: false };

    const em = this.deps.emFactory();
    const knex = em.getKnex();
    const matching = (extraOrgIds: readonly string[] | null) =>
      knex('quote_requests').where((qb) => {
        if (tenantOrgIds !== null) qb.whereIn('organization_id', tenantOrgIds);
        if (extraOrgIds !== null) qb.whereIn('organization_id', [...extraOrgIds]);
        qb.andWhere((or) => {
          for (const match of matches) match(or);
        });
      });

    let visibleOrgIds: string[] | null = null;
    if (!ctx.isPlatformAdmin) {
      const candidates = (
        (await em.execute(matching(null).distinct('organization_id'))) as Array<{ organization_id: string }>
      ).map((r) => r.organization_id);
      const visible = await Promise.all(
        candidates.map((id) => this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, id)),
      );
      visibleOrgIds = candidates.filter((_, i) => visible[i]);
      if (visibleOrgIds.length === 0) return { rows: [], hasMore: false };
    }

    const builder = matching(visibleOrgIds).select('id');
    const exact: string[] = [];
    const bindings: unknown[] = [];
    if (query.isUuid) {
      exact.push('"id" = ?::uuid');
      bindings.push(query.text);
    }
    if (fields.has('number')) {
      exact.push('lower("business_id") = lower(?)');
      bindings.push(query.text);
    }
    if (exact.length > 0) {
      const starts = fields.has('number') ? ' when "business_id" ilike ? then 1' : '';
      if (fields.has('number')) bindings.push(prefix);
      builder.orderByRaw(`case when ${exact.join(' or ')} then 0${starts} else 2 end`, bindings as Knex.RawBinding[]);
    }
    builder.orderBy('updated_at', 'desc').orderBy('id', 'asc').limit(query.limit + 1);
    const ids = ((await em.execute(builder)) as Array<{ id: string }>).map((r) => r.id);
    const page = ids.slice(0, query.limit);
    if (page.length === 0) return { rows: [], hasMore: false };

    const found = await em.find(QuoteRequest, { id: { $in: page } });
    const byId = new Map(found.map((r) => [r.id, r]));
    const ranked = page.map((id) => byId.get(id)).filter((r): r is QuoteRequest => r !== undefined);
    const orgs = await this.deps.organizations.findByIds([...new Set(ranked.map((r) => r.organizationId))]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    return {
      hasMore: ids.length > query.limit,
      rows: ranked.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        organizationName: orgName.get(r.organizationId) ?? null,
        submittedAt: (r.submittedAt ?? r.createdAt).toISOString(),
        status: r.status,
      })),
    };
  }

  async getById(ctx: AdminContext, rfqId: string): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    const dto = await this.deps.rfqService.serializeFull(
      em,
      rfq,
      /* includeFullActorIdentity */ true,
    );
    // Enrich with Organization + Customer display fields so the admin detail
    // can render them by name (parity with the Order detail view).
    const [org, customer] = await Promise.all([
      this.deps.organizations.findById(rfq.organizationId),
      this.deps.customerAccounts.findById(rfq.customerAccountId),
    ]);
    return {
      ...dto,
      organization: org
        ? {
            id: org.id,
            name: org.name,
            legalName: org.legalName ?? null,
            taxId: org.taxId,
            vatStatus: org.vatStatus,
          }
        : null,
      customer: customer
        ? {
            id: customer.id,
            firstName: customer.firstName ?? null,
            lastName: customer.lastName ?? null,
            email: customer.email,
          }
        : null,
    };
  }

  /**
   * Feature 146 (FR-010 – FR-019; research R8; contract §3) — the admin
   * History: the most recent {@link HISTORY_EVENT_WINDOW} events merged into
   * entries, attributed and diffed on read.
   *
   * Bounded (threat model T9): one read of `window + 1` events, the revisions
   * those events reference, then only the predecessors of the modifications'
   * revisions. One `findByIds` per actor port — customers `activeOnly`, so a
   * deleted account's PII is never read and its entries name an unknown user
   * (FR-018) — and one variant read for the labels.
   */
  async history(ctx: AdminContext, rfqId: string): Promise<QuoteRequestHistory> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);

    const latest = await this.deps.eventService.listLatestForRfq(rfq.id, HISTORY_EVENT_WINDOW + 1);
    const truncated = latest.length > HISTORY_EVENT_WINDOW;
    const events: HistoryEventInput[] = latest
      .slice(0, HISTORY_EVENT_WINDOW)
      .reverse()
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorAdminUserId: event.actorAdminUserId ?? null,
        actorCustomerAccountId: event.actorCustomerAccountId ?? null,
        actorRoleLabel: event.actorRoleLabel ?? null,
        payload: event.payload ?? {},
        revisionId: event.revisionId ?? null,
        createdAt: event.createdAt,
      }));

    const referenced = await this.deps.revisionService.findForHistory(rfq.id, {
      ids: events.flatMap((event) => (event.revisionId ? [event.revisionId] : [])),
    });
    const revisions: HistoryRevisionInput[] = referenced.map(toHistoryRevision);
    revisions.push(
      ...(await this.deps.revisionService.findForHistory(rfq.id, predecessorsToRead(events, revisions))).map(
        toHistoryRevision,
      ),
    );

    const adminIds = unique(events.map((event) => event.actorAdminUserId));
    const customerIds = unique(
      events.filter((event) => !event.actorAdminUserId).map((event) => event.actorCustomerAccountId),
    );
    const productIds = unique(
      revisions.flatMap((revision) =>
        revision.itemsSnapshot.filter((line) => line.variantId).map((line) => line.productId),
      ),
    );
    const [admins, customers, variants] = await Promise.all([
      adminIds.length > 0 ? this.deps.adminUsers.findByIds(adminIds) : [],
      customerIds.length > 0 ? this.deps.customerAccounts.findByIds(customerIds, { activeOnly: true }) : [],
      productIds.length > 0 ? this.deps.catalogProducts.listVariantsByProductIds(productIds) : [],
    ]);

    return {
      entries: projectHistory(events, revisions, {
        admins: adminActorDirectory(admins),
        customers: customerActorDirectory(customers),
        variantLabels: variantLabelDirectory(variants),
      }),
      truncated,
    };
  }

  // -------------------------------------------------------------------------
  // Approve (US2)
  // -------------------------------------------------------------------------

  async approve(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    note: string | undefined,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    if (rfq.status !== 'Pending') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not pending approval.');
    }
    this.assertVersion(rfq, expectedVersion);

    // Approving is what lets the buyer order, at the agreed prices — so every
    // line needs one. There is deliberately no "approve at the list price"
    // here: which price an unpriced line would be sold at is a commercial
    // decision, and the operator makes it by pricing the line (`modify`).
    const lines = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    if (hasUnpricedLine(lines)) throw quoteIncompleteError();

    const now = new Date();
    await underRowLock(em, rfq, async () => {
      rfq.status = 'Approved';
      rfq.approvedAt = now;
      rfq.awaitingCustomerRevisionAcceptance = false;
      rfq.assignedAdminUserId = ctx.adminUserId;
      rfq.version += 1;
      this.#audit(em, 'quote_request.approve', rfq.id, { status: 'Pending' }, { status: 'Approved' });
      await em.flush();
    });

    if (note && note.trim().length > 0) {
      await this.deps.eventService.append({
        quoteRequestId: rfq.id,
        eventType: 'note-added',
        actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
        payload: { type: 'note-added', note },
      });
    }
    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'approved',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'approved', approvedBy: 'admin' },
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    this.deps.events.emit('rfq.approved.v1', {
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      rfqId: rfq.id,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Cancel (US2)
  // -------------------------------------------------------------------------

  async cancel(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    reason: string | undefined,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request cannot be canceled in its current state.');
    }
    this.assertVersion(rfq, expectedVersion);

    const now = new Date();
    await underRowLock(em, rfq, async () => {
      rfq.status = 'Canceled';
      rfq.canceledAt = now;
      rfq.awaitingCustomerRevisionAcceptance = false;
      if (reason) rfq.cancellationReason = reason;
      rfq.assignedAdminUserId = ctx.adminUserId;
      rfq.version += 1;
      this.#audit(em, 'quote_request.cancel', rfq.id, null, { status: 'Canceled', reason: reason ?? null });
      await em.flush();
    });

    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'canceled',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'canceled', canceledBy: 'admin', reason: reason ?? null },
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    this.deps.events.emit('rfq.canceled.v1', {
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      rfqId: rfq.id,
      reason: reason ?? null,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Internal-side claim (informational; visibility is per-org, not per-rfq)
  // -------------------------------------------------------------------------

  async assign(ctx: AdminContext, rfqId: string, targetAdminUserId: string): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    await underRowLock(em, rfq, async () => {
      const previousAssignee = rfq.assignedAdminUserId;
      rfq.assignedAdminUserId = targetAdminUserId;
      rfq.version += 1;
      this.#audit(em, 'quote_request.assign', rfq.id, { assignedAdminUserId: previousAssignee }, {
        assignedAdminUserId: targetAdminUserId,
      });
      await em.flush();
    });
    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Modify (US3) — also handles edits to Created from admin (US4)
  // -------------------------------------------------------------------------

  async modify(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    body: AdminPatchQuoteRequest,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not editable.');
    }
    this.assertVersion(rfq, expectedVersion);

    // Research R7 — a validity change is recorded on the event, since no
    // revision snapshot carries `expiresAt`.
    const recorded: { validity?: { before: string | null; after: string | null } } = {};
    await underRowLock(em, rfq, async () => {
      if (body.headerNote !== undefined) rfq.headerNote = body.headerNote ?? null;

      // Feature 055 — validate + merge custom-field values (host owns the write).
      if (body.customFieldValues !== undefined && this.deps.customFieldValues) {
        try {
          rfq.customFieldValues = await this.deps.customFieldValues.validateAndMerge(
            'quote_request',
            rfq.customFieldValues ?? {},
            body.customFieldValues,
          );
        } catch (err) {
          if (isCustomFieldValidationFailure(err)) {
            throw new HttpError(
              422,
              ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
              'One or more custom fields are invalid.',
              err.errors.map((e) => ({ path: e.field, issue: e.message })),
            );
          }
          throw err;
        }
      }

      if (body.items) {
        const products = await this.deps.catalogProducts.findByIds(
        body.items.map((it) => it.productId),
      );
        const productById = new Map(products.map((p) => [p.id, p]));
        if (productById.size !== new Set(body.items.map((it) => it.productId)).size) {
          throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
        }
        const existing = await em.find(
          QuoteRequestItem,
          { quoteRequestId: rfq.id },
          { orderBy: { createdAt: 'asc', id: 'asc' } },
        );
        // Feature 146, FR-034 (research R5.1, R5.2) — a body line is the stored
        // row its `id` names (same product only), else the row the R6 rule
        // pairs it with. A paired line keeps what the rep did not change:
        // packaging unit, product name snapshot, the customer's proposal and the
        // stored reference; variant and note too, unless the body carries the
        // key (`lineNote: null` clears). A new line has no packaging unit and no
        // reference — `modify` never prices a line.
        const { paired } = pairLines(
          existing,
          body.items.map((line) => ({
            id: line.id,
            productId: line.productId,
            variantId: line.variantId,
          })),
          'admin',
        );
        await em.removeAndFlush(existing);
        const items: QuoteRequestItem[] = [];
        for (const [index, lineInput] of body.items.entries()) {
          const product = productById.get(lineInput.productId)!;
          const row = paired[index] ?? null;
          const variantId =
            lineInput.variantId !== undefined ? lineInput.variantId : (row?.variantId ?? null);
          items.push(
            em.create(QuoteRequestItem, {
              quoteRequestId: rfq.id,
              productId: product.id,
              productName: row?.productName ?? anyLocaleValue(product.name),
              productSlug: product.slug,
              variantId,
              variantLabel:
                row !== null && (row.variantId ?? null) === variantId ? (row.variantLabel ?? null) : null,
              quantity: lineInput.quantity,
              packagingUnitName: row?.packagingUnitName ?? null,
              packagingUnitBaseQuantity: row?.packagingUnitBaseQuantity ?? null,
              // Feature 155 (analyze F14) — the resolved unit travels with its
              // snapshot; an operator never sends one, a new line has none.
              packagingUnitId: row?.packagingUnitId ?? null,
              desiredUnitPrice: row?.desiredUnitPrice ?? null,
              agreedUnitPrice:
                lineInput.agreedUnitPrice !== undefined && lineInput.agreedUnitPrice !== null
                  ? lineInput.agreedUnitPrice.toFixed(2)
                  : null,
              lineNote:
                lineInput.lineNote !== undefined ? lineInput.lineNote : (row?.lineNote ?? null),
              lineCurrency: row?.lineCurrency ?? 'PLN',
              ...(row !== null
                ? storedReferenceColumns(row)
                : { referenceUnitPrice: null, referenceCurrency: null, referenceCapturedAt: null }),
            }),
          );
        }
        await em.persistAndFlush(items);
      }

      rfq.currentRevisionNumber += 1;
      rfq.awaitingCustomerRevisionAcceptance = true;
      rfq.assignedAdminUserId = ctx.adminUserId;
      if (body.expiresInDays !== undefined) {
        const before = rfq.expiresAt?.toISOString() ?? null;
        rfq.expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000);
        const after = rfq.expiresAt.toISOString();
        if (before !== after) recorded.validity = { before, after };
      }
      rfq.version += 1;
      this.#audit(em, 'quote_request.modify', rfq.id, null, {
        currentRevisionNumber: rfq.currentRevisionNumber,
        status: rfq.status,
      });
      await em.flush();
    });

    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    const previousRevision = await this.deps.revisionService.byNumber(
      rfq.id,
      rfq.currentRevisionNumber - 1,
    );
    const revision = await this.deps.revisionService.record({
      rfq,
      items,
      actor: { adminUserId: ctx.adminUserId },
      previousRevisionId: previousRevision?.id ?? null,
    });

    const diff = previousRevision
      ? this.deps.revisionService.diffRevisions({
          beforeHeaderNote: previousRevision.headerNoteSnapshot ?? null,
          afterHeaderNote: rfq.headerNote ?? null,
          beforeItems: previousRevision.itemsSnapshot,
          afterItems: revision.itemsSnapshot,
        })
      : [];

    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'modified',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'modified', diff, ...recorded },
      revisionId: revision.id,
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    this.deps.events.emit('rfq.modified.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      revisionNumber: rfq.currentRevisionNumber,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Create on behalf (US4)
  // -------------------------------------------------------------------------

  async createOnBehalf(
    ctx: AdminContext,
    body: AdminCreateQuoteRequest,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();

    // Visibility on the target organization (platform_admin always passes).
    if (
      !ctx.isPlatformAdmin &&
      !(await this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, body.organizationId))
    ) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not authorized for this organization.');
    }

    // The membership half of the old `findOne(CustomerAccount, { id,
    // organizationId })` is asserted here rather than in the query: the record
    // carries `organizationId`, so the port does not need a second lookup shape
    // and the two failures still answer with one message, as they did.
    const customer = await this.deps.customerAccounts.findById(body.customerAccountId);
    if (!customer || customer.organizationId !== body.organizationId) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        'Customer does not belong to the organization.',
      );
    }

    // **Neither scoping axis is applied to these lines, and that is the
    // decision rather than the gap.** `RfqService.createForCustomer` filters by
    // `isProductVisibleTo` (issue #227) and by the request's channel assortment
    // (issue #259); this path filters by neither.
    //
    // It is an operator surface. The admin names the organisation, the customer
    // and the lines, having chosen them from an admin catalogue that shows the
    // whole assortment — so there is no buyer whose audience could answer, and
    // the channel the admin's own request happens to have resolved (the
    // resolver's step-4 default, unless the SPA sent `X-Sales-Channel`) is not
    // a statement about where this quote should be sellable. The
    // `quote_requests:write` permission is the enforcement, exactly as
    // `quick_order`'s `'unrestricted'` import arm says of itself.
    //
    // The channel this quote *is* raised on is recorded below and is the
    // honest answer to "where did this come from", not a filter.
    const products = await this.deps.catalogProducts.findByIds(
      body.items.map((it) => it.productId),
    );
    const productById = new Map(products.map((p) => [p.id, p]));
    if (productById.size !== new Set(body.items.map((it) => it.productId)).size) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
    }

    const businessId = await this.deps.rfqService.generateBusinessId(em);
    const rfq = em.create(QuoteRequest, {
      ...(businessId ? { businessId } : {}),
      organizationId: body.organizationId,
      customerAccountId: body.customerAccountId,
      // The channel the admin's own request resolved to. Admin paths take the
      // resolver's step-4 fallback unless the SPA sends `X-Sales-Channel`, so
      // this is the system default until it does — which is the honest answer
      // for "where was this raised", not a channel this module picked.
      salesChannelId: raisedOnChannelId(),
      createdByAdminUserId: ctx.adminUserId,
      assignedAdminUserId: ctx.adminUserId,
      status: 'Created from admin' satisfies QuoteRequestStatus,
      headerNote: body.headerNote ?? null,
      currentRevisionNumber: 1,
      lastCustomerSeenRevisionNumber: 0,
      // The customer must accept or reject the quote the admin prepared, so it
      // surfaces the Accept/Reject controls on the storefront (the same flag the
      // admin's later revisions set). Without this the customer had no way to
      // act on an admin-created quote.
      awaitingCustomerRevisionAcceptance: true,
      expiresAt:
        body.expiresInDays !== undefined
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : null,
    });
    await em.persistAndFlush(rfq);

    const items: QuoteRequestItem[] = [];
    for (const lineInput of body.items) {
      const product = productById.get(lineInput.productId)!;
      items.push(
        em.create(QuoteRequestItem, {
          quoteRequestId: rfq.id,
          productId: product.id,
          productName: anyLocaleValue(product.name),
          productSlug: product.slug,
          variantId: lineInput.variantId ?? null,
          quantity: lineInput.quantity,
          agreedUnitPrice: lineInput.agreedUnitPrice.toFixed(2),
          lineNote: lineInput.lineNote ?? null,
          lineCurrency: 'PLN',
        }),
      );
    }
    this.#audit(em, 'quote_request.create_on_behalf', rfq.id, null, {
      status: rfq.status,
      itemCount: items.length,
      salesChannelId: rfq.salesChannelId ?? null,
    });
    await em.persistAndFlush(items);

    const revision = await this.deps.revisionService.record({
      rfq,
      items,
      actor: { adminUserId: ctx.adminUserId },
    });

    await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'created',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'created' },
      revisionId: revision.id,
    });

    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'note-added',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'note-added', note: AUTOMATIC_ADMIN_CREATION_NOTE },
      revisionId: revision.id,
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    // Announced last, once every row of the request is written: a subscriber
    // may read it at once. This path does **not** emit `rfq.created.v1` — that
    // is the customer's submission, and whatever listens to it must not start
    // seeing requests an administrator prepared. `origin` is handed on as it
    // came: this module validates its shape and reads nothing in it.
    // The one bus, seen with the event only this path emits.
    (this.deps.events as EventBus<RfqAdminEvents>).emit(RFQ_CREATED_BY_ADMIN_EVENT, {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      organizationId: rfq.organizationId,
      adminUserId: ctx.adminUserId,
      origin: body.origin ?? null,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async findVisibleForAdmin(
    em: EntityManager,
    ctx: AdminContext,
    rfqId: string,
  ): Promise<QuoteRequest> {
    // Threat model C1 (Constitution XI) — a request outside the caller's
    // organizations answers exactly as an unknown id does, so its existence
    // does not leak.
    const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    const rfq = await em.findOne(QuoteRequest, { id: rfqId });
    if (!rfq) throw notFound();
    if (
      !ctx.isPlatformAdmin &&
      !(await this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, rfq.organizationId))
    ) {
      throw notFound();
    }
    return rfq;
  }

  private assertVersion(rfq: QuoteRequest, expectedVersion: number | null): void {
    if (expectedVersion !== null && rfq.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
    }
  }

  private async isUnassigned(em: EntityManager, organizationId: string): Promise<boolean> {
    const reps = await this.deps.salesRepAssignment.listForOrganization(organizationId);
    void em;
    return reps.length === 0;
  }
}

function toHistoryRevision(revision: {
  id: string;
  revisionNumber: number;
  previousRevisionId?: string | null;
  headerNoteSnapshot?: string | null;
  itemsSnapshot: HistoryRevisionInput['itemsSnapshot'];
}): HistoryRevisionInput {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    previousRevisionId: revision.previousRevisionId ?? null,
    headerNoteSnapshot: revision.headerNoteSnapshot ?? null,
    itemsSnapshot: Array.isArray(revision.itemsSnapshot) ? revision.itemsSnapshot : [],
  };
}

function unique(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function anyLocaleValue(blob: Record<string, string>): string {
  const k = Object.keys(blob)[0];
  return k ? (blob[k] ?? '') : '';
}

function customerDisplayName(c: CustomerAccountRecord): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const v of arr) {
    const k = key(v);
    const existing = out.get(k);
    if (existing) existing.push(v);
    else out.set(k, [v]);
  }
  return out;
}
