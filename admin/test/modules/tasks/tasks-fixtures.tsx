import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ADMIN_PREFERENCES_DEFAULTS,
  type AdminPreferences,
  type RecordHistoryEntry,
  type TaskDetail,
  type TaskStatusRef,
  type TaskSummary,
  type TaskWorkflow,
} from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Shared fixtures of the Tasks screen tests (`specs/163-projects-and-tasks/`,
 * User Story 2 — task T064).
 *
 * **The screens are rendered over the shipped English bundles**, the module's
 * own `i18n/en.json` and `_i18n`'s, so a test names a control by the sentence an
 * operator reads, through {@link en} — which throws for a key the bundle does
 * not carry, so a screen asking for a key nobody wrote fails here rather than
 * rendering `tasks.some.key` in production.
 */

function shippedBundle(relativePath: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as Record<string, string>;
}

const TASKS_BUNDLE = shippedBundle('../packages/modules/tasks/i18n/en.json');
const CORE_BUNDLE = shippedBundle('../packages/modules/_i18n/i18n/en.json');

function sentence(
  bundle: Record<string, string>,
  scope: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = bundle[key];
  if (template === undefined) {
    throw new Error(`[tasks fixtures] the shipped English ${scope} bundle has no key "${key}".`);
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The English sentence of one of the module's own keys. */
export function en(key: string, params?: Record<string, string | number>): string {
  return sentence(TASKS_BUNDLE, 'tasks', key, params);
}

/** The English sentence of a key the host's shared bundle owns. */
export function core(key: string, params?: Record<string, string | number>): string {
  return sentence(CORE_BUNDLE, 'core', key, params);
}

export const EVERY_TASKS_PERMISSION = ['tasks:read', 'tasks:write'];

/** Mount a screen at `path` (matched against `pattern`) under the real session and presence providers. */
export function renderTasks(
  ui: ReactElement,
  options: {
    readonly permissions?: readonly string[];
    readonly path?: string;
    readonly pattern?: string;
    readonly present?: readonly string[];
    readonly contributions?: Parameters<typeof withSession>[1]['contributions'];
    /**
     * The signed-in admin's preferences (feature 164). Given, the store is
     * available and a change is saved at once through `PATCH /me/preferences`;
     * omitted, the session carries none and nothing is saved.
     */
    readonly preferences?: Partial<AdminPreferences>;
  } = {},
): RenderResult {
  const session = adminSession({ permissions: options.permissions ?? EVERY_TASKS_PERMISSION, id: ME_ID });
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>
          <Routes>
            <Route path={options.pattern ?? '*'} element={ui} />
            <Route path="/tasks" element={<p>tasks list screen</p>} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: options.preferences
          ? { ...session, preferences: { ...structuredClone(ADMIN_PREFERENCES_DEFAULTS), ...options.preferences } }
          : session,
        presence: modulePresence({ present: options.present ?? ['tasks', 'admin_users'] }),
        registry: [],
        ...(options.contributions ? { contributions: options.contributions } : {}),
      },
    ),
    { core: CORE_BUNDLE, tasks: TASKS_BUNDLE },
  );
}

export const TASK_ID = '00000000-0000-4000-8000-0000000007a1';
export const OTHER_TASK_ID = '00000000-0000-4000-8000-0000000007a2';
export const PROJECT_ID = '00000000-0000-4000-8000-0000000000f1';
export const STAGE_ID = '00000000-0000-4000-8000-000000000d01';
export const ME_ID = '00000000-0000-4000-8000-00000000ad01';
export const ANNA_ID = '00000000-0000-4000-8000-000000000c01';

/** The seeded workflow's statuses as a Task carries them (`specs/165-task-management/` data-model §3). */
export const STATUS: Record<'todo' | 'in_progress' | 'done' | 'cancelled', TaskStatusRef> = {
  todo: { code: 'todo', name: 'To do', color: '#64748b', category: 'open' },
  in_progress: { code: 'in_progress', name: 'In progress', color: '#f59e0b', category: 'open' },
  done: { code: 'done', name: 'Done', color: '#10b981', category: 'done' },
  cancelled: { code: 'cancelled', name: 'Cancelled', color: '#94a3b8', category: 'cancelled' },
};

/** `GET /tasks/workflow` — the seeded four statuses, every move between them. */
export function workflow(): TaskWorkflow {
  const codes = ['todo', 'in_progress', 'done', 'cancelled'] as const;
  return {
    statuses: codes.map((code, index) => ({
      code,
      name: { en: STATUS[code].name },
      defaultName: STATUS[code].name,
      category: STATUS[code].category,
      isInitial: code === 'todo',
      weight: (index + 1) * 10,
      color: STATUS[code].color,
      inUseCount: 0,
    })),
    transitions: codes.flatMap((from) => codes.filter((to) => to !== from).map((to) => ({ from, to }))),
  };
}

export function taskSummary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: TASK_ID,
    number: 'TSK-000001',
    title: 'Order the racking',
    status: STATUS.todo,
    closed: false,
    dueOn: '2026-11-05',
    dueAt: null,
    overdue: false,
    assignees: [{ id: ANNA_ID, name: 'Anna Nowak', active: true }],
    priority: null,
    tags: [],
    context: {
      type: 'project',
      available: true,
      label: 'PRJ-000001 Warehouse fit-out',
      href: `/projects/${PROJECT_ID}`,
      groupLabel: 'Design',
    },
    parent: null,
    subtasks: { closed: 0, total: 0 },
    draft: false,
    private: false,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

export function taskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  const { context: _context, ...summary } = taskSummary();
  return {
    ...summary,
    description: 'Three bays, galvanised.',
    references: [],
    context: {
      type: 'project',
      available: true,
      label: 'PRJ-000001 Warehouse fit-out',
      href: `/projects/${PROJECT_ID}`,
      groupLabel: 'Design',
      id: PROJECT_ID,
      groupId: STAGE_ID,
      canChangeTasks: true,
    },
    contextNote: null,
    startOn: null,
    customFieldValues: {},
    links: [],
    relatedTasks: [],
    subtaskItems: [],
    attachmentsCount: 0,
    commentsCount: 0,
    reminders: [],
    createdBy: { id: ME_ID, name: 'Ada Min' },
    publishedAt: '2026-10-20T10:00:00.000Z',
    completedAt: null,
    permissions: { canChange: true, canDelete: true, canPublish: false },
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

export function historyEntry(overrides: Partial<RecordHistoryEntry> = {}): RecordHistoryEntry {
  return {
    id: '00000000-0000-4000-8000-0000000009a1',
    actedAt: '2026-10-20T10:00:00.000Z',
    action: 'tasks.task.create',
    actor: { kind: 'admin_user', id: ME_ID, name: 'Ada Min' },
    before: null,
    after: null,
    references: [],
    ...overrides,
  };
}

/** The history answer of `GET /tasks/:id/history`. */
export function historyPage(entries: RecordHistoryEntry[]): unknown {
  return {
    data: entries,
    pagination: { cursor: null, hasMore: false, limit: 50 },
    truncated: false,
  };
}
