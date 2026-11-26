import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { VisibilityCategory } from '../entities/visibility-category.entity.js';

/** The configuration screen every reference links to. */
const CONFIGURATION_URL = '/product-visibility';

/**
 * What this module's audit rows are called, and where the admin app shows
 * them: a visibility category by its name, a designation by its currency. Both open the
 * module's configuration screen. A mapping's audit row names an admin role, which
 * `admin_roles` already resolves.
 */
export function registerProductVisibilityAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'product_visibility_rules',
    referenceType: 'visibility_category',
    resolve: async (ids) => {
      const rows = await emFactory().find(VisibilityCategory, { id: { $in: [...ids] } }, { fields: ['id', 'name'] });
      return rows.map((r) => ({ id: r.id, label: r.name, url: CONFIGURATION_URL }));
    },
  });
  registry.register({
    ownerModuleId: 'product_visibility_rules',
    referenceType: 'catalogue_price_designation',
    resolve: async (ids) => ids.map((id) => ({ id, label: id, url: CONFIGURATION_URL })),
  });
}
