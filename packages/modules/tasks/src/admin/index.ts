/**
 * `tasks`' admin surface (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`
 * §1–§3): 163's four screens and two sidebar rows — the Tasks screen and *My
 * Tasks* now each a list or a board (`specs/165-task-management/` User Story 3)
 * — the workflow screen (User Story 2) with its *Task settings* row, and the
 * priorities and tags screens (User Story 9) and the general settings screen
 * (User Story 7), each linked from the workflow screen.
 *
 * The palette actions are the manifest's (`src/manifest.ts`, §4). The zone
 * `task.detail.after` is mounted by `pages/TaskDetail.tsx`; this module
 * contributes nothing to it. It contributes the *Tasks* panel to an Order's,
 * a Quote Request's and an Opportunity's screen (`specs/165-task-management/`
 * User Story 6, `contracts/admin-surfaces.md` §3).
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The code that opens the lists and one Task; `GET /tasks`, `/tasks/mine` and `/tasks/:id` enforce it. */
const READ_PERMISSION = 'tasks:read';

/** The code that opens the create screen: `POST /tasks` is the one write it exists to make. */
const WRITE_PERMISSION = 'tasks:write';

/**
 * The code that opens the configuration screens: every write they make —
 * statuses and moves, priorities, tags, the time zone — is gated on it
 * (`specs/165-task-management/` FR-012, FR-041).
 */
const CONFIGURE_PERMISSION = 'tasks:configure';

const TASKS_PATH = '/tasks';

const WORKFLOW_PATH = `${TASKS_PATH}/settings/workflow`;

const PRIORITIES_PATH = `${TASKS_PATH}/settings/priorities`;

const TAGS_PATH = `${TASKS_PATH}/settings/tags`;

const GENERAL_SETTINGS_PATH = `${TASKS_PATH}/settings/general`;

export const contributions: AdminContributions = {
  routes: [
    {
      path: TASKS_PATH,
      component: () => import('./pages/TasksPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Both static segments are declared before `/:id`; `<Routes>` ranks them first anyway.
      path: `${TASKS_PATH}/mine`,
      component: () => import('./pages/MyTasksPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${TASKS_PATH}/new`,
      component: () => import('./pages/TaskCreate.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: WORKFLOW_PATH,
      component: () => import('./pages/settings/TaskWorkflowPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The priority list (User Story 9, R-9), reached from the workflow screen and ⌘K.
      path: PRIORITIES_PATH,
      component: () => import('./pages/settings/TaskPrioritiesPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The tag list (User Story 9, R-10), reached from the workflow screen and ⌘K.
      path: TAGS_PATH,
      component: () => import('./pages/settings/TaskTagsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The time zone (User Story 7, R-17), reached from the workflow screen.
      path: GENERAL_SETTINGS_PATH,
      component: () => import('./pages/settings/TaskGeneralSettingsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: `${TASKS_PATH}/:id`,
      component: () => import('./pages/TaskDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: `${TASKS_PATH}/mine`,
      labelKey: 'nav.mine.label',
      icon: 'ListChecks',
      // The host's "Projects & tasks" section (research R-16), after Projects.
      section: 'work',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: TASKS_PATH,
      labelKey: 'nav.tasks.label',
      icon: 'ListChecks',
      section: 'work',
      weight: 210,
      requiredPermission: READ_PERMISSION,
    },
    {
      // With the section's other configuration rows, after Projects' (400–420)
      // (`specs/165-task-management/contracts/admin-surfaces.md` §1).
      to: WORKFLOW_PATH,
      labelKey: 'nav.settings.label',
      icon: 'Settings',
      section: 'work',
      weight: 430,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
  // User Story 6 — the Tasks linked to a record, on that record's own screen.
  // One panel, three zones; each is one line: the zone, the chunk, the code the
  // panel's read enforces. The record's owner names no contributor, and the
  // zone renderer leaves the panel out while this module is off.
  zones: [
    zoneComponent('order.detail.after', () => import('./zones/OrderTasksPanel.js'), { weight: 660, requiredPermission: READ_PERMISSION }),
    zoneComponent('quote_request.detail.after', () => import('./zones/QuoteRequestTasksPanel.js'), { weight: 660, requiredPermission: READ_PERMISSION }),
    zoneComponent('opportunity.detail.after', () => import('./zones/OpportunityTasksPanel.js'), { weight: 660, requiredPermission: READ_PERMISSION }),
  ],
};
