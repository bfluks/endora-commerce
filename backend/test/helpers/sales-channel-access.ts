import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { BackendServerHandle } from './test-server.js';

/**
 * Fixtures for the sales-channel access rule (`specs/154-sales-channel-access/`).
 *
 * The rule refuses a customer request on a channel its Organization is not
 * assigned to, and an anonymous request on a channel closed to anonymous
 * visitors. A fixture that needs a customer to shop on a channel says so here,
 * **through the membership service** — the single audited writer of the
 * assignment, which also drops the access cache the rule reads — rather than by
 * inserting bridge rows the cache would not hear about.
 */

/** Replace an Organization's channel assignment with exactly `codes`. */
export async function assignOrganizationChannels(
  h: BackendServerHandle,
  organizationId: string,
  codes: readonly string[],
): Promise<void> {
  const ids: string[] = [];
  for (const code of codes) {
    const channel = await h.salesChannels.resolver.getByCode(code);
    if (!channel) throw new Error(`assignOrganizationChannels: no sales channel "${code}"`);
    ids.push(channel.id);
  }
  if (ids.length === 0) throw new Error('assignOrganizationChannels: at least one channel');
  await h.salesChannels.membershipService.replaceChannelsForEntity(
    'organization',
    organizationId,
    ids as [string, ...string[]],
  );
}

/** Add channels to an Organization's assignment, keeping what it already has. */
export async function addOrganizationChannels(
  h: BackendServerHandle,
  organizationId: string,
  codes: readonly string[],
): Promise<void> {
  for (const code of codes) {
    const channel = await h.salesChannels.resolver.getByCode(code);
    if (!channel) throw new Error(`addOrganizationChannels: no sales channel "${code}"`);
    await h.salesChannels.membershipService.addToChannel(
      channel.id,
      'organization',
      organizationId,
    );
  }
}

/**
 * Bind an Organization a fixture created directly (`em.create(Organization, …)`)
 * to the system-default channel — what every production creation path without
 * a storefront channel does (FR-019). Idempotent.
 */
export async function bindOrganizationToDefaultChannel(
  h: Pick<BackendServerHandle, 'salesChannels'>,
  organizationId: string,
): Promise<void> {
  await h.salesChannels.membershipService.bindToDefaultIfEmpty('organization', organizationId);
}

/**
 * Bind Organizations a fixture created directly to the stores the harness
 * seeds: the system-default channel and, when the US1 catalogue was seeded,
 * its `pl_retail` and `pl_b2b_vip` storefronts — the fixture buyer is a customer of each, as an
 * upgraded multi-channel shop's buyer is of every store it has ordered on (D4).
 * A channel a test creates for itself is **not** included: a test that puts a
 * customer on its own channel assigns it, and a test about a refusal relies on
 * that. Plain SQL against the Organization bridge, idempotent, for seeds that
 * hold only an `EntityManager` (the harness's own run before the composition
 * exists, so there is no cache to drop yet).
 */
export async function bindOrganizationsToFixtureChannelsSql(
  em: EntityManager,
  organizationIds: readonly string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  await em.getConnection().execute(
    `insert into "sales_channel_organizations" ("sales_channel_id", "organization_id")
     select sc."id", o."id" from "sales_channels" sc cross join "organizations" o
     where (sc."system_default" = true or sc."code" in (${FIXTURE_STOREFRONT_CODES.map((c) => `'${c}'`).join(', ')}))
       and o."id" in (${organizationIds.map(() => '?').join(', ')})
     on conflict do nothing`,
    [...organizationIds],
  );
}

/**
 * {@link bindOrganizationsToFixtureChannelsSql} for every Organization that has
 * no channel at all — for a fixture that writes several Organizations with
 * `em.create` and then binds them in one statement once its seeding is done.
 */
export async function bindUnassignedOrganizationsToFixtureChannelsSql(
  em: EntityManager,
): Promise<void> {
  await em.getConnection().execute(
    `insert into "sales_channel_organizations" ("sales_channel_id", "organization_id")
     select sc."id", o."id" from "sales_channels" sc cross join "organizations" o
     where (sc."system_default" = true or sc."code" in (${FIXTURE_STOREFRONT_CODES.map((c) => `'${c}'`).join(', ')}))
       and not exists (select 1 from "sales_channel_organizations" x where x."organization_id" = o."id")
     on conflict do nothing`,
  );
}

/** The storefront channels `seedUs1Catalog` creates beside the default. */
const FIXTURE_STOREFRONT_CODES = ['pl_retail', 'pl_b2b_vip'] as const;

/** Open or close a channel to anonymous visitors, and drop the channel cache. */
export async function setChannelAnonymousAccess(
  h: BackendServerHandle,
  code: string,
  anonymousAccess: boolean,
): Promise<void> {
  const em = h.em();
  const channel = await em.findOneOrFail(SalesChannel, { code });
  channel.anonymousAccess = anonymousAccess;
  await em.flush();
  await h.salesChannels.cache.invalidate(code);
}
