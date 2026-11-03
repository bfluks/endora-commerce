import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  ProjectAnalyticsDurationsResponseSchema,
  ProjectAnalyticsLossesResponseSchema,
  ProjectAnalyticsManagersResponseSchema,
  ProjectAnalyticsSummaryResponseSchema,
  ProjectAnalyticsTimeInStageResponseSchema,
  ProjectAnalyticsTopOpenResponseSchema,
  ProjectAnalyticsValueResponseSchema,
} from '@endora-commerce/contracts';
import type { z } from 'zod';

/**
 * The seven reads of the analytics screen
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.6), each gated
 * `projects:analytics`. A file of its own beside `api.ts`: the screen is the
 * only caller, and the only Projects screen that opens on this permission.
 *
 * Each answers its figure in the envelope of FR-038 — the period, the Projects
 * it counted and those it left out for having no value — which the screen
 * shows under every figure, so the envelope is returned whole.
 */

const BASE = '/api/v1/admin/projects/analytics';

/** What every figure is computed over. Dates are `YYYY-MM-DD`, both included. */
export interface ProjectAnalyticsFilters {
  from: string;
  to: string;
  templateId: string | null;
  organizationId: string | null;
  projectManagerId: string | null;
}

export type SummaryFigure = z.infer<typeof ProjectAnalyticsSummaryResponseSchema>;
export type DurationsFigure = z.infer<typeof ProjectAnalyticsDurationsResponseSchema>;
export type TimeInStageFigure = z.infer<typeof ProjectAnalyticsTimeInStageResponseSchema>;
export type LossesFigure = z.infer<typeof ProjectAnalyticsLossesResponseSchema>;
export type ValueFigure = z.infer<typeof ProjectAnalyticsValueResponseSchema>;
export type TopOpenFigure = z.infer<typeof ProjectAnalyticsTopOpenResponseSchema>;
export type ManagersFigure = z.infer<typeof ProjectAnalyticsManagersResponseSchema>;

/** What every figure's envelope says beside its data (FR-038). */
export type FigureEnvelope = Pick<SummaryFigure, 'from' | 'to' | 'projectCount' | 'excluded'>;

function query(filters: ProjectAnalyticsFilters): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.templateId) params.set('templateId', filters.templateId);
  if (filters.organizationId) params.set('organizationId', filters.organizationId);
  if (filters.projectManagerId) params.set('projectManagerId', filters.projectManagerId);
  return params.toString();
}

const read = <T>(figure: string, filters: ProjectAnalyticsFilters): Promise<T> =>
  apiClient.get<T>(`${BASE}/${figure}?${query(filters)}`);

export const projectsAnalyticsApi = {
  summary: (filters: ProjectAnalyticsFilters) => read<SummaryFigure>('summary', filters),
  durations: (filters: ProjectAnalyticsFilters) => read<DurationsFigure>('durations', filters),
  timeInStage: (filters: ProjectAnalyticsFilters) => read<TimeInStageFigure>('time-in-stage', filters),
  losses: (filters: ProjectAnalyticsFilters) => read<LossesFigure>('losses', filters),
  value: (filters: ProjectAnalyticsFilters) => read<ValueFigure>('value', filters),
  topOpen: (filters: ProjectAnalyticsFilters) => read<TopOpenFigure>('top-open', filters),
  managers: (filters: ProjectAnalyticsFilters) => read<ManagersFigure>('managers', filters),
};
