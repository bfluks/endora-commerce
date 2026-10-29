import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  assertProductChannelMembers,
  loadAttachmentPackagingScopedFields,
  mirrorTranslationRemovals,
} from './attachment-packaging-scopes.js';

/**
 * Feature 163 (FR-078, FR-079, FR-080, FR-081; data-model §8) — the pieces of the
 * attachment and packaging-unit scope writes that need no database.
 */
describe('mirrorTranslationRemovals', () => {
  it('names every language either side names, "" where a side has none, so re-sending either restores it', () => {
    const before: Record<string, unknown> = { nameTranslations: { 'pl-PL': 'Karton' }, other: 1 };
    const after: Record<string, unknown> = { nameTranslations: { 'de-DE': 'Kiste' }, other: 2 };
    mirrorTranslationRemovals(before, after, ['nameTranslations']);
    expect(before['nameTranslations']).toEqual({ 'pl-PL': 'Karton', 'de-DE': '' });
    expect(after['nameTranslations']).toEqual({ 'de-DE': 'Kiste', 'pl-PL': '' });
    expect(before['other']).toBe(1);
  });

  it('leaves both sides alone where they name the same languages', () => {
    const before: Record<string, unknown> = { nameTranslations: { pl: 'a' }, descriptionTranslations: {} };
    const after: Record<string, unknown> = { nameTranslations: { pl: 'b' }, descriptionTranslations: {} };
    mirrorTranslationRemovals(before, after, ['nameTranslations', 'descriptionTranslations']);
    expect(before).toEqual({ nameTranslations: { pl: 'a' }, descriptionTranslations: {} });
    expect(after).toEqual({ nameTranslations: { pl: 'b' }, descriptionTranslations: {} });
  });
});

describe('assertProductChannelMembers', () => {
  const membership = {
    listChannelsForEntity: vi.fn(async () => [{ id: 'b2b' }, { id: 'b2c' }]),
  };

  it('passes when every channel is one the product is a member of', async () => {
    await expect(assertProductChannelMembers(membership as never, 'p1', ['b2b'])).resolves.toBeUndefined();
  });

  it('refuses the first outside channel with 422 SCOPE_INVALID not_a_member (FR-014)', async () => {
    await expect(assertProductChannelMembers(membership as never, 'p1', ['b2b', 'outside'])).rejects.toMatchObject({
      statusCode: 422,
      code: 'SCOPE_INVALID',
      details: { channelId: 'outside', reason: 'not_a_member' },
    });
  });

  it('asks nothing for an empty set (clearing is always allowed, FR-015)', async () => {
    membership.listChannelsForEntity.mockClear();
    await expect(assertProductChannelMembers(membership as never, 'p1', [])).resolves.toBeUndefined();
    expect(membership.listChannelsForEntity).not.toHaveBeenCalled();
  });

  it('fails loudly when the membership port is not wired', async () => {
    await expect(assertProductChannelMembers(undefined, 'p1', ['b2b'])).rejects.toThrow(/not wired/);
  });
});

describe('loadAttachmentPackagingScopedFields', () => {
  it('reads the four overview fields of one product in one statement (T139b)', async () => {
    const statements: string[] = [];
    const em = {
      execute: async (sql: string) => {
        statements.push(sql);
        return [
          { field: 'attachments:hidden', channel_id: 'b2c', language_code: null },
          { field: 'attachments:name', channel_id: null, language_code: 'pl-PL' },
          { field: 'packagingUnits:name', channel_id: null, language_code: 'de-DE' },
        ];
      },
    } as unknown as EntityManager;
    const fields = await loadAttachmentPackagingScopedFields(em, 'p1');
    expect(statements).toHaveLength(1);
    for (const table of ['product_attachment_channel_hidden', 'product_attachments', 'product_packaging_units']) {
      expect(statements[0]).toContain(table);
    }
    expect(statements[0]).toContain("'attachments:description'");
    expect(fields).toEqual([
      { field: 'attachments:hidden', channelId: 'b2c', languageCode: null },
      { field: 'attachments:name', channelId: null, languageCode: 'pl-PL' },
      { field: 'packagingUnits:name', channelId: null, languageCode: 'de-DE' },
    ]);
  });
});
