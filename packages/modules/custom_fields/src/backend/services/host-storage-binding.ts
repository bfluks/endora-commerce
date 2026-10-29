import type { SupportedEntityType } from '@endora-commerce/contracts';

/** Where one host entity type stores its custom-field value bag. */
export interface HostStorageBinding {
  readonly table: string;
  readonly column: string;
}

/**
 * Host-table binding for the reads `custom_fields` makes over the host rows
 * (read-only introspection, feature 055; generalized to a per-host
 * `{table, column}` pair by feature 061 — the `product` host stores its value
 * bag in `products.attribute_values`). The definition-change guards probe it,
 * and the list-filter port (`specs/157-custom-fields-list-filters/`) builds its
 * condition against it. Purely a storage binding: no host logic lives here,
 * and neither the table nor the column ever comes from a caller.
 */
const HOST_STORAGE: Record<SupportedEntityType, HostStorageBinding> = {
  category: { table: 'categories', column: 'custom_field_values' },
  order: { table: 'orders', column: 'custom_field_values' },
  organization: { table: 'organizations', column: 'custom_field_values' },
  customer: { table: 'customer_accounts', column: 'custom_field_values' },
  quote_request: { table: 'quote_requests', column: 'custom_field_values' },
  product: { table: 'products', column: 'attribute_values' },
  opportunity: { table: 'crm_opportunities', column: 'custom_field_values' },
  project: { table: 'projects', column: 'custom_field_values' },
};

/** The `{ table, column }` holding `entityType`'s custom-field values. */
export function hostStorageBinding(entityType: SupportedEntityType): HostStorageBinding {
  return HOST_STORAGE[entityType];
}
