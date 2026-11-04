import type { AttributeScope } from '@endora-commerce/contracts';

/**
 * Feature 163 (FR-017 b, `specs/163-product-data-scopes/research.md` R19) —
 * #384's storefront walk (`channelOverrideFor` / `effectiveSystemText` /
 * `effectiveAttributeValues` in `@endora-commerce/contracts`) restated as SQL,
 * so a listing can search, filter, count and sort by the value a card shows.
 *
 * The walk, over the language chain `languages` (`overrideLanguages(L, channel
 * default)`): at each language, the (channel, language) override answers; else
 * the walk stops where the baseline answers. If nothing stopped it and the
 * baseline is a per-language object, its **first key** is a last leg. Whatever
 * stopped it, the channel-only override is asked last; else the baseline.
 *
 * The override rows of one product, one attribute and one channel are read once
 * per row, as a JSON object keyed by language (`''` for the channel-only slot —
 * a language code is never empty), so the expression costs one keyed lookup per
 * product however long the chain is. PostgreSQL's `jsonb` keeps object keys in
 * one stored order, and both `jsonb_object_keys` here and the driver's parsed
 * object (`Object.keys`) read that order, so "first key" is one key on both sides.
 *
 * `backend/test/integration/catalog/effective-text-parity.test.ts` holds the SQL
 * equal to the TypeScript walk over a grid.
 *
 * Descriptions, never `raw()` fragments — the caller creates the key in the
 * expression that executes it (`catalog-query.service.ts`' rule). Every bound
 * value is collected **as the SQL is written**, so the placeholders and the
 * values cannot come apart.
 */

/** Where the walk runs: the request's channel and its language chain. */
export interface EffectiveValueScope {
  channelId: string;
  /** `overrideLanguages(L, channel default)` — ordered, de-duplicated. */
  languages: readonly string[];
}

/** An SQL expression over a row alias, with the values its `?` placeholders bind, in order. */
export interface SqlExpression {
  sql: (alias: string) => string;
  params: unknown[];
}

/** Writes SQL left to right and binds each value where its `?` is written. */
class Writer {
  readonly params: unknown[] = [];
  bind(value: unknown): string {
    this.params.push(value);
    return '?';
  }
}

/**
 * `isNonEmpty` for a `jsonb` value: a missing or JSON `null` value is empty, as is `""`, `[]`, `{}`.
 *
 * The two scalar kinds that are always non-empty are named rather than left to
 * an `else`: a missing key is SQL `NULL`, `jsonb_typeof(NULL)` is `NULL`, and a
 * simple `case` over a `NULL` matches no `when` — an `else true` would read every
 * absent override slot as present and stop the walk at its first leg.
 */
function nonEmpty(x: () => string): string {
  return (
    `coalesce(case jsonb_typeof(${x()}) ` +
    `when 'string' then (${x()} #>> '{}') <> '' ` +
    `when 'array' then jsonb_array_length(${x()}) > 0 ` +
    `when 'object' then ${x()} <> '{}'::jsonb ` +
    `when 'number' then true ` +
    `when 'boolean' then true ` +
    `else false end, false)`
  );
}

/** The baseline's first key, or `null` when it is not an object. */
function firstKey(base: () => string): string {
  return `(case when jsonb_typeof(${base()}) = 'object' then (select k from jsonb_object_keys(${base()}) k limit 1) end)`;
}

/**
 * The walk as SQL. `base()` renders the baseline (it may bind values, so it is
 * rendered at each use); `pick(v)` turns the override that answered into the
 * result; `rest()` is "no override applies".
 */
function walk(
  w: Writer,
  base: () => string,
  scope: EffectiveValueScope,
  languageScoped: boolean,
  pick: (overrideValue: () => string) => string,
  rest: () => string,
): string {
  const slot = (language: () => string) => () => `(ov.m -> ${language()})`;
  const channelOnly = () => `(ov.m -> '')`;
  const channelOrRest = () => `(case when ${nonEmpty(channelOnly)} then ${pick(channelOnly)} else ${rest()} end)`;
  const parts: string[] = [];
  for (const language of scope.languages) {
    const bound = () => `${w.bind(language)}::text`;
    if (languageScoped) {
      parts.push(`when ${nonEmpty(slot(bound))} then ${pick(slot(bound))}`);
    }
    const answers =
      `(case when jsonb_typeof(${base()}) = 'object' ` +
      `then ${nonEmpty(() => `(${base()} -> ${bound()})`)} else ${nonEmpty(base)} end)`;
    parts.push(`when ${answers} then ${channelOrRest()}`);
  }
  if (languageScoped) {
    const first = slot(() => firstKey(base));
    parts.push(
      `when (case when jsonb_typeof(${base()}) = 'object' then ${nonEmpty(first)} else false end) then ${pick(first)}`,
    );
  }
  return `(case ${parts.join(' ')} else ${channelOrRest()} end)`;
}

/**
 * The override rows of one product, attribute and channel, keyed by language
 * (`''` = the channel-only slot). Written **after** the select list that reads
 * `ov.m`, so it binds after it.
 */
function overridesOf(w: Writer, alias: string, attributeKey: string, channelId: string): string {
  return (
    `(select coalesce(jsonb_object_agg(coalesce(o.language_code, ''), o.value -> 'v'), '{}'::jsonb) as m ` +
    `from product_value_overrides o ` +
    `where o.product_id = ${alias}.id and o.attribute_key = ${w.bind(attributeKey)} and o.channel_id = ${w.bind(channelId)})`
  );
}

/**
 * The storefront's baseline pick of a per-language text (`pickLang`): the first
 * leg holding a non-empty string, else the first key's value, else `''`.
 */
function baselinePick(w: Writer, base: string, languages: readonly string[]): string {
  const legs = languages.map((language) => `nullif(${base} ->> ${w.bind(language)}::text, '')`);
  const first = `(case when jsonb_typeof(${base}) = 'object' then (select e.value from jsonb_each_text(${base}) e limit 1) end)`;
  return `coalesce(${[...legs, first].join(', ')}, '')`;
}

function render(build: (w: Writer, alias: string) => string): SqlExpression {
  const probe = new Writer();
  build(probe, 'a');
  return { sql: (alias) => build(new Writer(), alias), params: probe.params };
}

/**
 * The effective Name (or Description) a storefront card shows at (channel,
 * language chain) — `effectiveSystemText(overrides, key, { channelId,
 * languages }, baseline, pickLang(baseline, …))` as one `text` expression.
 *
 * `pickLanguages` is the chain the card's baseline pick walks (`pickLang`'s:
 * the request language, the channel default, `en-US`, `en`).
 */
export function effectiveTextSql(
  attributeKey: 'name' | 'description',
  scope: EffectiveValueScope,
  pickLanguages: readonly string[] = scope.languages,
): SqlExpression {
  return render((w, alias) => {
    const base = `${alias}.${attributeKey}`;
    const text = (v: () => string) =>
      `(case when jsonb_typeof(${v()}) = 'string' and (${v()} #>> '{}') <> '' then ${v()} #>> '{}' ` +
      `else ${baselinePick(w, base, pickLanguages)} end)`;
    const body = walk(w, () => base, scope, true, text, () => baselinePick(w, base, pickLanguages));
    return `(select ${body} from ${overridesOf(w, alias, attributeKey, scope.channelId)} ov)`;
  });
}

/**
 * The effective value of a user attribute (`effectiveAttributeValues`) as a
 * `jsonb` expression: the override the walk lands on, else the baseline
 * `attribute_values -> key`. An attribute that is not channel-scoped has no
 * override slot and is its baseline.
 */
export function effectiveAttributeSql(
  attributeKey: string,
  attributeScope: AttributeScope,
  scope: EffectiveValueScope,
): SqlExpression {
  return render((w, alias) => {
    const base = () => `(${alias}.attribute_values -> ${w.bind(attributeKey)}::text)`;
    if (!attributeScope.channelScoped) return base();
    const body = walk(w, base, scope, attributeScope.languageScoped, (v) => v(), base);
    return `(select ${body} from ${overridesOf(w, alias, attributeKey, scope.channelId)} ov)`;
  });
}
