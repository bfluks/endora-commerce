# Contract: shared line-group shapes and the arrangement helper

**Owner**: `@endora-commerce/contracts` — new file `packages/contracts/src/line-groups.ts`, re-exported
from `packages/contracts/src/index.ts`, co-located test `line-groups.test.ts`.
**Consumers**: `quote_requests`, `orders`, `document_templates` (through the two hosts), the admin SPA,
the storefront.

## 1. Schemas

```ts
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

/** A group of a document being created — no `id`. */
export const newLineGroupInputSchema = lineGroupInputSchema.omit({ id: true }).strict();

export type LineGroupInput = z.infer<typeof lineGroupInputSchema>;
```

`refineLineGrouping(ctx, body: { groups?: LineGroupInput[]; items?: { groupKey?: string | null }[] })`
— one `superRefine` helper both request schemas call:

| Rule | Issue path | Message (English; the envelope translates `VALIDATION_FAILED`) |
| --- | --- | --- |
| `groups.length ≤ 50` | `groups` | `At most 50 groups.` |
| keys unique | `groups.<i>.key` | `Two groups have the same key.` |
| ids unique | `groups.<i>.id` | `Two groups name the same group.` |
| every `items[j].groupKey` (non-null) is a declared key | `items.<j>.groupKey` | `No group has this key.` |
| `groups` present ⇒ `items` present (PATCH only) | `groups` | `Groups are saved together with the lines.` |

Schema failures answer **400 `VALIDATION_FAILED`** with `details[].path` as above (the route schema
convention). Rules needing the stored document (an `id` not belonging to it) are the services' and
answer **422 `VALIDATION_FAILED`**.

## 2. Line keys used by replies

Every reply line that can be grouped carries:

```ts
groupId: uuidSchema.nullable().default(null),   // null = ungrouped
position: z.number().int().nonnegative().default(0), // within its section
```

`default(...)` keeps fixtures and replies written before this feature parsing.

## 3. `arrangeLineGroups`

```ts
export interface ArrangeableLine { readonly groupId?: string | null; readonly position?: number }

export interface LineSection<T> {
  readonly kind: 'group' | 'ungrouped';
  readonly group: LineGroup | null;   // null for ungrouped
  readonly lines: readonly T[];
}

export function arrangeLineGroups<T extends ArrangeableLine>(
  groups: readonly LineGroup[],
  lines: readonly T[],
  options?: { readonly includeEmptyGroups?: boolean; readonly includeEmptyUngrouped?: boolean },
): LineSection<T>[];

export function flattenSections<T>(sections: readonly LineSection<T>[]): T[];
```

Behaviour (each row is a unit-test case in `line-groups.test.ts`):

| Input | Output |
| --- | --- |
| no groups, lines with positions 0,0,0 | one `ungrouped` section, input order (stable) |
| groups `B(pos 1)`, `A(pos 0)` | `A` then `B` then `ungrouped` |
| lines of one group with positions 2,0,1 | ordered 0,1,2; ties keep input order |
| a line whose `groupId` names no given group | in `ungrouped` |
| an empty group, default options | dropped |
| an empty group, `includeEmptyGroups` | kept, `lines: []` |
| no ungrouped line, default options | no `ungrouped` section |
| `includeEmptyUngrouped` | `ungrouped` section always last, possibly empty |
| `flattenSections(arrangeLineGroups(...))` | the display order (R-6) |

Callers pass rows already sorted by `(created_at, id)` when they hold legacy rows (all `position = 0`),
which is what makes the stable sort reproduce today's order (R-6).

## 4. Summaries are not here

Summaries are each surface's own totals function applied to `section.lines` (research R-15). This file
holds no money logic.
