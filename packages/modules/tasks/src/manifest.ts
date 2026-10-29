import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Tasks — a first version of Tasks assigned to admin users, with a due date and
 * a status (`specs/163-projects-and-tasks/`). Any module may own Tasks through
 * an opaque context; this module names none of them.
 *
 * The module is operator-toggleable (Constitution XVII): `tasks.enabled` is its
 * activation control, and everything it contributes — routes, ports, admin
 * surfaces — stops with it. Nothing is dropped while it is off.
 */

const settings = defineModuleSettingsManifest({
  moduleCode: 'tasks',
  groups: [
    {
      code: 'tasks',
      name: 'Tasks',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: 'tasks.enabled',
      name: 'Tasks enabled',
      description:
        'Switches Tasks on or off: the Tasks list, My Tasks, the Task screens and the Tasks other modules create. Nothing is dropped — every Task and its history stay in the database and reappear when Tasks is switched back on.',
      groupCode: 'tasks',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'tasks',
  name: 'Tasks',
  description:
    'Tasks assigned to admin users, with a due date and a status, which any module can own through an opaque context.',
  version: '1.0.0',
  // `auth` owns `requireAdmin`, which gates every route of this module;
  // `settings` owns the store the activation control lives in;
  // `admin_users` owns `adminUserReadPort`, through which an assignee and a
  // creator are named; `audit_logs` owns `auditReferenceRegistry`, through
  // which an audit row about a Task is labelled; `_i18n` owns
  // `adminI18nService`, which words a context its owner did not describe in
  // the reader's language. All five are non-deactivatable.
  dependencies: ['_i18n', 'admin_users', 'audit_logs', 'auth', 'settings'],
  /**
   * Edges that are real to the container and bind no operator.
   *
   * `admin_notifications` is operator-switchable, and telling somebody a Task
   * is now theirs is a courtesy: the notifier asks
   * `effectiveState.isPresent('admin_notifications')` before it resolves the
   * port, so with the bell off an assignment succeeds and nobody is told.
   */
  nonBindingDependencies: [
    {
      moduleId: 'admin_search',
      name: 'adminSearchProviderRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s contribution-only boot hook, of the Task provider for the ' +
        'admin global search, built over its own task service. Nothing is read back: the registry ' +
        'enumerates only providers whose module is effectively present, so an absent contributor ' +
        'costs the host nothing and an absent host holds a table nobody walks. Not `dependencies`: ' +
        'that would make global search a reason this module cannot be switched off.',
    },
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent: 'Assignees are not notified of new Tasks.',
      reason:
        'The one call into this owner is `task-notifier.ts`, which decides its presence in front ' +
        'of the gate and answers `not-present` in its return type; nothing in this module fails ' +
        "closed on it, and no table of that owner is referenced from this module's schema.",
    },
  ],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: 'tasks.enabled', default: true },
  /** Reading Tasks, and creating, editing and deleting them (User Story 2). */
  permissions: [
    {
      code: 'tasks:read',
      label: 'View tasks',
      module: 'tasks',
    },
    {
      code: 'tasks:write',
      label: 'Create and edit tasks',
      module: 'tasks',
      requires: ['tasks:read'],
    },
  ],
  /**
   * The refusals this module raises, each with its sentence under
   * `errors.<CODE>` in `i18n/{en,pl}.json`, declared by the change that added
   * its first raise site.
   */
  errorCodes: [{ code: 'TASK_NOT_FOUND' }, { code: 'TASK_CONTEXT_INVALID' }, { code: 'TASK_ASSIGNEE_INVALID' }],
  /**
   * The command palette (Principle XVI, FR-041; `contracts/admin-surfaces.md`
   * §4). Each opens a screen of this module's own admin layer and declares the
   * code that screen and its API are gated on.
   */
  actions: [
    {
      id: 'open-tasks',
      labelKey: 'actions.openTasks.label',
      descriptionKey: 'actions.openTasks.description',
      icon: 'ListChecks',
      targetRoute: '/tasks',
      requiredPermission: 'tasks:read',
      keywords: ['tasks', 'task', 'to do', 'todo', 'zadania', 'zadanie'],
      weight: 330,
    },
    {
      id: 'open-my-tasks',
      labelKey: 'actions.openMyTasks.label',
      descriptionKey: 'actions.openMyTasks.description',
      icon: 'ListChecks',
      targetRoute: '/tasks/mine',
      requiredPermission: 'tasks:read',
      keywords: ['my tasks', 'mine', 'assigned', 'tasks', 'moje zadania', 'przypisane', 'zadania'],
      weight: 331,
    },
    {
      id: 'new-task',
      labelKey: 'actions.newTask.label',
      descriptionKey: 'actions.newTask.description',
      icon: 'Plus',
      targetRoute: '/tasks/new',
      requiredPermission: 'tasks:write',
      keywords: ['task', 'new', 'create', 'zadanie', 'nowe', 'utwórz'],
      weight: 332,
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  // `docs/tasks.md` at the package root: users' and developers' page.
  docs: { dir: 'docs' },
  // `false` is a decision, absent would be "nobody has decided".
  demo: false,
});
