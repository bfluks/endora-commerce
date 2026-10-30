/**
 * Large sets of asset ids in a query (`specs/166-asset-reference-visibility/`
 * T049): a restricted reader's exclusion can hold thousands of ids, and the
 * ORM's `$in` / `$nin` expand each into one bind parameter, which the measured
 * list paid for twice (the scoping read and the page). Here a set is **one**
 * parameter, a Postgres uuid array, and the scoping read hydrates no entity.
 *
 * Every id in a set comes from a uuid column (an owner's `asset_id`, or the
 * `assets` table itself), and the array is typed `uuid[]`, so a value that is
 * not a uuid fails the cast rather than reaching the statement as text.
 */
import { raw } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Asset } from '../entities/asset.entity.js';

const uuidArray = (ids: readonly string[]): string => `{${ids.join(',')}}`;

/** A clause for an `Asset` `where`: the row's id is none of `ids`. */
export function idNotAmong(ids: readonly string[]): Record<string, unknown> {
  return { [raw((alias: string) => `${alias}."id" <> all(?::uuid[])`, [uuidArray(ids)])]: [] };
}

/** The ids of `candidates` that match `where` — one statement, ids only, nothing hydrated. */
export async function assetIdsAmong(
  em: EntityManager,
  where: Record<string, unknown>,
  candidates: readonly string[],
): Promise<string[]> {
  const rows = (await em
    .createQueryBuilder(Asset, 'a')
    .select('a.id')
    .where(where)
    .andWhere('a.id = any(?::uuid[])', [uuidArray(candidates)])
    .execute('all', false)) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
