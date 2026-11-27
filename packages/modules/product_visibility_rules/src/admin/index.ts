import { type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * `product_visibility_rules`' admin layer (`specs/193-product-visibility-rules/`).
 *
 * The configuration screen — categories, catalogue price books, role mappings (US2) — is the
 * module's landing route and its sidebar entry under *Access*, behind `product_visibility:read`,
 * the code its API reads enforce; the manifest's palette action `open-product-visibility` opens
 * it (FR-071, Principle XVI). Off ⇒ the registry drops every contribution (FR-073).
 */
const ROUTE = '/product-visibility';
const READ = 'product_visibility:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE,
      component: () => import('./pages/ConfigurationPage.js'),
      requiredPermission: READ,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE,
      labelKey: 'nav.productVisibility.label',
      icon: 'ShieldCheck',
      section: 'access',
      // *Access* runs users, roles, API keys, credentials, audit log (100 to 500). What a
      // role may see belongs right after the roles themselves.
      weight: 250,
      requiredPermission: READ,
    },
  ],
};
