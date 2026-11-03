import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { effectiveSystemText, overrideLanguages, type OverrideRow } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { effectiveTextSql } from '../../../../packages/modules/catalog/dist/backend/services/effective-value.sql.js';

/**
 * Feature 163, Phase 8 (T057) — `effectiveTextSql` equals #384's walk
 * (`effectiveSystemText` over `channelOverrideFor`, with the storefront's
 * baseline pick) over a grid: an override at (C, L) for the request language,
 * for a later language of the chain, for the baseline's first key only, and
 * channel-only; a baseline present or absent per leg; another channel's rows;
 * empty values. The expectation is derived from the TypeScript, never written
 * out.
 */

const CHANNEL_DEFAULT = 'pl-PL';

let db: TestDb;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

/** The storefront's baseline pick (`catalog-query.service.ts` `pickLang`). */
function pickLang(blob: Record<string, string>, preferred: string | undefined): string {
  for (const lang of [preferred, CHANNEL_DEFAULT, 'en-US', 'en'].filter((v): v is string => typeof v === 'string')) {
    const hit = blob[lang];
    if (hit) return hit;
  }
  const anyKey = Object.keys(blob)[0];
  return anyKey ? (blob[anyKey] ?? '') : '';
}

async function insertChannel(em: EntityManager): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
     values (?, ?, '{"en-US":"parity"}'::jsonb, 'pl-PL', '["pl-PL","en-US","de-DE"]'::jsonb, 'PLN', now(), now())`,
    [id, `ep163-${id.slice(0, 8)}`],
  );
  return id;
}

const BASELINES: Array<Record<string, string>> = [
  { 'pl-PL': 'Nazwa', 'en-US': 'Name' },
  { 'en-US': 'Name' },
  { 'de-DE': 'Name DE' },
  { 'pl-PL': '', 'en-US': 'Name' },
  {},
];
type Slot = string | null; // language, or null = channel-only
const OVERRIDE_SETS: Array<Array<{ slot: Slot; value: unknown; other?: boolean }>> = [
  [],
  [{ slot: 'pl-PL', value: 'Override PL' }],
  [{ slot: 'en-US', value: 'Override EN' }],
  [{ slot: null, value: 'Override channel' }],
  [{ slot: 'de-DE', value: 'Override DE' }],
  [{ slot: 'pl-PL', value: '' }, { slot: null, value: 'Override channel' }],
  [{ slot: 'pl-PL', value: 'Other channel', other: true }],
  [{ slot: 'en-US', value: 'Override EN' }, { slot: null, value: 'Override channel' }],
];
const PREFERRED: Array<string | undefined> = ['pl-PL', 'en-US', 'de-DE', undefined];

describe('163 — effectiveTextSql ≡ #384 walk [integration]', () => {
  it('equals effectiveSystemText over the grid', async () => {
    const em = db.em();
    const channelId = await insertChannel(em);
    const otherChannelId = await insertChannel(em);
    const products: Array<{ id: string; name: Record<string, string>; rows: OverrideRow[] }> = [];
    for (const name of BASELINES) {
      for (const set of OVERRIDE_SETS) {
        const id = randomUUID();
        await em.execute(
          `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
           values (?, ?, ?, 'simple', 'active', ?::jsonb, '{}', now(), now())`,
          [id, `EP163-${id.slice(0, 8)}`, `ep163-${id.slice(0, 8)}`, JSON.stringify(name)],
        );
        const rows: OverrideRow[] = [];
        for (const o of set) {
          const rowChannel = o.other ? otherChannelId : channelId;
          await em.execute(
            `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
             values (?, ?, 'name', ?, ?, ?::jsonb, now(), now())`,
            [randomUUID(), id, rowChannel, o.slot, JSON.stringify({ v: o.value })],
          );
          rows.push({ attributeKey: 'name', channelId: rowChannel, languageCode: o.slot, value: { v: o.value } });
        }
        products.push({ id, name, rows });
      }
    }

    for (const preferred of PREFERRED) {
      const languages = overrideLanguages(preferred, CHANNEL_DEFAULT);
      const pickLanguages = [preferred, CHANNEL_DEFAULT, 'en-US', 'en'].filter((v): v is string => typeof v === 'string');
      const expr = effectiveTextSql('name', { channelId, languages }, pickLanguages);
      const ids = products.map((p) => p.id);
      const rows = await em.execute<Array<{ id: string; v: string }>>(
        `select p.id::text as id, ${expr.sql('p')} as v from products p where p.id in (${ids.map(() => '?').join(',')})`,
        [...expr.params, ...ids],
      );
      const byId = new Map(rows.map((r) => [r.id, r.v]));
      // The baseline as the driver parsed it — the order the walk's "first key" reads.
      const stored = await em.execute<Array<{ id: string; name: Record<string, string> }>>(
        `select p.id::text as id, p.name from products p where p.id in (${ids.map(() => '?').join(',')})`,
        ids,
      );
      const nameOf = new Map(stored.map((r) => [r.id, r.name]));
      for (const p of products) {
        const name = nameOf.get(p.id)!;
        const want = effectiveSystemText(p.rows, 'name', { channelId, languages }, name, pickLang(name, preferred));
        expect(byId.get(p.id), `${JSON.stringify(p.name)} ${JSON.stringify(p.rows)} preferred=${preferred}`).toBe(want);
      }
    }
  });
});
