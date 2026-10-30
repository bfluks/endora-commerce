/**
 * `projects`' admin surface (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`
 * §1–§3): User Story 1's three routes and sidebar row, User Story 3's
 * Templates screens and row, User Story 4's Project Roles and loss reasons,
 * User Story 6's Project panel on the screens of the records a Project
 * holds, User Story 10's analytics screen and row, and User Story 11's panel
 * of an Organization's Projects on the Organization screen.
 *
 * **Only what has shipped** — a sidebar or palette entry pointing at a route
 * that does not exist is a defect (Principle XVI). The palette actions are the
 * manifest's (`src/manifest.ts`, §4).
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The code that opens the list and one Project; `GET /projects` and `GET /projects/:id` enforce it. */
const READ_PERMISSION = 'projects:read';

/** The code that opens the create screen: `POST /projects` is the one write it exists to make. */
const WRITE_PERMISSION = 'projects:write';

/**
 * The code that opens the configuration screens — Templates (User Story 3),
 * Project Roles and loss reasons (User Story 4): every write there is
 * `projects:configure`.
 */
const CONFIGURE_PERMISSION = 'projects:configure';

/** The code that opens analytics: every `GET /projects/analytics/*` enforces it. */
const ANALYTICS_PERMISSION = 'projects:analytics';

const PROJECTS_PATH = '/projects';

export const contributions: AdminContributions = {
  routes: [
    {
      path: PROJECTS_PATH,
      component: () => import('./pages/ProjectsList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/:id`; `<Routes>` ranks the static segment first anyway.
      path: `${PROJECTS_PATH}/new`,
      component: () => import('./pages/ProjectCreate.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    // User Story 3 — Templates. Declared before `/:id`, whose segment would
    // otherwise also match `templates`.
    {
      path: `${PROJECTS_PATH}/templates`,
      component: () => import('./pages/TemplatesList.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/templates/new`,
      component: () => import('./pages/TemplateEditor.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/templates/:id`,
      component: () => import('./pages/TemplateEditor.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    // User Story 4 — the two dictionaries. Declared before `/:id` too.
    {
      path: `${PROJECTS_PATH}/roles`,
      component: () => import('./pages/RolesPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/loss-reasons`,
      component: () => import('./pages/LossReasonsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    // User Story 10 — analytics. Declared before `/:id` too.
    {
      path: `${PROJECTS_PATH}/analytics`,
      component: () => import('./pages/AnalyticsPage.js'),
      requiredPermission: ANALYTICS_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/:id`,
      component: () => import('./pages/ProjectDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: PROJECTS_PATH,
      labelKey: 'nav.projects.label',
      icon: 'ClipboardList',
      // The host's "Projects & tasks" section (research R-16); Projects first.
      section: 'work',
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${PROJECTS_PATH}/analytics`,
      labelKey: 'nav.analytics.label',
      icon: 'LineChart',
      // After My Tasks (200) and Tasks (210), before the configuration.
      section: 'work',
      weight: 300,
      requiredPermission: ANALYTICS_PERMISSION,
    },
    {
      to: `${PROJECTS_PATH}/templates`,
      labelKey: 'nav.templates.label',
      icon: 'Layers',
      section: 'work',
      weight: 400,
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      to: `${PROJECTS_PATH}/roles`,
      labelKey: 'nav.roles.label',
      icon: 'Users',
      section: 'work',
      weight: 410,
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      to: `${PROJECTS_PATH}/loss-reasons`,
      labelKey: 'nav.lossReasons.label',
      icon: 'Tag',
      section: 'work',
      weight: 420,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
  // User Story 6 — the Project a record is in, on that record's own screen.
  // One panel, four zones; each is one line: the zone, the chunk, the code the
  // panel's read enforces. The record's owner names no contributor.
  zones: [
    zoneComponent('order.detail.after', () => import('./zones/OrderProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    zoneComponent('quote_request.detail.after', () => import('./zones/QuoteRequestProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    zoneComponent('opportunity.detail.after', () => import('./zones/OpportunityProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    zoneComponent('task.detail.after', () => import('./zones/TaskProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    // User Story 11 — the Organization's Projects on the Organization screen.
    zoneComponent('organization.detail.after', () => import('./zones/OrganizationProjects.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
  ],
};
