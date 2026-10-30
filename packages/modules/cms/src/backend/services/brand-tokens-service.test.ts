import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { DEFAULT_BRAND_TOKENS, ERROR_CODES, type CmsBrandTokens } from '@endora-commerce/contracts';
import { CmsBrandTokensService } from './brand-tokens-service.js';

/**
 * Feature 163 (T018) — the brand-token service, held without a database.
 *
 * What the audit entry contains once it reaches the table, the 409 on the wire
 * and the cross-channel read are the contract suite's questions
 * (`backend/test/contract/cms/brand-tokens.contract.test.ts`). This file holds
 * the ordering a database cannot show: one read query, the version check before
 * any write, and revalidation only after a commit.
 */

const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

function tokensWith(primary: string): CmsBrandTokens {
  return { ...DEFAULT_BRAND_TOKENS, colors: { ...DEFAULT_BRAND_TOKENS.colors, primary } };
}

interface StoredRow {
  sales_channel_id: string | null;
  tokens: CmsBrandTokens;
  version: number;
}

/** An EntityManager that answers the service's reads and remembers its writes. */
function fakeEm(rows: StoredRow[]): {
  em: EntityManager;
  reads: string[];
  writes: string[];
} {
  const reads: string[] = [];
  const writes: string[] = [];
  const em = {
    execute: async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        // `insert … on conflict do nothing returning id` answers the row it wrote.
        return /^\s*insert\b/i.test(sql) ? [{ id: 'inserted' }] : [];
      }
      reads.push(sql);
      // The scope-row read inside the Command names one scope; the effective
      // read names the channel and the global row together.
      if (/for update/i.test(sql)) {
        const channel = params[0] ?? null;
        return rows.filter((row) => row.sales_channel_id === channel);
      }
      const channel = params[0] ?? null;
      return rows.filter((row) => row.sales_channel_id === null || row.sales_channel_id === channel);
    },
    findOne: async () => ({ id: CHANNEL_ID }),
  };
  return { em: em as unknown as EntityManager, reads, writes };
}

function harness(
  rows: StoredRow[] = [],
  options: { failAfterRun?: boolean; revalidate?: (tags: string[]) => Promise<void> } = {},
) {
  const ambient = fakeEm(rows);
  const transactional = fakeEm(rows);
  const commands: Array<{ action: string; objectType: string; objectId: string }> = [];
  const outcomes: Array<{ before?: unknown; after?: unknown; skipAudit?: boolean | undefined }> = [];

  const commandBus = {
    run: async <T>(command: Command<T>): Promise<T> => {
      commands.push({
        action: command.action,
        objectType: command.objectType,
        objectId: command.objectId,
      });
      const outcome = await command.run({
        em: transactional.em,
        actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' },
      });
      outcomes.push({ before: outcome.before, after: outcome.after, skipAudit: outcome.skipAudit });
      // A commit that fails after the write ran: the bus rolls back and throws.
      if (options.failAfterRun) throw new Error('commit failed');
      return outcome.result;
    },
  } as unknown as CommandBus;

  const revalidate = vi.fn(options.revalidate ?? (async () => {}));
  const warn = vi.fn();
  const service = new CmsBrandTokensService({
    emFactory: () => ambient.em,
    commandBus,
    revalidateStorefront: revalidate,
  });
  service.setLogger({ warn });
  return { service, commands, outcomes, ambient, transactional, revalidate, warn };
}

/** Revalidation is fire-and-forget after the commit; let it settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CmsBrandTokensService.read', () => {
  it('answers the channel row first, in one query', async () => {
    const h = harness([
      { sales_channel_id: null, tokens: tokensWith('#111111'), version: 2 },
      { sales_channel_id: CHANNEL_ID, tokens: tokensWith('#222222'), version: 5 },
    ]);

    const read = await h.service.read(CHANNEL_ID);

    expect(read.effective.colors.primary).toBe('#222222');
    expect(read.global).toEqual({ tokens: tokensWith('#111111'), version: 2 });
    expect(read.channel).toEqual({
      salesChannelId: CHANNEL_ID,
      tokens: tokensWith('#222222'),
      version: 5,
    });
    expect(h.ambient.reads).toHaveLength(1);
  });

  it('falls back to the global row when the channel has none', async () => {
    const h = harness([{ sales_channel_id: null, tokens: tokensWith('#111111'), version: 2 }]);

    const read = await h.service.read(CHANNEL_ID);

    expect(read.effective.colors.primary).toBe('#111111');
    expect(read.channel).toEqual({ salesChannelId: CHANNEL_ID, tokens: null, version: 0 });
    expect(h.ambient.reads).toHaveLength(1);
  });

  it('falls back to the built-in defaults when nothing is stored', async () => {
    const h = harness([]);

    const read = await h.service.read(null);

    expect(read.effective).toEqual(DEFAULT_BRAND_TOKENS);
    expect(read.global).toEqual({ tokens: null, version: 0 });
    expect(read.channel).toBeNull();
    expect(h.ambient.reads).toHaveLength(1);
  });
});

describe('CmsBrandTokensService.update — the `cms.brand_tokens.update` Command', () => {
  it('writes the scope row on the Command manager, with the state on both sides', async () => {
    const h = harness([{ sales_channel_id: null, tokens: tokensWith('#111111'), version: 2 }]);

    const result = await h.service.update({ kind: 'all' }, tokensWith('#333333'), 2);

    expect(h.commands).toEqual([
      { action: 'cms.brand_tokens.update', objectType: 'cms_brand_tokens', objectId: 'global' },
    ]);
    expect(h.transactional.writes).toEqual(['update cms_brand_tokens set']);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes[0]?.before).toMatchObject({ version: 2, tokens: tokensWith('#111111') });
    expect(h.outcomes[0]?.after).toMatchObject({ version: 3, tokens: tokensWith('#333333') });
    expect(result.version).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it('names the channel as the audited object for a channel scope', async () => {
    const h = harness([]);

    await h.service.update({ kind: 'channel', salesChannelId: CHANNEL_ID }, tokensWith('#333333'), 0);

    expect(h.commands[0]).toMatchObject({ objectType: 'cms_brand_tokens', objectId: CHANNEL_ID });
    expect(h.transactional.writes).toEqual(['insert into cms_brand_tokens']);
  });

  it('refuses a stale version with the version conflict, before writing anything', async () => {
    const h = harness([{ sales_channel_id: null, tokens: tokensWith('#111111'), version: 4 }]);

    await expect(h.service.update({ kind: 'all' }, tokensWith('#333333'), 3)).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
    });

    expect(h.transactional.writes).toEqual([]);
    expect(h.ambient.writes).toEqual([]);
    expect(h.outcomes).toEqual([]);
    await settle();
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it('removes a channel override when the tokens are null', async () => {
    const h = harness([{ sales_channel_id: CHANNEL_ID, tokens: tokensWith('#222222'), version: 1 }]);

    const result = await h.service.update({ kind: 'channel', salesChannelId: CHANNEL_ID }, null, 1);

    expect(h.transactional.writes).toEqual(['delete from cms_brand_tokens']);
    expect(h.outcomes[0]?.after).toBeNull();
    expect(result.version).toBe(0);
  });

  it('revalidates the storefront brand tag once, after the commit', async () => {
    const h = harness([]);

    await h.service.update({ kind: 'all' }, tokensWith('#333333'), 0);
    await settle();

    expect(h.revalidate).toHaveBeenCalledTimes(1);
    expect(h.revalidate).toHaveBeenCalledWith(['cms:brand']);
  });

  it('logs a failing revalidation and still answers the save', async () => {
    const h = harness([], {
      revalidate: async () => {
        throw new Error('storefront unreachable');
      },
    });

    await expect(h.service.update({ kind: 'all' }, tokensWith('#333333'), 0)).resolves.toMatchObject({
      version: 1,
    });
    await settle();

    expect(h.revalidate).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it('calls no revalidation for a rolled-back Command', async () => {
    const h = harness([], { failAfterRun: true });

    await expect(h.service.update({ kind: 'all' }, tokensWith('#333333'), 0)).rejects.toThrow(
      'commit failed',
    );
    await settle();

    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it('returns the contrast findings of the saved set', async () => {
    const h = harness([]);
    const lowContrast: CmsBrandTokens = {
      ...DEFAULT_BRAND_TOKENS,
      schemes: {
        ...DEFAULT_BRAND_TOKENS.schemes,
        dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, background: '#000000', text: '#555555' },
      },
    };

    const result = await h.service.update({ kind: 'all' }, lowContrast, 0);

    expect(result.warnings.map((w) => w.pair)).toContain('schemes.dark.text/background');
  });
});
