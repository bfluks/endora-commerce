import type { Config, ComponentConfig, Field, Fields } from '@puckeditor/core';
import { sharedFieldLabel } from '@endora-commerce/page-builder-core';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Resolve one block's palette label, or `undefined` when this resolver has
 * nothing to say about that name.
 *
 * Feature 096, T306. A block's `labelKey` is **module-relative and declared by
 * its owner** (`contracts/block-definition.md` §2), so `cms`' bundle is the
 * wrong place to look for `catalog.ProductGrid`'s label — and the key scheme
 * this file used, `pageBuilder.components.<name>`, cannot express the scope at
 * all. The caller builds this from the descriptor, which carries both the owner
 * and the key.
 */
export type BlockLabelResolver = (name: string) => string | undefined;

/**
 * Resolve one key of a block's field-label tree, or `undefined` when the
 * declaring module's bundle has no such key (feature 163, research R-24).
 *
 * `key` is relative to the block's label-key stem: `fields.<field>.label`,
 * `fields.<field>.options.<value>`, and for a sub-field of an object or array
 * field `fields.<field>.fields.<sub>.…`; a field relabelled for one placement
 * names its own sibling of `label` (`metadata.pageBuilder.labelKey`). The caller builds this from the
 * descriptor, which carries the owner and the `labelKey` the stem is cut from.
 */
export type BlockFieldLabelResolver = (name: string, key: string) => string | undefined;

/**
 * Resolve one key of a **shared** field's translation — `<key>.label` or
 * `<key>.options.<value>` of a field the page builder owns (editor name, "Hide
 * on", box spacing, border, background, corners, shadow, typography), from
 * the `core` bundle's `pageBuilder.sharedFields.` (feature 163, R17, T200).
 * Read after the block's own key and before the English.
 */
export type SharedFieldLabelResolver = (key: string) => string | undefined;

type FieldCache = Map<string, WeakMap<object, Field>>;

type Resolve = (key: string) => string | undefined;

function translateField(field: Field, path: string, resolve: Resolve, cache: FieldCache, shared: Resolve): Field {
  if (!field || typeof field !== 'object') return field;
  let byField = cache.get(path);
  const cached = byField?.get(field);
  if (cached) return cached;

  const next = { ...field } as Field & {
    label?: string;
    options?: Array<{ label: string; value: unknown }>;
    objectFields?: Fields;
    arrayFields?: Fields;
  };
  // A block may relabel a field for one placement; it names the sibling key
  // of that label in `metadata.pageBuilder.labelKey` (e.g. `topLevelLabel`).
  const variant = (field as { metadata?: { pageBuilder?: { labelKey?: unknown } } }).metadata?.pageBuilder?.labelKey;
  // R17 (T200): a field the page builder owns falls back to its one shared translation.
  const sharedKey = sharedFieldLabel(field)?.key;
  const label = resolve(`${path}.${typeof variant === 'string' ? variant : 'label'}`) ?? (sharedKey ? shared(`${sharedKey}.label`) : undefined);
  if (label !== undefined) next.label = label;
  // A custom field may carry options too (R17: the item open at first); they translate alike.
  const options = (field as { options?: unknown }).options;
  if ((field.type === 'select' || field.type === 'radio' || field.type === 'custom') && Array.isArray(options)) {
    next.options = (options as Array<{ label: string; value: unknown }>).map((option) => {
      const translated =
        resolve(`${path}.options.${String(option.value)}`) ??
        (sharedKey ? shared(`${sharedKey}.options.${String(option.value)}`) : undefined);
      return translated === undefined ? option : { ...option, label: translated };
    });
  }
  if (field.type === 'object' && field.objectFields) {
    next.objectFields = translateFields(field.objectFields as Fields, path, resolve, cache, shared);
  }
  if (field.type === 'array' && field.arrayFields) {
    next.arrayFields = translateFields(field.arrayFields as Fields, path, resolve, cache, shared);
    // A list whose item is one choice (e.g. the hero's order of elements), or
    // that names the select summarising its items (`metadata.pageBuilder.summaryField`, the
    // hero's space after an element, T145), is summarised by that choice's
    // label, translated; anything else keeps the block's own summary.
    const entries = Object.entries(field.arrayFields as Fields);
    const [only] = entries;
    const own = (field as { getItemSummary?: (item: unknown, index?: number) => string }).getItemSummary;
    const named = (field as { metadata?: { pageBuilder?: { summaryField?: unknown } } }).metadata?.pageBuilder?.summaryField;
    const summaryKey =
      typeof named === 'string' && (field.arrayFields as Record<string, Field>)[named]?.type === 'select'
        ? named
        : entries.length === 1 && only && (only[1] as Field).type === 'select'
          ? only[0]
          : undefined;
    if (summaryKey !== undefined) {
      const key = summaryKey;
      (next as { getItemSummary?: (item: unknown, index?: number) => string }).getItemSummary = (item, index) => {
        const value = (item as Record<string, unknown> | null | undefined)?.[key];
        const translated = value === undefined ? undefined : resolve(`${path}.fields.${key}.options.${String(value)}`);
        return translated ?? own?.(item, index) ?? String(value ?? '');
      };
    }
  }

  if (!byField) {
    byField = new WeakMap();
    cache.set(path, byField);
  }
  byField.set(field, next as Field);
  return next as Field;
}

function translateFields(fields: Fields, base: string, resolve: Resolve, cache: FieldCache, shared: Resolve): Fields {
  const out: Record<string, Field> = {};
  for (const [name, field] of Object.entries(fields)) {
    out[name] = translateField(field as Field, base === '' ? `fields.${name}` : `${base}.fields.${name}`, resolve, cache, shared);
  }
  return out as Fields;
}

/**
 * The block's config with its field and option labels translated — the static
 * `fields` and whatever its `resolveFields` returns, since several blocks
 * build their field set there. A translated field is cached per source field
 * object, so `resolveFields` hands Puck the same object on every call (a
 * field recreated on every call loses its input focus).
 */
function withTranslatedFields(
  name: string,
  cfg: ComponentConfig,
  fieldLabel: BlockFieldLabelResolver,
  shared: SharedFieldLabelResolver,
): ComponentConfig {
  const resolve = (key: string): string | undefined => fieldLabel(name, key);
  const cache: FieldCache = new Map();
  const translate = (fields: Fields): Fields => translateFields(fields, '', resolve, cache, shared);
  const own = cfg.resolveFields;
  return {
    ...cfg,
    ...(cfg.fields ? { fields: translate(cfg.fields as Fields) } : {}),
    ...(own
      ? {
          resolveFields: (data, params) => {
            const resolved = own(data, params);
            return resolved instanceof Promise ? resolved.then(translate) : translate(resolved as Fields);
          },
        }
      : {}),
  } as ComponentConfig;
}

function translateOrFallback(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key);
  // Missing keys resolve to `cms.<key>` placeholders — keep the English label.
  if (value === `cms.${key}`) return fallback;
  return value;
}

/**
 * Apply i18n labels to Puck component titles (drawer / outline) and, with a
 * `fieldLabelFor`, to the blocks' field and option labels (feature 163, R-24);
 * a field the page builder owns falls back to `sharedFieldLabelFor` (R17), and
 * a label with no key keeps the config's English.
 *
 * **Categories are no longer touched here.** Their titles are resolved where the
 * palette is derived, in the owning module's scope, because a section's
 * `titleKey` belongs to whichever module's declaration won the merge
 * (`contracts/block-definition.md` §1.1). Translating them a second time in
 * `cms`' scope would either be a no-op or would overwrite the right answer with
 * a placeholder.
 */
export function applyPageBuilderTranslations(
  config: Config,
  t: TranslateFn,
  labelFor?: BlockLabelResolver,
  fieldLabelFor?: BlockFieldLabelResolver,
  sharedFieldLabelFor: SharedFieldLabelResolver = () => undefined,
): Config {
  const components = Object.fromEntries(
    Object.entries(config.components ?? {}).map(([name, cfg]) => {
      const fallback =
        typeof (cfg as ComponentConfig | undefined)?.label === 'string'
          ? ((cfg as ComponentConfig).label as string)
          : name;
      const declared = labelFor?.(name);
      const labelled = {
        ...cfg,
        label: declared ?? translateOrFallback(t, `pageBuilder.components.${name}`, fallback),
      } as ComponentConfig;
      return [name, fieldLabelFor ? withTranslatedFields(name, labelled, fieldLabelFor, sharedFieldLabelFor) : labelled];
    }),
  );

  return { ...config, components } as Config;
}
