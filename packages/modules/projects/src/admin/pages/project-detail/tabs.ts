import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ProjectDetail } from '@endora-commerce/contracts';
import type { GatedSurface } from '@endora-commerce/admin-kit/lib';

/**
 * The tabs of a Project's screen, as data
 * (`specs/163-projects-and-tasks/contracts/admin-surfaces.md` §2).
 *
 * **A story adds a tab by adding one file and one entry here** — Tasks, Linked
 * records, Notes, Messages, Attachments and History each arrive that way — so
 * the stories meet in one array and not in the body of `ProjectDetail.tsx`.
 * Each component is lazy: a tab nobody opens is never downloaded.
 *
 * **A tab's `id` is part of an address**: the screen selects a tab from
 * `?tab=<id>`, so an id that is renamed breaks every link somebody saved.
 *
 * **A tab another module's presence decides** names that module and the code
 * its data needs in `surface`; the page offers it only while both hold
 * (Principle XVII), and an address naming a tab that is not offered opens the
 * default tab — exactly as an id nobody declares does.
 */

/** What the page hands every tab. */
export interface ProjectTabProps {
  project: ProjectDetail;
  /** Put a newer read of the Project on screen (the answer of a write). */
  onChange: (next: ProjectDetail) => void;
  /** Read the Project again; resolves once the new read is on screen. */
  reload: () => Promise<void>;
}

export interface ProjectTab {
  id: string;
  /** Relative to the module's namespace. */
  labelKey: string;
  component: LazyExoticComponent<ComponentType<ProjectTabProps>>;
  /** Offered only while this module is present and the operator holds this code. */
  surface?: GatedSurface;
  /** A number drawn beside the label — nothing for 0. */
  count?: (project: ProjectDetail) => number;
  /**
   * The tab's accessible name while it counts, a template of `{label}` and
   * `{count}` — "Messages, unread: 2"; a bare number says nothing read aloud.
   */
  countLabelKey?: string;
}

/** The tab a visit opens on when its address names none. */
export const DEFAULT_TAB_ID = 'overview';

/** The query parameter that names the selected tab. */
export const TAB_PARAM = 'tab';

export const PROJECT_TABS: readonly ProjectTab[] = [
  {
    id: DEFAULT_TAB_ID,
    labelKey: 'tabs.overview',
    component: lazy(() => import('./tabs/OverviewTab.js')),
  },
  {
    id: 'stages',
    labelKey: 'tabs.stages',
    component: lazy(() => import('./tabs/StagesTab.js')),
  },
  {
    // User Story 2: the Project's Tasks by Stage — only while Tasks is on and readable.
    id: 'tasks',
    labelKey: 'tabs.tasks',
    component: lazy(() => import('./tabs/TasksTab.js')),
    surface: { module: 'tasks', requiredPermission: 'tasks:read' },
  },
  {
    // User Story 6: Orders, Quote Requests and Opportunities of the Project's
    // Organizations. Always offered: a switched-off owner's group says so.
    id: 'links',
    labelKey: 'tabs.links',
    component: lazy(() => import('./tabs/LinkedRecordsTab.js')),
  },
  {
    // The Stage history of User Story 1; the audit trail is the *Change history* tab.
    id: 'stage-history',
    labelKey: 'tabs.history',
    component: lazy(() => import('./tabs/StageHistoryTab.js')),
  },
  // User Story 7: notes, the message thread, attachments and the audit trail.
  {
    id: 'notes',
    labelKey: 'tabs.notes',
    component: lazy(() => import('./tabs/NotesTab.js')),
  },
  {
    id: 'messages',
    labelKey: 'tabs.messages',
    component: lazy(() => import('./tabs/MessagesTab.js')),
    count: (project) => project.unreadMessageCount,
    countLabelKey: 'tabs.unread',
  },
  {
    id: 'attachments',
    labelKey: 'tabs.attachments',
    component: lazy(() => import('./tabs/AttachmentsTab.js')),
  },
  {
    id: 'history',
    labelKey: 'tabs.changeHistory',
    component: lazy(() => import('./tabs/HistoryTab.js')),
  },
];

/** The tabs offered to this operator now: every tab whose `surface`, if any, is visible. */
export function offeredTabs(isVisible: (surface: GatedSurface) => boolean): readonly ProjectTab[] {
  return PROJECT_TABS.filter((tab) => tab.surface === undefined || isVisible(tab.surface));
}

/** The tab an address selects; an id nobody declares, or one not offered, is the default tab. */
export function tabFromSearch(search: URLSearchParams, offered: readonly ProjectTab[] = PROJECT_TABS): string {
  const asked = search.get(TAB_PARAM);
  return asked && offered.some((tab) => tab.id === asked) ? asked : DEFAULT_TAB_ID;
}

/** The query string that selects `tabId`, keeping every other parameter; the default tab is the bare address. */
export function searchForTab(search: URLSearchParams, tabId: string): URLSearchParams {
  const next = new URLSearchParams(search);
  if (tabId === DEFAULT_TAB_ID) next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, tabId);
  return next;
}
