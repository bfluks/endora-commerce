import { describe, expect, it } from 'vitest';
import { TASK_BOARD_DEFAULT_CARD_FIELDS, type TaskSummary } from '@endora-commerce/contracts';
import {
  builtinBoardCardFields,
  cardFieldValues,
  namesCustomBoardField,
  resolveBoardCardFields,
  storedBoardCardFieldRefs,
} from './board-card-fields.js';

const summary: TaskSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  number: 'TSK-000001',
  title: 'Install',
  status: { code: 'todo', name: 'To do', color: '#64748b', category: 'open' },
  closed: false,
  assignees: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Ann', active: true }],
  dueOn: '2026-11-02',
  dueAt: null,
  overdue: false,
  priority: { code: 'high', name: 'High', color: '#f97316' },
  tags: [],
  context: null,
  parent: null,
  subtasks: { closed: 1, total: 2 },
  draft: false,
  private: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-02T08:00:00.000Z',
};

describe('board card fields (FR-022)', () => {
  it('reads a stored choice forgivingly: the default for a non-array, strings once each', () => {
    expect(storedBoardCardFieldRefs(null)).toEqual([...TASK_BOARD_DEFAULT_CARD_FIELDS]);
    expect(storedBoardCardFieldRefs(['builtin:number', 3, 'builtin:number', 'custom:x'])).toEqual([
      'builtin:number',
      'custom:x',
    ]);
    expect(namesCustomBoardField(['builtin:number'])).toBe(false);
    expect(namesCustomBoardField(['custom:x'])).toBe(true);
  });

  it('keeps only offered references, in their stored order, at most six', () => {
    const offered = builtinBoardCardFields();
    expect(resolveBoardCardFields(['builtin:tags', 'custom:gone', 'builtin:number'], offered).map((f) => f.ref)).toEqual([
      'builtin:tags',
      'builtin:number',
    ]);
    expect(resolveBoardCardFields(offered.map((f) => f.ref), offered)).toHaveLength(6);
  });

  it('gives each chosen field its value; a custom field without one is null', () => {
    const offered = [
      ...builtinBoardCardFields(),
      { ref: 'custom:region', source: 'custom' as const, key: 'region', label: { en: 'Region' }, labelDefault: 'Region' },
      { ref: 'custom:size', source: 'custom' as const, key: 'size', label: {}, labelDefault: 'Size' },
    ];
    const fields = resolveBoardCardFields(
      ['custom:region', 'builtin:due', 'builtin:startOn', 'builtin:subtasks', 'custom:size'],
      offered,
    );
    expect(cardFieldValues(fields, summary, { startOn: '2026-10-30', customFieldValues: { region: 'North' } })).toEqual([
      { ref: 'custom:region', value: 'North' },
      { ref: 'builtin:due', value: { dueOn: '2026-11-02', dueAt: null, overdue: false } },
      { ref: 'builtin:startOn', value: '2026-10-30' },
      { ref: 'builtin:subtasks', value: { closed: 1, total: 2 } },
      { ref: 'custom:size', value: null },
    ]);
  });
});
