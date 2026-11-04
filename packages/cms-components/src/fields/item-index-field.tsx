'use client';

import type { ReactElement } from 'react';
import { FieldLabel } from '@puckeditor/core';
import { PB_FIELD_INPUT_CLASS } from '@endora-commerce/page-builder-core';

/**
 * `specs/163-page-builder-marketing-pages/` R17 (T219) — "which item is open
 * (or shown) at first" as a choice among the block's own items rather than a
 * number to type: **None** (where the block allows it), then
 * `1: <item label>`, `2: <item label>`…
 *
 * It stores the index it always stored (a number; nothing for None). A stored
 * list — an accordion saved with several items open — reads as its first
 * element, the one this field ever wrote; the list itself is kept until the
 * editor picks another item.
 *
 * The options are built by the block's `resolveFields` from its items
 * ({@link itemIndexFieldFor}), the same object for the same items, so Puck
 * keeps the control's focus; they are translated by the admin like a select's
 * (`fields.<field>.options.none`).
 */

type Option = { label: string; value: number | 'none' };

export interface ItemIndexField {
  type: 'custom';
  label: string;
  options: Option[];
  render: (props: {
    value: unknown;
    onChange: (value: number | undefined) => void;
    readOnly?: boolean;
    field: { label?: string; options?: Option[] };
    id?: string;
  }) => ReactElement;
}

/** The stored value's index: a number, or a list's first number; `undefined` otherwise. */
export function storedItemIndex(value: unknown): number | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'number' && Number.isInteger(first) && first >= 0 ? first : undefined;
}

export function createItemIndexField(label: string, options: { none: boolean }): ItemIndexField {
  return {
    type: 'custom',
    label,
    options: options.none ? [{ label: 'None', value: 'none' }] : [],
    render: ({ value, onChange, readOnly, field, id }) => {
      const choices = field.options ?? [];
      const index = storedItemIndex(value);
      const selected = index !== undefined && choices.some((choice) => choice.value === index) ? String(index) : options.none ? 'none' : String(choices[0]?.value ?? '');
      return (
        <FieldLabel label={field.label ?? label} {...(readOnly === true ? { readOnly: true } : {})}>
          <select
            {...(id !== undefined ? { id } : {})}
            className={PB_FIELD_INPUT_CLASS}
            disabled={readOnly === true}
            value={selected}
            onChange={(event): void => onChange(event.target.value === 'none' ? undefined : Number(event.target.value))}
          >
            {choices.map((choice) => (
              <option key={String(choice.value)} value={String(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
        </FieldLabel>
      );
    },
  };
}

// Per host field object and item labels: the same field for the same items (focus is kept).
const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * The host's field (the block's own, or the admin's translated copy) with one
 * option per item: `1: <label>`, or the number alone for an item with no label.
 * Anything that is not this field is handed back as it is.
 */
export function itemIndexFieldFor<F>(field: F, labels: readonly string[]): F {
  const source = field as unknown as { type?: string; options?: Option[] } | null;
  if (!source || source.type !== 'custom' || !Array.isArray(source.options)) return field;
  const key = JSON.stringify(labels);
  let byItems = cache.get(source);
  if (!byItems) {
    byItems = new Map();
    cache.set(source, byItems);
  }
  const cached = byItems.get(key);
  if (cached) return cached as F;
  const none = source.options.filter((option) => option.value === 'none');
  const next = {
    ...source,
    options: [
      ...none,
      ...labels.map((text, index) => ({ label: text.trim() ? `${index + 1}: ${text.trim()}` : String(index + 1), value: index })),
    ],
  };
  byItems.set(key, next);
  return next as unknown as F;
}
