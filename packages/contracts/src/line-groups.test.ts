import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LINE_GROUP_LIMITS,
  arrangeLineGroups,
  flattenSections,
  lineGroupInputSchema,
  lineGroupKeySchema,
  lineGroupNameSchema,
  lineGroupSchema,
  newLineGroupInputSchema,
  refineLineGrouping,
  type LineGroup,
} from './line-groups.js';

/**
 * Feature 159 — the shared line-group shapes and the one display ordering
 * (`specs/159-quote-request-item-groups/contracts/line-groups.md`).
 */

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';

/** A request body shaped like the admin PATCH, refined by the shared helper. */
const bodySchema = z
  .object({
    groups: z.array(lineGroupInputSchema).optional(),
    items: z
      .array(
        z.object({ productId: z.string(), groupKey: lineGroupKeySchema.nullable().optional() }),
      )
      .optional(),
  })
  .superRefine((body, ctx) => refineLineGrouping(ctx, body));

function issuePaths(result: { success: boolean; error?: z.ZodError }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('line group schemas', () => {
  it('trims a name and refuses an empty or over-long one', () => {
    expect(lineGroupNameSchema.parse('  Ground floor  ')).toBe('Ground floor');
    expect(lineGroupNameSchema.safeParse('   ').success).toBe(false);
    expect(lineGroupNameSchema.safeParse('x'.repeat(120)).success).toBe(true);
    expect(lineGroupNameSchema.safeParse('x'.repeat(121)).success).toBe(false);
  });

  it('accepts only the key alphabet, 1–64 characters', () => {
    expect(lineGroupKeySchema.safeParse('g-1_A').success).toBe(true);
    expect(lineGroupKeySchema.safeParse('').success).toBe(false);
    expect(lineGroupKeySchema.safeParse('a b').success).toBe(false);
    expect(lineGroupKeySchema.safeParse('k'.repeat(64)).success).toBe(true);
    expect(lineGroupKeySchema.safeParse('k'.repeat(65)).success).toBe(false);
  });

  it('parses a stored group and an input group; a new group carries no id', () => {
    expect(lineGroupSchema.parse({ id: G1, name: 'A', position: 0 })).toEqual({
      id: G1,
      name: 'A',
      position: 0,
    });
    expect(lineGroupInputSchema.parse({ key: 'a', id: G1, name: ' A ' })).toEqual({
      key: 'a',
      id: G1,
      name: 'A',
    });
    expect(newLineGroupInputSchema.safeParse({ key: 'a', name: 'A' }).success).toBe(true);
    expect(newLineGroupInputSchema.safeParse({ key: 'a', id: G1, name: 'A' }).success).toBe(false);
    expect(lineGroupInputSchema.safeParse({ key: 'a', name: 'A', extra: 1 }).success).toBe(false);
  });

  it('exposes the limits', () => {
    expect(LINE_GROUP_LIMITS).toEqual({ maxGroups: 50, maxNameLength: 120 });
  });
});

describe('refineLineGrouping', () => {
  it('accepts a body whose lines name declared keys or none', () => {
    const result = bodySchema.safeParse({
      groups: [
        { key: 'a', name: 'A' },
        { key: 'b', id: G1, name: 'B' },
      ],
      items: [
        { productId: 'p1', groupKey: 'a' },
        { productId: 'p2', groupKey: null },
        { productId: 'p3' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('refuses more than 50 groups at `groups`', () => {
    const groups = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, name: `G${i}` }));
    const result = bodySchema.safeParse({ groups, items: [{ productId: 'p' }] });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('groups');
  });

  it('accepts exactly 50 groups', () => {
    const groups = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, name: `G${i}` }));
    expect(bodySchema.safeParse({ groups, items: [{ productId: 'p' }] }).success).toBe(true);
  });

  it('refuses duplicate keys at the second one', () => {
    const result = bodySchema.safeParse({
      groups: [
        { key: 'a', name: 'A' },
        { key: 'a', name: 'B' },
      ],
      items: [{ productId: 'p' }],
    });
    expect(issuePaths(result)).toEqual(['groups.1.key']);
  });

  it('refuses duplicate ids at the second one', () => {
    const result = bodySchema.safeParse({
      groups: [
        { key: 'a', id: G1, name: 'A' },
        { key: 'b', id: G1, name: 'B' },
      ],
      items: [{ productId: 'p' }],
    });
    expect(issuePaths(result)).toEqual(['groups.1.id']);
  });

  it('refuses a groupKey naming no group at the line', () => {
    const result = bodySchema.safeParse({
      groups: [{ key: 'a', name: 'A' }],
      items: [
        { productId: 'p1', groupKey: 'a' },
        { productId: 'p2', groupKey: 'zzz' },
      ],
    });
    expect(issuePaths(result)).toEqual(['items.1.groupKey']);
  });

  it('refuses a groupKey when the body declares no groups at all', () => {
    const result = bodySchema.safeParse({ items: [{ productId: 'p1', groupKey: 'a' }] });
    expect(issuePaths(result)).toEqual(['items.0.groupKey']);
  });

  it('refuses groups without items', () => {
    const result = bodySchema.safeParse({ groups: [{ key: 'a', name: 'A' }] });
    expect(issuePaths(result)).toEqual(['groups']);
  });

  it('accepts a body with neither', () => {
    expect(bodySchema.safeParse({}).success).toBe(true);
  });
});

interface Line {
  id: string;
  groupId?: string | null;
  position?: number;
}

const ids = (lines: readonly Line[]) => lines.map((line) => line.id);

describe('arrangeLineGroups', () => {
  const groupA: LineGroup = { id: G1, name: 'A', position: 0 };
  const groupB: LineGroup = { id: G2, name: 'B', position: 1 };

  it('answers one ungrouped section in input order when there is no group', () => {
    const lines: Line[] = [
      { id: 'l1', position: 0 },
      { id: 'l2', position: 0 },
      { id: 'l3', position: 0 },
    ];
    const sections = arrangeLineGroups([], lines);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe('ungrouped');
    expect(sections[0]!.group).toBeNull();
    expect(ids(sections[0]!.lines)).toEqual(['l1', 'l2', 'l3']);
  });

  it('orders groups by position, then the ungrouped section last', () => {
    const lines: Line[] = [
      { id: 'u', groupId: null },
      { id: 'b', groupId: G2 },
      { id: 'a', groupId: G1 },
    ];
    const sections = arrangeLineGroups([groupB, groupA], lines);
    expect(sections.map((s) => s.group?.name ?? null)).toEqual(['A', 'B', null]);
  });

  it('orders a section by position, keeping input order on ties', () => {
    const lines: Line[] = [
      { id: 'p2', groupId: G1, position: 2 },
      { id: 'p0a', groupId: G1, position: 0 },
      { id: 'p1', groupId: G1, position: 1 },
      { id: 'p0b', groupId: G1, position: 0 },
    ];
    const sections = arrangeLineGroups([groupA], lines);
    expect(ids(sections[0]!.lines)).toEqual(['p0a', 'p0b', 'p1', 'p2']);
  });

  it('treats a line naming an unknown group as ungrouped', () => {
    const sections = arrangeLineGroups(
      [groupA],
      [
        { id: 'x', groupId: G3 },
        { id: 'a', groupId: G1 },
      ],
    );
    expect(sections.map((s) => s.kind)).toEqual(['group', 'ungrouped']);
    expect(ids(sections[1]!.lines)).toEqual(['x']);
  });

  it('drops an empty group by default and keeps it on request', () => {
    const lines: Line[] = [{ id: 'a', groupId: G1 }];
    expect(arrangeLineGroups([groupA, groupB], lines).map((s) => s.group?.name)).toEqual(['A']);
    const kept = arrangeLineGroups([groupA, groupB], lines, { includeEmptyGroups: true });
    expect(kept.map((s) => s.group?.name)).toEqual(['A', 'B']);
    expect(kept[1]!.lines).toEqual([]);
  });

  it('omits an empty ungrouped section unless asked', () => {
    const lines: Line[] = [{ id: 'a', groupId: G1 }];
    expect(arrangeLineGroups([groupA], lines).map((s) => s.kind)).toEqual(['group']);
    const always = arrangeLineGroups([groupA], lines, { includeEmptyUngrouped: true });
    expect(always.map((s) => s.kind)).toEqual(['group', 'ungrouped']);
    expect(always[1]!.lines).toEqual([]);
  });

  it('flattens to the display order', () => {
    const lines: Line[] = [
      { id: 'u1', groupId: null, position: 1 },
      { id: 'b0', groupId: G2, position: 0 },
      { id: 'u0', groupId: null, position: 0 },
      { id: 'a1', groupId: G1, position: 1 },
      { id: 'a0', groupId: G1, position: 0 },
    ];
    expect(ids(flattenSections(arrangeLineGroups([groupB, groupA], lines)))).toEqual([
      'a0',
      'a1',
      'b0',
      'u0',
      'u1',
    ]);
  });

  it('keeps input order for groups tied on position', () => {
    const tiedA: LineGroup = { id: G1, name: 'A', position: 0 };
    const tiedB: LineGroup = { id: G2, name: 'B', position: 0 };
    const sections = arrangeLineGroups([tiedB, tiedA], [], { includeEmptyGroups: true });
    expect(sections.map((s) => s.group?.name)).toEqual(['B', 'A']);
  });
});
