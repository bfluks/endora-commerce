import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RecordHistoryEntry, TaskDetail, TaskSummary } from '@endora-commerce/contracts';
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
  } = {},
): RenderResult {
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
        session: adminSession({ permissions: options.permissions ?? EVERY_TASKS_PERMISSION, id: ME_ID }),
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

export function taskSummary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: TASK_ID,
    number: 'TSK-000001',
    title: 'Order the racking',
    status: 'todo',
    dueOn: '2026-11-05',
    overdue: false,
    assignee: { id: ANNA_ID, name: 'Anna Nowak', active: true },
    context: {
      type: 'project',
      available: true,
      label: 'PRJ-000001 Warehouse fit-out',
      href: `/projects/${PROJECT_ID}`,
      groupLabel: 'Design',
    },
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
    createdBy: { id: ME_ID, name: 'Ada Min' },
    completedAt: null,
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
