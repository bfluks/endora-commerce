import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Migration20261025T145041ProductFeedsGoogleTemplatePackFields } from '@endora-commerce/mod-product-feeds/migrations';
import { PREDEFINED_TEMPLATES } from '../../../../packages/modules/product_feeds/src/backend/seeds/predefined-templates.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #430 — the predefined Google Merchant Center template gains the three
 * pack fields. The boot reconciler never edits an installed system template,
 * so an installation that already had one gets them from this migration, in
 * the same place a fresh installation has them. The statements come from the
 * migration class.
 */
const PACK_FIELDS = ['g:multipack', 'g:unit_pricing_measure', 'g:unit_pricing_base_measure'];
const TEMPLATE = `(select "id" from "product_feed_templates" where "system_code" = 'google_merchant_v1')`;

describe('product_feeds — the Google template pack fields migration', () => {
  let h: BackendServerHandle;

  async function runMigration(): Promise<void> {
    const em = h.em();
    const migration = new Migration20261025T145041ProductFeedsGoogleTemplatePackFields(em.getDriver(), em.config);
    await migration.up();
    for (const query of migration.getQueries()) await em.execute(query as string);
  }

  async function fields(): Promise<Array<{ output_name: string; source_kind: string; sort_order: number }>> {
    return h.em().execute(
      `select "output_name", "source_kind", "sort_order" from "product_feed_template_fields"
        where "feed_template_id" = ${TEMPLATE} order by "sort_order", "output_name"`,
    );
  }

  const shipped = PREDEFINED_TEMPLATES.find((t) => t.systemCode === 'google_merchant_v1')!.fields;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a fresh installation already has them, after g:sale_price', async () => {
    const rows = await fields();
    expect(rows.map((r) => r.output_name)).toEqual(shipped.map((f) => f.outputName));
  });

  it('an installation from before the fields gets them in the same place, and a re-run changes nothing', async () => {
    // The template as 0.108.0 installed it: no pack fields, contiguous order.
    await h.em().execute(
      `delete from "product_feed_template_fields"
        where "feed_template_id" = ${TEMPLATE} and "output_name" in (${PACK_FIELDS.map((n) => `'${n}'`).join(', ')})`,
    );
    await h.em().execute(
      `update "product_feed_template_fields" f set "sort_order" = r.n - 1
         from (select "id", row_number() over (order by "sort_order") as n
                 from "product_feed_template_fields" where "feed_template_id" = ${TEMPLATE}) r
        where f."id" = r."id"`,
    );
    expect((await fields()).map((r) => r.output_name)).not.toContain('g:multipack');

    await runMigration();
    const after = await fields();
    expect(after.map((r) => r.output_name)).toEqual(shipped.map((f) => f.outputName));
    expect(after.map((r) => r.sort_order)).toEqual(shipped.map((_, i) => i));
    expect(after.filter((r) => PACK_FIELDS.includes(r.output_name)).map((r) => r.source_kind)).toEqual([
      'pack_quantity',
      'pack_unit_pricing_measure',
      'pack_unit_pricing_base_measure',
    ]);

    await runMigration();
    expect(await fields()).toEqual(after);
  });
});
