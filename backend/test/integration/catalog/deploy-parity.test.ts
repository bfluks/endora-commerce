import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CatalogProductAvailabilityPort,
  type ProductAudience,
  type ScopeChannel,
} from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Migration20261025T222634CatalogProductStatusDropDraft } from '@endora-commerce/mod-catalog/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { testChannelBridges } from '../../helpers/channel-bridges.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import {
  ProductAvailabilityService,
  availableAmong,
} from '../../../../packages/modules/catalog/dist/backend/services/product-availability.service.js';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { errorBodyOf } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 24 (T144) — deploy parity (FR-110, SC-001, SC-009).
 *
 * A database deployed before this feature holds no scope rows, no window, no URL key
 * and no channel-scoped SEO row — every migration of the feature is additive except
 * the Q1 status migration (`20261025T222634_catalog_product_status_drop_draft`), which
 * maps `draft` → `inactive` and archives today's `inactive` products. So on such a
 * dataset, the sets a buyer reaches — listed, searchable, reachable by URL, in the
 * sitemap, in a feed — per channel × language must be what the pre-feature rules gave,
 * except the *Intended behaviour changes* of `plan.md`:
 *
 *  1. an off, non-archived product (yesterday's `draft`) is not addable to a basket;
 *  2. it is not reachable by URL (yesterday a `draft` member answered 200);
 *  3. listing name sort follows the effective name, not the slug;
 *  4. existing per-language SEO overrides are served (asserted by the SEO page tests,
 *     `contract/catalog/product-seo-scoped.test.ts`; nothing here seeds one);
 *  7. an archived product answers 410 only where it would be available with the archive
 *     taken away (T036's deviation, security checkpoints A and B), and the absent
 *     product's 404 elsewhere (a non-member, a caller outside its audience) — before,
 *     `getProductByIdOrSlug` answered 410 to every `inactive` product before it checked
 *     the channel or the audience;
 *  8. an archived product is not addable to a basket — basket add tested no status at
 *     all (R0 F1), so yesterday's `inactive` products were addable too; item 1 names the
 *     `draft` half.
 *
 * Items 7 and 8 were found by this test and accepted by the owner on 2026-10-27 (spec
 * Clarifications, Session 2026-10-27).
 *
 * Part A runs the Q1 migration itself — its own `down`, a pre-feature dataset, its
 * `up` — inside one transaction the test rolls back (the backfill is table-wide; see
 * `product-status-drop-draft-migration.test.ts`, T156b, which covers the migration's
 * row mapping in detail), and holds the pre-feature predicates, restated over the rows
 * as stored before `up`, against the shipped availability port after it. Part B reads
 * the HTTP surfaces on the booted server over a dataset in the shape such a database
 * has after the migrations.
 */

const NOW = new Date('2031-06-15T12:00:00.000Z');
const ORG_X = '7a000000-0000-4000-8000-00000000000a';
const ANONYMOUS: ProductAudience = { organizationId: null, authenticated: false };
const ORG_X_BUYER: ProductAudience = { organizationId: ORG_X, authenticated: true };

describe('163 — deploy parity across the Q1 status migration [integration]', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  function migration(): Migration20261025T222634CatalogProductStatusDropDraft {
    return new Migration20261025T222634CatalogProductStatusDropDraft(em.getDriver(), em.config);
  }

  async function run(direction: 'up' | 'down'): Promise<void> {
    const m = migration();
    await m[direction]();
    for (const query of m.getQueries()) await em.execute(query as unknown as string);
    em.clear();
  }

  /** One pre-feature product: its stored status, archive, audience and channels. */
  interface Seed {
    label: string;
    status: 'active' | 'draft' | 'inactive';
    archived: boolean;
    visibility: 'public' | 'logged_in_only' | 'organization_restricted';
    member: boolean;
  }

  const SEEDS: readonly Seed[] = [
    { label: 'active', status: 'active', archived: false, visibility: 'public', member: true },
    { label: 'active, logged-in only', status: 'active', archived: false, visibility: 'logged_in_only', member: true },
    { label: 'active, org X only', status: 'active', archived: false, visibility: 'organization_restricted', member: true },
    { label: 'active, non-member', status: 'active', archived: false, visibility: 'public', member: false },
    { label: 'draft', status: 'draft', archived: false, visibility: 'public', member: true },
    { label: 'draft, org X only', status: 'draft', archived: false, visibility: 'organization_restricted', member: true },
    { label: 'inactive, archived', status: 'inactive', archived: true, visibility: 'public', member: true },
    { label: 'inactive', status: 'inactive', archived: false, visibility: 'public', member: true },
    { label: 'inactive, org X only', status: 'inactive', archived: false, visibility: 'organization_restricted', member: true },
    { label: 'inactive, non-member', status: 'inactive', archived: false, visibility: 'public', member: false },
  ];

  const UPDATED_AT = '2026-03-04T05:06:07.000Z';
  const ARCHIVED_AT = '2026-01-02T03:04:05.000Z';

  async function seed(): Promise<{ channel: ScopeChannel; byLabel: Map<string, string> }> {
    const channelId = randomUUID();
    await em.execute(
      `insert into "sales_channels" ("id", "code", "name", "default_language", "languages", "default_currency", "created_at", "updated_at")
       values (?, ?, '{"en-US":"T144"}'::jsonb, 'pl-PL', '["pl-PL","en-US"]'::jsonb, 'PLN', now(), now())`,
      [channelId, `t144-${channelId.slice(0, 8)}`],
    );
    const byLabel = new Map<string, string>();
    for (const s of SEEDS) {
      const id = randomUUID();
      const stamp = id.slice(0, 8);
      await em.execute(
        `insert into "products" ("id", "sku", "slug", "type", "status", "archived_at", "name", "description",
                                 "visibility", "allowed_organization_ids", "created_at", "updated_at")
         values (?, ?, ?, 'simple', ?, ?, '{"en-US":"Parity","pl-PL":"Parytet"}', '{}', ?, ?::jsonb, now(), ?)`,
        [
          id,
          `T144-${stamp}`,
          `t144-${stamp}`,
          s.status,
          s.archived ? ARCHIVED_AT : null,
          s.visibility,
          JSON.stringify(s.visibility === 'organization_restricted' ? [ORG_X] : []),
          UPDATED_AT,
        ],
      );
      if (s.member) {
        await em.execute(`insert into "sales_channel_products" ("sales_channel_id", "product_id") values (?, ?)`, [
          channelId,
          id,
        ]);
      }
      byLabel.set(s.label, id);
    }
    return { channel: { id: channelId, languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' }, byLabel };
  }

  /** The pre-feature audience rule for the three shapes seeded here. */
  function visibleBefore(s: Seed, audience: ProductAudience): boolean {
    if (s.visibility === 'public') return true;
    if (s.visibility === 'logged_in_only') return audience.authenticated;
    return audience.organizationId === ORG_X;
  }

  /** The pre-feature rules, restated over the rows as stored before `up`. */
  const before = {
    /** Listing, facets, sitemap and feeds: `status = 'active'` + membership + audience. */
    listed: (s: Seed, audience: ProductAudience) => s.status === 'active' && s.member && visibleBefore(s, audience),
    /** The indexer's `isPublishable`: active, not archived, a member — no audience (the index filters it). */
    searchable: (s: Seed) => s.status === 'active' && !s.archived && s.member,
    /** The product page: 410 on `inactive` before any other test; else 200 when member + audience (draft included). */
    page: (s: Seed, audience: ProductAudience): 200 | 404 | 410 => {
      if (s.status === 'inactive') return 410;
      return s.member && visibleBefore(s, audience) ? 200 : 404;
    },
  };

  it('keeps every listed and searchable set, per channel × language × buyer, and the product pages but for the intended changes', async () => {
    await run('down');
    const { channel, byLabel } = await seed();
    const seeds = new Map(SEEDS.map((s) => [byLabel.get(s.label)!, s]));
    const ids = [...seeds.keys()];
    // The pre-feature status set is what was stored: `down` re-allows `draft`.
    const stored = (await em.execute(`select "id", "status" from "products" where "id" = any(?::uuid[])`, [
      `{${ids.join(',')}}`,
    ])) as Array<{ id: string; status: string }>;
    for (const row of stored) expect(row.status, seeds.get(row.id)!.label).toBe(seeds.get(row.id)!.status);

    await run('up');

    const membership = new SalesChannelMembershipService(() => em, new EventBus(), undefined, testChannelBridges());
    const port = new ProductAvailabilityService(() => em, membership, {
      getById: async (id: string) =>
        id === channel.id
          ? ({ id: channel.id, languages: [...channel.languages], defaultLanguage: channel.defaultLanguage } as never)
          : null,
    } as never);
    const label = (set: Iterable<string>) => [...set].map((id) => seeds.get(id)!.label).sort();

    // Searchable: the projection the search documents carry.
    const described = await port.describeChannelAvailability(ids, channel.id);
    const searchable = ids.filter((id) => (described.get(id)?.liveLanguages.length ?? 0) > 0);
    expect(label(searchable)).toEqual(label(ids.filter((id) => before.searchable(seeds.get(id)!))));
    for (const id of searchable) {
      expect(described.get(id)!.liveLanguages, seeds.get(id)!.label).toEqual([...channel.languages]);
    }

    const products = await em.find(Product, { id: { $in: ids } });
    let comparisons = 0;
    for (const languageCode of channel.languages) {
      for (const audience of [ANONYMOUS, ORG_X_BUYER]) {
        const tag = `${languageCode}, ${audience.organizationId ? 'org X' : 'anonymous'}`;
        const after = await port.filterAvailable(ids, { channelId: channel.id, languageCode, audience, now: NOW });
        expect(label(after), `listed — ${tag}`).toEqual(label(ids.filter((id) => before.listed(seeds.get(id)!, audience))));

        // The page's 410 set, computed the way `assertReachable` computes it: archived,
        // and available with `archived_at` cleared and the global status read `active`.
        const asIfLive = products
          .filter((p) => p.archivedAt !== null && p.archivedAt !== undefined)
          .map((p) => ({ ...p, id: p.id, status: 'active' as const, archivedAt: null, deletedAt: null }));
        const gone = await availableAmong(em, membership, asIfLive as never, {
          channel,
          languageCode,
          audience,
          now: NOW,
        });
        for (const id of ids) {
          const s = seeds.get(id)!;
          const pageAfter: 200 | 404 | 410 = after.has(id) ? 200 : gone.has(id) ? 410 : 404;
          const pageBefore = before.page(s, audience);
          comparisons += 1;
          if (s.status === 'draft' && pageBefore === 200) {
            // Intended change 2: yesterday's `draft` member is not reachable by URL.
            expect(pageAfter, `${s.label} page — ${tag}`).toBe(404);
          } else if (pageBefore === 410 && !(s.member && visibleBefore(s, audience))) {
            // Intended change 7: 410 narrowed to where the product would be available.
            expect(pageAfter, `${s.label} page — ${tag}`).toBe(404);
          } else {
            expect(pageAfter, `${s.label} page — ${tag}`).toBe(pageBefore);
          }
        }
      }
    }
    expect(comparisons).toBe(SEEDS.length * 4);
  });

  it('leaves only active / inactive stored and every formerly inactive product archived (SC-009, O-4)', async () => {
    await run('down');
    const { byLabel } = await seed();
    await run('up');
    for (const table of ['products', 'product_channel_scopes', 'product_channel_language_scopes']) {
      const rows = (await em.execute(
        `select count(*)::int as n from "${table}" where "status" is not null and "status" not in ('active', 'inactive')`,
      )) as Array<{ n: number }>;
      expect(rows[0]!.n, table).toBe(0);
    }
    for (const s of SEEDS) {
      const rows = (await em.execute(`select "status", "archived_at" from "products" where "id" = ?`, [
        byLabel.get(s.label),
      ])) as Array<{ status: string; archived_at: Date | string | null }>;
      const row = rows[0]!;
      const archivedAt = row.archived_at === null ? null : new Date(row.archived_at).toISOString();
      if (s.status === 'inactive') {
        expect(row.status, s.label).toBe('inactive');
        expect(archivedAt, s.label).toBe(s.archived ? ARCHIVED_AT : UPDATED_AT);
      } else if (s.status === 'draft') {
        expect(row, s.label).toMatchObject({ status: 'inactive', archived_at: null });
      } else {
        expect(row, s.label).toMatchObject({ status: 'active', archived_at: null });
      }
    }
  });
});

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const RETAIL = 'pl_retail';

describe('163 — deploy parity on the buyer surfaces [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelIds: string[] = [];
  let languages: string[] = [];
  let retailId = '';
  /** Active, member — yesterday listed and reachable; names disagree with slugs (change 3). */
  let activeZ: MinimumProductFixture;
  let activeA: MinimumProductFixture;
  /** Yesterday's `draft`: `inactive`, not archived, member. */
  let formerDraft: MinimumProductFixture;
  /** Yesterday's `inactive`: archived, member. */
  let formerInactive: MinimumProductFixture;
  /** Yesterday's `inactive`, in no channel. */
  let formerInactiveElsewhere: MinimumProductFixture;
  /** Active, in no channel. */
  let nonMember: MinimumProductFixture;
  let feedCountBefore = 0;

  const ours = () => [activeZ, activeA, formerDraft, formerInactive, formerInactiveElsewhere, nonMember];
  const slug = (p: MinimumProductFixture) => p.sku.toLowerCase();
  const headers = (language: string) => ({ 'x-sales-channel': RETAIL, 'accept-language': language });
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);

  const completeActiveBaskets = () =>
    sql(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);

  async function feedCount(): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/feed-previews/selection',
      cookies: ADMIN,
      payload: { salesChannelId: retailId, selectionRule: { kind: 'all' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { matchedCount: number } }).data.matchedCount;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelIds = await buyerChannelIds(em);
    const retail = await em.findOneOrFail(SalesChannel, { code: RETAIL });
    retailId = retail.id;
    languages = [...new Set([retail.defaultLanguage, ...retail.languages])];
    feedCountBefore = await feedCount();

    const create = (label: string, name: string, channels: readonly string[]) =>
      createMinimumProduct(em, { sku: `S163-DP-${RUN}-${label}`, nameEn: name, namePl: name, channelIds: channels });
    // Slug order A < Z; name order the reverse ("Alpha" < "Zulu").
    activeA = await create('A', `Zulu ${RUN}`, channelIds);
    activeZ = await create('Z', `Alpha ${RUN}`, channelIds);
    formerDraft = await create('DRAFT', `Draft ${RUN}`, channelIds);
    formerInactive = await create('INACTIVE', `Inactive ${RUN}`, channelIds);
    formerInactiveElsewhere = await create('INACTIVE-N', `Inactive elsewhere ${RUN}`, []);
    nonMember = await create('NONMEMBER', `Non-member ${RUN}`, []);
    // The shape the Q1 migration leaves: `draft` → `inactive` not archived;
    // `inactive` → `inactive` archived (`archived_at` from `updated_at`).
    await sql(`update "products" set "status" = 'inactive', "archived_at" = null where "id" = ?`, [formerDraft.id]);
    await sql(`update "products" set "status" = 'inactive', "archived_at" = "updated_at" where "id" in (?, ?)`, [
      formerInactive.id,
      formerInactiveElsewhere.id,
    ]);
  });

  beforeEach(async () => {
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await teardownBackendServer(h);
  });

  it('lists, in every channel language, exactly what the pre-feature listing listed', async () => {
    for (const language of languages) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-DP-${RUN}`)}&limit=50`,
        headers: headers(language),
      });
      expect(res.statusCode, res.body).toBe(200);
      const listed = new Set((res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id));
      const mine = ours().filter((p) => listed.has(p.id)).map((p) => p.id).sort();
      expect(mine, `listed at ${RETAIL}/${language}`).toEqual([activeA.id, activeZ.id].sort());
    }
  });

  it('sorts by name by the name a card shows, not by slug (intended change 3)', async () => {
    for (const language of languages) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-DP-${RUN}`)}&sort=name&limit=50`,
        headers: headers(language),
      });
      expect(res.statusCode, res.body).toBe(200);
      const order = (res.json() as { data: Array<{ id: string }> }).data
        .map((p) => p.id)
        .filter((id) => id === activeA.id || id === activeZ.id);
      expect(order, `sort=name at ${language}`).toEqual([activeZ.id, activeA.id]);
    }
  });

  it('answers the product pages as before but for the intended changes', async () => {
    for (const language of languages) {
      const absent = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/s163-dp-absent-${RUN}`,
        headers: headers(language),
      });
      expect(absent.statusCode).toBe(404);
      const page = (p: MinimumProductFixture) =>
        h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${slug(p)}`, headers: headers(language) });

      expect((await page(activeA)).statusCode).toBe(200);
      expect((await page(activeZ)).statusCode).toBe(200);
      // Before 404 (not a member); after 404 — unchanged.
      const nm = await page(nonMember);
      expect(nm.statusCode).toBe(404);
      expect(errorBodyOf(nm)).toEqual(errorBodyOf(absent));
      // Before 410 (`inactive`); after 410 (archived, available with the archive taken away).
      const gone = await page(formerInactive);
      expect(gone.statusCode).toBe(410);
      expect((gone.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
      // Intended change 2 — before 200 (a `draft` member was reachable); after the absent 404.
      const draft = await page(formerDraft);
      expect(draft.statusCode).toBe(404);
      expect(errorBodyOf(draft)).toEqual(errorBodyOf(absent));
      // Intended change 7 — before 410 (`inactive` answered before the channel test); after
      // the absent 404, the product being in no channel.
      const elsewhere = await page(formerInactiveElsewhere);
      expect(elsewhere.statusCode).toBe(404);
      expect(errorBodyOf(elsewhere)).toEqual(errorBodyOf(absent));
    }
  });

  it('keeps the searchable set: the documents’ projection is live exactly for the active members', async () => {
    const port = (h.container.cradle as never as { catalogProductAvailabilityPort: CatalogProductAvailabilityPort })
      .catalogProductAvailabilityPort;
    const described = await port.describeChannelAvailability(
      ours().map((p) => p.id),
      retailId,
    );
    const live = ours()
      .filter((p) => (described.get(p.id)?.liveLanguages.length ?? 0) > 0)
      .map((p) => p.id)
      .sort();
    expect(live).toEqual([activeA.id, activeZ.id].sort());
  });

  it('keeps the sitemap: the active members, and nothing that was not listed', async () => {
    const regen = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
      cookies: ADMIN,
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(regen.statusCode, regen.body).toBe(200);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml', headers: { 'x-sales-channel': RETAIL } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`/p/${slug(activeA)}`);
    expect(res.body).toContain(`/p/${slug(activeZ)}`);
    for (const p of [formerDraft, formerInactive, formerInactiveElsewhere, nonMember]) {
      expect(res.body).not.toContain(`/p/${slug(p)}`);
    }
  });

  it('keeps the feed selection: the two active members join it, nothing else', async () => {
    expect(await feedCount()).toBe(feedCountBefore + 2);
  });

  it('refuses a basket add of an off product, archived or not (intended changes 1 and 8)', async () => {
    const add = (productId: string) =>
      h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: CUSTOMER, payload: { productId, quantity: 1 } });
    const absent = await add(randomUUID());
    expect(absent.statusCode).toBe(404);
    for (const p of [formerDraft, formerInactive]) {
      const res = await add(p.id);
      expect(res.statusCode, `${p.sku}: ${res.body}`).toBe(404);
      expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
    }
    const added = await add(activeA.id);
    expect(added.statusCode, added.body).toBeLessThan(300);
  });
});
