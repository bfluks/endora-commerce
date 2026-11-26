import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec 193 (T064; threat model TM-10) — every writer of the channel-product bridge.
 *
 * The website rule's governor (research R-10) sits inside `SalesChannelMembershipService`, the
 * single mutator of the bridges (Principle XII). A statement that writes `sales_channel_products`
 * anywhere else bypasses it: a product joins or leaves a governed channel without the rule's say.
 * This test reads every TypeScript source under `packages/**` and `backend/src/**` for a write
 * statement naming the table — literally, or through a registered bridge's table name
 * (`bridge.table`, `registration.table`, any `${….table}`, `bridgeTable`) —
 * and compares the files with the ledger below, **in both directions**: an unlisted writer fails,
 * and so does a listed one that no longer writes, so the ledger cannot go stale.
 *
 * A ledger entry other than the membership service is a known bypass, stated with its reason.
 */

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const ROOTS = [join(REPO, 'packages'), join(REPO, 'backend/src')];

const WRITERS: Readonly<Record<string, string>> = {
  'packages/platform/src/kernel/sales-channels/sales-channel-membership.service.ts':
    'The single mutator; the membership governor is applied here (R-10).',
  'packages/modules/sales_channels/src/backend/services/sales-channels.service.ts':
    'Channel delete rebinds orphans to the default only after the membership port confirms the ' +
    'default is not governed for `product` (spec 193 T100); non-product bridges are never governed.',
  'packages/demo-composition/src/composition.ts':
    'The demo seed bridges its own demo products to the demo channels at seed time; a seed, not a ' +
    'runtime writer, and it runs on a demo instance only.',
};

/** A write statement whose target is the product bridge, by name or through a bridge registration. */
const WRITE = /\b(?:insert\s+into|delete\s+from|update)\s+"?(?:sales_channel_products\b|\$\{\s*[\w.]*(?:\.table|bridgeTable)\s*\})/i;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Migrations create the table; they are schema, not writers.
      if (entry.name === 'migrations') continue;
      sources(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('channel-product bridge writers (spec 193, T064, TM-10)', () => {
  const found = ROOTS.flatMap((root) => sources(root))
    .filter((path) => WRITE.test(readFileSync(path, 'utf8')))
    .map((path) => relative(REPO, path).split('\\').join('/'))
    .sort();

  it('the pattern sees a literal and a registered-bridge write, and not a read', () => {
    expect(WRITE.test('`insert into "sales_channel_products" ("sales_channel_id", "product_id")`')).toBe(true);
    expect(WRITE.test('`delete from sales_channel_products where product_id in`')).toBe(true);
    expect(WRITE.test('`insert into "${bridge.table}" ("sales_channel_id", …)`')).toBe(true);
    expect(WRITE.test('`insert into "${o.bridgeTable}" ("sales_channel_id", …)`')).toBe(true);
    expect(WRITE.test('`delete from "${registration.table}" where …`')).toBe(true);
    expect(WRITE.test('`update ${entry.table} set …`')).toBe(true);
    expect(WRITE.test('`select "product_id" from "sales_channel_products" where …`')).toBe(false);
  });

  it('every writer is in the ledger', () => {
    expect(found.filter((path) => !(path in WRITERS))).toEqual([]);
  });

  it('every ledger entry still writes (two-way)', () => {
    expect(Object.keys(WRITERS).filter((path) => !found.includes(path)).sort()).toEqual([]);
  });
});
