import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  createCrmOpportunity,
  removeCrmAssets,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';
import { deleteProjects } from '../projects/helpers.js';

/**
 * Switching an owner off neither exposes nor destroys its files
 * (`specs/166-asset-reference-visibility/` User Story 5, FR-009, FR-010,
 * SC-005, research R-4; Constitution XVII).
 *
 * For each restricted owner — Tasks, Projects, CRM — and on both axes
 * (`deactivated` while platform-available, and `platform-unavailable`, F-22),
 * a file used only by a record B and S **can** see while the owner is on:
 * - while off it is hidden from B and S and answers every read by id as a
 *   missing file, while W still sees it (FR-010);
 * - nobody can delete it, W included (FR-008 counts the switched-off owner's
 *   references);
 * - the library's list keeps answering — it never resolves the owner's gated
 *   code (R-4);
 * - a file of the same record **and** a CMS page stays visible (FR-001 b);
 * - switched back on, every reader's lists and details are the ones taken
 *   before, and no asset row was written.
 *
 * **Readers** (quickstart.md): B — reads and writes Tasks, Projects, CRM and
 * the library, without `tasks:see_private`, confined to Organization O2; S —
 * B's permissions plus `tasks:see_private`, reaching every Organization; W —
 * the Platform administrator (`*`), the **control**. A, who only differs from
 * S in authorship, and N, who sees no owner's record even while it is on, add
 * nothing an owner switched off could change, so they are not built here.
 */
type Owner = 'tasks' | 'projects' | 'crm';
const OWNERS: readonly Owner[] = ['tasks', 'projects', 'crm'];
/** Every owner on both axes, written out so `check:off-state-coverage` can read each subject. */
const CASES: ReadonlyArray<{ readonly owner: Owner; readonly axis: OffStateAxis }> = [
  { owner: 'tasks', axis: 'deactivated' },
  { owner: 'tasks', axis: 'platform-unavailable' },
  { owner: 'projects', axis: 'deactivated' },
  { owner: 'projects', axis: 'platform-unavailable' },
  { owner: 'crm', axis: 'deactivated' },
  { owner: 'crm', axis: 'platform-unavailable' },
];

describe('assets library — an owner switched off (feature 166, US5)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let B: Person;
  let S: Person;
  const W = { b2b_session: 'stub-admin-session' };
  const run = randomUUID().slice(0, 8);

  const task = randomUUID();
  const project = randomUUID();
  let opportunity: string;
  const cmsPages: string[] = [];

  /** Per owner: a file only its record uses, and one its record and a CMS page use. */
  const files = {} as Record<Owner, { only: string; rescued: string }>;
  let unused: string;
  const assetIds: string[] = [];

  const inject = (method: 'GET' | 'DELETE', url: string, cookies: Record<string, string>): Promise<LightMyRequestResponse> =>
    h.app.inject({ method, url, cookies });

  async function file(name: string): Promise<string> {
    const { id } = await seedCrmAsset(h.em(), { filename: `rvo-${run}-${name}.pdf` });
    assetIds.push(id);
    return id;
  }

  async function useBy(owner: Owner, assetId: string): Promise<void> {
    const conn = h.em().getConnection();
    switch (owner) {
      case 'tasks':
        await conn.execute(`insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
          task,
          assetId,
          TEST_ADMIN_ID,
        ]);
        return;
      case 'projects':
        await conn.execute(`insert into "project_attachments" ("project_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
          project,
          assetId,
          TEST_ADMIN_ID,
        ]);
        return;
      case 'crm':
        await conn.execute(
          `insert into "crm_opportunity_attachments" ("id", "opportunity_id", "asset_id", "file_name", "uploaded_by_admin_user_id", "created_at")
           values (?, ?, ?, ?, ?, now())`,
          [randomUUID(), opportunity, assetId, `rvo-${run}.pdf`, TEST_ADMIN_ID],
        );
        return;
    }
  }

  async function embedInCmsPage(assetId: string): Promise<void> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(`insert into cms_pages (id, path, name, content, created_at, updated_at) values (?, ?, ?, ?::jsonb, now(), now())`, [
        id,
        `rvo-${run}-${id.slice(0, 8)}`,
        `RVO ${id.slice(0, 8)}`,
        JSON.stringify({
          schema_version: 1,
          languages: { 'en-US': { root: { props: {} }, content: [{ type: 'LibraryImage', props: { assetId } }] } },
        }),
      ]);
    cmsPages.push(id);
  }

  /** Every id `GET /assets?q=rvo-<run>` lists, across pages. */
  async function listed(cookies: Record<string, string>): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const params = new URLSearchParams({ q: `rvo-${run}`, limit: '4', ...(cursor ? { cursor } : {}) });
      const response = await inject('GET', `/api/v1/admin/assets?${params.toString()}`, cookies);
      // R-4: the library never resolves the owner's gated code, so it never answers 503.
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as { data: Array<{ id: string }>; nextCursor: string | null };
      ids.push(...body.data.map((row) => row.id));
      cursor = body.nextCursor;
      if (cursor === null) return ids;
    }
    throw new Error('listed: more than 50 pages');
  }

  /** The answer with the asked id and the request id taken out: what must be equal byte for byte. */
  function normalised(response: LightMyRequestResponse, id: string): unknown {
    const body = JSON.parse(response.body.split(id).join('<id>')) as { error?: Record<string, unknown> };
    if (body.error) delete body.error.requestId;
    return { status: response.statusCode, body };
  }

  /** What each reader is answered: the list, and every file's detail. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [who, cookies] of [
      ['B', B.cookies],
      ['S', S.cookies],
      ['W', W],
    ] as const) {
      out[`${who} list`] = await listed(cookies);
      for (const id of assetIds) {
        const response = await inject('GET', `/api/v1/admin/assets/${id}`, cookies);
        // A private file's signed URL is minted per answer; its signature and expiry are not state.
        out[`${who} ${id}`] = JSON.parse(
          JSON.stringify(normalised(response, id)).replace(/token=[0-9a-f]+&exp=\d+/g, 'token=<signed>'),
        ) as unknown;
      }
    }
    return out;
  }

  async function rows(): Promise<unknown[]> {
    return h
      .em()
      .getConnection()
      .execute(
        `select id::text as id, updated_at, folder_id, deleted_at, permalink from assets where id = any(?::uuid[]) order by id`,
        [`{${assetIds.join(',')}}`],
      );
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const PERMISSIONS = [
      'tasks:read',
      'tasks:write',
      'projects:read',
      'projects:write',
      'crm:read',
      'crm:write',
      'assets.read',
      'assets.write',
    ];
    // O2: an Organization with a row behind it (Projects and CRM hold real foreign keys).
    const organizationO2 = await seedCrmOrganization(h.em(), 'rvo-o2');
    B = await seedCrmSalesRep(h.em(), [organizationO2], PERMISSIONS);
    S = await seedCrmAdmin(h.em(), 'rvo-s', [...PERMISSIONS, 'tasks:see_private']);

    const conn = h.em().getConnection();
    // A public Task, a Project open to everyone in O2, and an Opportunity of
    // O2: B and S see each of them while its module is on.
    await conn.execute(`insert into "tasks" ("id", "number", "title", "created_by_admin_user_id") values (?, ?, ?, ?)`, [
      task,
      `T-RVO-${run}`,
      `RVO ${run}`,
      TEST_ADMIN_ID,
    ]);
    const stageId = randomUUID();
    await conn.transactional(async (trx) => {
      await conn.execute(
        `insert into "projects" ("id", "number", "title", "visibility", "created_by_admin_user_id") values (?, ?, ?, 'everyone', ?)`,
        [project, `PRJ-RVO${run}`, `RVO ${run}`, TEST_ADMIN_ID],
        'run',
        trx,
      );
      await conn.execute(
        `insert into "project_stages" ("id", "project_id", "name", "color", "position") values (?, ?, 'Design', '#3b82f6', 1)`,
        [stageId, project],
        'run',
        trx,
      );
      await conn.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, project], 'run', trx);
      await conn.execute(
        `insert into "project_organizations" ("project_id", "organization_id") values (?, ?)`,
        [project, organizationO2],
        'run',
        trx,
      );
    });
    opportunity = (await createCrmOpportunity(h, { organizationId: organizationO2 })).id;

    unused = await file('unused');
    for (const owner of OWNERS) {
      const only = await file(`${owner}-only`);
      const rescued = await file(`${owner}-rescued`);
      await useBy(owner, only);
      await useBy(owner, rescued);
      await embedInCmsPage(rescued);
      files[owner] = { only, rescued };
    }
  });

  afterAll(async () => {
    const conn = h.em().getConnection();
    if (cmsPages.length > 0) await conn.execute(`delete from cms_pages where id = any(?::uuid[])`, [`{${cmsPages.join(',')}}`]);
    await conn.execute(`delete from "tasks" where "id" = ?`, [task]);
    await deleteProjects(h, [project]);
    await removeCrmAssets(h.em(), assetIds);
    for (const person of [B, S]) person?.undo();
    await teardownBackendServer(h);
  });

  it('the control: while every owner is on, B, S and W list and open every file', async () => {
    for (const [who, cookies] of [
      ['B', B.cookies],
      ['S', S.cookies],
      ['W', W],
    ] as const) {
      expect([...(await listed(cookies))].sort(), who).toEqual([...assetIds].sort());
      for (const id of assetIds) {
        const response = await inject('GET', `/api/v1/admin/assets/${id}`, cookies);
        expect(response.statusCode, `${who} ${id}: ${response.body}`).toBe(200);
      }
    }
  });

  it.each(CASES)('$owner $axis: its file is hidden from B and S — absent from the list, by id a missing file — and present for W', async (c) => {
    const target = files[c.owner].only;
    await withModuleOff(c.owner, c.axis, async () => {
      for (const [who, cookies] of [
        ['B', B.cookies],
        ['S', S.cookies],
      ] as const) {
        const list = await listed(cookies);
        expect(list, `${who} list`).not.toContain(target);
        expect(list, `${who} list keeps the unused file`).toContain(unused);
        for (const path of ['', '/url']) {
          const missing = randomUUID();
          const hidden = await inject('GET', `/api/v1/admin/assets/${target}${path}`, cookies);
          const none = await inject('GET', `/api/v1/admin/assets/${missing}${path}`, cookies);
          expect(none.statusCode).toBe(404);
          expect(normalised(hidden, target), `${who} GET /assets/:id${path}`).toEqual(normalised(none, missing));
        }
      }
      expect(await listed(W)).toContain(target);
      const forW = await inject('GET', `/api/v1/admin/assets/${target}`, W);
      expect(forW.statusCode, forW.body).toBe(200);
    });
  });

  it.each(CASES)('$owner $axis: nobody can delete its file, W included', async (c) => {
    const target = files[c.owner].only;
    await withModuleOff(c.owner, c.axis, async () => {
      for (const [who, cookies] of [
        ['B', B.cookies],
        ['S', S.cookies],
      ] as const) {
        const missing = randomUUID();
        const hidden = await inject('DELETE', `/api/v1/admin/assets/${target}`, cookies);
        const none = await inject('DELETE', `/api/v1/admin/assets/${missing}`, cookies);
        expect(normalised(hidden, target), `${who} DELETE`).toEqual(normalised(none, missing));
      }
      const forW = await inject('DELETE', `/api/v1/admin/assets/${target}`, W);
      expect(forW.statusCode, forW.body).toBe(409);
      expect((forW.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ASSET_REFERENCED);
    });
    const [row] = (await rows()).filter((r) => (r as { id: string }).id === target) as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at ?? null).toBeNull();
  });

  it.each(CASES)('$owner $axis: a file of its record and a CMS page stays visible to B, and its delete names the page only', async (c) => {
    const target = files[c.owner].rescued;
    await withModuleOff(c.owner, c.axis, async () => {
      expect(await listed(B.cookies)).toContain(target);
      const shown = await inject('GET', `/api/v1/admin/assets/${target}`, B.cookies);
      expect(shown.statusCode, shown.body).toBe(200);
      const references = (shown.json() as { data: { references: Array<{ kind: string }> } }).data.references;
      expect(references.map((r) => r.kind)).toEqual(['cms_body_embed']);
      const refused = await inject('DELETE', `/api/v1/admin/assets/${target}`, B.cookies);
      expect(refused.statusCode, refused.body).toBe(409);
      expect((refused.json() as { error: { details: Array<{ path: string }> } }).error.details.map((d) => d.path)).toEqual([
        'cms_body_embed',
      ]);
    });
  });

  it.each(CASES)('$owner $axis, then on again: every reader’s lists and details are the ones before, and no asset row was written', async (c) => {
    // The snapshot is of the owner on: B and S see every file through its record.
    for (const cookies of [B.cookies, S.cookies]) expect([...(await listed(cookies))].sort()).toEqual([...assetIds].sort());
    const before = await snapshot();
    const rowsBefore = await rows();
    await withModuleOff(c.owner, c.axis, async () => {
      // What a reader does while the owner is off: list, open, and try to
      // delete every file a record uses (the unused one, which anybody may
      // delete, is left alone).
      for (const cookies of [B.cookies, S.cookies, W]) {
        await listed(cookies);
        for (const id of assetIds) {
          await inject('GET', `/api/v1/admin/assets/${id}`, cookies);
          if (id !== unused) {
            const response = await inject('DELETE', `/api/v1/admin/assets/${id}`, cookies);
            expect([404, 409], response.body).toContain(response.statusCode);
          }
        }
      }
    });
    expect(await snapshot()).toEqual(before);
    expect(await rows()).toEqual(rowsBefore);
  });
});
