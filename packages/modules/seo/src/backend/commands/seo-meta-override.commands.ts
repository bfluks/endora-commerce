import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type SeoEntityType } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SeoMetaOverride } from '../entities/seo-meta-override.entity.js';

/**
 * SEO meta overrides as Commands — feature 163 (`specs/163-product-data-scopes/`,
 * analyze C1, research R13, R29; Constitution XIII, FR-080).
 *
 * The overrides were audited by hand (`recordAuditFromContext`), with
 * `stateBefore: null` on an update — so the audit trail could say that a title
 * changed, never what it changed from. They now run on the bus in the shape of
 * `delivery_methods/src/backend/commands/delivery-method.commands.ts`: one audit
 * entry per request, `before` and `after` the full row projection.
 *
 * **Not `reversible`**: a single row has no stored-revert undo surface. The audit
 * row's `before` is what an operator restores from, by re-sending it through the
 * same route (R29).
 *
 * A row is addressed by (entity, channel?, locale?): `locale` only is the language
 * row, `channelId` only the channel row, both the channel × language row.
 */

/** Where an override row sits. At least one of the two is set. */
export interface SeoMetaOverrideAddress {
  readonly entityType: SeoEntityType;
  readonly entityId: string;
  readonly channelId: string | null;
  readonly locale: string | null;
}

/** The five fields an override sets; `undefined` leaves a field as it is. */
export interface SeoMetaOverrideFields {
  readonly title?: string | null;
  readonly description?: string | null;
  readonly ogTitle?: string | null;
  readonly ogDescription?: string | null;
  readonly ogImageUrl?: string | null;
}

/** The audit projection of a row: its address and its five fields. */
export function seoMetaOverrideAuditState(row: SeoMetaOverride): Record<string, unknown> {
  return {
    entityType: row.entityType,
    entityId: row.entityId,
    channelId: row.salesChannelId ?? null,
    locale: row.locale ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
    ogTitle: row.ogTitle ?? null,
    ogDescription: row.ogDescription ?? null,
    ogImageUrl: row.ogImageUrl ?? null,
  };
}

/** The `where` that finds exactly the addressed row — a `null` half matches only `null`. */
export function seoMetaOverrideWhere(address: SeoMetaOverrideAddress): Record<string, unknown> {
  return {
    entityType: address.entityType,
    entityId: address.entityId,
    salesChannelId: address.channelId,
    locale: address.locale,
  };
}

export interface UpsertSeoMetaOverrideInput {
  readonly address: SeoMetaOverrideAddress;
  readonly fields: SeoMetaOverrideFields;
  /**
   * The id of the row at this address when the caller looked, or `null` for a
   * creation. It fixes the action's object id, so a row that appeared in between
   * is refused rather than duplicated.
   */
  readonly existingId: string | null;
}

export function makeUpsertSeoMetaOverrideCommand(input: UpsertSeoMetaOverrideInput): Command<SeoMetaOverride> {
  const id = input.existingId ?? randomUUID();
  const { fields } = input;
  return {
    action: 'seo_meta_override.upsert',
    objectType: 'seo_meta_override',
    objectId: id,
    run: async ({ em }) => {
      let row = await em.findOne(SeoMetaOverride, seoMetaOverrideWhere(input.address));
      if (row !== null && row.id !== input.existingId) {
        throw new HttpError(
          409,
          ERROR_CODES.VERSION_CONFLICT,
          'This SEO override was created by someone else. Reload and try again.',
        );
      }
      if (row === null && input.existingId !== null) {
        throw new HttpError(
          409,
          ERROR_CODES.VERSION_CONFLICT,
          'This SEO override was removed by someone else. Reload and try again.',
        );
      }
      const before = row === null ? null : seoMetaOverrideAuditState(row);
      if (row === null) {
        row = em.create(SeoMetaOverride, {
          id,
          entityType: input.address.entityType,
          entityId: input.address.entityId,
          salesChannelId: input.address.channelId,
          locale: input.address.locale,
        });
        em.persist(row);
      }
      if (fields.title !== undefined) row.title = fields.title;
      if (fields.description !== undefined) row.description = fields.description;
      if (fields.ogTitle !== undefined) row.ogTitle = fields.ogTitle;
      if (fields.ogDescription !== undefined) row.ogDescription = fields.ogDescription;
      if (fields.ogImageUrl !== undefined) row.ogImageUrl = fields.ogImageUrl;
      await em.flush();
      return { result: row, before, after: seoMetaOverrideAuditState(row) };
    },
  };
}

export interface DeleteSeoMetaOverrideInput {
  readonly address: SeoMetaOverrideAddress;
  /** The id of the row at this address when the caller looked; `null` = nothing there. */
  readonly existingId: string | null;
}

/**
 * Removes the addressed row. Nothing at the address is a no-op answered `204`
 * with no audit entry (`skipAudit`) — "use inherited" on a scope that already
 * inherits changes nothing.
 */
export function makeDeleteSeoMetaOverrideCommand(input: DeleteSeoMetaOverrideInput): Command<{ deleted: boolean }> {
  return {
    action: 'seo_meta_override.delete',
    objectType: 'seo_meta_override',
    objectId: input.existingId ?? randomUUID(),
    run: async ({ em }) => {
      const row = await em.findOne(SeoMetaOverride, seoMetaOverrideWhere(input.address));
      if (row === null) return { result: { deleted: false }, skipAudit: true };
      const before = seoMetaOverrideAuditState(row);
      em.remove(row);
      await em.flush();
      return { result: { deleted: true }, before, after: null };
    },
  };
}
