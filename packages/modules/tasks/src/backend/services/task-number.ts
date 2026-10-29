import type { EntityManager } from '@mikro-orm/postgresql';

const PREFIX = 'TSK-';
const PAD = 6;

/**
 * The human-readable number of a Task: `TSK-` and the sequence value,
 * zero-padded to six digits (`TSK-000123`, research R-19). A value past six
 * digits is written in full — the padding is a floor, never a truncation.
 *
 * The sequence value arrives from the driver as a string (`bigint`), so both
 * spellings are accepted.
 */
export function formatTaskNumber(sequenceValue: number | string | bigint): string {
  const digits = String(sequenceValue).trim();
  if (!/^[1-9]\d*$/.test(digits)) {
    throw new Error(`tasks: "${String(sequenceValue)}" is not a value of tasks_number_seq.`);
  }
  return `${PREFIX}${digits.padStart(PAD, '0')}`;
}

/**
 * The next number, taken from `tasks_number_seq` on the caller's transaction.
 * A sequence does not roll back, so a refused create leaves a gap rather than
 * a duplicate — which is the trade a sequence is for.
 */
export async function nextTaskNumber(em: EntityManager): Promise<string> {
  const rows = (await em.execute(`select nextval('tasks_number_seq') as value`)) as Array<{
    value: string | number;
  }>;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('tasks: tasks_number_seq returned no value.');
  return formatTaskNumber(value);
}
