import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_VISIBILITY_ERROR_CODES as E,
  isUuidShape,
  websiteRuleAuditSource,
  type CatalogAttributeReadPort,
  type CatalogProductReadPort,
  type CatalogueReferencePricePort,
  type ProductRuleAttributesResponse,
  type ProductRuleCreateBody,
  type ProductRuleDefinition,
  type ProductRuleUpdateBody,
  type ProductRuleView,
  type WebsiteRulePreviewCreateBody,
  type WebsiteRulePreviewResponse,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort, SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import {
  productRuleCreateCommand,
  productRuleDeleteCommand,
  productRuleUpdateCommand,
  websiteRuleAttachCommand,
  websiteRuleChangeCommand,
  websiteRuleDetachCommand,
  type WebsiteRuleConfirmed,
} from '../commands/website-rule-commands.js';
import { ProductRule } from '../entities/product-rule.entity.js';
import { WebsiteRuleAttachment } from '../entities/website-rule-attachment.entity.js';
import { WebsiteRulePreview } from '../entities/website-rule-preview.entity.js';
import type { WebsiteRuleGovernorHandle } from './membership-governor.js';
import {
  isLive,
  isRuleMember,
  ruleAttributeIndex,
  ruleCurrencies,
  validateRuleDefinition,
  type CataloguePriceFact,
  type ProductRuleFacts,
  type RuleAttributeIndex,
} from './product-rule-evaluator.js';

/**
 * The website rule — spec 193 Phase 6 (T057 – T060; research R-9 – R-11; FR-050 – FR-061,
 * FR-072, FR-079; threat model TM-10, TM-11).
 *
 * A named product rule governs the product membership of the sales channels it is attached to.
 * Attaching it or changing an attached rule's definition goes through a **preview**: a job
 * evaluates the draft over every product and stores the join / leave snapshot; the creator
 * confirms it (a Command), and the apply job writes **exactly** that snapshot (SC-004) with the
 * governor's write token, in transactions of {@link WebsiteRuleLimits.applyBatch}. From then on the
 * **steady state** keeps the channel in step: products marked by catalogue events and flag
 * refreshes are re-evaluated by a debounced job, window boundaries of a designated book schedule a
 * reconcile, and every governed channel is reconciled hourly.
 *
 * Every membership write is the kernel's (`SalesChannelMembershipPort`) with the governor token
 * and `source: website_rule:<id>` (FR-072); each runs inside an EventBus scope around its
 * transaction, so the audit rows, the events and the cache drops follow the commit (#1926). The
 * admissions ledger (`website_rule_admissions`) gains a row with each token add and loses it with
 * each token remove, in the same transaction (data-model N2).
 *
 * A channel that no longer exists is ignored everywhere: a preview does not evaluate it, a confirm
 * does not attach it, and the apply and steady-state jobs skip an attachment whose channel is gone.
 */

export interface WebsiteRuleLimits {
  /** TM-11: standing (pending or ready, unexpired) previews per administrator. */
  maxConcurrentPreviewsPerAdmin: number;
  /** TM-11: rows `website_rule_preview_changes` may hold in all. */
  maxPreviewChanges: number;
  /** Membership changes per apply transaction (R-11). */
  applyBatch: number;
}

export const DEFAULT_WEBSITE_RULE_LIMITS: Readonly<WebsiteRuleLimits> = Object.freeze({
  maxConcurrentPreviewsPerAdmin: 3,
  maxPreviewChanges: 2_000_000,
  applyBatch: 500,
});

/** A preview lives 15 minutes (data-model §3). */
export const PREVIEW_TTL_MS = 15 * 60_000;
/** Products read per evaluation batch (R-11 cost estimate). */
export const EVALUATION_BATCH = 1_000;
/** Marks taken per steady-state evaluation run. */
export const MARK_BATCH = 1_000;

/** Where the service asks for its jobs; the worker file implements it over BullMQ. */
export interface WebsiteRuleJobs {
  enqueuePreview(previewId: string): Promise<void>;
  enqueueApply(previewId: string): Promise<void>;
  enqueueEvaluate(): Promise<void>;
  /** A reconcile of every governed channel at `at` (a designated book's window boundary). */
  enqueueReconcileAt(at: Date, key: string): Promise<void>;
}

export interface WebsiteRuleServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly eventBus: Pick<EventBus, 'run'>;
  readonly membership: () => Pick<SalesChannelMembershipPort, 'addToChannel' | 'removeFromChannel' | 'filterEntityIdsInChannel'>;
  readonly channels: () => Pick<SalesChannelResolutionPort, 'getById'>;
  readonly products: () => Pick<CatalogProductReadPort, 'findByIds' | 'listPricingRefs'>;
  readonly attributes: () => Pick<CatalogAttributeReadPort, 'listAll'>;
  readonly prices: () => Pick<CatalogueReferencePricePort, 'designationStatuses'>;
  /** Holds the write token; kept in the module's closure, never the container (TM-10). */
  readonly governor: WebsiteRuleGovernorHandle;
  readonly jobs: WebsiteRuleJobs;
  readonly now?: () => Date;
  readonly limits?: Partial<WebsiteRuleLimits>;
}

/** A governed channel: an attachment whose channel still exists, with its rule. */
export interface GovernedChannel {
  readonly salesChannelId: string;
  readonly productRuleId: string;
  readonly productRuleName: string;
  readonly definition: ProductRuleDefinition;
}

/** What the facts of one evaluation read: the attribute catalogue and the usable price flags. */
interface EvaluationContext {
  readonly attributes: RuleAttributeIndex;
  /** Currency → served generation, for the currencies whose flags a rule may read now. */
  readonly generations: ReadonlyMap<string, number>;
}

function uuidArray(values: readonly string[]): string {
  return `{${values.join(',')}}`;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function previewNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Website rule preview not found.');
}

export class WebsiteRuleService {
  readonly limits: WebsiteRuleLimits;

  constructor(private readonly deps: WebsiteRuleServiceDeps) {
    this.limits = { ...DEFAULT_WEBSITE_RULE_LIMITS, ...deps.limits };
  }

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  #em(): EntityManager {
    return this.deps.emFactory().fork();
  }

  // ── Product rules (T057; FR-050, FR-056) ──────────────────────────────────────────────

  /** FR-050 — the attributes a rule may name, for the rule editor. */
  async listAttributes(): Promise<ProductRuleAttributesResponse> {
    const all = await this.deps.attributes().listAll();
    const index = ruleAttributeIndex(all);
    return {
      items: all
        .filter((a) => index.has(a.key))
        .map((a) => {
          const kind = index.get(a.key)!;
          return {
            key: a.key,
            labelDefault: a.labelDefault,
            label: a.label,
            kind: kind.kind,
            options: kind.kind === 'choice' ? a.options.map((o) => o.value) : [],
          };
        })
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  async #assertDefinitionValid(definition: ProductRuleDefinition): Promise<void> {
    const issues = validateRuleDefinition(definition, ruleAttributeIndex(await this.deps.attributes().listAll()));
    if (issues.length > 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The rule names an attribute or option it cannot use.', [...issues]);
    }
  }

  async createRule(body: ProductRuleCreateBody): Promise<ProductRuleView> {
    await this.#assertDefinitionValid(body.definition);
    return view(await this.deps.commandBus.run(productRuleCreateCommand(body)));
  }

  async updateRule(id: string, body: ProductRuleUpdateBody, expectedVersion: number | undefined): Promise<ProductRuleView> {
    if (body.definition !== undefined) await this.#assertDefinitionValid(body.definition);
    return view(await this.deps.commandBus.run(productRuleUpdateCommand(id, body, expectedVersion, await this.#deadAttachments(id))));
  }

  async deleteRule(id: string, expectedVersion: number | undefined): Promise<void> {
    await this.deps.commandBus.run(productRuleDeleteCommand(id, expectedVersion, await this.#deadAttachments(id)));
  }

  /** Channels attached to `ruleId` that no longer exist (deleted while governed). */
  async #deadAttachments(ruleId: string): Promise<string[]> {
    const rows = await this.#em().find(WebsiteRuleAttachment, { productRuleId: ruleId });
    const dead: string[] = [];
    for (const r of rows) if ((await this.deps.channels().getById(r.salesChannelId)) === null) dead.push(r.salesChannelId);
    return dead;
  }

  // ── Previews (T058; FR-053, TM-11) ─────────────────────────────────────────────────────

  /** Enqueue a preview of attaching or changing a rule; the job evaluates it. */
  async createPreview(adminUserId: string, body: WebsiteRulePreviewCreateBody): Promise<{ previewId: string }> {
    const em = this.#em();
    const rule = await em.findOne(ProductRule, { id: body.productRuleId });
    if (!rule) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product rule not found.');
    const now = this.#now();

    let salesChannelIds: string[];
    let definition: ProductRuleDefinition;
    if (body.kind === 'attach') {
      salesChannelIds = [...new Set(body.salesChannelIds)].sort();
      definition = rule.definition;
      const held = await em.find(WebsiteRuleAttachment, { salesChannelId: { $in: salesChannelIds } });
      if (held.length > 0) {
        throw new HttpError(409, E.CHANNEL_ALREADY_GOVERNED, 'A sales channel of this preview already follows a product rule.', {
          channelCount: held.length,
        });
      }
      for (const id of salesChannelIds) {
        if ((await this.deps.channels().getById(id)) === null) {
          throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A sales channel of this preview does not exist.', [
            { path: 'salesChannelIds', issue: 'unknown sales channel' },
          ]);
        }
      }
    } else {
      await this.#assertDefinitionValid(body.definition);
      definition = body.definition;
      const dead = new Set(await this.#deadAttachments(rule.id));
      salesChannelIds = (await em.find(WebsiteRuleAttachment, { productRuleId: rule.id }))
        .map((a) => a.salesChannelId)
        .filter((id) => !dead.has(id))
        .sort();
    }

    // TM-11 — standing previews of this administrator, and the snapshot table as a whole.
    const [standing] = await em.getConnection().execute<Array<{ n: number }>>(
      `select count(*)::int as n from "website_rule_previews"
        where "created_by_admin_user_id" = ? and "status" in ('pending', 'ready') and "expires_at" > ?`,
      [adminUserId, now],
    );
    if (standing!.n >= this.limits.maxConcurrentPreviewsPerAdmin) {
      throw new HttpError(409, E.WEBSITE_RULE_PREVIEW_LIMIT, 'Too many previews are waiting; confirm one or let it expire.', {
        limit: this.limits.maxConcurrentPreviewsPerAdmin,
      });
    }
    if ((await this.#previewChangeRows(em)) >= this.limits.maxPreviewChanges) {
      throw new HttpError(409, E.WEBSITE_RULE_PREVIEW_LIMIT, 'The preview store is full; try again when earlier previews expired.');
    }

    // command-coverage-ignore: a preview is a short-lived, per-administrator scratch snapshot (TTL,
    // swept on expiry) that changes no domain state; its confirm is the audited Command.
    const preview = em.create(WebsiteRulePreview, {
      kind: body.kind,
      productRuleId: rule.id,
      definition,
      ruleVersion: rule.version,
      salesChannelIds,
      createdByAdminUserId: adminUserId,
      expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
    });
    await em.persist(preview).flush();
    await this.deps.jobs.enqueuePreview(preview.id);
    return { previewId: preview.id };
  }

  async #previewChangeRows(em: EntityManager): Promise<number> {
    const [row] = await em.getConnection().execute<Array<{ n: number }>>(`select count(*)::int as n from "website_rule_preview_changes"`);
    return row!.n;
  }

  /** The preview, to its creator only (TM-11: anyone else gets not found). */
  async getPreview(adminUserId: string, previewId: string): Promise<WebsiteRulePreviewResponse> {
    if (!isUuidShape(previewId)) throw previewNotFound();
    const preview = await this.#em().findOne(WebsiteRulePreview, { id: previewId });
    if (!preview || preview.createdByAdminUserId !== adminUserId) throw previewNotFound();
    const expired = (preview.status === 'pending' || preview.status === 'ready') && preview.expiresAt.getTime() <= this.#now().getTime();
    return { status: expired ? 'expired' : preview.status, counts: preview.counts ?? {}, expiresAt: preview.expiresAt.toISOString() };
  }

  /**
   * The preview job: evaluate the definition over every product for every channel the preview
   * names that still exists, and store the join / leave snapshot. A snapshot that would pass the
   * table cap fails the preview and keeps nothing (TM-11).
   */
  async runPreview(previewId: string): Promise<void> {
    const em = this.#em();
    const preview = await em.findOne(WebsiteRulePreview, { id: previewId });
    if (!preview || preview.status !== 'pending') return;
    const channelIds: string[] = [];
    for (const id of preview.salesChannelIds) if ((await this.deps.channels().getById(id)) !== null) channelIds.push(id);

    const counts: Record<string, { join: number; leave: number }> = Object.fromEntries(channelIds.map((id) => [id, { join: 0, leave: 0 }]));
    const budget = this.limits.maxPreviewChanges - (await this.#previewChangeRows(em));
    let written = 0;
    const fail = async (): Promise<void> => {
      await em.getConnection().execute(`delete from "website_rule_preview_changes" where "preview_id" = ?`, [previewId]);
      await em.getConnection().execute(`update "website_rule_previews" set "status" = 'failed' where "id" = ?`, [previewId]);
    };

    const context = await this.#context([preview.definition]);
    const ids = (await this.deps.products().listPricingRefs()).map((p) => p.id);
    for (const batch of chunks(ids, EVALUATION_BATCH)) {
      const facts = await this.#facts(batch, context);
      for (const channelId of channelIds) {
        const { joins, leaves } = await this.#diff(channelId, preview.definition, batch, facts, context);
        if (written + joins.length + leaves.length > budget) {
          await fail();
          return;
        }
        await this.#insertChanges(em, previewId, channelId, joins, 'join');
        await this.#insertChanges(em, previewId, channelId, leaves, 'leave');
        written += joins.length + leaves.length;
        counts[channelId]!.join += joins.length;
        counts[channelId]!.leave += leaves.length;
      }
    }
    await em
      .getConnection()
      .execute(`update "website_rule_previews" set "status" = 'ready', "counts" = ?::jsonb where "id" = ? and "status" = 'pending'`, [
        JSON.stringify(counts),
        previewId,
      ]);
  }

  async #insertChanges(em: EntityManager, previewId: string, channelId: string, productIds: readonly string[], op: 'join' | 'leave'): Promise<void> {
    if (productIds.length === 0) return;
    await em.getConnection().execute(
      `insert into "website_rule_preview_changes" ("preview_id", "sales_channel_id", "product_id", "op")
       select ?, ?, p, ? from unnest(?::uuid[]) as t(p) on conflict do nothing`,
      [previewId, channelId, op, uuidArray(productIds)],
    );
  }

  /** Confirm a ready preview: the attach / change Command, then the apply job (SC-004). */
  async confirmPreview(adminUserId: string, previewId: string): Promise<WebsiteRuleConfirmed> {
    if (!isUuidShape(previewId)) throw previewNotFound();
    const preview = await this.#em().findOne(WebsiteRulePreview, { id: previewId });
    if (!preview || preview.createdByAdminUserId !== adminUserId) throw previewNotFound();
    // A channel deleted since the preview ran is not attached (and its snapshot rows are skipped).
    const existing = new Set<string>();
    for (const id of Object.keys(preview.counts ?? {})) if ((await this.deps.channels().getById(id)) !== null) existing.add(id);
    const now = this.#now();
    const command =
      preview.kind === 'attach'
        ? websiteRuleAttachCommand(previewId, adminUserId, now, existing)
        : websiteRuleChangeCommand(previewId, adminUserId, now, preview.productRuleId ? await this.#deadAttachments(preview.productRuleId) : []);
    const confirmed = await this.deps.commandBus.run(command);
    await this.deps.jobs.enqueueApply(previewId);
    await this.scheduleWindowBoundaries();
    return confirmed;
  }

  /**
   * The apply job: write the confirmed preview's snapshot with the governor token, a batch per
   * transaction; each processed row is deleted with its batch, so a retried job continues where it
   * stopped. A join for a product no longer live is skipped (FR-079); a row whose channel is no
   * longer governed by this rule (detached, channel deleted) is skipped.
   */
  async applyPreview(previewId: string): Promise<{ applied: number }> {
    const em = this.#em();
    const preview = await em.findOne(WebsiteRulePreview, { id: previewId });
    if (!preview || preview.status !== 'applied' || !preview.productRuleId) return { applied: 0 };
    const ruleId = preview.productRuleId;
    let applied = 0;
    for (;;) {
      const rows = await em.getConnection().execute<Array<{ sales_channel_id: string; product_id: string; op: 'join' | 'leave' }>>(
        `select "sales_channel_id", "product_id", "op" from "website_rule_preview_changes" where "preview_id" = ?
          order by "sales_channel_id", "op", "product_id" limit ?`,
        [previewId, this.limits.applyBatch],
      );
      if (rows.length === 0) break;
      const live = await this.#liveIds(rows.filter((r) => r.op === 'join').map((r) => r.product_id));
      applied += await this.#inTransaction(async (tx) => {
        const governing = new Map<string, boolean>();
        let changed = 0;
        for (const row of rows) {
          if (!governing.has(row.sales_channel_id)) governing.set(row.sales_channel_id, await this.#governedBy(tx, row.sales_channel_id, ruleId));
          if (!governing.get(row.sales_channel_id)) continue;
          if (row.op === 'join' && !live.has(row.product_id)) continue;
          if (await this.#write(tx, row.sales_channel_id, row.product_id, row.op, ruleId)) changed += 1;
        }
        await tx.getConnection().execute(
          `delete from "website_rule_preview_changes" where "preview_id" = ? and ("sales_channel_id", "product_id", "op") in
             (select * from unnest(?::uuid[], ?::uuid[], ?::varchar[]))`,
          [
            previewId,
            uuidArray(rows.map((r) => r.sales_channel_id)),
            uuidArray(rows.map((r) => r.product_id)),
            `{${rows.map((r) => r.op).join(',')}}`,
          ],
          'run',
          tx.getTransactionContext(),
        );
        return changed;
      });
    }
    return { applied };
  }

  /** Detach (FR-058). */
  async detach(salesChannelId: string): Promise<void> {
    if (!isUuidShape(salesChannelId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'No product rule governs this sales channel.');
    await this.deps.commandBus.run(websiteRuleDetachCommand(salesChannelId));
  }

  // ── Steady state (T059; R-11, SC-005, Q2 A) ───────────────────────────────────────────

  /** Mark products for re-evaluation on every governed channel; durable before it returns. */
  async markProducts(productIds: readonly string[]): Promise<void> {
    const ids = [...new Set(productIds.filter(isUuidShape))];
    if (ids.length === 0) return;
    await this.#em().getConnection().execute(
      `insert into "website_rule_stale_products" ("product_id", "marked_at")
       select p, clock_timestamp() from unnest(?::uuid[]) as t(p)
       on conflict ("product_id") do update set "marked_at" = excluded."marked_at"`,
      [uuidArray(ids)],
    );
  }

  /**
   * The debounced job: evaluate marked products on every governed channel and apply the
   * difference. Only marks older than the read's start are cleared, so a mark taken meanwhile is
   * evaluated by the next run. With no governed channel the marks are simply cleared.
   */
  async evaluateMarked(): Promise<{ evaluated: number; changed: number }> {
    const em = this.#em();
    let evaluated = 0;
    let changed = 0;
    for (;;) {
      const [clock] = await em.getConnection().execute<Array<{ at: Date }>>(`select clock_timestamp() as "at"`);
      const marks = await em.getConnection().execute<Array<{ product_id: string }>>(
        `select "product_id" from "website_rule_stale_products" where "marked_at" < ? order by "marked_at" limit ?`,
        [clock!.at, MARK_BATCH],
      );
      if (marks.length === 0) break;
      const ids = marks.map((m) => m.product_id);
      const governed = await this.governedChannels();
      if (governed.length > 0) {
        changed += await this.#reconcile(governed, ids);
        evaluated += ids.length;
      }
      await em.getConnection().execute(
        `delete from "website_rule_stale_products" where "product_id" = any(?::uuid[]) and "marked_at" < ?`,
        [uuidArray(ids), clock!.at],
      );
    }
    return { evaluated, changed };
  }

  /**
   * The hourly reconcile (and a window boundary's): every governed channel against every product;
   * then any confirmed preview whose snapshot is still unapplied, and expired previews are swept.
   */
  async reconcileAll(): Promise<{ changed: number }> {
    // T101 — first the rows of channels deleted while the module was off (no event reached it).
    await this.sweepDeletedChannels();
    const governed = await this.governedChannels();
    let changed = 0;
    if (governed.length > 0) {
      const ids = (await this.deps.products().listPricingRefs()).map((p) => p.id);
      for (const batch of chunks(ids, EVALUATION_BATCH)) changed += await this.#reconcile(governed, batch);
    }
    const em = this.#em();
    const unapplied = await em.getConnection().execute<Array<{ id: string }>>(
      `select distinct "preview_id" as id from "website_rule_preview_changes" c
         join "website_rule_previews" p on p."id" = c."preview_id" where p."status" = 'applied'`,
    );
    for (const { id } of unapplied) changed += (await this.applyPreview(id)).applied;
    await em.getConnection().execute(
      `delete from "website_rule_previews" where ("status" in ('pending', 'ready', 'failed', 'expired') and "expires_at" < ?)
          or ("status" = 'applied' and "expires_at" < ? and not exists (select 1 from "website_rule_preview_changes" c where c."preview_id" = "website_rule_previews"."id"))`,
      [this.#now(), this.#now()],
    );
    await this.scheduleWindowBoundaries();
    return { changed };
  }

  /**
   * T101 — delete the attachment and admissions rows of every channel that no longer resolves. A
   * sales channel deleted while governed leaves them (no foreign key leaves this module,
   * data-model §0). Run on every `sales_channels.lifecycle_changed` — a delete emits it, and there
   * is no dedicated delete event — and at the start of the hourly reconcile. Idempotent; a
   * deactivated channel still resolves and keeps its rows. Answers the channels swept.
   */
  async sweepDeletedChannels(): Promise<string[]> {
    const conn = this.#em().getConnection();
    const rows = await conn.execute<Array<{ sales_channel_id: string }>>(
      `select "sales_channel_id" from "website_rule_attachments"
       union select "sales_channel_id" from "website_rule_admissions"`,
    );
    const gone: string[] = [];
    for (const { sales_channel_id: id } of rows) if ((await this.deps.channels().getById(id)) === null) gone.push(id);
    if (gone.length === 0) return [];
    await this.#em().transactional(async (tx) => {
      await tx.getConnection().execute(`delete from "website_rule_admissions" where "sales_channel_id" = any(?::uuid[])`, [uuidArray(gone)], 'run', tx.getTransactionContext());
      await tx.getConnection().execute(`delete from "website_rule_attachments" where "sales_channel_id" = any(?::uuid[])`, [uuidArray(gone)], 'run', tx.getTransactionContext());
    });
    return gone;
  }

  /**
   * Window boundaries (R-11): a designated book entering or leaving its window changes whether a
   * price condition on its currency can be met, with no event to say so. Each future boundary of
   * a currency an attached rule names schedules a reconcile at that instant (one job per boundary).
   */
  async scheduleWindowBoundaries(): Promise<number> {
    const governed = await this.governedChannels();
    const currencies = [...new Set(governed.flatMap((g) => ruleCurrencies(g.definition)))];
    if (currencies.length === 0) return 0;
    const rows = await this.#em().getConnection().execute<Array<{ currency_code: string; price_list_id: string; sales_channel_id: string }>>(
      `select "currency_code", "price_list_id", "sales_channel_id" from "catalogue_price_designations" where "currency_code" = any(?::text[])`,
      [`{${currencies.join(',')}}`],
    );
    if (rows.length === 0) return 0;
    const designated = rows.map((r) => ({ currencyCode: r.currency_code.trim(), priceListId: r.price_list_id, salesChannelId: r.sales_channel_id }));
    const statuses = await this.deps.prices().designationStatuses(designated);
    const now = this.#now().getTime();
    let scheduled = 0;
    for (const [i, status] of statuses.entries()) {
      for (const boundary of [status.window?.startsAt, status.window?.endsAt]) {
        if (!boundary) continue;
        const at = new Date(boundary);
        if (at.getTime() <= now) continue;
        await this.deps.jobs.enqueueReconcileAt(at, `${designated[i]!.currencyCode}:${at.toISOString()}`);
        scheduled += 1;
      }
    }
    return scheduled;
  }

  // ── Port (T060; FR-055) ───────────────────────────────────────────────────────────────

  /** Every attachment whose channel still exists, with its rule. */
  async governedChannels(): Promise<GovernedChannel[]> {
    const rows = await this.#em().getConnection().execute<Array<{ sales_channel_id: string; product_rule_id: string; name: string; definition: ProductRuleDefinition }>>(
      `select a."sales_channel_id", a."product_rule_id", r."name", r."definition"
         from "website_rule_attachments" a join "product_rules" r on r."id" = a."product_rule_id"
        order by a."sales_channel_id"`,
    );
    const out: GovernedChannel[] = [];
    for (const r of rows) {
      if ((await this.deps.channels().getById(r.sales_channel_id)) === null) continue;
      out.push({ salesChannelId: r.sales_channel_id, productRuleId: r.product_rule_id, productRuleName: r.name, definition: r.definition });
    }
    return out;
  }

  /** Whether each product meets the rule governing the channel now; `null` ⇒ not governed. */
  async meetsRule(salesChannelId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, boolean> | null> {
    if (!isUuidShape(salesChannelId)) return null;
    const governed = (await this.governedChannels()).find((g) => g.salesChannelId === salesChannelId);
    if (!governed) return null;
    const ids = [...new Set(productIds)].filter(isUuidShape);
    const context = await this.#context([governed.definition]);
    const out = new Map<string, boolean>(productIds.map((id) => [id, false]));
    for (const batch of chunks(ids, EVALUATION_BATCH)) {
      const facts = await this.#facts(batch, context);
      for (const id of batch) {
        const f = facts.get(id);
        out.set(id, f !== undefined && isRuleMember(governed.definition, f, context.attributes));
      }
    }
    return out;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────

  /** Re-evaluate `productIds` on every governed channel and apply the difference. */
  async #reconcile(governed: readonly GovernedChannel[], productIds: readonly string[]): Promise<number> {
    const context = await this.#context(governed.map((g) => g.definition));
    const facts = await this.#facts(productIds, context);
    let changed = 0;
    for (const g of governed) {
      const { joins, leaves } = await this.#diff(g.salesChannelId, g.definition, productIds, facts, context);
      const writes = [...joins.map((p) => [p, 'join'] as const), ...leaves.map((p) => [p, 'leave'] as const)];
      for (const batch of chunks(writes, this.limits.applyBatch)) {
        changed += await this.#inTransaction(async (tx) => {
          if (!(await this.#governedBy(tx, g.salesChannelId, g.productRuleId))) return 0;
          let n = 0;
          for (const [productId, op] of batch) if (await this.#write(tx, g.salesChannelId, productId, op, g.productRuleId)) n += 1;
          return n;
        });
      }
    }
    return changed;
  }

  /** One governor-token membership write and its admissions-ledger row (N2). */
  async #write(tx: EntityManager, channelId: string, productId: string, op: 'join' | 'leave', ruleId: string): Promise<boolean> {
    const options = { em: tx, governorToken: this.deps.governor.token(), source: websiteRuleAuditSource(ruleId) };
    const conn = tx.getConnection();
    if (op === 'join') {
      const { changed } = await this.deps.membership().addToChannel(channelId, 'product', productId, options);
      if (changed) {
        await conn.execute(
          `insert into "website_rule_admissions" ("sales_channel_id", "product_id", "admitted_at", "post_admission_status_seen")
           values (?, ?, now(), false)
           on conflict ("sales_channel_id", "product_id") do update set "admitted_at" = excluded."admitted_at", "post_admission_status_seen" = false`,
          [channelId, productId],
          'run',
          tx.getTransactionContext(),
        );
      }
      return changed;
    }
    const { changed } = await this.deps.membership().removeFromChannel(channelId, 'product', productId, options);
    if (changed) {
      await conn.execute(
        `delete from "website_rule_admissions" where "sales_channel_id" = ? and "product_id" = ?`,
        [channelId, productId],
        'run',
        tx.getTransactionContext(),
      );
    }
    return changed;
  }

  /** One transaction inside an EventBus scope: audit, events and cache drops follow the commit (#1926). */
  #inTransaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T> {
    return this.deps.eventBus.run(() => this.#em().transactional((tx) => work(tx as EntityManager)));
  }

  /** Whether `channelId` is still governed by `ruleId`, read in the writing transaction. */
  async #governedBy(tx: EntityManager, channelId: string, ruleId: string): Promise<boolean> {
    const rows = await tx
      .getConnection()
      .execute<Array<{ product_rule_id: string }>>(
        `select "product_rule_id" from "website_rule_attachments" where "sales_channel_id" = ? for share`,
        [channelId],
        'all',
        tx.getTransactionContext(),
      );
    return rows[0]?.product_rule_id === ruleId && (await this.deps.channels().getById(channelId)) !== null;
  }

  /** The joins and leaves of `productIds` on `channelId` under `definition`. */
  async #diff(
    channelId: string,
    definition: ProductRuleDefinition,
    productIds: readonly string[],
    facts: ReadonlyMap<string, ProductRuleFacts>,
    context: EvaluationContext,
  ): Promise<{ joins: string[]; leaves: string[] }> {
    const members = new Set(await this.deps.membership().filterEntityIdsInChannel(channelId, 'product', productIds));
    const joins: string[] = [];
    const leaves: string[] = [];
    for (const id of productIds) {
      const f = facts.get(id);
      const wanted = f !== undefined && isRuleMember(definition, f, context.attributes);
      if (wanted && !members.has(id)) joins.push(id);
      else if (!wanted && members.has(id) && f !== undefined) leaves.push(id);
    }
    return { joins, leaves };
  }

  async #liveIds(productIds: readonly string[]): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const products = await this.deps.products().findByIds([...new Set(productIds)]);
    return new Set(
      products.filter((p) => isLive({ status: p.status, archived: p.archivedAt !== null, deleted: p.deletedAt !== null })).map((p) => p.id),
    );
  }

  /**
   * The attribute catalogue as it is now (TM-11), and the flag generation each currency a rule
   * names may be read at: the **served** one (Q2 A — a rebuild in progress changes nothing until
   * its swap), and only while the currency's designated book, if any, is in force.
   */
  async #context(definitions: readonly ProductRuleDefinition[]): Promise<EvaluationContext> {
    const attributes = ruleAttributeIndex(await this.deps.attributes().listAll());
    const currencies = [...new Set(definitions.flatMap(ruleCurrencies))];
    const generations = new Map<string, number>();
    if (currencies.length === 0) return { attributes, generations };
    const conn = this.#em().getConnection();
    const served = await conn.execute<Array<{ currency_code: string; served_generation: number }>>(
      `select "currency_code", "served_generation" from "catalogue_price_generations" where "currency_code" = any(?::text[]) and "served_generation" > 0`,
      [`{${currencies.join(',')}}`],
    );
    const designations = await conn.execute<Array<{ currency_code: string; price_list_id: string; sales_channel_id: string }>>(
      `select "currency_code", "price_list_id", "sales_channel_id" from "catalogue_price_designations" where "currency_code" = any(?::text[])`,
      [`{${currencies.join(',')}}`],
    );
    const designated = designations.map((d) => ({ currencyCode: d.currency_code.trim(), priceListId: d.price_list_id, salesChannelId: d.sales_channel_id }));
    const statuses = designated.length > 0 ? await this.deps.prices().designationStatuses(designated) : [];
    const notInForce = new Set(designated.filter((_, i) => statuses[i]?.inForce !== true).map((d) => d.currencyCode));
    for (const row of served) {
      const code = row.currency_code.trim();
      if (!notInForce.has(code)) generations.set(code, row.served_generation);
    }
    return { attributes, generations };
  }

  /** Facts of `productIds` (those that exist), with their price flags at the context's generations. */
  async #facts(productIds: readonly string[], context: EvaluationContext): Promise<Map<string, ProductRuleFacts>> {
    if (productIds.length === 0) return new Map();
    const products = await this.deps.products().findByIds(productIds);
    const prices = new Map<string, Map<string, CataloguePriceFact>>();
    for (const [code, generation] of context.generations) {
      const rows = await this.#em().getConnection().execute<Array<{ product_id: string; has_positive: boolean }>>(
        `select "product_id", "has_positive" from "product_catalogue_prices"
          where "currency_code" = ? and "generation" = ? and "product_id" = any(?::uuid[])`,
        [code, generation, uuidArray(productIds)],
      );
      for (const r of rows) {
        let map = prices.get(r.product_id);
        if (!map) prices.set(r.product_id, (map = new Map()));
        map.set(code, { hasPositive: r.has_positive });
      }
    }
    const out = new Map<string, ProductRuleFacts>();
    for (const p of products) {
      out.set(p.id, {
        status: p.status,
        archived: p.archivedAt !== null,
        deleted: p.deletedAt !== null,
        attributeValues: p.attributeValues ?? {},
        prices: prices.get(p.id) ?? new Map(),
      });
    }
    return out;
  }
}

function view(rule: ProductRule): ProductRuleView {
  return { id: rule.id, name: rule.name, version: rule.version, definition: rule.definition };
}
