import { randomUUID } from 'node:crypto';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  PRODUCT_VISIBILITY_AUDIT_ACTIONS as A,
  PRODUCT_VISIBILITY_ERROR_CODES as E,
  type ProductRuleDefinition,
} from '@endora-commerce/contracts';
import type { Command, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ProductRule } from '../entities/product-rule.entity.js';
import { WebsiteRuleAdmission } from '../entities/website-rule-admission.entity.js';
import { WebsiteRuleAttachment } from '../entities/website-rule-attachment.entity.js';
import { WebsiteRulePreview } from '../entities/website-rule-preview.entity.js';

/**
 * The product-rule and website-rule Commands (FR-050 – FR-053, FR-056,
 * FR-058, FR-070; contracts/events-and-errors.md §3). Each is one `CommandBus.run`: one
 * transaction, one audit entry naming the actor. Rules and attachments are platform-global
 * configuration (Principle XI, FR-075): the audit state carries names, definitions and ids.
 *
 * What validates against other modules (the attribute catalogue, the channels) is the service's,
 * before the Command runs; a Command owns its rows and their invariants — one rule per channel
 * (FR-051), no definition change of an attached rule without a preview (FR-053), no delete of an
 * attached rule, and the preview checks that make a confirm apply exactly what it showed (SC-004).
 */

type Em = CommandContext['em'];

export type ProductRuleState = {
  readonly name: string;
  readonly version: number;
  readonly definition: ProductRuleDefinition;
};

function ruleState(rule: ProductRule): ProductRuleState {
  return { name: rule.name, version: rule.version, definition: rule.definition };
}

function nameTaken(): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Another product rule already has this name.', [
    { path: 'name', issue: 'already used by another product rule' },
  ]);
}

async function flushNamed(em: Em): Promise<void> {
  try {
    await em.flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) throw nameTaken();
    throw error;
  }
}

async function loadRule(em: Em, id: string, expectedVersion?: number): Promise<ProductRule> {
  const rule = await em.findOne(ProductRule, { id });
  if (!rule) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product rule not found.');
  if (expectedVersion !== undefined && rule.version !== expectedVersion) {
    throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The product rule changed since it was read.', { currentVersion: rule.version });
  }
  return rule;
}

/**
 * Drop the attachments (and admissions) of channels that no longer exist — a sales channel deleted
 * while governed leaves its rows behind (no foreign key leaves this module, data-model §0). The
 * service names them; the Command removes them in its own transaction before it decides.
 */
async function dropDeadAttachments(em: Em, deadChannelIds: readonly string[]): Promise<void> {
  if (deadChannelIds.length === 0) return;
  await em.nativeDelete(WebsiteRuleAttachment, { salesChannelId: { $in: [...deadChannelIds] } });
  await em.nativeDelete(WebsiteRuleAdmission, { salesChannelId: { $in: [...deadChannelIds] } });
}

async function attachedChannelIds(em: Em, ruleId: string): Promise<string[]> {
  const rows = await em.find(WebsiteRuleAttachment, { productRuleId: ruleId }, { orderBy: { salesChannelId: 'asc' } });
  return rows.map((r) => r.salesChannelId);
}

/** `product_visibility.product_rule.create` (FR-056). */
export function productRuleCreateCommand(input: { name: string; definition: ProductRuleDefinition }): Command<ProductRule> {
  const id = randomUUID();
  return {
    action: A.PRODUCT_RULE_CREATE,
    objectType: 'product_rule',
    objectId: id,
    async run({ em }) {
      const rule = em.create(ProductRule, { id, name: input.name.trim(), definition: input.definition });
      em.persist(rule);
      await flushNamed(em);
      return { result: rule, before: null, after: ruleState(rule) };
    },
  };
}

/**
 * `product_visibility.product_rule.update` — rename, and / or change the definition, which moves
 * `version`. A definition change of a rule attached to a channel is refused: it goes through a
 * preview (FR-053), applied by {@link websiteRuleChangeCommand}.
 */
export function productRuleUpdateCommand(
  id: string,
  patch: { name?: string | undefined; definition?: ProductRuleDefinition | undefined },
  expectedVersion: number | undefined,
  deadChannelIds: readonly string[] = [],
): Command<ProductRule> {
  return {
    action: A.PRODUCT_RULE_UPDATE,
    objectType: 'product_rule',
    objectId: id,
    async run({ em }) {
      const rule = await loadRule(em, id, expectedVersion);
      const before = ruleState(rule);
      const nextName = patch.name !== undefined ? patch.name.trim() : rule.name;
      const definitionChanged = patch.definition !== undefined && JSON.stringify(patch.definition) !== JSON.stringify(rule.definition);
      if (nextName === rule.name && !definitionChanged) return { result: rule, before, after: before, skipAudit: true };
      if (definitionChanged) {
        await dropDeadAttachments(em, deadChannelIds);
        if ((await attachedChannelIds(em, id)).length > 0) {
          throw new HttpError(
            409,
            E.WEBSITE_RULE_PREVIEW_REQUIRED,
            'This product rule governs a sales channel; change its definition through a preview.',
          );
        }
        rule.definition = patch.definition!;
        rule.version += 1;
      }
      rule.name = nextName;
      await flushNamed(em);
      return { result: rule, before, after: ruleState(rule) };
    },
  };
}

/** `product_visibility.product_rule.delete` — refused while attached to any channel. */
export function productRuleDeleteCommand(id: string, expectedVersion: number | undefined, deadChannelIds: readonly string[] = []): Command<void> {
  return {
    action: A.PRODUCT_RULE_DELETE,
    objectType: 'product_rule',
    objectId: id,
    async run({ em }) {
      const rule = await loadRule(em, id, expectedVersion);
      await dropDeadAttachments(em, deadChannelIds);
      const channels = await attachedChannelIds(em, id);
      if (channels.length > 0) {
        throw new HttpError(409, E.PRODUCT_RULE_ATTACHED, 'This product rule governs a sales channel; detach it first.', {
          channelCount: channels.length,
        });
      }
      const before = ruleState(rule);
      em.remove(rule);
      await em.flush();
      return { result: undefined, before, after: null };
    },
  };
}

function stale(reason: string): HttpError {
  return new HttpError(409, E.WEBSITE_RULE_PREVIEW_STALE, `This preview is no longer current: ${reason}. Create a new preview.`);
}

/**
 * The checks every confirm makes, on the preview row locked for this transaction (FR-053,
 * TM-11): only its creator may confirm it (anyone else: not found), it is ready, not expired, and
 * the rule's version is the one it evaluated.
 */
async function lockReadyPreview(em: Em, previewId: string, adminUserId: string, now: Date): Promise<{ preview: WebsiteRulePreview; rule: ProductRule }> {
  const preview = await em.findOne(WebsiteRulePreview, { id: previewId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!preview || preview.createdByAdminUserId !== adminUserId) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Website rule preview not found.');
  }
  if (preview.status !== 'ready') throw stale(`it is ${preview.status}`);
  if (preview.expiresAt.getTime() <= now.getTime()) throw stale('it expired');
  const rule = preview.productRuleId ? await em.findOne(ProductRule, { id: preview.productRuleId }) : null;
  if (!rule) throw stale('its rule was deleted');
  if (preview.ruleVersion !== rule.version) throw stale('the rule changed since');
  return { preview, rule };
}

export interface WebsiteRuleConfirmed {
  readonly previewId: string;
  readonly productRuleId: string;
  readonly salesChannelIds: readonly string[];
}

/**
 * `product_visibility.website_rule.attach` — attach the rule to the channels the preview
 * evaluated (its `counts`), one rule per channel (FR-051). The apply job then writes the
 * preview's snapshot (SC-004); from this commit on the channels are governed.
 */
export function websiteRuleAttachCommand(
  previewId: string,
  adminUserId: string,
  now: Date,
  /** The channels that still exist; one deleted since the preview ran is not attached. */
  existingChannelIds: ReadonlySet<string>,
): Command<WebsiteRuleConfirmed> {
  return {
    action: A.WEBSITE_RULE_ATTACH,
    objectType: 'website_rule_preview',
    objectId: previewId,
    async run({ em }) {
      const { preview, rule } = await lockReadyPreview(em, previewId, adminUserId, now);
      if (preview.kind !== 'attach') throw stale('it is not an attach preview');
      const channelIds = Object.keys(preview.counts ?? {}).filter((id) => existingChannelIds.has(id)).sort();
      const held = await em.find(WebsiteRuleAttachment, { salesChannelId: { $in: channelIds } });
      if (held.length > 0) {
        throw new HttpError(409, E.CHANNEL_ALREADY_GOVERNED, 'A sales channel of this preview already follows a product rule.', {
          channelCount: held.length,
        });
      }
      for (const salesChannelId of channelIds) {
        em.persist(em.create(WebsiteRuleAttachment, { salesChannelId, productRuleId: rule.id, appliedRuleVersion: rule.version }));
      }
      preview.status = 'applied';
      try {
        await em.flush();
      } catch (error) {
        // Two confirms racing for one channel: the loser meets the primary key (FR-051).
        if (error instanceof UniqueConstraintViolationException) {
          throw new HttpError(409, E.CHANNEL_ALREADY_GOVERNED, 'A sales channel of this preview already follows a product rule.');
        }
        throw error;
      }
      return {
        result: { previewId, productRuleId: rule.id, salesChannelIds: channelIds },
        before: null,
        after: { productRuleId: rule.id, productRuleName: rule.name, ruleVersion: rule.version, salesChannelIds: channelIds },
      };
    },
  };
}

/**
 * `product_visibility.website_rule.change` — the definition the preview evaluated becomes the
 * rule's, its version moves, and every attachment records it. Stale when the channels the rule
 * governs changed since the preview.
 */
export function websiteRuleChangeCommand(
  previewId: string,
  adminUserId: string,
  now: Date,
  deadChannelIds: readonly string[] = [],
): Command<WebsiteRuleConfirmed> {
  return {
    action: A.WEBSITE_RULE_CHANGE,
    objectType: 'website_rule_preview',
    objectId: previewId,
    async run({ em }) {
      const { preview, rule } = await lockReadyPreview(em, previewId, adminUserId, now);
      if (preview.kind !== 'change') throw stale('it is not a change preview');
      await dropDeadAttachments(em, deadChannelIds);
      const channelIds = await attachedChannelIds(em, rule.id);
      if (JSON.stringify(channelIds) !== JSON.stringify(Object.keys(preview.counts ?? {}).sort())) {
        throw stale('the channels the rule governs changed since');
      }
      const before = ruleState(rule);
      rule.definition = preview.definition;
      rule.version += 1;
      const attachments = await em.find(WebsiteRuleAttachment, { productRuleId: rule.id });
      for (const a of attachments) a.appliedRuleVersion = rule.version;
      preview.status = 'applied';
      await em.flush();
      return {
        result: { previewId, productRuleId: rule.id, salesChannelIds: channelIds },
        before,
        after: { ...ruleState(rule), salesChannelIds: channelIds },
      };
    },
  };
}

/**
 * `product_visibility.website_rule.detach` (FR-058) — the attachment and the channel's admissions
 * ledger go; memberships stay. The channel is ungoverned from the next write.
 */
export function websiteRuleDetachCommand(salesChannelId: string): Command<void> {
  return {
    action: A.WEBSITE_RULE_DETACH,
    objectType: 'website_rule_attachment',
    objectId: salesChannelId,
    async run({ em }) {
      const attachment = await em.findOne(WebsiteRuleAttachment, { salesChannelId });
      if (!attachment) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'No product rule governs this sales channel.');
      const before = { productRuleId: attachment.productRuleId, appliedRuleVersion: attachment.appliedRuleVersion };
      em.remove(attachment);
      await em.nativeDelete(WebsiteRuleAdmission, { salesChannelId });
      await em.flush();
      return { result: undefined, before, after: null };
    },
  };
}
