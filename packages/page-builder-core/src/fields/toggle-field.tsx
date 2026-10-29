'use client';

import type { ReactElement } from 'react';
import type { CustomField } from '@puckeditor/core';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';
import { isResponsiveField, type ResponsiveProp } from '../types/responsive.js';
import { ScopedFieldHint, ScopedResetLink, readScopedValue, writeScopedValue } from './scoped-field.js';

/**
 * One control for every true/false setting of a block
 * (`specs/163-page-builder-marketing-pages/` R17, T199): a switch, instead of
 * Yes/No and Show/Hide radios, a select with No/Yes, or a bare checkbox.
 *
 * It stores the same booleans those controls stored, so nothing stored
 * changes. While the prop is unset the switch shows `defaultValue` — the value
 * the block renders with — and the first change writes a boolean.
 *
 * Accessibility: a native `<button role="switch">` (Space and Enter operate
 * it), `aria-checked` for its state, named by the words it shows beside it,
 * inside one `<label>` so a click on the words toggles it too.
 */
export interface ToggleFieldOptions {
  label: string;
  /** What the block renders while the prop is unset; `false` by default. */
  defaultValue?: boolean;
  /** Field metadata (e.g. the responsive flag), passed through. */
  metadata?: Record<string, unknown>;
}

/**
 * The switch itself, for a custom control with a boolean among its settings
 * (the border's "Show border", a link's "Open in new tab"). `size="sm"` is the
 * weight of a control's own sub-setting rather than a field label.
 */
export function ToggleSwitch({
  label,
  checked,
  readOnly,
  onChange,
  size = 'field',
}: {
  label: string;
  checked: boolean;
  readOnly: boolean;
  onChange: (next: boolean) => void;
  size?: 'field' | 'sm';
}): ReactElement {
  return (
    <label
      className={
        'flex min-h-6 cursor-pointer items-center justify-between gap-3 text-[color:var(--puck-color-text,#000000)] ' +
        (size === 'sm' ? 'text-xs' : 'text-sm font-semibold')
      }
    >
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={readOnly}
        onClick={(): void => onChange(!checked)}
        className={
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-solid p-0 transition-colors ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ' +
          (checked
            ? 'border-[color:var(--puck-color-azure-04,#0158ad)] bg-[color:var(--puck-color-azure-04,#0158ad)]'
            : 'border-[color:var(--puck-color-grey-07,#767676)] bg-[color:var(--puck-color-grey-09,#dcdcdc)]')
        }
      >
        <span
          aria-hidden="true"
          className={
            'pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform ' +
            (checked ? 'translate-x-[18px]' : 'translate-x-[1px]')
          }
        />
      </button>
    </label>
  );
}

/**
 * A switch per breakpoint: the field carries the responsive metadata, so it
 * sits on the Responsive tab and edits the breakpoint its scope switcher
 * selects, as the spacing and aspect-ratio fields do. A plain stored boolean
 * is the value at every breakpoint.
 */
function ResponsiveToggle({
  label,
  value,
  fallback,
  readOnly,
  onChange,
}: {
  label: string;
  value: boolean | ResponsiveProp<boolean> | undefined;
  fallback: boolean;
  readOnly: boolean;
  onChange: (next: boolean | ResponsiveProp<boolean>) => void;
}): ReactElement {
  const componentId = usePageBuilderPuck((s) => s.selectedItem?.props.id as string | undefined);
  const scope = useComponentScope(componentId);
  const checked = readScopedValue<boolean>(value, scope, fallback) === true;
  return (
    <div className="space-y-1">
      <ScopedFieldHint value={value} scope={scope} fallback={fallback} />
      <ScopedResetLink value={value} scope={scope} fallback={fallback} onChange={onChange as (next: unknown) => void} readOnly={readOnly} />
      <ToggleSwitch
        label={label}
        checked={checked}
        readOnly={readOnly}
        onChange={(next): void => onChange(writeScopedValue<boolean>(value, getStoredScope(componentId), next, fallback))}
      />
    </div>
  );
}

/** A Puck field holding one boolean, edited with a switch (T199); per breakpoint with the responsive metadata. */
export function createToggleField<T extends boolean | undefined = boolean | undefined>(options: ToggleFieldOptions): CustomField<T> {
  const fallbackLabel = options.label;
  const given = (options.metadata ?? {}) as { pageBuilder?: Record<string, unknown> };
  const field: CustomField<boolean | ResponsiveProp<boolean> | undefined> = {
    type: 'custom',
    label: fallbackLabel,
    // `pageBuilder.toggle` names the field a switch for readers that list a field's values (true and false).
    metadata: { ...given, pageBuilder: { ...(given.pageBuilder ?? {}), toggle: true } },
    render: ({ value, onChange, readOnly, field: host }): ReactElement =>
      isResponsiveField(host as never) ? (
        <ResponsiveToggle
          label={host.label ?? fallbackLabel}
          value={value}
          fallback={options.defaultValue === true}
          readOnly={readOnly === true}
          onChange={onChange}
        />
      ) : (
        <ToggleSwitch
          label={host.label ?? fallbackLabel}
          checked={typeof value === 'boolean' ? value : options.defaultValue === true}
          readOnly={readOnly === true}
          onChange={onChange}
        />
      ),
  };
  // Typed as the boolean the blocks declare; a responsive one also stores `{ base, tablet, desktop }`.
  return field as unknown as CustomField<T>;
}
