import type { EntityManager } from '@mikro-orm/postgresql';

const PREFIX = 'PRJ-';
const PAD = 6;

/**
 * The human-readable number of a Project: `PRJ-` and the sequence value,
 * zero-padded to six digits (`PRJ-000123`, research R-19). A value past six
 * digits is written in full — the padding is a floor, never a truncation.
 *
 * The sequence value arrives from the driver as a string (`bigint`), so every
 * spelling is accepted.
 */
export function formatProjectNumber(sequenceValue: number | string | bigint): string {
  const digits = String(sequenceValue).trim();
  if (!/^[1-9]\d*$/.test(digits)) {
    throw new Error(`projects: "${String(sequenceValue)}" is not a value of projects_number_seq.`);
  }
  return `${PREFIX}${digits.padStart(PAD, '0')}`;
}

/**
 * The next number, taken from `projects_number_seq` on the caller's
 * transaction. A sequence does not roll back, so a refused create leaves a gap
 * rather than a duplicate — the trade a sequence is for.
 */
export async function nextProjectNumber(em: EntityManager): Promise<string> {
  const rows = (await em.execute(`select nextval('projects_number_seq') as value`)) as Array<{
    value: string | number;
  }>;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('projects: projects_number_seq returned no value.');
  return formatProjectNumber(value);
}
