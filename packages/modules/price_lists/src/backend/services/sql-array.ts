/**
 * A Postgres array literal for one bound parameter — the module's one way to
 * hand an array to a statement (`= any(?::uuid[])`, `unnest(?::numeric[])`).
 *
 * Not a JavaScript array: `em.execute` formats its parameters into the
 * statement on the client (MikroORM's `Platform.formatQuery`), and an array
 * there becomes a comma-separated list of values, not one array. A literal
 * string is one value, escaped as a string by the same formatter; this builds
 * the literal itself correctly: every element double-quoted, with `\` and `"`
 * escaped, and `null` as an unquoted `NULL`. The hand-built literals it
 * replaces escaped `"` but not `\`, so an attribute key holding a backslash was
 * read as another key, or made the literal malformed (review finding 10 of
 * release 0.108.0).
 */
export function pgArray(values: ReadonlyArray<string | number | bigint | null>): string {
  return `{${values
    .map((value) =>
      value === null ? 'NULL' : `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
    )
    .join(',')}}`;
}
