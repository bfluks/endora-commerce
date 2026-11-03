/**
 * A Postgres array literal of ids for one bound parameter. `em.execute` formats
 * a JavaScript array as a list of values, not one array, so the literal is
 * built here: every element double-quoted, `\` and `"` escaped.
 *
 * Bind it as `= any(?::uuid[])`: one parameter and one parsed literal whatever
 * the size of the set — a whole channel's members can be the catalogue (the
 * sitemap, a reindex, a feed's count), where an `in (…)` list grows a statement
 * by one placeholder per id.
 */
export function uuidArrayLiteral(ids: readonly string[]): string {
  return `{${ids.map((id) => `"${id.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}

/** How many ids one `$in` read carries at most; a larger set is read in chunks. */
export const ID_CHUNK = 5_000;

/** `read` over `ids` in chunks of {@link ID_CHUNK}, the answers concatenated in order. */
export async function inIdChunks<T>(
  ids: readonly string[],
  read: (chunk: string[]) => Promise<readonly T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    out.push(...(await read(ids.slice(start, start + ID_CHUNK))));
  }
  return out;
}
