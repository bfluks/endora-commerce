import { TASK_LIST_SORTS } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { describe, expect, it } from 'vitest';
import { decodeListCursor, defaultDirection, encodeListCursor, keysetAfter, listOrdering } from './list-cursor.js';

const ID = '00000000-0000-4000-8000-000000000001';

function refusal(act: () => unknown): HttpError | undefined {
  try {
    act();
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  return undefined;
}

describe('list-cursor — keyset paging on any sort (research R-12)', () => {
  it('has a default direction for every sort: newest first for the timestamps, ascending for the rest', () => {
    expect(Object.fromEntries(TASK_LIST_SORTS.map((sort) => [sort, defaultDirection(sort)]))).toEqual({
      created: 'desc',
      number: 'desc',
      title: 'asc',
      due: 'asc',
      priority: 'asc',
      status: 'asc',
      updated: 'desc',
    });
  });

  for (const sort of TASK_LIST_SORTS) {
    for (const dir of ['asc', 'desc'] as const) {
      it(`round-trips a ${sort} ${dir} cursor, with a key and with a null key`, () => {
        for (const key of ['2026-10-28 10:00:00.123456+00', null]) {
          const cursor = encodeListCursor({ sort, dir, key, id: ID });
          expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(decodeListCursor(cursor, sort, dir)).toEqual({ key, id: ID });
        }
      });
    }
  }

  it('answers no position for no cursor', () => {
    expect(decodeListCursor(undefined, 'created', 'desc')).toBeNull();
    expect(decodeListCursor('', 'created', 'desc')).toBeNull();
  });

  it('refuses a tampered cursor with 400: garbage, another sort or direction, a bad id, a non-text key', () => {
    const issued = encodeListCursor({ sort: 'title', dir: 'asc', key: 'a', id: ID });
    const tampered = [
      () => decodeListCursor('not-a-cursor!', 'title', 'asc'),
      () => decodeListCursor(Buffer.from('{"s":"title"', 'utf8').toString('base64url'), 'title', 'asc'),
      () => decodeListCursor(issued, 'due', 'asc'),
      () => decodeListCursor(issued, 'title', 'desc'),
      () =>
        decodeListCursor(
          Buffer.from(JSON.stringify({ s: 'title', d: 'asc', k: 'a', i: 'x' }), 'utf8').toString('base64url'),
          'title',
          'asc',
        ),
      () =>
        decodeListCursor(
          Buffer.from(JSON.stringify({ s: 'title', d: 'asc', k: 7, i: ID }), 'utf8').toString('base64url'),
          'title',
          'asc',
        ),
    ];
    for (const act of tampered) {
      const error = refusal(act);
      expect(error?.statusCode).toBe(400);
    }
  });

  it('orders by the sort key with nulls last in both directions, then by id', () => {
    for (const sort of TASK_LIST_SORTS) {
      expect(listOrdering(sort, 'asc', 't').orderBy).toMatch(/ asc nulls last, t\."id" asc$/);
      expect(listOrdering(sort, 'desc', 't').orderBy).toMatch(/ desc nulls last, t\."id" desc$/);
    }
    expect(listOrdering('created', 'desc', 't').key).toBe('t."created_at"');
    expect(listOrdering('priority', 'asc', 't').key).toContain('"task_priorities"');
    expect(listOrdering('status', 'asc', 't').key).toContain('"task_statuses"');
  });

  it('after a row with a key: further along the key, the same key and a later id, or no key at all (nulls last)', () => {
    const after = keysetAfter('title', 'asc', 't', { key: 'b', id: ID });
    expect(after.sql).toContain('is null');
    expect(after.sql).toContain(' > ');
    expect(after.params).toEqual(['b', 'b', ID]);
    const before = keysetAfter('title', 'desc', 't', { key: 'b', id: ID });
    expect(before.sql).toContain(' < ');
  });

  it('after a row without a key: only keyless rows remain, by id', () => {
    const asc = keysetAfter('due', 'asc', 't', { key: null, id: ID });
    expect(asc.sql).toMatch(/is null and t\."id" > \?::uuid/);
    expect(asc.params).toEqual([ID]);
    const desc = keysetAfter('due', 'desc', 't', { key: null, id: ID });
    expect(desc.sql).toMatch(/is null and t\."id" < \?::uuid/);
  });

  it('casts the key back to its own type: a timestamp, an integer weight, text', () => {
    expect(keysetAfter('created', 'desc', 't', { key: 'x', id: ID }).sql).toContain('?::timestamptz');
    expect(keysetAfter('priority', 'asc', 't', { key: '10', id: ID }).sql).toContain('?::int');
    expect(keysetAfter('number', 'desc', 't', { key: 'TSK-1', id: ID }).sql).toContain('?::text');
  });
});
