import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  type SalesChannelCreateRequest,
  type SalesChannelUpdateBody,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * A sales channel's identity writes — create and update — as Commands
 * (Principle XIII; raised by issue #467).
 *
 * They used to be audited by hand in `SalesChannelsService`: a flush, then a
 * separate `auditLogService.record`, which a failure between the two could split.
 * Through the Command Bus the actor comes from the ambient TenantContext (fail
 * closed — no context, no write), and the write and its one audit row commit
 * together or not at all. The row keeps its action,
 * `sales_channel.identity.changed`, and carries the channel's snapshot in
 * `stateBefore` (null on create) and `stateAfter`.
 *
 * **No `event` here, on purpose — D-93.** The bus would dispatch a declared
 * event on commit, and the channel cache can only be dropped once `run` has
 * returned, so a declared event would reach subscribers (`dictionaries`
 * re-reads the channel on it) before the drop. `SalesChannelsService` therefore
 * drops the cache after `CommandBus.run` has committed and only then emits
 * `sales_channels.identity_changed` — after the commit, so a concurrent read
 * cannot re-pin the pre-commit row, and before the announcement, so every
 * subscriber reads the new state. A rolled-back Command throws, so nothing is
 * dropped or announced for it.
 *
 * **Not `reversible`.** Like `set-default.command.ts`: no operator-facing undo
 * surface exists for a channel's identity; the inverse is another update, and
 * the audit row's `stateBefore` says what to restore.
 *
 * What stays in the service, before the Command runs: the 404, the code
 * immutability refusal and the dictionary validation — reads that answer the
 * operator's mistake without opening a transaction. The optimistic-concurrency
 * check is made there for the same reason **and again here**, inside the
 * transaction, because that is the one still true at the moment of the write.
 */

/** The audit snapshot of a channel's identity — what `stateBefore` / `stateAfter` hold. */
export function snapshotSalesChannel(c: SalesChannel): Record<string, unknown> {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    logoAssetId: c.logoAssetId ?? null,
    themeCode: c.themeCode ?? null,
    languages: c.languages,
    defaultLanguage: c.defaultLanguage,
    currencies: c.currencies,
    defaultCurrency: c.defaultCurrency,
    active: c.active,
    anonymousAccess: c.anonymousAccess,
    prefixDefaultLanguage: c.prefixDefaultLanguage,
    systemDefault: c.systemDefault,
    version: c.version,
  };
}

function duplicateCode(code: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.DUPLICATE_SALES_CHANNEL_CODE,
    `Sales channel code "${code}" is already in use.`,
  );
}

/**
 * Create a channel. `channelId` is chosen by the caller so the Command can name
 * its object before the row exists.
 */
export function makeCreateSalesChannelCommand(
  channelId: string,
  body: SalesChannelCreateRequest,
): Command<SalesChannel> {
  return {
    action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
    objectType: 'sales_channel',
    objectId: channelId,
    run: async ({ em }) => {
      const active = body.active ?? true;
      const channel = em.create(SalesChannel, {
        id: channelId,
        code: body.code,
        name: body.name,
        logoAssetId: body.logoAssetId ?? null,
        themeCode: body.themeCode ?? null,
        languages: body.languages,
        defaultLanguage: body.defaultLanguage,
        currencies: body.currencies,
        defaultCurrency: body.defaultCurrency,
        active,
        // Feature 154 (FR-003) — open unless the operator turns it off.
        anonymousAccess: body.anonymousAccess ?? true,
        // Feature 167 (OR-1) — a new channel prefixes its default language in
        // storefront URLs unless the operator turns it off.
        prefixDefaultLanguage: body.prefixDefaultLanguage ?? true,
        systemDefault: false,
        version: 1,
        // Legacy column preserved for one release (research R-12).
        status: active ? 'active' : 'inactive',
      });
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) throw duplicateCode(body.code);
        throw err;
      }
      return { result: channel, before: null, after: snapshotSalesChannel(channel) };
    },
  };
}

/**
 * Apply a validated identity patch to the channel `channelId`, refusing a stale
 * `expectedVersion` and the deactivation of the system default.
 */
export function makeUpdateSalesChannelCommand(
  channelId: string,
  body: SalesChannelUpdateBody,
  expectedVersion: number,
): Command<SalesChannel> {
  return {
    action: SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
    objectType: 'sales_channel',
    objectId: channelId,
    run: async ({ em }) => {
      const channel = await em.findOne(SalesChannel, { id: channelId });
      if (channel === null) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'The sales channel no longer exists.');
      }
      if (channel.version !== expectedVersion) {
        throw new HttpError(
          412,
          ERROR_CODES.STALE_SALES_CHANNEL_WRITE,
          `Sales channel "${channel.code}" was modified by another writer; ` +
            `current version is ${channel.version}, your If-Match was ${expectedVersion}.`,
          [{ path: 'version', issue: String(channel.version) }],
        );
      }

      const before = snapshotSalesChannel(channel);

      if (body.name !== undefined) channel.name = body.name;
      if (body.logoAssetId !== undefined) channel.logoAssetId = body.logoAssetId;
      if (body.themeCode !== undefined) channel.themeCode = body.themeCode;
      if (body.languages !== undefined) channel.languages = body.languages;
      if (body.defaultLanguage !== undefined) channel.defaultLanguage = body.defaultLanguage;
      if (body.currencies !== undefined) channel.currencies = body.currencies;
      if (body.defaultCurrency !== undefined) channel.defaultCurrency = body.defaultCurrency;
      if (body.active !== undefined) {
        if (channel.systemDefault && body.active === false) {
          throw new HttpError(
            422,
            ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
            `Sales channel "${channel.code}" is the system default and cannot be deactivated.`,
          );
        }
        channel.active = body.active;
        channel.status = body.active ? 'active' : 'inactive';
      }
      // Feature 154 — the access step reads this off the cached channel, which
      // the service drops once this Command has committed.
      if (body.anonymousAccess !== undefined) channel.anonymousAccess = body.anonymousAccess;
      // Feature 167 — every storefront URL emitter reads this off the cached channel,
      // which the service drops once this Command has committed.
      if (body.prefixDefaultLanguage !== undefined) {
        channel.prefixDefaultLanguage = body.prefixDefaultLanguage;
      }
      channel.version += 1;

      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) throw duplicateCode(channel.code);
        throw err;
      }
      return { result: channel, before, after: snapshotSalesChannel(channel) };
    },
  };
}
