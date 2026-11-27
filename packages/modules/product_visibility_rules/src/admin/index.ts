import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * `product_visibility_rules`' admin layer (`specs/193-product-visibility-rules/`).
 *
 * The configuration screen — categories, catalogue price books, role mappings (US2) — is the
 * module's landing route and its sidebar entry under *Access*, behind `product_visibility:read`,
 * the code its API reads enforce; the manifest's palette action `open-product-visibility` opens
 * it (FR-071, Principle XVI). The role list and the role editor show each role's visibility
 * through two read-only zones `admin_users` hosts (FR-024, research R-14). Off ⇒ the registry
 * drops every contribution (FR-073).
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
    {
      // US4 — the product rules and the channels they govern; opened from the configuration
      // screen and by the palette action `open-website-rules`.
      path: '/product-visibility/website-rules',
      component: () => import('./pages/WebsiteRulesPage.js'),
      requiredPermission: READ,
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
  zones: [
    zoneComponent('admin_users.roles.list.columns', () => import('./zones/RoleListVisibility.js'), {
      requiredPermission: READ,
    }),
    zoneComponent('admin_users.roles.editor.aside', () => import('./zones/RoleVisibilityPanel.js'), {
      requiredPermission: READ,
    }),
  ],
};
