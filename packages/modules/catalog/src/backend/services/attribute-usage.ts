import type { ProductVisibilityClause } from './admin-product-visibility.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminAttributeUsage } from '@endora-commerce/contracts';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-007 – FR-009, owner
 * ruling OR-5, research R-21) — what deleting an attribute would meet.
 *
 * **One query for the dialog and the guard.** `GET …/attributes/:idOrKey/usage`
 * and `catalog.attribute.delete` both call {@link readAttributeUsage}, so the
 * count an operator is shown before confirming is the count the Command refuses
 * on — the two cannot disagree.
 *
 * - `attributeSetCount` — set memberships of the definition (refuses).
 * - `productValueCount` — distinct **non-deleted** products holding a value for
 *   the key: a baseline value (`products.attribute_values`), a per-channel
 *   override (`product_value_overrides`) or a variant value
 *   (`product_variants.variant_attribute_values`) (refuses). A soft-deleted
 *   product does not count: nothing purges or restores one, so it would block
 *   the attribute for ever with nothing the operator could clear (R-21).
 * - `productContentCount` — Page Builder content rows of the attribute whose
 *   product is not soft-deleted (deleted with the attribute). Always `0` for a
 *   non-content attribute, whose extension id no content row carries.
 */

export interface AttributeUsageTarget {
  definitionId: string;
  extensionId: string;
  key: string;
}

export async function readAttributeUsage(
  /** A Command's EntityManager (the delete guard), or a fresh one (the usage read). */
  em: EntityManager,
  target: AttributeUsageTarget,
  /** Spec 193 (FR-031) — over `"p"."id"`: the caller's visible products only; `null` counts every one. */
  visible: ProductVisibilityClause,
): Promise<AdminAttributeUsage> {
  if (visible === false) {
    const [row] = (await em.execute(
      `select count(*)::int as attribute_set_count from attribute_set_attributes where custom_field_definition_id = ?`,
      [target.definitionId],
    )) as Array<{ attribute_set_count: number }>;
    return { attributeSetCount: Number(row?.attribute_set_count ?? 0), productValueCount: 0, productContentCount: 0 };
  }
  const narrow = visible ? ` and ${visible.sql}` : '';
  const narrowParams = visible ? visible.params : [];
  // `em.execute`, never `em.getConnection().execute`: inside a Command this
  // must read the state of the transaction whose write it guards (issue #200).
  // The JSONB key operator is escaped (`\\?`), because a bare `?` is a binding.
  const rows = (await em.execute(
    `select
       (select count(*)::int from attribute_set_attributes where custom_field_definition_id = ?) as attribute_set_count,
       (select count(*)::int
          from products p
         where p.deleted_at is null${narrow}
           and (p.attribute_values \\? ?
                or exists (select 1 from product_value_overrides o
                            where o.product_id = p.id and o.attribute_key = ?)
                or exists (select 1 from product_variants v
                            where v.parent_product_id = p.id and v.variant_attribute_values \\? ?))
       ) as product_value_count,
       (select count(*)::int
          from product_content_values pcv
          join products p on p.id = pcv.product_id
         where pcv.product_attribute_id = ? and p.deleted_at is null${narrow}) as product_content_count`,
    [target.definitionId, ...narrowParams, target.key, target.key, target.key, target.extensionId, ...narrowParams],
  )) as Array<{ attribute_set_count: number; product_value_count: number; product_content_count: number }>;
  const row = rows[0];
  return {
    attributeSetCount: Number(row?.attribute_set_count ?? 0),
    productValueCount: Number(row?.product_value_count ?? 0),
    productContentCount: Number(row?.product_content_count ?? 0),
  };
}
