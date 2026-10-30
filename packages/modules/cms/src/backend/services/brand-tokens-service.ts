import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CMS_STOREFRONT_CACHE_TAGS,
  DEFAULT_BRAND_TOKENS,
  ERROR_CODES,
  assessBrandContrast,
  cmsBrandTokensSchema,
  type CmsBrandTokens,
  type CmsBrandTokensScope,
  type CmsBrandTokensScopeState,
  type ContrastFinding,
} from '@endora-commerce/contracts';
import type { AuditState, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Brand tokens (`specs/163-page-builder-marketing-pages/` research R-1, R-2;
 * `contracts/storefront-and-admin-api.md` §1).
 *
 * One complete set per scope in `cms_brand_tokens`: the global row
 * (`sales_channel_id is null`) and one optional override per sales channel.
 * The effective set of a channel is its own row, else the global row, else
 * {@link DEFAULT_BRAND_TOKENS} — whole sets, never merged token by token.
 *
 * Every write is the Command `cms.brand_tokens.update` (Constitution XIII): the
 * row is upserted or deleted on the Command's EntityManager, so the write and
 * its single audit entry commit or roll back together. Nothing here goes
 * through the settings write path, which audits outside a transaction and would
 * record a second entry for the same change (R-1).
 *
 * The storefront keeps the read in its Data Cache under `cms:brand`; the tag is
 * revalidated after the commit, never before it and never for a rolled-back
 * write. Revalidation is best-effort: a failure is logged and the save stands.
 */

export const CMS_BRAND_TOKENS_UPDATE_ACTION = 'cms.brand_tokens.update';
export const CMS_BRAND_TOKENS_OBJECT_TYPE = 'cms_brand_tokens';
/** The audit object id of the global set; a channel's set is named by its id. */
export const CMS_BRAND_TOKENS_GLOBAL_OBJECT_ID = 'global';

type StoredRow = {
  sales_channel_id: string | null;
  tokens: unknown;
  version: number;
};

export interface BrandTokensRead {
  global: CmsBrandTokensScopeState;
  /** `null` when the read names no channel. */
  channel: (CmsBrandTokensScopeState & { salesChannelId: string }) | null;
  effective: CmsBrandTokens;
}

export interface BrandTokensUpdateResult {
  /** The scope's version after the write; 0 once its row is removed. */
  version: number;
  /** The saved set's contrast findings (`[]` for a removal). */
  warnings: ContrastFinding[];
}

export interface BrandTokensLogger {
  warn: (obj: unknown, msg: string) => void;
}

export interface CmsBrandTokensServiceOptions {
  emFactory: () => EntityManager;
  commandBus: Pick<CommandBus, 'run'>;
  /**
   * Asks the storefront to drop Data Cache entries by tag. The composition
   * binds it to `cmsStorefrontRevalidator`; absent, nothing is revalidated.
   */
  revalidateStorefront?: (tags: string[]) => Promise<void>;
}

const NO_STATE: CmsBrandTokensScopeState = { tokens: null, version: 0 };

export class CmsBrandTokensService {
  private logger: BrandTokensLogger | undefined;

  constructor(private readonly options: CmsBrandTokensServiceOptions) {}

  /** Installed where `app.log` exists — the route registrar. */
  setLogger(logger: BrandTokensLogger): void {
    this.logger = logger;
  }

  /**
   * The global set, the named channel's set and the effective one, in one
   * indexed query for both rows.
   */
  async read(salesChannelId: string | null): Promise<BrandTokensRead> {
    const rows = (await this.options.emFactory().execute(
      salesChannelId === null
        ? `select sales_channel_id::text as sales_channel_id, tokens, version
           from cms_brand_tokens where sales_channel_id is null`
        : `select sales_channel_id::text as sales_channel_id, tokens, version
           from cms_brand_tokens where sales_channel_id is null or sales_channel_id = ?`,
      salesChannelId === null ? [] : [salesChannelId],
    )) as StoredRow[];

    const globalRow = rows.find((row) => row.sales_channel_id === null);
    const channelRow =
      salesChannelId === null ? undefined : rows.find((row) => row.sales_channel_id === salesChannelId);
    const global = this.stateOf(globalRow);
    const channel = salesChannelId === null ? null : { salesChannelId, ...this.stateOf(channelRow) };

    return {
      global,
      channel,
      effective: channel?.tokens ?? global.tokens ?? DEFAULT_BRAND_TOKENS,
    };
  }

  /** The effective set for a channel, or the global set for `null`. */
  async effective(salesChannelId: string | null): Promise<CmsBrandTokens> {
    return (await this.read(salesChannelId)).effective;
  }

  /**
   * Save or remove one scope's set as the Command `cms.brand_tokens.update`.
   * `tokens: null` removes the scope's row: a channel then inherits the global
   * set, and the global scope falls back to the built-in defaults.
   */
  async update(
    scope: CmsBrandTokensScope,
    tokens: CmsBrandTokens | null,
    expectedVersion: number,
  ): Promise<BrandTokensUpdateResult> {
    const salesChannelId = scope.kind === 'channel' ? scope.salesChannelId : null;
    if (salesChannelId !== null) await this.assertChannelExists(salesChannelId);

    const { version, changed } = await this.options.commandBus.run<{
      version: number;
      changed: boolean;
    }>({
      action: CMS_BRAND_TOKENS_UPDATE_ACTION,
      objectType: CMS_BRAND_TOKENS_OBJECT_TYPE,
      objectId: salesChannelId ?? CMS_BRAND_TOKENS_GLOBAL_OBJECT_ID,
      run: async ({ em: tx }) => {
        const [row] = (await tx.execute(
          `select sales_channel_id::text as sales_channel_id, tokens, version
           from cms_brand_tokens where sales_channel_id is not distinct from ?
           for update`,
          [salesChannelId],
        )) as StoredRow[];
        const current = row?.version ?? 0;
        if (expectedVersion !== current) {
          throw new HttpError(
            409,
            ERROR_CODES.VERSION_CONFLICT,
            'The brand tokens were updated concurrently.',
          );
        }
        const before = row ? this.auditState(salesChannelId, row.tokens, row.version) : null;

        if (tokens === null) {
          // Nothing stored and nothing asked for: no write, so no audit entry.
          if (!row) return { result: { version: 0, changed: false }, skipAudit: true };
          await tx.execute(
            'delete from cms_brand_tokens where sales_channel_id is not distinct from ?',
            [salesChannelId],
          );
          return { result: { version: 0, changed: true }, before, after: null };
        }

        const next = current + 1;
        if (row) {
          await tx.execute(
            `update cms_brand_tokens set tokens = ?::jsonb, version = ?, updated_at = now()
             where sales_channel_id is not distinct from ?`,
            [JSON.stringify(tokens), next, salesChannelId],
          );
        } else {
          // A concurrent first save of the same scope loses on the unique
          // constraint; `on conflict do nothing` turns that into the 409 it is.
          const inserted = (await tx.execute(
            `insert into cms_brand_tokens (id, sales_channel_id, tokens, version, updated_at)
             values (?, ?, ?::jsonb, ?, now())
             on conflict do nothing
             returning id`,
            [randomUUID(), salesChannelId, JSON.stringify(tokens), next],
          )) as Array<{ id: string }> | undefined;
          if (Array.isArray(inserted) && inserted.length === 0) {
            throw new HttpError(
              409,
              ERROR_CODES.VERSION_CONFLICT,
              'The brand tokens were updated concurrently.',
            );
          }
        }
        return {
          result: { version: next, changed: true },
          before,
          after: this.auditState(salesChannelId, tokens, next),
        };
      },
    });

    if (changed) this.revalidateAfterCommit();
    return { version, warnings: tokens === null ? [] : assessBrandContrast(tokens) };
  }

  /** What an audit entry keeps of a set: its scope, the whole set and its version. */
  private auditState(salesChannelId: string | null, tokens: unknown, version: number): AuditState {
    return { salesChannelId, tokens: tokens as Record<string, unknown>, version };
  }

  /**
   * A stored set as the API states it. A row the current schema refuses — a
   * set written before a schema change — reads as unset, so the next level
   * applies rather than a page styled from a value nobody can save again.
   */
  private stateOf(row: StoredRow | undefined): CmsBrandTokensScopeState {
    if (!row) return NO_STATE;
    const parsed = cmsBrandTokensSchema.safeParse(row.tokens);
    if (!parsed.success) {
      this.logger?.warn(
        { salesChannelId: row.sales_channel_id, issues: parsed.error.issues.length },
        '[cms-brand-tokens] stored set no longer matches the schema; ignored',
      );
      return { tokens: null, version: row.version };
    }
    return { tokens: parsed.data, version: row.version };
  }

  private async assertChannelExists(salesChannelId: string): Promise<void> {
    // The kernel's own entity, the sanctioned access to its table (D-87).
    const channel = await this.options
      .emFactory()
      .findOne(SalesChannel, { id: salesChannelId }, { fields: ['id'] });
    if (!channel) {
      throw new HttpError(404, ERROR_CODES.UNKNOWN_SALES_CHANNEL, 'Sales channel not found.');
    }
  }

  /** Not awaited: the save has answered, and a slow storefront is not the operator's wait. */
  private revalidateAfterCommit(): void {
    const revalidate = this.options.revalidateStorefront;
    if (!revalidate) return;
    void Promise.resolve()
      .then(() => revalidate([CMS_STOREFRONT_CACHE_TAGS.brand]))
      .catch((err: unknown) => {
        this.logger?.warn({ err }, '[cms-brand-tokens] storefront revalidation failed');
      });
  }
}
