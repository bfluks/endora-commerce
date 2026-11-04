import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetReferenceReaderRestriction } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin, seedCrmOrganization } from '../../helpers/seed-crm.js';
import type { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';
import { deleteProjects } from './helpers.js';

/**
 * The Projects descriptor's reader restriction over seeded rows
 * (`specs/166-asset-reference-visibility/` contracts/ports.md §1.1, research
 * R-2, R-16).
 *
 * `assetIdsWithHiddenReferences()` is the exact complement of
 * `visibleEntityIds` over this descriptor's references, and
 * `allReferencedAssetIds()` is every attached asset — for a Member, a Viewer,
 * a `projects:read` holder who is neither, a reader confined to one
 * Organization, and a caller without `projects:read`. The module setting stays
 * at its default, `members`.
 */
describe('projects — the asset-reference reader restriction (feature 166)', () => {
  let h: BackendServerHandle;
  type Person = { adminUserId: string; undo: () => void };
  let member: Person;
  let viewer: Person;
  let outsider: Person;
  let nonReader: Person;
  let orgOne: string;
  let orgTwo: string;
  const projects: Record<'members' | 'everyone' | 'orgOne' | 'orgTwo', string> = {
    members: randomUUID(),
    everyone: randomUUID(),
    orgOne: randomUUID(),
    orgTwo: randomUUID(),
  };
  const assets: Record<'members' | 'everyone' | 'orgOne' | 'orgTwo' | 'shared', string> = {
    members: randomUUID(),
    everyone: randomUUID(),
    orgOne: randomUUID(),
    orgTwo: randomUUID(),
    shared: randomUUID(),
  };
  const pairs: Array<[string, string]> = [
    [assets.members, projects.members],
    [assets.everyone, projects.everyone],
    [assets.orgOne, projects.orgOne],
    [assets.orgTwo, projects.orgTwo],
    [assets.shared, projects.everyone],
    [assets.shared, projects.members],
  ];
  const ours = new Set(Object.values(assets));
  const sorted = (...ids: string[]) => [...ids].sort();

  function restriction(): AssetReferenceReaderRestriction {
    const registry = h.container.resolve<AssetReferenceRegistry>('assetReferenceRegistry');
    const descriptor = registry.partition().restricted.find((d) => d.ownerModuleId === 'projects');
    expect(descriptor, 'Projects registers a reader-restricted descriptor').toBeDefined();
    return descriptor!.readerRestriction!;
  }

  const as = <T>(adminUserId: string, reach: readonly string[] | 'all', body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId },
        reach === 'all'
          ? { allowAll: true, allowedOrganizationIds: [] }
          : { allowAll: false, allowedOrganizationIds: [...reach] },
      ),
      body,
    );

  async function complementFor(
    adminUserId: string,
    reach: readonly string[] | 'all' = 'all',
  ): Promise<{ visible: string[]; hidden: string[] }> {
    return as(adminUserId, reach, async () => {
      const r = restriction();
      const visible = await r.visibleEntityIds(Object.values(projects));
      const expected = new Set(pairs.filter(([, project]) => !visible.has(project)).map(([asset]) => asset));
      const hidden = (await r.assetIdsWithHiddenReferences()).filter((id) => ours.has(id));
      expect([...hidden].sort(), 'assetIdsWithHiddenReferences is the complement of visibleEntityIds').toEqual(
        [...expected].sort(),
      );
      return { visible: [...visible].sort(), hidden: [...hidden].sort() };
    });
  }

  async function insertProject(id: string, visibility: 'members_and_listed' | 'everyone', organizationIds: string[]): Promise<void> {
    const stageId = randomUUID();
    const connection = h.orm.em.getConnection();
    await connection.transactional(async (trx) => {
      await connection.execute(
        `insert into "projects" ("id", "number", "title", "visibility", "created_by_admin_user_id")
         values (?, ?, ?, ?, ?)`,
        [id, `PRJ-R6${id.slice(0, 8)}`, `R6 ${id.slice(0, 8)}`, visibility, TEST_ADMIN_ID],
        'run',
        trx,
      );
      await connection.execute(
        `insert into "project_stages" ("id", "project_id", "name", "color", "position") values (?, ?, 'Design', '#3b82f6', 1)`,
        [stageId, id],
        'run',
        trx,
      );
      await connection.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, id], 'run', trx);
      for (const organizationId of organizationIds) {
        await connection.execute(
          `insert into "project_organizations" ("project_id", "organization_id") values (?, ?)`,
          [id, organizationId],
          'run',
          trx,
        );
      }
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    member = await seedCrmAdmin(h.em(), 'r6-prj-member', ['projects:read']);
    viewer = await seedCrmAdmin(h.em(), 'r6-prj-viewer', ['projects:read']);
    outsider = await seedCrmAdmin(h.em(), 'r6-prj-outsider', ['projects:read']);
    nonReader = await seedCrmAdmin(h.em(), 'r6-prj-none', ['assets.read']);
    orgOne = await seedCrmOrganization(h.em(), 'r6-prj-one');
    orgTwo = await seedCrmOrganization(h.em(), 'r6-prj-two');
    await insertProject(projects.members, 'members_and_listed', []);
    await insertProject(projects.everyone, 'everyone', []);
    await insertProject(projects.orgOne, 'everyone', [orgOne]);
    await insertProject(projects.orgTwo, 'everyone', [orgTwo]);
    const conn = h.orm.em.getConnection();
    await conn.execute(`insert into "project_members" ("project_id", "admin_user_id") values (?, ?)`, [
      projects.members,
      member.adminUserId,
    ]);
    await conn.execute(`insert into "project_viewers" ("project_id", "admin_user_id") values (?, ?)`, [
      projects.members,
      viewer.adminUserId,
    ]);
    for (const [asset, project] of pairs) {
      await conn.execute(
        `insert into "project_attachments" ("project_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
        [project, asset, TEST_ADMIN_ID],
      );
    }
  });

  afterAll(async () => {
    await deleteProjects(h, Object.values(projects));
    for (const person of [member, viewer, outsider, nonReader]) person?.undo();
    await teardownBackendServer(h);
  });

  it('a Member sees the members-only Project and the open ones', async () => {
    const { visible, hidden } = await complementFor(member.adminUserId);
    expect(visible).toEqual(sorted(projects.members, projects.everyone, projects.orgOne, projects.orgTwo));
    expect(hidden).toEqual([]);
  });

  it('a Viewer sees what a Member sees', async () => {
    const { visible } = await complementFor(viewer.adminUserId);
    expect(visible).toEqual(sorted(projects.members, projects.everyone, projects.orgOne, projects.orgTwo));
  });

  it('a reader who is neither sees the open Projects only', async () => {
    const { visible, hidden } = await complementFor(outsider.adminUserId);
    expect(visible).toEqual(sorted(projects.everyone, projects.orgOne, projects.orgTwo));
    expect(hidden).toEqual(sorted(assets.members, assets.shared));
  });

  it('a reader confined to one Organization sees only that Organization’s Project', async () => {
    const { visible, hidden } = await complementFor(outsider.adminUserId, [orgOne]);
    expect(visible).toEqual([projects.orgOne]);
    expect(hidden).toEqual(sorted(assets.members, assets.everyone, assets.orgTwo, assets.shared));
  });

  it('a caller without projects:read sees no Project, and every file has a hidden reference', async () => {
    const { visible, hidden } = await complementFor(nonReader.adminUserId);
    expect(visible).toEqual([]);
    expect(hidden).toEqual(sorted(...Object.values(assets)));
  });

  it('allReferencedAssetIds is every attached file, whoever asks', async () => {
    const all = await as(nonReader.adminUserId, 'all', () => restriction().allReferencedAssetIds());
    expect(all.filter((id) => ours.has(id)).sort()).toEqual(sorted(...Object.values(assets)));
  });
});
