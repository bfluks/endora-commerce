'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { CustomField } from '@puckeditor/core';
import { useColorPalette } from '../color-palette/context.js';
import { PuckFieldLabel } from './puck-field-label.js';
import {
  colorFieldCommitValue,
  colorFieldDisplayValue,
  colorPickerDisplayHex,
  INHERITED_COLOR,
  isBrandColorToken,
  isInheritedColor,
  isTransparentColor,
  isValidHexColor,
  parseColorTextInput,
  type ColorValueOptions,
} from './color-field-utils.js';
import { NativeColorInput } from './native-color-input.js';
import { useFieldText } from './field-text.js';
import { PB_FIELD_HINT_CLASS, PB_FIELD_INPUT_CLASS } from './field-classes.js';
import { getStoredScope } from '../editor/settings-scope-store.js';
import { useComponentScope } from '../editor/use-component-scope.js';
import { usePageBuilderPuck } from '../editor/use-page-builder-puck.js';
import { PB_RESPONSIVE_METADATA, isResponsiveProp, type SettingsScope } from '../types/responsive.js';
import type { Responsive } from '../types/page-builder-props.js';

const controlHeightClass = 'h-9';
const DEBOUNCE_MS = 250;

function ColorFieldControl({
  value,
  onChange,
  readOnly,
  label,
  hint,
  inherit = false,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean | undefined;
  label: string;
  /** A line under the row (the responsive field's inherited colour). */
  hint?: string | undefined;
  /** R18 (T222): the field's empty state is `currentColor` (inherit the text colour), with an Inherit action. */
  inherit?: boolean | undefined;
}): ReactElement {
  const palette = useColorPalette();
  const text = useFieldText();
  // Brand tokens (`token:<role>`) only where the palette offers them (T040).
  const tokens = palette?.brandRoles === true;
  const valueOptions: ColorValueOptions = { tokens };
  const committedDisplay = colorFieldDisplayValue(value);
  const [draft, setDraft] = useState(committedDisplay);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(colorFieldDisplayValue(value));
  }, [value]);

  const flushDebounce = useCallback((): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const commit = useCallback(
    (next: string): void => {
      flushDebounce();
      // R18 (T222): in a field that inherits, an emptied box (or the word itself) is `currentColor`.
      if (inherit && (next === '' || next === 'transparent' || isInheritedColor(next))) {
        setDraft('');
        onChange(INHERITED_COLOR);
        return;
      }
      const display = colorFieldDisplayValue(next === 'transparent' ? undefined : next);
      const committed = colorFieldCommitValue(next, { tokens });
      setDraft(display);
      onChange(committed);
    },
    [flushDebounce, onChange, tokens, inherit],
  );

  const scheduleCommit = useCallback(
    (next: string): void => {
      flushDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const committed = colorFieldCommitValue(next, { tokens });
        const currentCommitted = colorFieldCommitValue(value ?? '', { tokens });
        if (committed !== currentCommitted) {
          onChange(committed);
        }
      }, DEBOUNCE_MS);
    },
    [flushDebounce, onChange, value, tokens],
  );

  useEffect(() => (): void => flushDebounce(), [flushDebounce]);

  const onTextChange = (raw: string): void => {
    const parsed = parseColorTextInput(raw, valueOptions);
    setDraft(parsed.display);
    if (parsed.commit !== undefined || parsed.display === '') {
      commit(parsed.commit ?? 'transparent');
      return;
    }
    scheduleCommit(parsed.display);
  };

  const onTextBlur = (): void => {
    flushDebounce();
    if (isValidHexColor(draft) || (tokens && isBrandColorToken(draft))) {
      commit(draft);
      return;
    }
    if (isTransparentColor(draft) || (inherit && isInheritedColor(draft))) {
      commit(isInheritedColor(draft) ? draft : 'transparent');
      return;
    }
    setDraft(committedDisplay);
  };

  // R18 (T222): a colour that inherits the text colour shows as such — an
  // empty box with an "Inherited (text color)" placeholder and a swatch marked
  // as inherited — never as the raw `currentColor`.
  const inherited = isInheritedColor(value) && draft === '';

  // One row that never outgrows its column (T115: this row is what made the
  // side bar scroll sideways wherever a colour field sat): the swatch and the
  // palette button keep their size, the text box takes what is left and may
  // shrink to nothing (`min-w-0`). A `<div>` and not Puck's `<label>`: a
  // `<label>` names only the first of the three controls, so each one carries
  // its own name.
  return (
    <PuckFieldLabel label={label} el="div" {...(readOnly === true ? { readOnly: true } : {})}>
      <div
        className={`flex min-w-0 max-w-full items-center gap-2 ${controlHeightClass}`}
        data-pb-color-row=""
        {...(inherited ? { 'data-pb-color-inherited': '' } : {})}
      >
        <span className="relative inline-flex shrink-0">
          <NativeColorInput
            className={`${controlHeightClass} w-10 shrink-0 cursor-pointer rounded border border-border p-0.5`}
            readOnly={readOnly}
            ariaLabel={text('color.picker', { label })}
            value={colorPickerDisplayHex(draft)}
            onCommit={(hex): void => commit(hex)}
          />
          {inherited ? (
            // The inherited swatch: half the text colour, half the page, over the picker (clicks pass through).
            <span
              aria-hidden="true"
              data-pb-color-swatch-inherited=""
              className="pointer-events-none absolute inset-[3px] rounded-sm border border-border"
              style={{ background: 'linear-gradient(135deg, currentColor 0 50%, transparent 50% 100%)' }}
            />
          ) : null}
        </span>
        <input
          type="text"
          aria-label={label}
          className={`${PB_FIELD_INPUT_CLASS} ${controlHeightClass} flex-1`}
          readOnly={readOnly}
          value={draft}
          placeholder={inherited ? text('color.inherited') : text('color.transparent')}
          onChange={(e): void => onTextChange(e.target.value)}
          onBlur={onTextBlur}
        />
        {palette ? (
          <button
            type="button"
            aria-label={text('color.paletteFor', { label })}
            className={`${controlHeightClass} shrink-0 cursor-pointer rounded border border-border bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            disabled={readOnly === true}
            onClick={(): void => palette.openPalette((picked) => commit(picked))}
          >
            {text('color.palette')}
          </button>
        ) : null}
        {inherit && !inherited ? (
          <button
            type="button"
            aria-label={text('color.inheritFor', { label })}
            className={`${controlHeightClass} shrink-0 cursor-pointer rounded border border-border bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            disabled={readOnly === true}
            onClick={(): void => commit(INHERITED_COLOR)}
          >
            {text('color.inherit')}
          </button>
        ) : null}
      </div>
      {hint ? <p className={PB_FIELD_HINT_CLASS}>{hint}</p> : null}
    </PuckFieldLabel>
  );
}

/**
 * A colour. `inherit: true` (R18, T222) is a colour whose empty state inherits
 * the surrounding text colour: it stores `currentColor`, shows it as
 * "Inherited (text color)", and offers an **Inherit** action once a colour is
 * picked. Without it, an emptied box stores nothing, as before.
 */
export function createColorField(options: { label: string; inherit?: boolean }): CustomField<string | undefined> {
  return {
    type: 'custom',
    label: options.label,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <ColorFieldControl
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={field.label ?? options.label}
        inherit={options.inherit === true}
      />
    ),
  };
}

/**
 * A colour per breakpoint — `specs/163-page-builder-marketing-pages/` T181
 * (`cms.LinkTile`'s resting title and label colour). A **responsive** field,
 * as the aspect-ratio field is: the responsive metadata puts it on the
 * Responsive tab, and it edits the breakpoint that tab's scope switcher
 * selects, with the colour control of {@link createColorField}.
 *
 * A colour has no default, so a breakpoint set first is stored without a base
 * (T170: the block's own look below it); a value with only its base is stored
 * plain, as the single colour field writes it, and clearing the last colour
 * writes nothing. Above the base, a breakpoint with no colour of its own shows
 * an empty box and the colour it inherits.
 */
export type ResponsiveColorProp = string | Responsive<string>;

const COLOR_SCOPES: readonly SettingsScope[] = ['base', 'tablet', 'desktop'];

function colorAt(value: ResponsiveColorProp | undefined, scope: SettingsScope): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (isResponsiveProp<string>(value)) return value[scope];
  return typeof value === 'string' && scope === 'base' ? value : undefined;
}

function inheritedColor(value: ResponsiveColorProp | undefined, scope: SettingsScope): string | undefined {
  for (let index = COLOR_SCOPES.indexOf(scope) - 1; index >= 0; index -= 1) {
    const below = colorAt(value, COLOR_SCOPES[index]!);
    if (below !== undefined) return below;
  }
  return undefined;
}

/** The value with `scope`'s colour set (or removed): plain with only a base, `undefined` with none. */
export function writeResponsiveColor(
  value: ResponsiveColorProp | undefined,
  scope: SettingsScope,
  next: string | undefined,
): ResponsiveColorProp | undefined {
  const current: { base?: string; tablet?: string; desktop?: string } = {};
  for (const tier of COLOR_SCOPES) {
    const own = colorAt(value, tier);
    if (own !== undefined) current[tier] = own;
  }
  if (next === undefined || next === '') delete current[scope];
  else current[scope] = next;
  if (current.tablet === undefined && current.desktop === undefined) return current.base;
  return current as Responsive<string>;
}

function ResponsiveColorControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: ResponsiveColorProp | undefined;
  onChange: (value: ResponsiveColorProp | undefined) => void;
  readOnly?: boolean | undefined;
  label: string;
}): ReactElement {
  const text = useFieldText();
  const componentId = usePageBuilderPuck((state) => state.selectedItem?.props.id as string | undefined);
  const scope = useComponentScope(componentId);
  // The scope is read again at write time: a change of scope between render and event is the user's latest choice.
  const componentIdRef = useRef(componentId);
  componentIdRef.current = componentId;
  const valueRef = useRef(value);
  valueRef.current = value;
  const own = colorAt(value, scope);
  const inherited = own === undefined && scope !== 'base' ? inheritedColor(value, scope) : undefined;
  const write = useCallback(
    (next: string | undefined): void =>
      onChange(writeResponsiveColor(valueRef.current, getStoredScope(componentIdRef.current), next)),
    [onChange],
  );
  return (
    <ColorFieldControl
      value={own}
      onChange={write}
      readOnly={readOnly}
      label={label}
      hint={inherited !== undefined ? text('tier.inheritValue', { value: inherited }) : undefined}
    />
  );
}

export function createResponsiveColorField(options: { label: string }): CustomField<ResponsiveColorProp | undefined> {
  return {
    type: 'custom',
    label: options.label,
    metadata: PB_RESPONSIVE_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <ResponsiveColorControl
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={field.label ?? options.label}
      />
    ),
  };
}
