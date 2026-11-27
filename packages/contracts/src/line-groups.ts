import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Feature 159 — named, ordered groups of a document's lines (quote requests
 * and orders), and the one display ordering every reader shares
 * (`specs/159-quote-request-item-groups/contracts/line-groups.md`).
 *
 * Shapes only: summaries are each surface's own totals rule applied to a
 * section's lines, and no money logic lives here.
 */

export const LINE_GROUP_LIMITS = { maxGroups: 50, maxNameLength: 120 } as const;

/** A request-local reference from a line to a group of the same request body. */
export const lineGroupKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Trimmed; 1–120 characters after trimming. Operator content, never translated. */
export const lineGroupNameSchema = z.string().trim().min(1).max(LINE_GROUP_LIMITS.maxNameLength);

/** A stored group as every reply carries it. */
export const lineGroupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  position: z.number().int().nonnegative(),
});
export type LineGroup = z.infer<typeof lineGroupSchema>;

/** A group in an edit of an existing document: `id` keeps an existing group's identity. */
export const lineGroupInputSchema = z
  .object({ key: lineGroupKeySchema, id: uuidSchema.optional(), name: lineGroupNameSchema })
  .strict();
export type LineGroupInput = z.infer<typeof lineGroupInputSchema>;

/** A group of a document being created — no `id`. */
export const newLineGroupInputSchema = lineGroupInputSchema.omit({ id: true }).strict();
export type NewLineGroupInput = z.infer<typeof newLineGroupInputSchema>;

/** The body shape `refineLineGrouping` judges: any request carrying groups and lines. */
export interface LineGroupingBody {
  readonly groups?: readonly { readonly key: string; readonly id?: string | undefined }[] | undefined;
  readonly items?: readonly { readonly groupKey?: string | null | undefined }[] | undefined;
}

/**
 * The rules a grouping body must meet regardless of the stored document — one
 * `superRefine` helper every request schema carrying groups calls. Rules that
 * need the stored document (an `id` belonging to it) are the services'.
 */
export function refineLineGrouping(ctx: z.RefinementCtx, body: LineGroupingBody): void {
  const groups = body.groups;
  if (groups !== undefined) {
    if (body.items === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'Groups are saved together with the lines.',
      });
    }
    if (groups.length > LINE_GROUP_LIMITS.maxGroups) {
      ctx.addIssue({
        code: 'custom',
        path: ['groups'],
        message: `At most ${LINE_GROUP_LIMITS.maxGroups} groups.`,
      });
    }
    const keys = new Set<string>();
    const groupIds = new Set<string>();
    groups.forEach((group, index) => {
      if (keys.has(group.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'key'],
          message: 'Two groups have the same key.',
        });
      }
      keys.add(group.key);
      if (group.id !== undefined) {
        if (groupIds.has(group.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['groups', index, 'id'],
            message: 'Two groups name the same group.',
          });
        }
        groupIds.add(group.id);
      }
    });
  }
  const declared = new Set((groups ?? []).map((group) => group.key));
  body.items?.forEach((item, index) => {
    if (item.groupKey !== undefined && item.groupKey !== null && !declared.has(item.groupKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'groupKey'],
        message: 'No group has this key.',
      });
    }
  });
}

// ---------------------------------------------------------------------------
// The one display ordering (research R-6)
// ---------------------------------------------------------------------------

export interface ArrangeableLine {
  readonly groupId?: string | null;
  readonly position?: number;
}

export interface LineSection<T> {
  readonly kind: 'group' | 'ungrouped';
  /** `null` for the ungrouped section. */
  readonly group: LineGroup | null;
  readonly lines: readonly T[];
}

export interface ArrangeLineGroupsOptions {
  /** Keep groups holding no line (the admin editor needs them). Default `false`. */
  readonly includeEmptyGroups?: boolean;
  /** Always answer the ungrouped section, last, even when empty. Default `false`. */
  readonly includeEmptyUngrouped?: boolean;
}

function stableSortBy<T>(items: readonly T[], key: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, rank: key(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * Partition `lines` into ordered sections: groups by `position`, each group's
 * lines by `position`, then the ungrouped lines — ties keep input order, so a
 * caller passing rows sorted by `(created_at, id)` reproduces the legacy order
 * of lines that all read `position = 0`. A line naming an unknown group is
 * ungrouped. Pure and total.
 */
export function arrangeLineGroups<T extends ArrangeableLine>(
  groups: readonly LineGroup[],
  lines: readonly T[],
  options: ArrangeLineGroupsOptions = {},
): LineSection<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const group of groups) byGroup.set(group.id, []);
  const ungrouped: T[] = [];
  for (const line of lines) {
    const bucket = line.groupId ? byGroup.get(line.groupId) : undefined;
    (bucket ?? ungrouped).push(line);
  }
  const sections: LineSection<T>[] = [];
  for (const group of stableSortBy(groups, (g) => g.position)) {
    const groupLines = byGroup.get(group.id) ?? [];
    if (groupLines.length === 0 && !options.includeEmptyGroups) continue;
    sections.push({
      kind: 'group',
      group,
      lines: stableSortBy(groupLines, (l) => l.position ?? 0),
    });
  }
  if (ungrouped.length > 0 || options.includeEmptyUngrouped) {
    sections.push({
      kind: 'ungrouped',
      group: null,
      lines: stableSortBy(ungrouped, (l) => l.position ?? 0),
    });
  }
  return sections;
}

/** The display order: every section's lines, in section order. */
export function flattenSections<T>(sections: readonly LineSection<T>[]): T[] {
  return sections.flatMap((section) => [...section.lines]);
}
