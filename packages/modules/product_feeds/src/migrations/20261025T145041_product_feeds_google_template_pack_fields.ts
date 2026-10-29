import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #430 — the predefined Google Merchant Center template gains the three
 * fields that publish a sub-cent unit price as a pack: `g:multipack`,
 * `g:unit_pricing_measure` and `g:unit_pricing_base_measure`, bound to the
 * `pack_*` sources, right after `g:sale_price`.
 *
 * The boot reconciler (`seeds/predefined-templates.ts`) installs a *missing*
 * system template and never edits an existing one, so without this an
 * installation that already has the template would keep it without the fields,
 * and every sub-cent product would be skipped from its Google feeds — while an
 * operator cannot edit a system template to add them. A system template is the
 * platform's, not the operator's; this brings an installed one level with what
 * a fresh installation gets.
 *
 * It changes no file for a price with two significant places: each field
 * resolves to nothing for such an item and is omitted. Idempotent: a field
 * already present (by output name) is not inserted, and nothing happens on an
 * installation without the template — the reconciler installs it complete.
 * An operator's copy of the template is not touched; the upgrade note says how
 * to add the fields to one.
 *
 * Only this module's own tables, so the manifest `dependencies` are unchanged.
 */
const FIELDS = [
  ['g:multipack', 'pack_quantity', 'templateHelp.google.multipack'],
  ['g:unit_pricing_measure', 'pack_unit_pricing_measure', 'templateHelp.google.unitPricingMeasure'],
  ['g:unit_pricing_base_measure', 'pack_unit_pricing_base_measure', 'templateHelp.google.unitPricingBaseMeasure'],
] as const;

const TEMPLATE = `(select "id" from "product_feed_templates" where "system_code" = 'google_merchant_v1')`;
const NAMES = FIELDS.map(([name]) => `'${name}'`).join(', ');

export class Migration20261025T145041ProductFeedsGoogleTemplatePackFields extends Migration {
  override async up(): Promise<void> {
    // The fields go after `g:sale_price`, or at the end when it is gone.
    const anchor =
      `coalesce((select "sort_order" from "product_feed_template_fields" ` +
      `where "feed_template_id" = ${TEMPLATE} and "output_name" = 'g:sale_price'), ` +
      `(select max("sort_order") from "product_feed_template_fields" where "feed_template_id" = ${TEMPLATE}), -1)`;
    // Make room only when none of the fields is there yet, so a re-run moves nothing.
    this.addSql(`
      update "product_feed_template_fields"
         set "sort_order" = "sort_order" + ${FIELDS.length}, "updated_at" = now()
       where "feed_template_id" = ${TEMPLATE}
         and "sort_order" > ${anchor}
         and not exists (
           select 1 from "product_feed_template_fields"
            where "feed_template_id" = ${TEMPLATE} and "output_name" in (${NAMES})
         );
    `);
    const rows = FIELDS.map(
      ([outputName, sourceKind, helpKey], index) => `('${outputName}', '${sourceKind}', '${helpKey}', ${index + 1})`,
    ).join(',\n               ');
    this.addSql(`
      insert into "product_feed_template_fields"
        ("id", "feed_template_id", "output_name", "source_kind", "provider_required",
         "sort_order", "help_key", "unbound", "created_at", "updated_at")
      select gen_random_uuid(), t."id", v."output_name", v."source_kind", false,
             a."anchor" + v."offset", v."help_key", false, now(), now()
        from "product_feed_templates" t
        cross join (select ${anchor} as "anchor") a
        cross join (values ${rows}) as v("output_name", "source_kind", "help_key", "offset")
       where t."system_code" = 'google_merchant_v1'
         and not exists (
           select 1 from "product_feed_template_fields" f
            where f."feed_template_id" = t."id" and f."output_name" = v."output_name"
         );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      delete from "product_feed_template_fields"
       where "feed_template_id" = ${TEMPLATE} and "output_name" in (${NAMES});
    `);
  }
}
